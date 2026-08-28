package main

// First-boot seeding: only the teacher account and the gateway's own runner as
// a local worker so grading works immediately. Classes, students, and
// assignments are created by the teacher; nothing else is seeded.

func seed() {
	if store.CountUsers() == 0 {
		store.PutUser("teacher", "lc3teach", "teacher", "")
	}

	// Register the gateway's own runner as a worker. It is always up and never
	// SSH-provisioned, so grading fans out over the cluster path with no Pi 3.
	if !hasLocalWorker() {
		store.PutWorker(&Worker{
			ID: "local", Host: "127.0.0.1", RunnerPort: 9500, CdnPort: 8081,
			Status: "up", Note: "gateway (Pi 4)", Local: true})
		regenUpstream()
	}
}

func hasLocalWorker() bool {
	for _, w := range store.AllWorkers() {
		if w.Local {
			return true
		}
	}
	return false
}
