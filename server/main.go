// lc3d: the LC3 gateway API. Auth, per-student files, grading dispatch,
// worker admin. Serves HTTP on 127.0.0.1:8000 behind nginx.
package main

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	dataDir      = envOr("LC3_DATA", "/srv/lc3")
	upstreamConf = envOr("LC3_UPSTREAM_CONF", "/etc/nginx/lc3-upstream.conf")
	listenAddr   = envOr("LC3_LISTEN", "127.0.0.1:8000")
	store        *Store
)

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func studentsDir() string { return filepath.Join(dataDir, "students") }
func assignDir() string   { return filepath.Join(dataDir, "assignments") }

const sessionCookie = "lc3_session"

// ---------- helpers ----------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"detail": msg})
}

func readBody(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(io.LimitReader(r.Body, 40<<20)).Decode(v)
}

func currentUser(r *http.Request) *User {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return nil
	}
	return store.UserForSession(c.Value)
}

func requireUser(w http.ResponseWriter, r *http.Request) *User {
	u := currentUser(r)
	if u == nil {
		fail(w, 401, "not logged in")
	}
	return u
}

func requireTeacher(w http.ResponseWriter, r *http.Request) *User {
	u := requireUser(w, r)
	if u == nil {
		return nil
	}
	if u.Role != "teacher" {
		fail(w, 403, "teacher only")
		return nil
	}
	return u
}

func studentRoot(u *User) string {
	root := filepath.Join(studentsDir(), u.Username)
	_ = os.MkdirAll(root, 0o755)
	return root
}

// safePath resolves rel under root and refuses escapes.
func safePath(root, rel string) (string, error) {
	rel = strings.TrimLeft(rel, "/")
	p := filepath.Clean(filepath.Join(root, rel))
	if p != root && !strings.HasPrefix(p, root+string(os.PathSeparator)) {
		return "", fmt.Errorf("bad path")
	}
	return p, nil
}

