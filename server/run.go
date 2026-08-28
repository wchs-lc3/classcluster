package main

// Interactive program execution, distributed across the cluster. Java cannot
// block on input in the browser over plain HTTP (that needs SharedArrayBuffer,
// hence HTTPS), so a Java Run compiles and runs on a real JVM inside a runner's
// sandbox, with stdin and stdout streamed to the terminal so Scanner/System.in
// actually wait for the student to type.
//
// The gateway is only the controller (nginx, database, routing). Interactive
// runs go to the Pi 3 workers first; the gateway's own runner (127.0.0.1) is
// used last, only when the workers are full or absent. The gateway starts the
// run on the chosen runner and relays output and input to and from the browser.

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

type execRoute struct {
	ref     runnerRef
	session string
}

var (
	execRoutes   = map[string]execRoute{} // gateway runId -> worker + session
	execRoutesMu sync.Mutex
	runLoad      = map[string]int{} // active interactive runs per host
	runLoadMu    sync.Mutex
)

func execRunID() string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

// pickExecRunner lists runners least-loaded first, but always keeps the
// gateway's own runner (127.0.0.1) last: the Pi 4 is the controller and only
// runs jobs when no worker can.
func pickExecRunner() []runnerRef {
	var workers []runnerRef
	local := runnerRef{"127.0.0.1", 9500}
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
	runLoadMu.Lock()
	sort.SliceStable(workers, func(i, j int) bool {
		return runLoad[workers[i].Host] < runLoad[workers[j].Host]
	})
	runLoadMu.Unlock()
	return append(workers, local) // local always last
}

func addRunLoad(host string, d int) {
	runLoadMu.Lock()
	runLoad[host] += d
	if runLoad[host] < 0 {
		runLoad[host] = 0
	}
	runLoadMu.Unlock()
}

func execCall(ref runnerRef, path string, payload any, out any) (int, error) {
	body, _ := json.Marshal(payload)
	client := &http.Client{Timeout: 40 * time.Second}
	resp, err := client.Post(
		fmt.Sprintf("http://%s:%d%s", ref.Host, ref.Port, path),
		"application/json", bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if out != nil {
		_ = json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(out)
	}
	return resp.StatusCode, nil
}

// ---------- HTTP: browser <-> gateway <-> runner ----------

func handleRunExecStart(w http.ResponseWriter, r *http.Request) {
	u := requireUser(w, r)
	if u == nil {
		return
	}
	var body struct{ Path string }
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	p, err := safePath(studentRoot(u), body.Path)
	if err != nil {
		fail(w, 400, "bad path")
		return
	}
	folder, entry := p, ""
	if st, err := os.Stat(p); err == nil && !st.IsDir() {
		folder = filepath.Dir(p)
		entry = filepath.Base(p)
	}
	if entry == "" {
		fail(w, 400, "run a file, not a folder")
		return
	}
	payload := map[string]any{
		"language": "java",
		"entry":    entry,
		"files":    collectFiles(folder, 512<<10, 8<<20),
	}

	for _, ref := range pickExecRunner() {
		var res map[string]any
		code, err := execCall(ref, "/exec/start", payload, &res)
		if err != nil || code != 200 {
			if ref.Host != "127.0.0.1" {
				store.SetWorkerStatus(ref.Host, "down", "")
				regenUpstream()
			}
			continue
		}
		status, _ := res["status"].(string)
		if status == "running" {
			sid, _ := res["session"].(string)
			runID := execRunID()
			execRoutesMu.Lock()
			execRoutes[runID] = execRoute{ref: ref, session: sid}
			execRoutesMu.Unlock()
			addRunLoad(ref.Host, 1)
			writeJSON(w, 200, map[string]any{"status": "running", "run": runID})
			return
		}
		// compile_error / busy / error: pass straight back, no session held.
		writeJSON(w, 200, res)
		return
	}
	fail(w, 503, "no runner available")
}

func lookupRoute(runID string) (execRoute, bool) {
	execRoutesMu.Lock()
	defer execRoutesMu.Unlock()
	rt, ok := execRoutes[runID]
	return rt, ok
}

func dropRoute(runID string) {
	execRoutesMu.Lock()
	rt, ok := execRoutes[runID]
	if ok {
		delete(execRoutes, runID)
	}
	execRoutesMu.Unlock()
	if ok {
		addRunLoad(rt.ref.Host, -1)
	}
}

func handleRunExecOutput(w http.ResponseWriter, r *http.Request) {
	if requireUser(w, r) == nil {
		return
	}
	runID := r.URL.Query().Get("run")
	rt, ok := lookupRoute(runID)
	if !ok {
		fail(w, 404, "no such run")
		return
	}
	since := r.URL.Query().Get("since")
	var res map[string]any
	code, err := execCall(rt.ref, "/exec/output",
		map[string]any{"session": rt.session, "since": since}, &res)
	if err != nil || code != 200 {
		fail(w, 502, "runner unreachable")
		return
	}
	if done, _ := res["done"].(bool); done {
		dropRoute(runID) // program finished; free the slot
	}
	writeJSON(w, 200, res)
}

func handleRunExecInput(w http.ResponseWriter, r *http.Request) {
	if requireUser(w, r) == nil {
		return
	}
	rt, ok := lookupRoute(r.URL.Query().Get("run"))
	if !ok {
		fail(w, 404, "no such run")
		return
	}
	data, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	_, _ = execCall(rt.ref, "/exec/input",
		map[string]any{"session": rt.session, "data": string(data)}, nil)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func handleRunExecKill(w http.ResponseWriter, r *http.Request) {
	if requireUser(w, r) == nil {
		return
	}
	runID := r.URL.Query().Get("run")
	if rt, ok := lookupRoute(runID); ok {
		_, _ = execCall(rt.ref, "/exec/kill", map[string]any{"session": rt.session}, nil)
		dropRoute(runID)
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}
