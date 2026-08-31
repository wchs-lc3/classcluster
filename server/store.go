package main

// SQLite-backed state store (pure-Go modernc.org/sqlite, so the gateway stays
// a single CGO-free static binary). One database file holds users, classes,
// sessions, workers, and submissions. A single open connection plus WAL keeps
// the classroom-sized write load correct without a busy-loop.

import (
	"crypto/hmac"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/scrypt"
	_ "modernc.org/sqlite"
)

type User struct {
	Username string `json:"username"`
	PwHash   string `json:"pwhash"`
	Role     string `json:"role"`
	Class    string `json:"class"` // class id; "" for teacher or unassigned
}

// A class groups students who take one course. Its language decides which
// single runtime a student loads (python -> Pyodide in the browser, java -> a
// JVM on a runner) and which assignments they see.
type Class struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Lang string `json:"lang"` // python | java
	// Students join by typing this code, but only while the teacher has
	// signup open. Teachers see it; nobody else is served it.
	Code       string `json:"code"`
	SignupOpen bool   `json:"signup_open"`
}

type Worker struct {
	ID         string `json:"id"`   // stable identity; survives IP changes
	Host       string `json:"host"` // current IP, updated from heartbeats
	RunnerPort int    `json:"runner_port"`
	CdnPort    int    `json:"cdn_port"`
	Status     string `json:"status"` // provisioning | up | down | error
	Note       string `json:"note"`
	Local      bool   `json:"local"` // the gateway's own runner; never SSH-provisioned
	LastSeen   int64  `json:"last_seen"`
}

type TestResult struct {
	Name   string `json:"name"`
	Passed bool   `json:"passed"`
}

type Submission struct {
	ID         int          `json:"id"`
	Username   string       `json:"username"`
	Assignment string       `json:"assignment"`
	Ts         int64        `json:"ts"`
	Status     string       `json:"status"`
	Passed     int          `json:"passed"`
	Failed     int          `json:"failed"`
	Late       bool         `json:"late"`
	Tests      []TestResult `json:"tests,omitempty"`
}

type Store struct {
	db *sql.DB
}

const sessionTTL = 14 * 24 * time.Hour

func NewStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	dsn := "file:" + filepath.Join(dir, "lc3.db") +
		"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(on)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // serialize writes; classroom scale needs no more
	schema := `
CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY, pwhash TEXT NOT NULL,
    role TEXT NOT NULL, class TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS classes (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, lang TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '', signup_open INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, username TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS workers (
    id TEXT PRIMARY KEY, host TEXT, runner_port INTEGER, cdn_port INTEGER,
    status TEXT, note TEXT, local INTEGER NOT NULL DEFAULT 0,
    last_seen INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, assignment TEXT,
    ts INTEGER, status TEXT, passed INTEGER, failed INTEGER, tests TEXT,
    late INTEGER NOT NULL DEFAULT 0);
`
	if _, err := db.Exec(schema); err != nil {
		return nil, err
	}
	// Columns added after the first release. Adding one that is already there is
	// an error, and the only error worth reporting, so all are ignored: a fresh
	// database gets them from the schema above.
	for _, alter := range []string{
		"ALTER TABLE classes ADD COLUMN code TEXT NOT NULL DEFAULT ''",
		"ALTER TABLE classes ADD COLUMN signup_open INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE submissions ADD COLUMN late INTEGER NOT NULL DEFAULT 0",
	} {
		_, _ = db.Exec(alter)
	}
	// Scores and comments are not kept on the device. A database written before
	// that decision still holds them, so the table goes on the way past.
	_, _ = db.Exec("DROP TABLE IF EXISTS grades")
	return &Store{db: db}, nil
}

// ---- passwords ----

func HashPassword(pw string) string {
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	h, _ := scrypt.Key([]byte(pw), salt, 16384, 8, 1, 32)
	return base64.StdEncoding.EncodeToString(salt) + "$" + base64.StdEncoding.EncodeToString(h)
}