func isDir(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

func validID(s string) bool {
	if s == "" || strings.HasPrefix(s, ".") {
		return false
	}
	for _, c := range s {
		ok := c == '-' || c == '_' || (c >= 'a' && c <= 'z') ||
			(c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
		if !ok {
			return false
		}
	}
	return true
}

// collectFiles walks dir and returns rel->base64, skipping dotfiles.
func collectFiles(dir string, maxPer, maxTotal int64) map[string]string {
	out := map[string]string{}
	var total int64
	_ = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		name := d.Name()
		if strings.HasPrefix(name, ".") && path != dir {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil || int64(len(data)) > maxPer {
			return nil
		}
		total += int64(len(data))
		if total > maxTotal {
			return filepath.SkipAll
		}
		rel, _ := filepath.Rel(dir, path)
		out[filepath.ToSlash(rel)] = base64.StdEncoding.EncodeToString(data)
		return nil
	})
	return out
}

// ---------- auth ----------

func setSession(w http.ResponseWriter, username string) {
	token := store.NewSession(username)
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/", MaxAge: int(sessionTTL.Seconds()),
		HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct{ Username, Password string }
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	body.Username = strings.TrimSpace(body.Username)
	u := store.GetUser(body.Username)
	if u == nil || !CheckPassword(body.Password, u.PwHash) {
		fail(w, 401, "bad username or password")
		return
	}
	setSession(w, u.Username)
	writeJSON(w, 200, map[string]any{"ok": true, "username": u.Username, "role": u.Role})
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		store.DropSession(c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, 200, map[string]any{"ok": true})
}

func handleMe(w http.ResponseWriter, r *http.Request) {
	u := requireUser(w, r)
	if u == nil {
		return
	}
	// lang is the student's single runtime, taken from their class. A student
	// with no class (or a teacher) has no runtime; the workbench then just
	// loads without a language engine.
	lang := ""
	if u.Class != "" {
		lang = store.ClassLang(u.Class)
	}
	writeJSON(w, 200, map[string]string{
		"username": u.Username, "role": u.Role, "class": u.Class, "lang": lang})
}

// ---------- student filesystem ----------

func fsPath(w http.ResponseWriter, r *http.Request, u *User, param string) (string, bool) {
	p, err := safePath(studentRoot(u), r.URL.Query().Get(param))
	if err != nil {
		fail(w, 400, "bad path")
		return "", false
	}
	return p, true
}

func handleFsStat(w http.ResponseWriter, r *http.Request) {
	u := requireUser(w, r)
	if u == nil {
		return
	}
	p, ok := fsPath(w, r, u, "path")
	if !ok {
		return
	}
	st, err := os.Stat(p)
	if err != nil {
		fail(w, 404, "not found")
		return
	}
	typ := "file"
	if st.IsDir() {
		typ = "dir"
	}
	writeJSON(w, 200, map[string]any{
		"type": typ, "size": st.Size(), "mtime": st.ModTime().UnixMilli()})
}

func handleFsList(w http.ResponseWriter, r *http.Request) {
	u := requireUser(w, r)
	if u == nil {
		return
	}
	p, ok := fsPath(w, r, u, "path")
	if !ok {
		return
	}
	entries, err := os.ReadDir(p)
	if err != nil {
		fail(w, 404, "not a directory")
		return
	}
	type ent struct {
		Name string `json:"name"`
		Type string `json:"type"`
	}
	out := []ent{}
	for _, e := range entries {
		typ := "file"
		if e.IsDir() {
			typ = "dir"
		}
		out = append(out, ent{e.Name(), typ})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	writeJSON(w, 200, map[string]any{"entries": out})
}

func handleFsRead(w http.ResponseWriter, r *http.Request) {
	u := requireUser(w, r)
	if u == nil {
		return
	}
	p, ok := fsPath(w, r, u, "path")
	if !ok {
		return
	}
	st, err := os.Stat(p)
	if err != nil || st.IsDir() {
		fail(w, 404, "not found")
		return
	}
	f, err := os.Open(p)
	if err != nil {
		fail(w, 404, "not found")
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	_, _ = io.Copy(w, io.LimitReader(f, 4<<20))
}

func handleFsWrite(w http.ResponseWriter, r *http.Request) {
	u := requireUser(w, r)
	if u == nil {
		return
	}
	p, ok := fsPath(w, r, u, "path")
	if !ok {
		return
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, 4<<20+1))
	if err != nil || len(data) > 4<<20 {
		fail(w, 413, "file too large")
		return
	}
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		fail(w, 500, "write failed")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func handleFsMkdir(w http.ResponseWriter, r *http.Request) {
	u := requireUser(w, r)
	if u == nil {
		return
	}
	p, ok := fsPath(w, r, u, "path")
	if !ok {
		return
	}
	_ = os.MkdirAll(p, 0o755)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func handleFsDelete(w http.ResponseWriter, r *http.Request) {
	u := requireUser(w, r)
	if u == nil {
		return
	}
	root := studentRoot(u)
	p, ok := fsPath(w, r, u, "path")
	if !ok {
		return
	}
	if p == root {
		fail(w, 400, "cannot delete root")
		return
	}
	_ = os.RemoveAll(p)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func handleFsRename(w http.ResponseWriter, r *http.Request) {
	u := requireUser(w, r)
	if u == nil {
		return
	}
	root := studentRoot(u)
	a, err1 := safePath(root, r.URL.Query().Get("src"))
	b, err2 := safePath(root, r.URL.Query().Get("dst"))
	if err1 != nil || err2 != nil {
		fail(w, 400, "bad path")
		return
	}
	if _, err := os.Stat(a); err != nil {
		fail(w, 404, "not found")
		return
	}
	_ = os.MkdirAll(filepath.Dir(b), 0o755)
	if err := os.Rename(a, b); err != nil {
		fail(w, 500, "rename failed")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// ---------- run bundle ----------

func handleRunBundle(w http.ResponseWriter, r *http.Request) {
	u := requireUser(w, r)
	if u == nil {
		return
	}
	p, ok := fsPath(w, r, u, "path")
	if !ok {
		return
	}
	folder := p
	entry := ""
	if st, err := os.Stat(p); err == nil && !st.IsDir() {
		folder = filepath.Dir(p)
		entry = filepath.Base(p)
	}
	writeJSON(w, 200, map[string]any{
		"files": collectFiles(folder, 1<<20, 8<<20), "entry": entry})
}

// ---------- assignments ----------

type Manifest struct {
	Language   string   `json:"language"`
	Title      string   `json:"title"`
	Classes    []string `json:"classes"`         // owning classes; students in any see it
	Class      string   `json:"class,omitempty"` // legacy single class, migrated on load
	Closed     bool     `json:"closed"`          // unpublished: hidden from students
	TimeoutSec int      `json:"timeout_sec"`
	MemMB      int      `json:"mem_mb"`
	// Due is a unix time, 0 for no due date. It does not close the assignment:
	// work submitted after it is still graded and still reaches the teacher,
	// marked late. Closing is unpublish, which is a decision the teacher makes.
	Due int64 `json:"due"`
	// NoPaste stops students pasting anything into this assignment's files that
	// was not copied inside the editor.
	NoPaste bool `json:"no_paste"`
	// Entry is the file the input/output cases run ("main.py", "Cart.java").
	// Empty lets the grader guess: main.py, or the one program file there is.
	Entry string `json:"entry,omitempty"`
}

func collectedDir() string { return filepath.Join(dataDir, "collected") }

func saveManifest(id string, m *Manifest) error {
	data, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(assignDir(), id, "manifest.json"), data, 0o644)
}

// setAssignmentClosed rewrites just the closed flag in a manifest.
func setAssignmentClosed(id string, closed bool) error {
	m := loadManifest(id)
	if m == nil {
		return fmt.Errorf("unknown assignment")
	}
	m.Closed = closed
	return saveManifest(id, m)
}

func (m *Manifest) hasClass(id string) bool {
	for _, c := range m.Classes {
		if c == id {
			return true
		}
	}
	return false
}

func loadManifest(id string) *Manifest {
	data, err := os.ReadFile(filepath.Join(assignDir(), id, "manifest.json"))
	if err != nil {
		return nil
	}
	var m Manifest
	if json.Unmarshal(data, &m) != nil {
		return nil
	}
	if len(m.Classes) == 0 && m.Class != "" {
		m.Classes = []string{m.Class}
	}
	m.Class = ""
	if m.TimeoutSec == 0 {
		m.TimeoutSec = 15
	}
	if m.MemMB == 0 {
		m.MemMB = 256
	}
	return &m
}

func handleAssignments(w http.ResponseWriter, r *http.Request) {
	u := requireUser(w, r)
	if u == nil {
		return
	}
	type a struct {
		ID       string   `json:"id"`
		Language string   `json:"language"`
		Title    string   `json:"title"`
		Classes  []string `json:"classes"`
		Closed   bool     `json:"closed"`
		Due      int64    `json:"due"`
		NoPaste  bool     `json:"no_paste"`
	}
	out := []a{}
	entries, _ := os.ReadDir(assignDir())
	for _, e := range entries {
		m := loadManifest(e.Name())
		if m == nil {
			continue
		}
		if u.Role != "teacher" {
			// Students see assignments for their class that are still open.
			if m.Closed || !m.hasClass(u.Class) {
				continue
			}
		}
		out = append(out, a{e.Name(), m.Language, m.Title, m.Classes, m.Closed, m.Due, m.NoPaste})
	}
	writeJSON(w, 200, map[string]any{"assignments": out})
}

// ---------- grading dispatch ----------

var (
	inflight   = map[string]int{}
	inflightMu sync.Mutex
)

type runnerRef struct {
	Host string
	Port int
}

func pickRunners() []runnerRef {
	// Grade on the Pi 3 workers first, least-loaded first; the gateway's own
	// runner (127.0.0.1) is used last, only when no worker can take the job.
	var workers []runnerRef
	seen := map[string]bool{}
	for _, w := range store.UpWorkers() {
		if w.Host == "127.0.0.1" {
			continue
		}
		key := fmt.Sprintf("%s:%d", w.Host, w.RunnerPort)
		if seen[key] {
			continue
		}
		seen[key] = true
		workers = append(workers, runnerRef{w.Host, w.RunnerPort})
	}
	inflightMu.Lock()
	sort.SliceStable(workers, func(i, j int) bool {
		return inflight[workers[i].Host] < inflight[workers[j].Host]
	})
	inflightMu.Unlock()
	return append(workers, runnerRef{"127.0.0.1", 9500}) // local last, always present
}

func callRunner(ref runnerRef, endpoint string, payload, result any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	inflightMu.Lock()
	inflight[ref.Host]++
	inflightMu.Unlock()
	defer func() {
		inflightMu.Lock()
		inflight[ref.Host]--
		inflightMu.Unlock()
	}()
	client := &http.Client{Timeout: 150 * time.Second}
	resp, err := client.Post(
		fmt.Sprintf("http://%s:%d/%s", ref.Host, ref.Port, endpoint),
		"application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("runner status %d", resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 64<<20)).Decode(result)
}

type gradeResult struct {
	Status string `json:"status"`
	Tests  []struct {
		Name   string `json:"name"`
		Passed bool   `json:"passed"`
	} `json:"tests"`
}

func handleSubmit(w http.ResponseWriter, r *http.Request) {
	u := requireUser(w, r)
	if u == nil {
		return
	}
	// Part is the teacher's choice of what to grade: "solution" runs their
	// worked answer against the tests, anything else the starter. Students
	// have one folder and no choice.
	var body struct{ Assignment, Part string }
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	aid := strings.Trim(body.Assignment, "/ ")
	if !validID(aid) {
		fail(w, 400, "bad assignment id")
		return
	}
	dryRun := u.Role == "teacher"
	m := loadManifest(aid)
	own := filepath.Join(studentRoot(u), aid)
	if m == nil && dryRun {
		// An assignment the teacher is still writing has no published manifest
		// yet. Its own folder describes it well enough to rehearse against, so
		// Submit works from the first template right through to publishing.
		m = authoringManifest(own)
	}
	if m == nil {
		fail(w, 404, "unknown assignment")
		return
	}

	workFolder := filepath.Join(studentRoot(u), aid)
	testsFolder := filepath.Join(assignDir(), aid, "tests")
	graded := "your code"
	if dryRun {
		// A teacher owns the authoring layout (<id>/starter + <id>/tests), not a
		// student's flat copy, so Submit grades exactly the pair a student would
		// be graded on: the starter they receive, against the tests that run.
		// Their working copies win over the published ones, which is what makes
		// Submit a usable check before publishing an edit. Asked for the
		// solution, it grades solution/ instead, which is how the teacher checks
		// that the tests can be passed at all.
		graded = "starter"
		if body.Part == "solution" && isDir(filepath.Join(own, "solution")) {
			workFolder = filepath.Join(own, "solution")
			graded = "solution"
		} else if isDir(filepath.Join(own, "starter")) {
			workFolder = filepath.Join(own, "starter")
		} else if !isDir(own) {
			workFolder = filepath.Join(assignDir(), aid, "starter")
		}
		if isDir(filepath.Join(own, "tests")) {
			testsFolder = filepath.Join(own, "tests")
		}
	}
	if !isDir(workFolder) {
		fail(w, 404, "no work folder for this assignment")
		return
	}
	if !isDir(testsFolder) {
		fail(w, 500, "assignment has no tests")
		return
	}

	payload := map[string]any{
		"language":    m.Language,
		"files":       collectFiles(workFolder, 512<<10, 8<<20),
		"tests":       collectFiles(testsFolder, 512<<10, 8<<20),
		"timeout_sec": m.TimeoutSec,
		"mem_mb":      m.MemMB,
		"entry":       m.Entry,
	}

	var result gradeResult
	got := false
	for _, ref := range pickRunners() {
		if err := callRunner(ref, "grade", payload, &result); err != nil {
			if ref.Host != "127.0.0.1" {
				store.SetWorkerStatus(ref.Host, "down", err.Error())
				regenUpstream()
			}
			continue
		}
		got = true
		break
	}
	if !got {
		fail(w, 503, "no grader available")
		return
	}

	// Black box: only status and per-test pass/fail reach the student.
	tests := make([]TestResult, 0, len(result.Tests))
	passed := 0
	for _, t := range result.Tests {
		tests = append(tests, TestResult{Name: t.Name, Passed: t.Passed})
		if t.Passed {
			passed++
		}
	}
	// A teacher's Submit is a rehearsal of the student's, so it is not recorded
	// and does not show up among the class's submissions.
	now := time.Now().Unix()
	late := m.Due > 0 && now > m.Due
	id := 0
	if !dryRun {
		id = store.AddSubmission(&Submission{
			Username: u.Username, Assignment: aid, Ts: now,
			Status: result.Status, Passed: passed, Failed: len(tests) - passed,
			Late: late, Tests: tests,
		})
	}
	writeJSON(w, 200, map[string]any{
		"id": id, "status": result.Status, "passed": passed,
		"failed": len(tests) - passed, "tests": tests, "dry_run": dryRun,
		"graded": graded, "due": m.Due, "late": late && !dryRun})
}

func handleCompileJava(w http.ResponseWriter, r *http.Request) {
	u := requireUser(w, r)
	if u == nil {
		return
	}
	var body struct{ Path, Entry string }
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	p, err := safePath(studentRoot(u), body.Path)
	if err != nil {
		fail(w, 400, "bad path")
		return
	}
	folder := p
	if st, err := os.Stat(p); err == nil && !st.IsDir() {
		folder = filepath.Dir(p)
	}
	if st, err := os.Stat(folder); err != nil || !st.IsDir() {
		fail(w, 404, "folder not found")
		return
	}
	payload := map[string]any{
		"files": collectFiles(folder, 512<<10, 8<<20), "entry": body.Entry}
	var result map[string]any
	for _, ref := range pickRunners() {
		if err := callRunner(ref, "compile", payload, &result); err == nil {
			writeJSON(w, 200, result)
			return
		}
	}
	fail(w, 503, "no compiler available")
}

// ---------- client-run relay ----------
//
// Programs run in the student's browser, but the terminal that shows their
// output lives in the VS Code extension host, a separate context. Worse, the
// browser runtime blocks its own thread while a program waits: that is the
// whole point of running it in a Web Worker, and it means the worker cannot
// receive a postMessage until it comes back. A blocked worker can still make a
// synchronous HTTP request, so everything it has to wait for goes through this
// relay instead.
//
// Two things use it. stdin: input() long-polls GET /api/run/stdin and blocks,
// and the terminal POSTs each typed line. Debugging: a paused program POSTs
// where it stopped to /api/run/debug/pause and blocks there until the editor
// answers with a step or a continue. Queues are keyed by user, run id, and
// channel, so no student can read another's.

var (
	relayMu     sync.Mutex
	relayQueues = map[string]chan string{}
)

func relayQueue(user, run, channel string) chan string {
	key := user + "|" + run + "|" + channel
	relayMu.Lock()
	defer relayMu.Unlock()
	q, ok := relayQueues[key]
	if !ok {
		q = make(chan string, 256)
		relayQueues[key] = q
	}
	return q
}

// dropRelayQueues forgets every channel belonging to one run, so an abandoned
// run does not leave queues behind.
func dropRelayQueues(user, run string) {
	prefix := user + "|" + run + "|"
	relayMu.Lock()
	for key := range relayQueues {
		if strings.HasPrefix(key, prefix) {
			delete(relayQueues, key)
		}
	}
	relayMu.Unlock()
}

// relayRun reads the run id both sides agree on, and the user it belongs to.
func relayRun(w http.ResponseWriter, r *http.Request) (*User, string, bool) {
	u := requireUser(w, r)
	if u == nil {
		return nil, "", false
	}
	run := r.URL.Query().Get("run")
	if run == "" {
		fail(w, 400, "missing run id")
		return nil, "", false
	}
	return u, run, true
}

// relayPush puts one message on a queue without ever blocking the sender.
func relayPush(u *User, run, channel, msg string) {
	select {
	case relayQueue(u.Username, run, channel) <- msg:
	default: // queue full; drop rather than block the caller
	}
}

// relayWait blocks until a message arrives on a queue, the client goes away, or
// the wait runs out. A false return means nothing came.
func relayWait(r *http.Request, u *User, run, channel string, timeout time.Duration) (string, bool) {
	select {
	case msg := <-relayQueue(u.Username, run, channel):
		return msg, true
	case <-time.After(timeout):
		return "", false
	case <-r.Context().Done():
		return "", false
	}
}

func handleRunStdinPost(w http.ResponseWriter, r *http.Request) {
	u, run, ok := relayRun(w, r)
	if !ok {
		return
	}
	if r.URL.Query().Get("end") == "1" {
		dropRelayQueues(u.Username, run)
		writeJSON(w, 200, map[string]any{"ok": true})
		return
	}
	data, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	relayPush(u, run, "stdin", string(data))
	writeJSON(w, 200, map[string]any{"ok": true})
}

func handleRunStdinGet(w http.ResponseWriter, r *http.Request) {
	u, run, ok := relayRun(w, r)
	if !ok {
		return
	}
	line, got := relayWait(r, u, run, "stdin", 100*time.Second)
	if !got {
		w.WriteHeader(204) // no input arrived; the runtime treats this as EOF
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	_, _ = w.Write([]byte(line))
}

// ---------- debug relay ----------
//
// The debugger's three moves, from the gateway's point of view: the program
// reports that it stopped and waits for its next instruction (pause), the
// editor collects what happened (events), and the editor answers (command).

// handleRunDebugPause holds a stopped program until the editor says what to do
// next. A body announces where it stopped; an empty body is the same program
// asking again, which is how a student can leave a breakpoint sitting there for
// the rest of the lesson without any proxy in the path timing the request out.
func handleRunDebugPause(w http.ResponseWriter, r *http.Request) {
	u, run, ok := relayRun(w, r)
	if !ok {
		return
	}
	state, _ := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if len(bytes.TrimSpace(state)) > 0 {
		relayPush(u, run, "debug-event", string(state))
	}
	cmd, got := relayWait(r, u, run, "debug-command", 90*time.Second)
	if !got {
		cmd = `{"cmd":"wait"}` // nothing yet; the program asks again
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(cmd))
}

func handleRunDebugEvents(w http.ResponseWriter, r *http.Request) {
	u, run, ok := relayRun(w, r)
	if !ok {
		return
	}
	msg, got := relayWait(r, u, run, "debug-event", 60*time.Second)
	if !got {
		w.WriteHeader(204) // nothing happened; the editor polls again
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(msg))
}

func handleRunDebugCommand(w http.ResponseWriter, r *http.Request) {
	u, run, ok := relayRun(w, r)
	if !ok {
		return
	}
	if r.URL.Query().Get("end") == "1" {
		dropRelayQueues(u.Username, run)
		writeJSON(w, 200, map[string]any{"ok": true})
		return
	}
	data, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	relayPush(u, run, "debug-command", string(data))
	writeJSON(w, 200, map[string]any{"ok": true})
}

func handleMySubmissions(w http.ResponseWriter, r *http.Request) {
	u := requireUser(w, r)
	if u == nil {
		return
	}
	subs := store.RecentSubmissions(u.Username, 50)
	writeJSON(w, 200, map[string]any{"submissions": subs})
}

// ---------- admin ----------

func handleAdminStudents(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	out := []map[string]string{}
	for _, u := range store.AllUsers() {
		out = append(out, map[string]string{
			"username": u.Username, "role": u.Role, "class": u.Class})
	}
	writeJSON(w, 200, map[string]any{"users": out})
}

func handleAdminAddStudent(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	var body struct{ Username, Password, Role, Class string }
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	body.Username = strings.TrimSpace(body.Username)
	if !validID(body.Username) || body.Password == "" {
		fail(w, 400, "bad username or empty password")
		return
	}
	if body.Role != "teacher" {
		body.Role = "student"
	}
	if body.Class != "" && store.ClassLang(body.Class) == "" {
		fail(w, 400, "unknown class")
		return
	}
	store.PutUser(body.Username, body.Password, body.Role, body.Class)
	_ = os.MkdirAll(filepath.Join(studentsDir(), body.Username), 0o755)
	// Whatever the class already has published belongs to them too, the same as
	// for a student who joined with the code themselves.
	reconcileStudent(body.Username)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func handleAdminSetPassword(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	var body struct{ Username, Password string }
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	u := store.GetUser(strings.TrimSpace(body.Username))
	if u == nil || u.Role != "student" {
		fail(w, 404, "unknown student")
		return
	}
	if body.Password == "" {
		fail(w, 400, "empty password")
		return
	}
	store.SetPassword(u.Username, body.Password)
	writeJSON(w, 200, map[string]any{"ok": true})
}

// handleAccountPassword lets any logged-in user change their own password. The
// current password must be given (a hijacked open session cannot silently lock
// the owner out), the new one has a minimum length, and every other session for
// the account is invalidated so an old cookie stops working.
func handleAccountPassword(w http.ResponseWriter, r *http.Request) {
	u := requireUser(w, r)
	if u == nil {
		return
	}
	var body struct {
		Current string `json:"current"`
		New     string `json:"new"`
	}
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	if !CheckPassword(body.Current, u.PwHash) {
		fail(w, 403, "current password is wrong")
		return
	}
	if len(body.New) < 8 {
		fail(w, 400, "new password must be at least 8 characters")
		return
	}
	if body.New == body.Current {
		fail(w, 400, "new password must differ from the current one")
		return
	}
	store.SetPassword(u.Username, body.New)
	if c, err := r.Cookie(sessionCookie); err == nil {
		store.DropOtherSessions(u.Username, c.Value)
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func handleAdminSetClass(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	var body struct{ Username, Class string }
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	if body.Class != "" && store.ClassLang(body.Class) == "" {
		fail(w, 400, "unknown class")
		return
	}
	username := strings.TrimSpace(body.Username)
	store.SetUserClass(username, body.Class)
	// Update the student's assignment folders to match their new class.
	reconcileStudent(username)
	writeJSON(w, 200, map[string]any{"ok": true})
}

// ---------- admin: classes ----------

func handleAdminClasses(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	writeJSON(w, 200, map[string]any{"classes": store.AllClasses()})
}

func handleAdminAddClass(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	var body struct{ ID, Name, Lang string }
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	body.ID = strings.TrimSpace(body.ID)
	if !validID(body.ID) {
		fail(w, 400, "bad class id")
		return
	}
	if body.Lang != "python" && body.Lang != "java" {
		fail(w, 400, "language must be python or java")
		return
	}
	if body.Name == "" {
		body.Name = body.ID
	}
	code := joinCode()
	store.PutClass(&Class{ID: body.ID, Name: body.Name, Lang: body.Lang, Code: code})
	writeJSON(w, 200, map[string]any{"ok": true, "code": code})
}

func handleAdminDelClass(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	var body struct{ ID string }
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	store.DeleteClass(strings.TrimSpace(body.ID))
	writeJSON(w, 200, map[string]any{"ok": true})
}

func handleAdminDelStudent(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	var body struct{ Username string }
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	store.DeleteStudent(strings.TrimSpace(body.Username))
	writeJSON(w, 200, map[string]any{"ok": true})
}

// handleAdminUploadAssignment ingests a zip. Expected layout:
//
//	starter/...        files students receive
//	tests/...          private grading tests (test_*.py or *Test.java)
//	assignment.yaml    optional: id, title, timeout_sec, due, no_paste
//
// Zipping a folder rather than its contents wraps all of that in one top-level
// directory, which is what most people do and what every file manager does by
// default, so a single wrapper is stripped before anything is read.
//
// Language is taken from the target class. The zip arrives base64-encoded in
// JSON so the browser can send it through the extension's API proxy without a
// multipart form.
func handleAdminUploadAssignment(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	var body struct {
		ID         string   `json:"id"`
		Title      string   `json:"title"`
		Class      string   `json:"class"`   // legacy single class
		Classes    []string `json:"classes"` // one or more target classes
		ZipB64     string   `json:"zip_b64"`
		TimeoutSec int      `json:"timeout_sec"`
	}
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	classes := body.Classes
	if len(classes) == 0 && body.Class != "" {
		classes = []string{body.Class}
	}
	if len(classes) == 0 {
		fail(w, 400, "pick at least one class")
		return
	}
	// Every target class must exist and share one language (the assignment's).
	lang := ""
	for _, c := range classes {
		cl := store.ClassLang(c)
		if cl == "" {
			fail(w, 400, "unknown class: "+c)
			return
		}
		if lang == "" {
			lang = cl
		} else if lang != cl {
			fail(w, 400, "all classes must be the same language")
			return
		}
	}
	raw, err := base64.StdEncoding.DecodeString(body.ZipB64)
	if err != nil || len(raw) == 0 {
		fail(w, 400, "bad zip data")
		return
	}
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		fail(w, 400, "not a valid zip file")
		return
	}

	id := strings.TrimSpace(body.ID)
	title := body.Title
	timeout := body.TimeoutSec
	var due int64
	noPaste := false
	entry := ""
	starter := map[string][]byte{}
	tests := map[string][]byte{}
	prefix := zipWrapper(zr)
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		name := filepath.ToSlash(filepath.Clean(f.Name))
		if strings.HasPrefix(name, "../") || strings.Contains(name, "/../") {
			continue
		}
		name = strings.TrimPrefix(name, prefix)
		data, err := readZipFile(f, 1<<20)
		if err != nil {
			continue
		}
		switch {
		case isMetaName(name):
			meta := parseAssignmentMeta(data)
			if meta == nil {
				break
			}
			if id == "" {
				id = meta.ID
			}
			if title == "" {
				title = meta.Title
			}
			if timeout == 0 {
				timeout = meta.TimeoutSec
			}
			if d, ok := parseDue(meta.Due); ok {
				due = d
			}
			noPaste = meta.NoPaste
			entry = meta.Entry
		case strings.HasPrefix(name, "starter/"):
			starter[strings.TrimPrefix(name, "starter/")] = data
		case strings.HasPrefix(name, "tests/"):
			tests[strings.TrimPrefix(name, "tests/")] = data
		}
	}
	if id == "" {
		fail(w, 400, "no assignment id (pass one or include assignment.yaml)")
		return
	}
	if !validID(id) {
		fail(w, 400, "bad assignment id")
		return
	}
	if len(tests) == 0 {
		fail(w, 400, "zip has no tests/ folder")
		return
	}
	if timeout <= 0 {
		timeout = 15
	}
	if title == "" {
		title = id
	}

	m := &Manifest{Language: lang, Title: title, Classes: classes,
		TimeoutSec: timeout, Due: due, NoPaste: noPaste, Entry: entry}
	existed := keepPublishState(id, m)
	base := filepath.Join(assignDir(), id)
	_ = os.RemoveAll(base)
	_ = os.MkdirAll(filepath.Join(base, "starter"), 0o755)
	_ = os.MkdirAll(filepath.Join(base, "tests"), 0o755)
	writeSection := func(section string, files map[string][]byte) {
		for rel, data := range files {
			p, err := safePath(filepath.Join(base, section), rel)
			if err != nil {
				continue
			}
			_ = os.MkdirAll(filepath.Dir(p), 0o755)
			_ = os.WriteFile(p, data, 0o644)
		}
	}
	writeSection("starter", starter)
	writeSection("tests", tests)
	writeAssignment(w, id, m, existed)
}

// zipWrapper returns the single top-level directory every entry in a zip sits
// under, as a prefix to strip ("unit3-cart/"), or "" when the zip already has
// starter/ and tests/ at its root.
func zipWrapper(zr *zip.Reader) string {
	first := ""
	for _, f := range zr.File {
		name := filepath.ToSlash(filepath.Clean(f.Name))
		if name == "." || strings.HasPrefix(name, "__MACOSX/") {
			continue
		}
		i := strings.IndexByte(name, '/')
		if i < 0 {
			return "" // a file at the root: nothing wraps this zip
		}
		top := name[:i]
		if first == "" {
			first = top
		} else if top != first {
			return "" // more than one top-level entry
		}
	}
	if first == "" {
		return ""
	}
	return first + "/"
}

func readZipFile(f *zip.File, max int64) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(io.LimitReader(rc, max))
}

func handleAdminPublish(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	var body struct{ ID string }
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	n, err := publishAssignment(body.ID)
	if err != nil {
		fail(w, 404, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "published_to": n})
}

func publishAssignment(id string) (int, error) {
	starter := filepath.Join(assignDir(), id, "starter")
	if st, err := os.Stat(starter); err != nil || !st.IsDir() {
		return 0, fmt.Errorf("unknown assignment")
	}
	m := loadManifest(id)
	if m == nil {
		return 0, fmt.Errorf("unknown assignment")
	}
	// Every student in any of the assignment's classes receives it (deduped).
	seen := map[string]bool{}
	var students []string
	for _, c := range m.Classes {
		for _, s := range store.StudentsInClass(c) {
			if !seen[s] {
				seen[s] = true
				students = append(students, s)
			}
		}
	}
	count := 0
	for _, s := range students {
		dest := filepath.Join(studentsDir(), s, id)
		if n, _ := copyMissing(starter, dest); n > 0 {
			count++
		}
	}
	_ = setAssignmentClosed(id, false) // publishing (re)opens the assignment
	return count, nil
}

// copyMissing gives dst every file under src that it does not already have,
// and returns how many it wrote. A student's own copy of a file is never
// touched: publishing an assignment a second time, after the teacher fixed a
// starter file or added one, hands over only what the student is missing.
func copyMissing(src, dst string) (int, error) {
	n := 0
	err := filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, path)
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if _, err := os.Stat(target); err == nil {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if err := os.WriteFile(target, data, 0o644); err != nil {
			return err
		}
		n++
		return nil
	})
	return n, err
}

// keepPublishState decides whether an assignment being written is open. One
// that already exists keeps what it had: a teacher re-running Create from
// Folder to fix the tests must not publish a closed assignment, nor close an
// open one. A new assignment starts closed, so the teacher decides when the
// class sees it. Returns whether the assignment existed before.
func keepPublishState(id string, m *Manifest) bool {
	if old := loadManifest(id); old != nil {
		m.Closed = old.Closed
		return true
	}
	m.Closed = true
	return false
}

// writeAssignment saves a manifest and, if the assignment is open, hands the
// starter to its students. It answers with what the teacher's view needs to
// say: whether this was an update, whether it is published, and to how many.
func writeAssignment(w http.ResponseWriter, id string, m *Manifest, existed bool) {
	if err := saveManifest(id, m); err != nil {
		fail(w, 500, "could not save the assignment")
		return
	}
	n := 0
	if !m.Closed {
		n, _ = publishAssignment(id)
	}
	writeJSON(w, 200, map[string]any{"ok": true, "id": id, "published_to": n,
		"updated": existed, "closed": m.Closed})
}

// reconcileStudent makes a student's home hold exactly the assignment folders
// they should have: open assignments whose class includes theirs. Missing ones
// get the starter; ones no longer applicable (unpublished, or for a class they
// left) are removed. The student's own non-assignment folders are left alone.
// This is what makes unpublish and moving a student between classes actually
// change what the student sees, since they interact through their file tree.
func reconcileStudent(username string) {
	u := store.GetUser(username)
	if u == nil || u.Role != "student" {
		return
	}
	home := filepath.Join(studentsDir(), username)
	_ = os.MkdirAll(home, 0o755)

	target := map[string]bool{}
	for _, e := range mustReadDir(assignDir()) {
		if !e.IsDir() {
			continue
		}
		m := loadManifest(e.Name())
		if m != nil && !m.Closed && m.hasClass(u.Class) {
			target[e.Name()] = true
		}
	}
	// Add assignments the student should have but does not.
	for id := range target {
		dest := filepath.Join(home, id)
		if _, err := os.Stat(dest); err != nil {
			_ = copyTree(filepath.Join(assignDir(), id, "starter"), dest)
		}
	}
	// Remove assignment folders that no longer apply (leave the student's own
	// scratch folders, which are not assignments). Snapshot the work first:
	// moving a student between classes takes away the assignments of the class
	// they left, and without this that work would be deleted with nothing kept.
	for _, e := range mustReadDir(home) {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		if _, err := os.Stat(filepath.Join(assignDir(), name, "manifest.json")); err != nil {
			continue // not an assignment
		}
		if !target[name] {
			src := filepath.Join(home, name)
			_ = copyTree(src, filepath.Join(collectedDir(), name, username))
			_ = os.RemoveAll(src)
		}
	}
}

func mustReadDir(dir string) []os.DirEntry {
	e, _ := os.ReadDir(dir)
	return e
}

// recallAssignment snapshots every student's current code for an assignment into
// the collected area (for grading). Returns how many students had work.
func recallAssignment(id string) int {
	m := loadManifest(id)
	if m == nil {
		return 0
	}
	dest0 := filepath.Join(collectedDir(), id)
	_ = os.RemoveAll(dest0)
	seen := map[string]bool{}
	count := 0
	for _, c := range m.Classes {
		for _, s := range store.StudentsInClass(c) {
			if seen[s] {
				continue
			}
			seen[s] = true
			src := filepath.Join(studentsDir(), s, id)
			if st, err := os.Stat(src); err != nil || !st.IsDir() {
				continue
			}
			if copyTree(src, filepath.Join(dest0, s)) == nil {
				count++
			}
		}
	}
	return count
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, path)
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
}

func handleAdminSubmissions(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	writeJSON(w, 200, map[string]any{"submissions": store.RecentSubmissions("", 200)})
}

// ---------- grading portal: unpublish, recall, read code, grade ----------

func handleAdminUnpublish(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	var body struct{ ID string }
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	id := strings.Trim(body.ID, "/ ")
	if err := setAssignmentClosed(id, true); err != nil {
		fail(w, 404, err.Error())
		return
	}
	// Snapshot the work for grading, then take the folder out of every student's
	// home so it actually disappears from their editor.
	recallAssignment(id)
	if m := loadManifest(id); m != nil {
		done := map[string]bool{}
		for _, c := range m.Classes {
			for _, s := range store.StudentsInClass(c) {
				if !done[s] {
					done[s] = true
					reconcileStudent(s)
				}
			}
		}
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// handleAdminRecall snapshots every student's current code for an assignment
// into the collected area, freezing it for grading.
func handleAdminRecall(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	var body struct{ ID string }
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	id := strings.Trim(body.ID, "/ ")
	if loadManifest(id) == nil {
		fail(w, 404, "unknown assignment")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "collected": recallAssignment(id)})
}

// handleAdminCollected lists the recalled students for an assignment, each with
// the files that were snapshotted for them. Scores live in the teacher's own
// gradebook, not on this device, so nothing here carries one.
func handleAdminCollected(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	id := r.URL.Query().Get("assignment")
	if !validID(id) {
		fail(w, 400, "bad assignment id")
		return
	}
	base := filepath.Join(collectedDir(), id)
	entries, _ := os.ReadDir(base)
	type stu struct {
		Username string   `json:"username"`
		Files    []string `json:"files"`
	}
	out := []stu{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		var files []string
		sdir := filepath.Join(base, e.Name())
		_ = filepath.WalkDir(sdir, func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || strings.HasPrefix(d.Name(), ".") {
				return nil
			}
			rel, _ := filepath.Rel(sdir, p)
			files = append(files, filepath.ToSlash(rel))
			return nil
		})
		sort.Strings(files)
		out = append(out, stu{e.Name(), files})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Username < out[j].Username })
	writeJSON(w, 200, map[string]any{"students": out})
}

func handleAdminCollectedRead(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	id := r.URL.Query().Get("assignment")
	user := r.URL.Query().Get("user")
	if !validID(id) || !validID(user) {
		fail(w, 400, "bad id")
		return
	}
	p, err := safePath(filepath.Join(collectedDir(), id, user), r.URL.Query().Get("path"))
	if err != nil {
		fail(w, 400, "bad path")
		return
	}
	data, err := os.ReadFile(p)
	if err != nil {
		fail(w, 404, "not found")
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write(data)
}

// handleAdminCollectedCheckout copies one student's recalled work into the
// teacher's own files, under review/<assignment>/<student>, so the teacher can
// Run it, type input into it, and edit it to try a case the tests did not. The
// snapshot itself stays as it was; the copy is the teacher's to change.
func handleAdminCollectedCheckout(w http.ResponseWriter, r *http.Request) {
	u := requireTeacher(w, r)
	if u == nil {
		return
	}
	var body struct{ Assignment, User string }
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	if !validID(body.Assignment) || !validID(body.User) {
		fail(w, 400, "bad id")
		return
	}
	src := filepath.Join(collectedDir(), body.Assignment, body.User)
	if !isDir(src) {
		fail(w, 404, "nothing collected for that student")
		return
	}
	rel := filepath.Join("review", body.Assignment, body.User)
	dst := filepath.Join(studentRoot(u), rel)
	_ = os.RemoveAll(dst)
	if err := copyTree(src, dst); err != nil {
		fail(w, 500, "could not copy the work")
		return
	}
	entry := ""
	if m := loadManifest(body.Assignment); m != nil {
		entry = m.Entry
	}
	if entry == "" || !isFile(filepath.Join(dst, entry)) {
		entry = guessEntry(dst)
	}
	writeJSON(w, 200, map[string]any{"ok": true,
		"folder": "/" + filepath.ToSlash(rel), "entry": entry})
}

func isFile(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

// guessEntry picks the file to open first in a folder of student work: main.py
// if there is one, else the Java file with a main method, else the first
// program file. Empty when there is nothing to run.
func guessEntry(dir string) string {
	if isFile(filepath.Join(dir, "main.py")) {
		return "main.py"
	}
	entries, _ := os.ReadDir(dir)
	first := ""
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !(strings.HasSuffix(name, ".py") || strings.HasSuffix(name, ".java")) {
			continue
		}
		if first == "" {
			first = name
		}
		if strings.HasSuffix(name, ".java") {
			if data, err := os.ReadFile(filepath.Join(dir, name)); err == nil &&
				strings.Contains(string(data), "static void main") {
				return name
			}
		}
	}
	return first
}

// handleAdminDeleteAssignment removes an assignment entirely: its definition
// and tests, the recalled snapshots, and each student's copy.
func handleAdminDeleteAssignment(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	var body struct{ ID string }
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	id := strings.Trim(body.ID, "/ ")
	if !validID(id) {
		fail(w, 400, "bad assignment id")
		return
	}
	_ = os.RemoveAll(filepath.Join(assignDir(), id))
	_ = os.RemoveAll(filepath.Join(collectedDir(), id))
	for _, u := range store.AllUsers() {
		if u.Role == "student" {
			_ = os.RemoveAll(filepath.Join(studentsDir(), u.Username, id))
		}
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// handleAdminAssignmentFromFolder builds an assignment from a folder the teacher
// authored in their own files (with starter/ and tests/ subfolders), so an
// assignment can be created entirely on the device without any zip tooling.
func handleAdminAssignmentFromFolder(w http.ResponseWriter, r *http.Request) {
	u := requireTeacher(w, r)
	if u == nil {
		return
	}
	var body struct {
		Folder     string   `json:"folder"`
		ID         string   `json:"id"`
		Title      string   `json:"title"`
		Classes    []string `json:"classes"`
		TimeoutSec int      `json:"timeout_sec"`
	}
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	if len(body.Classes) == 0 {
		fail(w, 400, "pick at least one class")
		return
	}
	lang := ""
	for _, c := range body.Classes {
		cl := store.ClassLang(c)
		if cl == "" {
			fail(w, 400, "unknown class: "+c)
			return
		}
		if lang == "" {
			lang = cl
		} else if lang != cl {
			fail(w, 400, "all classes must be the same language")
			return
		}
	}
	src, err := safePath(studentRoot(u), body.Folder)
	if err != nil {
		fail(w, 400, "bad folder")
		return
	}
	starterSrc := filepath.Join(src, "starter")
	testsSrc := filepath.Join(src, "tests")
	if st, err := os.Stat(testsSrc); err != nil || !st.IsDir() {
		fail(w, 400, "folder needs a tests/ subfolder")
		return
	}
	id := strings.TrimSpace(body.ID)
	if id == "" {
		id = filepath.Base(src)
	}
	if !validID(id) {
		fail(w, 400, "bad assignment id")
		return
	}
	// Whatever the teacher wrote in the folder's own assignment.yaml is the
	// default for everything the command did not ask them for.
	meta := readAssignmentMeta(src)
	if meta == nil {
		meta = &assignmentMeta{}
	}
	title := body.Title
	if title == "" {
		title = meta.Title
	}
	if title == "" {
		title = id
	}
	timeout := body.TimeoutSec
	if timeout <= 0 {
		timeout = meta.TimeoutSec
	}
	if timeout <= 0 {
		timeout = 15
	}
	due, ok := parseDue(meta.Due)
	if !ok {
		fail(w, 400, "due in assignment.yaml must look like 2026-09-14 23:59")
		return
	}
	m := &Manifest{Language: lang, Title: title, Classes: body.Classes,
		TimeoutSec: timeout, MemMB: meta.MemMB, Due: due, NoPaste: meta.NoPaste,
		Entry: meta.Entry}
	existed := keepPublishState(id, m)
	base := filepath.Join(assignDir(), id)
	_ = os.RemoveAll(base)
	_ = os.MkdirAll(filepath.Join(base, "starter"), 0o755)
	_ = os.MkdirAll(filepath.Join(base, "tests"), 0o755)
	if st, err := os.Stat(starterSrc); err == nil && st.IsDir() {
		_ = copyTree(starterSrc, filepath.Join(base, "starter"))
	}
	_ = copyTree(testsSrc, filepath.Join(base, "tests"))
	writeAssignment(w, id, m, existed)
}

// handleAdminAssignmentSettings changes the two things about a published
// assignment a teacher adjusts after the fact: when it is due, and whether
// students may paste into it.
func handleAdminAssignmentSettings(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	// Each field is optional: a caller changing the classes must not have to
	// resend the due date, and vice versa.
	var body struct {
		ID      string    `json:"id"`
		Due     *string   `json:"due"`      // "2026-09-14 23:59", or "" for none
		NoPaste *bool     `json:"no_paste"` // block pasting from outside the editor
		Classes *[]string `json:"classes"`  // which classes get this assignment
	}
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	id := strings.Trim(body.ID, "/ ")
	if !validID(id) {
		fail(w, 400, "bad assignment id")
		return
	}
	m := loadManifest(id)
	if m == nil {
		fail(w, 404, "unknown assignment")
		return
	}
	if body.Due != nil {
		due, ok := parseDue(*body.Due)
		if !ok {
			fail(w, 400, "due date must look like 2026-09-14 23:59, or be empty")
			return
		}
		m.Due = due
	}
	if body.NoPaste != nil {
		m.NoPaste = *body.NoPaste
	}
	dropped := []string{}
	if body.Classes != nil {
		classes := *body.Classes
		if len(classes) == 0 {
			fail(w, 400, "pick at least one class")
			return
		}
		// An assignment is written in one language, so every class it reaches
		// has to be taught in that language.
		for _, c := range classes {
			cl := store.ClassLang(c)
			if cl == "" {
				fail(w, 400, "unknown class: "+c)
				return
			}
			if cl != m.Language {
				fail(w, 400, "\""+c+"\" is not a "+m.Language+" class")
				return
			}
		}
		for _, was := range m.Classes {
			if !contains(classes, was) {
				dropped = append(dropped, was)
			}
		}
		m.Classes = classes
	}
	if err := saveManifest(id, m); err != nil {
		fail(w, 500, "could not save the assignment")
		return
	}
	// A class added here receives the assignment now; a class removed loses it,
	// and its students' work is snapshotted on the way out.
	published := 0
	if body.Classes != nil {
		// An unpublished assignment stays unpublished: changing who it is for is
		// not the same as deciding it is open again.
		if !m.Closed {
			published, _ = publishAssignment(id)
		}
		for _, c := range dropped {
			for _, s := range store.StudentsInClass(c) {
				reconcileStudent(s)
			}
		}
	}
	writeJSON(w, 200, map[string]any{"ok": true, "due": m.Due, "no_paste": m.NoPaste,
		"classes": m.Classes, "published_to": published})
}

func contains(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

// ---------- admin: workers ----------

func regenUpstream() {
	ws := store.UpWorkers()
	var b strings.Builder
	b.WriteString("upstream lc3cdn {\n    least_conn;\n")
	seen := map[string]bool{}
	remote := 0
	for _, w := range ws {
		addr := fmt.Sprintf("%s:%d", w.Host, w.CdnPort)
		if seen[addr] {
			continue
		}
		seen[addr] = true
		if !w.Local {
			remote++
		}
		fmt.Fprintf(&b, "    server %s max_fails=2 fail_timeout=10s;\n", addr)
	}
	// The gateway's local heavy server is the backup when real Pi 3 CDN
	// workers exist, or the sole server when none do.
	if !seen["127.0.0.1:8081"] {
		if remote > 0 {
			b.WriteString("    server 127.0.0.1:8081 backup;\n")
		} else {
			b.WriteString("    server 127.0.0.1:8081;\n")
		}
	}
	b.WriteString("}\n")
	if err := os.WriteFile(upstreamConf, []byte(b.String()), 0o644); err != nil {
		log.Printf("upstream write: %v", err)
		return
	}
	if err := exec.Command("nginx", "-t").Run(); err == nil {
		_ = exec.Command("systemctl", "reload", "nginx").Run()
	}
}

// workerToken is a shared secret workers present when they heartbeat, so a
// random host on the LAN cannot register itself. Stored once under state.
func workerToken() string {
	p := filepath.Join(dataDir, "state", "worker_token")
	if b, err := os.ReadFile(p); err == nil && len(bytes.TrimSpace(b)) > 0 {
		return strings.TrimSpace(string(b))
	}
	buf := make([]byte, 24)
	_, _ = rand.Read(buf)
	tok := base64.RawURLEncoding.EncodeToString(buf)
	_ = os.WriteFile(p, []byte(tok), 0o600)
	return tok
}

func newWorkerID() string {
	buf := make([]byte, 8)
	_, _ = rand.Read(buf)
	return "w-" + base64.RawURLEncoding.EncodeToString(buf)
}

func clientIP(r *http.Request) string {
	if xr := strings.TrimSpace(r.Header.Get("X-Real-IP")); xr != "" {
		return xr
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// handleWorkerHeartbeat lets a worker report that it is alive at its current IP.
// The gateway learns the IP from the connection, so a worker whose DHCP address
// changed is re-found automatically as long as it keeps the same id.
func handleWorkerHeartbeat(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID         string `json:"id"`
		Token      string `json:"token"`
		Note       string `json:"note"`
		RunnerPort int    `json:"runner_port"`
		CdnPort    int    `json:"cdn_port"`
	}
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	if body.Token == "" || body.Token != workerToken() {
		fail(w, 403, "bad worker token")
		return
	}
	if body.ID == "" {
		fail(w, 400, "missing worker id")
		return
	}
	if body.RunnerPort == 0 {
		body.RunnerPort = 9500
	}
	if body.CdnPort == 0 {
		body.CdnPort = 80
	}
	if store.Heartbeat(body.ID, clientIP(r), body.RunnerPort, body.CdnPort, body.Note) {
		regenUpstream()
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func handleAdminWorkers(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	ws := store.AllWorkers()
	sort.Slice(ws, func(i, j int) bool { return ws[i].Host < ws[j].Host })

	// Ask every node what it is currently carrying. The polls run together so
	// one unreachable worker does not hold up the whole view.
	type row struct {
		Worker
		Load WorkerLoad `json:"load"`
	}
	rows := make([]row, len(ws))
	var wg sync.WaitGroup
	for i, wk := range ws {
		rows[i].Worker = wk
		if wk.Status == "provisioning" {
			continue
		}
		port := wk.RunnerPort
		if port == 0 {
			port = 9500
		}
		wg.Add(1)
		go func(i int, ref runnerRef) {
			defer wg.Done()
			rows[i].Load = fetchWorkerLoad(ref)
		}(i, runnerRef{wk.Host, port})
	}
	wg.Wait()

	runLoadMu.Lock()
	inflightMu.Lock()
	for i := range rows {
		rows[i].Load.Dispatched = runLoad[rows[i].Host]
		rows[i].Load.Grading = inflight[rows[i].Host]
	}
	inflightMu.Unlock()
	runLoadMu.Unlock()

	writeJSON(w, 200, map[string]any{"workers": rows, "shell": shellToken() != ""})
}

func handleAdminAddWorker(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	var body struct {
		Host, User, Password string
		RootPassword         string `json:"root_password"`
	}
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	body.Host = strings.TrimSpace(body.Host)
	if net.ParseIP(body.Host) == nil {
		fail(w, 400, "host must be an IP address")
		return
	}
	if body.User == "" {
		body.User = "alarm"
	}
	if body.Password == "" {
		body.Password = "alarm"
	}
	if body.RootPassword == "" {
		body.RootPassword = "root"
	}
	id := newWorkerID()
	store.PutWorker(&Worker{ID: id, Host: body.Host, RunnerPort: 9500, CdnPort: 80,
		Status: "provisioning", Note: "started"})
	go func() {
		// Provisioning installs a heartbeat keyed by this id, so the worker is
		// tracked by id from then on and its IP can change freely.
		err := ProvisionWorker(id, body.Host, body.User, body.Password, body.RootPassword)
		if err != nil {
			store.SetWorkerStatus(body.Host, "error", err.Error())
			return
		}
		store.SetWorkerStatus(body.Host, "up", "ok")
		regenUpstream()
	}()
	writeJSON(w, 200, map[string]any{"ok": true, "status": "provisioning"})
}

func handleAdminDelWorker(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	var body struct{ Host string }
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	store.DeleteWorker(strings.TrimSpace(body.Host))
	regenUpstream()
	writeJSON(w, 200, map[string]any{"ok": true})
}

func handleAdminRecheck(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	for _, wk := range store.AllWorkers() {
		if wk.Status == "provisioning" {
			continue
		}
		client := &http.Client{Timeout: 4 * time.Second}
		resp, err := client.Get(fmt.Sprintf("http://%s:%d/health", wk.Host, wk.RunnerPort))
		if err == nil && resp.StatusCode == 200 {
			store.SetWorkerStatus(wk.Host, "up", "")
		} else {
			store.SetWorkerStatus(wk.Host, "down", "")
		}
		if resp != nil {
			resp.Body.Close()
		}
	}
	regenUpstream()
	handleAdminWorkers(w, r)
}

// ---------- main ----------

func main() {
	var err error
	store, err = NewStore(filepath.Join(dataDir, "state"))
	if err != nil {
		log.Fatal(err)
	}
	_ = os.MkdirAll(studentsDir(), 0o755)
	_ = os.MkdirAll(assignDir(), 0o755)
	seed()
	_ = workerToken() // ensure the shared secret exists for provisioning to read

	// Mark workers down if they stop sending heartbeats (e.g. powered off).
	go func() {
		for {
			time.Sleep(20 * time.Second)
			if store.MarkStaleWorkers(60 * time.Second) {
				regenUpstream()
			}
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/login", handleLogin)
	mux.HandleFunc("POST /api/signup", handleSignup)
	mux.HandleFunc("POST /api/logout", handleLogout)
	mux.HandleFunc("GET /api/me", handleMe)
	mux.HandleFunc("GET /api/fs/stat", handleFsStat)
	mux.HandleFunc("GET /api/fs/list", handleFsList)
	mux.HandleFunc("GET /api/fs/read", handleFsRead)
	mux.HandleFunc("POST /api/fs/write", handleFsWrite)
	mux.HandleFunc("POST /api/fs/mkdir", handleFsMkdir)
	mux.HandleFunc("POST /api/fs/delete", handleFsDelete)
	mux.HandleFunc("POST /api/fs/rename", handleFsRename)
	mux.HandleFunc("GET /api/runbundle", handleRunBundle)
	mux.HandleFunc("GET /api/assignments", handleAssignments)
	mux.HandleFunc("POST /api/submit", handleSubmit)
	mux.HandleFunc("GET /api/run/stdin", handleRunStdinGet)
	mux.HandleFunc("POST /api/run/stdin", handleRunStdinPost)
	mux.HandleFunc("POST /api/run/debug/pause", handleRunDebugPause)
	mux.HandleFunc("GET /api/run/debug/events", handleRunDebugEvents)
	mux.HandleFunc("POST /api/run/debug/command", handleRunDebugCommand)
	mux.HandleFunc("POST /api/run/exec/start", handleRunExecStart)
	mux.HandleFunc("GET /api/run/exec/output", handleRunExecOutput)
	mux.HandleFunc("POST /api/run/exec/input", handleRunExecInput)
	mux.HandleFunc("POST /api/run/exec/kill", handleRunExecKill)
	mux.HandleFunc("POST /api/compile-java", handleCompileJava)
	mux.HandleFunc("GET /api/submissions", handleMySubmissions)
	mux.HandleFunc("GET /api/admin/students", handleAdminStudents)
	mux.HandleFunc("POST /api/admin/students", handleAdminAddStudent)
	mux.HandleFunc("POST /api/admin/students/delete", handleAdminDelStudent)
	mux.HandleFunc("POST /api/admin/students/setclass", handleAdminSetClass)
	mux.HandleFunc("POST /api/admin/students/setpassword", handleAdminSetPassword)
	mux.HandleFunc("POST /api/account/password", handleAccountPassword)
	mux.HandleFunc("GET /api/admin/classes", handleAdminClasses)
	mux.HandleFunc("POST /api/admin/classes", handleAdminAddClass)
	mux.HandleFunc("POST /api/admin/classes/delete", handleAdminDelClass)
	mux.HandleFunc("POST /api/admin/classes/code", handleAdminClassCode)
	mux.HandleFunc("POST /api/admin/classes/signup", handleAdminClassSignup)
	mux.HandleFunc("POST /api/admin/signup/unlock", handleAdminSignupUnlock)
	mux.HandleFunc("POST /api/admin/assignments/upload", handleAdminUploadAssignment)
	mux.HandleFunc("POST /api/admin/assignments/from-folder", handleAdminAssignmentFromFolder)
	mux.HandleFunc("POST /api/admin/assignments/template", handleAdminAssignmentTemplate)
	mux.HandleFunc("POST /api/admin/assignments/delete", handleAdminDeleteAssignment)
	mux.HandleFunc("POST /api/admin/assignments/publish", handleAdminPublish)
	mux.HandleFunc("POST /api/admin/assignments/unpublish", handleAdminUnpublish)
	mux.HandleFunc("POST /api/admin/assignments/recall", handleAdminRecall)
	mux.HandleFunc("POST /api/admin/assignments/settings", handleAdminAssignmentSettings)
	mux.HandleFunc("GET /api/admin/collected", handleAdminCollected)
	mux.HandleFunc("GET /api/admin/collected/read", handleAdminCollectedRead)
	mux.HandleFunc("POST /api/admin/collected/checkout", handleAdminCollectedCheckout)
	mux.HandleFunc("GET /api/admin/submissions", handleAdminSubmissions)
	mux.HandleFunc("GET /api/admin/workers", handleAdminWorkers)
	mux.HandleFunc("POST /api/admin/workers", handleAdminAddWorker)
	mux.HandleFunc("POST /api/admin/workers/delete", handleAdminDelWorker)
	mux.HandleFunc("POST /api/admin/workers/recheck", handleAdminRecheck)
	mux.HandleFunc("POST /api/admin/shell/start", handleAdminShellStart)
	mux.HandleFunc("GET /api/admin/shell/output", handleAdminShellOutput)
	mux.HandleFunc("POST /api/admin/shell/input", handleAdminShellInput)
	mux.HandleFunc("POST /api/admin/shell/resize", handleAdminShellResize)
	mux.HandleFunc("POST /api/admin/shell/kill", handleAdminShellKill)
	mux.HandleFunc("POST /api/worker/heartbeat", handleWorkerHeartbeat)
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})

	log.Printf("lc3d listening on %s, data in %s", listenAddr, dataDir)
	srv := &http.Server{Addr: listenAddr, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(srv.ListenAndServe())
}
