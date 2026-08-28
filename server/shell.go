package main

// Teacher shell on a worker.
//
// A worker that misbehaves is hard to diagnose from the admin tree alone, so a
// teacher can open an interactive shell on any node the gateway knows about.
// The gateway is the only party that holds the shell token: the browser sends
// keystrokes to an admin endpoint here, this file forwards them to the chosen
// runner with the token attached, and the runner's shell endpoints reject
// anything else. A node with no token configured has no shell at all.
//
// The shell is not sandboxed and runs with the runner's privileges, which on a
// provisioned worker is root. That is the point of it; it is why the endpoints
// are teacher-only and why the target host must already be a known worker.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"
)

type shellRoute struct {
	ref     runnerRef
	session string
}

var (
	shellRoutes   = map[string]shellRoute{}
	shellRoutesMu sync.Mutex
)

func shellToken() string { return os.Getenv("LC3_SHELL_TOKEN") }

// resolveRunner maps a host the teacher picked to a runner the gateway already
// knows. Anything else is refused, so this endpoint cannot be turned into a
// generic request forwarder.
func resolveRunner(host string) (runnerRef, bool) {
	if host == "" {
		return runnerRef{}, false
	}
	for _, w := range store.AllWorkers() {
		if w.Host == host {
			port := w.RunnerPort
			if port == 0 {
				port = 9500
			}
			return runnerRef{w.Host, port}, true
		}
	}
	if host == "127.0.0.1" {
		return runnerRef{"127.0.0.1", 9500}, true // the gateway's own runner
	}
	return runnerRef{}, false
}

func shellCall(ref runnerRef, path string, payload map[string]any, out any) (int, error) {
	payload["token"] = shellToken()
	return execCall(ref, path, payload, out)
}

func handleAdminShellStart(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	if shellToken() == "" {
		fail(w, 503, "worker shell is not configured (set LC3_SHELL_TOKEN)")
		return
	}
	var body struct {
		Host       string
		Rows, Cols int
	}
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	ref, ok := resolveRunner(body.Host)
	if !ok {
		fail(w, 404, "unknown worker")
		return
	}
	if body.Rows <= 0 {
		body.Rows = 24
	}
	if body.Cols <= 0 {
		body.Cols = 80
	}
	var res map[string]any
	code, err := shellCall(ref, "/shell/start",
		map[string]any{"rows": body.Rows, "cols": body.Cols}, &res)
	if err != nil {
		fail(w, 502, "worker unreachable")
		return
	}
	if code == 404 {
		fail(w, 503, "this worker has no shell (LC3_SHELL_TOKEN is unset on it)")
		return
	}
	if code == 403 {
		fail(w, 502, "the worker rejected the shell token")
		return
	}
	if code != 200 {
		fail(w, 502, "worker error")
		return
	}
	if status, _ := res["status"].(string); status != "running" {
		writeJSON(w, 200, res) // busy / error, reported as-is
		return
	}
	sid, _ := res["session"].(string)
	runID := execRunID()
	shellRoutesMu.Lock()
	shellRoutes[runID] = shellRoute{ref: ref, session: sid}
	shellRoutesMu.Unlock()
	writeJSON(w, 200, map[string]any{"status": "running", "run": runID, "host": ref.Host})
}

func lookupShell(runID string) (shellRoute, bool) {
	shellRoutesMu.Lock()
	defer shellRoutesMu.Unlock()
	rt, ok := shellRoutes[runID]
	return rt, ok
}

// shellRelay forwards one call for an existing shell and hands the runner's
// reply straight back.
func shellRelay(w http.ResponseWriter, r *http.Request, path string,
	build func(*http.Request) (map[string]any, error)) {
	if requireTeacher(w, r) == nil {
		return
	}
	runID := r.URL.Query().Get("run")
	rt, ok := lookupShell(runID)
	if !ok {
		fail(w, 404, "no such shell")
		return
	}
	payload, err := build(r)
	if err != nil {
		fail(w, 400, "bad request")
		return
	}
	payload["session"] = rt.session
	var res map[string]any
	code, err := shellCall(rt.ref, path, payload, &res)
	if err != nil || code != 200 {
		fail(w, 502, "worker unreachable")
		return
	}
	if done, _ := res["done"].(bool); done {
		shellRoutesMu.Lock()
		delete(shellRoutes, runID)
		shellRoutesMu.Unlock()
	}
	writeJSON(w, 200, res)
}

func handleAdminShellOutput(w http.ResponseWriter, r *http.Request) {
	shellRelay(w, r, "/shell/output", func(r *http.Request) (map[string]any, error) {
		return map[string]any{"since": r.URL.Query().Get("since")}, nil
	})
}

func handleAdminShellInput(w http.ResponseWriter, r *http.Request) {
	shellRelay(w, r, "/shell/input", func(r *http.Request) (map[string]any, error) {
		var b struct{ Data string } // base64, so control characters survive
		if err := readBody(r, &b); err != nil {
			return nil, err
		}
		return map[string]any{"data": b.Data}, nil
	})
}

func handleAdminShellResize(w http.ResponseWriter, r *http.Request) {
	shellRelay(w, r, "/shell/resize", func(r *http.Request) (map[string]any, error) {
		var b struct{ Rows, Cols int }
		if err := readBody(r, &b); err != nil {
			return nil, err
		}
		return map[string]any{"rows": b.Rows, "cols": b.Cols}, nil
	})
}

func handleAdminShellKill(w http.ResponseWriter, r *http.Request) {
	shellRelay(w, r, "/shell/kill", func(r *http.Request) (map[string]any, error) {
		return map[string]any{}, nil
	})
}

// ---------- worker load ----------

// WorkerLoad is what a runner reports about itself, plus what the gateway knows
// about the jobs it has sent there.
type WorkerLoad struct {
	Reachable  bool      `json:"reachable"`
	Runs       int       `json:"runs"`
	MaxRuns    int       `json:"max_runs"`
	Grades     int       `json:"grades"`
	MaxGrades  int       `json:"max_grades"`
	Shells     int       `json:"shells"`
	LoadAvg    []float64 `json:"loadavg"`
	CPUs       int       `json:"cpus"`
	MemTotalMB int       `json:"mem_total_mb"`
	MemAvailMB int       `json:"mem_avail_mb"`
	HasShell   bool      `json:"shell_available"`
	Java       bool      `json:"java"`
	Dispatched int       `json:"dispatched"` // interactive runs this gateway is relaying
	Grading    int       `json:"grading"`    // grade calls in flight from here
}

func fetchWorkerLoad(ref runnerRef) WorkerLoad {
	var wl WorkerLoad
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://%s:%d/health", ref.Host, ref.Port))
	if err != nil {
		return wl
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return wl
	}
	if err := json.NewDecoder(resp.Body).Decode(&wl); err != nil {
		return wl
	}
	wl.Reachable = true
	return wl
}