func CheckPassword(pw, stored string) bool {
	i := strings.IndexByte(stored, '$')
	if i < 0 {
		return false
	}
	salt, err1 := base64.StdEncoding.DecodeString(stored[:i])
	want, err2 := base64.StdEncoding.DecodeString(stored[i+1:])
	if err1 != nil || err2 != nil {
		return false
	}
	got, err := scrypt.Key([]byte(pw), salt, 16384, 8, 1, 32)
	if err != nil {
		return false
	}
	return hmac.Equal(want, got)
}

// ---- sessions ----

func (s *Store) NewSession(username string) string {
	tok := make([]byte, 24)
	_, _ = rand.Read(tok)
	token := base64.RawURLEncoding.EncodeToString(tok)
	_, _ = s.db.Exec("INSERT INTO sessions(token, username, created) VALUES(?,?,?)",
		token, username, time.Now().Unix())
	return token
}

func (s *Store) UserForSession(token string) *User {
	var username string
	var created int64
	err := s.db.QueryRow(
		"SELECT username, created FROM sessions WHERE token=?", token).Scan(&username, &created)
	if err != nil {
		return nil
	}
	if time.Since(time.Unix(created, 0)) > sessionTTL {
		_, _ = s.db.Exec("DELETE FROM sessions WHERE token=?", token)
		return nil
	}
	return s.GetUser(username)
}

func (s *Store) DropSession(token string) {
	_, _ = s.db.Exec("DELETE FROM sessions WHERE token=?", token)
}

// DropOtherSessions logs a user out everywhere except the given token. Used
// after a password change so stolen or shared sessions stop working.
func (s *Store) DropOtherSessions(username, keep string) {
	_, _ = s.db.Exec("DELETE FROM sessions WHERE username=? AND token<>?", username, keep)
}

// ---- users ----

func (s *Store) GetUser(username string) *User {
	u := &User{}
	err := s.db.QueryRow(
		"SELECT username, pwhash, role, class FROM users WHERE username=?", username).
		Scan(&u.Username, &u.PwHash, &u.Role, &u.Class)
	if err != nil {
		return nil
	}
	return u
}

func (s *Store) CountUsers() int {
	var n int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM users").Scan(&n)
	return n
}

func (s *Store) AllUsers() []User {
	rows, err := s.db.Query("SELECT username, pwhash, role, class FROM users ORDER BY username")
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		if rows.Scan(&u.Username, &u.PwHash, &u.Role, &u.Class) == nil {
			out = append(out, u)
		}
	}
	return out
}

func (s *Store) PutUser(username, password, role, class string) {
	_, _ = s.db.Exec(
		"INSERT INTO users(username, pwhash, role, class) VALUES(?,?,?,?) "+
			"ON CONFLICT(username) DO UPDATE SET pwhash=excluded.pwhash, "+
			"role=excluded.role, class=excluded.class",
		username, HashPassword(password), role, class)
}

// SetUserClass moves an existing student to a class without touching the
// password.
func (s *Store) SetUserClass(username, class string) {
	_, _ = s.db.Exec("UPDATE users SET class=? WHERE username=?", class, username)
}

func (s *Store) DeleteStudent(username string) {
	_, _ = s.db.Exec("DELETE FROM users WHERE username=? AND role='student'", username)
	_, _ = s.db.Exec("DELETE FROM sessions WHERE username=?", username)
}

// ---- classes ----

func (s *Store) PutClass(c *Class) {
	// The code and the signup switch are managed on their own, so renaming a
	// class does not quietly hand out a new code or reopen signup.
	_, _ = s.db.Exec(
		"INSERT INTO classes(id, name, lang, code, signup_open) VALUES(?,?,?,?,?) "+
			"ON CONFLICT(id) DO UPDATE SET name=excluded.name, lang=excluded.lang",
		c.ID, c.Name, c.Lang, c.Code, boolInt(c.SignupOpen))
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// SetClassCode replaces a class's join code. The old one stops working, which
// is the point: it is how a teacher reacts to a code that got out.
func (s *Store) SetClassCode(id, code string) {
	_, _ = s.db.Exec("UPDATE classes SET code=? WHERE id=?", code, id)
}

func (s *Store) SetClassSignup(id string, open bool) {
	_, _ = s.db.Exec("UPDATE classes SET signup_open=? WHERE id=?", boolInt(open), id)
}

// ClassByCode finds the class a join code belongs to, and only while that class
// is accepting signups. A code for a closed class matches nothing.
func (s *Store) ClassByCode(code string) *Class {
	if code == "" {
		return nil
	}
	c := &Class{}
	var open int
	err := s.db.QueryRow(
		"SELECT id, name, lang, code, signup_open FROM classes "+
			"WHERE code=? AND signup_open=1", code).
		Scan(&c.ID, &c.Name, &c.Lang, &c.Code, &open)
	if err != nil {
		return nil
	}
	c.SignupOpen = open != 0
	return c
}

func (s *Store) DeleteClass(id string) {
	_, _ = s.db.Exec("DELETE FROM classes WHERE id=?", id)
	_, _ = s.db.Exec("UPDATE users SET class='' WHERE class=?", id)
}

func (s *Store) ClassLang(id string) string {
	var lang string
	if s.db.QueryRow("SELECT lang FROM classes WHERE id=?", id).Scan(&lang) != nil {
		return ""
	}
	return lang
}

func (s *Store) AllClasses() []Class {
	rows, err := s.db.Query(
		"SELECT id, name, lang, code, signup_open FROM classes ORDER BY id")
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []Class{}
	for rows.Next() {
		var c Class
		var open int
		if rows.Scan(&c.ID, &c.Name, &c.Lang, &c.Code, &open) == nil {
			c.SignupOpen = open != 0
			out = append(out, c)
		}
	}
	return out
}

// StudentsInClass returns the usernames of every student assigned to class id.
func (s *Store) StudentsInClass(id string) []string {
	rows, err := s.db.Query("SELECT username FROM users WHERE role='student' AND class=?", id)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var u string
		if rows.Scan(&u) == nil {
			out = append(out, u)
		}
	}
	return out
}

// ---- workers ----

func (s *Store) PutWorker(w *Worker) {
	local := 0
	if w.Local {
		local = 1
	}
	_, _ = s.db.Exec(
		"INSERT INTO workers(id, host, runner_port, cdn_port, status, note, local, last_seen) "+
			"VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "+
			"host=excluded.host, runner_port=excluded.runner_port, cdn_port=excluded.cdn_port, "+
			"status=excluded.status, note=excluded.note, local=excluded.local",
		w.ID, w.Host, w.RunnerPort, w.CdnPort, w.Status, w.Note, local, w.LastSeen)
}

// Heartbeat records a worker as up at its current IP (learned from the
// connection). Returns true if this is a new worker or its IP changed, so the
// caller can refresh the CDN upstream. This is how a worker whose DHCP address
// changed is re-found: it keeps the same id and reports the new host.
func (s *Store) Heartbeat(id, host string, runnerPort, cdnPort int, note string) bool {
	var prevHost string
	err := s.db.QueryRow("SELECT host FROM workers WHERE id=?", id).Scan(&prevHost)
	changed := err != nil || prevHost != host
	_, _ = s.db.Exec(
		"INSERT INTO workers(id, host, runner_port, cdn_port, status, note, local, last_seen) "+
			"VALUES(?,?,?,?,'up',?,0,?) ON CONFLICT(id) DO UPDATE SET "+
			"host=excluded.host, runner_port=excluded.runner_port, cdn_port=excluded.cdn_port, "+
			"status='up', note=excluded.note, last_seen=excluded.last_seen",
		id, host, runnerPort, cdnPort, note, time.Now().Unix())
	return changed
}

// MarkStaleWorkers marks non-local workers down if they have not sent a
// heartbeat within maxAge. Returns true if anything changed.
func (s *Store) MarkStaleWorkers(maxAge time.Duration) bool {
	cutoff := time.Now().Add(-maxAge).Unix()
	res, err := s.db.Exec(
		"UPDATE workers SET status='down' WHERE local=0 AND status='up' AND last_seen < ?", cutoff)
	if err != nil {
		return false
	}
	n, _ := res.RowsAffected()
	return n > 0
}

func (s *Store) SetWorkerStatus(host, status, note string) {
	if note == "" {
		_, _ = s.db.Exec("UPDATE workers SET status=? WHERE host=?", status, host)
		return
	}
	_, _ = s.db.Exec("UPDATE workers SET status=?, note=? WHERE host=?", status, note, host)
}

func (s *Store) DeleteWorker(host string) {
	// The gateway-local worker is infrastructure, not removable from the UI.
	_, _ = s.db.Exec("DELETE FROM workers WHERE host=? AND local=0", host)
}

func scanWorkers(rows *sql.Rows) []Worker {
	defer rows.Close()
	var out []Worker
	for rows.Next() {
		var w Worker
		var local int
		if rows.Scan(&w.ID, &w.Host, &w.RunnerPort, &w.CdnPort, &w.Status, &w.Note, &local, &w.LastSeen) == nil {
			w.Local = local != 0
			out = append(out, w)
		}
	}
	return out
}

const workerCols = "id, host, runner_port, cdn_port, status, note, local, last_seen"

func (s *Store) UpWorkers() []Worker {
	rows, err := s.db.Query("SELECT " + workerCols + " FROM workers WHERE status='up'")
	if err != nil {
		return nil
	}
	return scanWorkers(rows)
}

func (s *Store) AllWorkers() []Worker {
	rows, err := s.db.Query("SELECT " + workerCols + " FROM workers ORDER BY host")
	if err != nil {
		return nil
	}
	return scanWorkers(rows)
}

// ---- submissions ----

func (s *Store) AddSubmission(sub *Submission) int {
	testsJSON, _ := json.Marshal(sub.Tests)
	res, err := s.db.Exec(
		"INSERT INTO submissions(username, assignment, ts, status, passed, failed, tests, late) "+
			"VALUES(?,?,?,?,?,?,?,?)",
		sub.Username, sub.Assignment, sub.Ts, sub.Status, sub.Passed, sub.Failed,
		string(testsJSON), boolInt(sub.Late))
	if err != nil {
		return 0
	}
	id, _ := res.LastInsertId()
	sub.ID = int(id)
	return sub.ID
}

func (s *Store) SetPassword(username, password string) {
	_, _ = s.db.Exec("UPDATE users SET pwhash=? WHERE username=?", HashPassword(password), username)
}

func (s *Store) RecentSubmissions(username string, limit int) []*Submission {
	var rows *sql.Rows
	var err error
	q := "SELECT id, username, assignment, ts, status, passed, failed, tests, late FROM submissions "
	if username == "" {
		rows, err = s.db.Query(q+"ORDER BY id DESC LIMIT ?", limit)
	} else {
		rows, err = s.db.Query(q+"WHERE username=? ORDER BY id DESC LIMIT ?", username, limit)
	}
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []*Submission
	for rows.Next() {
		sub := &Submission{}
		var testsJSON string
		var late int
		if rows.Scan(&sub.ID, &sub.Username, &sub.Assignment, &sub.Ts, &sub.Status,
			&sub.Passed, &sub.Failed, &testsJSON, &late) == nil {
			sub.Late = late != 0
			_ = json.Unmarshal([]byte(testsJSON), &sub.Tests)
			out = append(out, sub)
		}
	}
	return out
}
