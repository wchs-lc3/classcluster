package main

// The assignment file a teacher writes by hand.
//
// An assignment folder holds starter/, tests/, and a small file describing the
// whole thing: its id, its title, how long a run may take, when it is due, and
// whether students may paste into it. That file is YAML, because a teacher
// edits it and YAML forgives a trailing comma and does not need quotes around
// every key. Folders written before the rename still hold assignment.json;
// YAML is a superset of JSON, so the same parser reads both and nothing has to
// be converted by hand.
//
// This is distinct from manifest.json inside an assignment's own directory,
// which the gateway writes and reads and nobody types.

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type assignmentMeta struct {
	ID         string `yaml:"id"`
	Title      string `yaml:"title"`
	Language   string `yaml:"language"`
	TimeoutSec int    `yaml:"timeout_sec"`
	MemMB      int    `yaml:"mem_mb"`
	// Due is written the way a person writes a date: "2026-09-14 23:59", or
	// "2026-09-14" for the end of that day. Empty means no due date.
	Due     string `yaml:"due"`
	NoPaste bool   `yaml:"no_paste"`
	// Entry is the program the input/output cases run. Empty means main.py, or
	// the one program file the starter has.
	Entry string `yaml:"entry"`
}

// metaNames are the file names looked for, in order. assignment.json is the
// name templates used before the move to YAML; it is still read so an
// assignment a teacher started earlier keeps working.
var metaNames = []string{"assignment.yaml", "assignment.yml", "assignment.json"}

func isMetaName(name string) bool {
	for _, n := range metaNames {
		if name == n {
			return true
		}
	}
	return false
}

func parseAssignmentMeta(data []byte) *assignmentMeta {
	var m assignmentMeta
	if yaml.Unmarshal(data, &m) != nil {
		return nil
	}
	return &m
}

// readAssignmentMeta finds and reads the description file in a folder. A folder
// without one is normal: everything in it has a default.
func readAssignmentMeta(dir string) *assignmentMeta {
	for _, name := range metaNames {
		if data, err := os.ReadFile(filepath.Join(dir, name)); err == nil {
			if m := parseAssignmentMeta(data); m != nil {
				return m
			}
		}
	}
	return nil
}

// parseDue turns what a teacher typed into a unix timestamp in the gateway's
// own timezone, which is the school's. A date with no time means the end of
// that day, since "due Friday" means Friday night, not Friday at midnight.
func parseDue(s string) (int64, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, true
	}
	for _, layout := range []string{"2006-01-02 15:04", "2006-01-02T15:04", "2006-01-02 3:04pm"} {
		if t, err := time.ParseInLocation(layout, s, time.Local); err == nil {
			return t.Unix(), true
		}
	}
	if t, err := time.ParseInLocation("2006-01-02", s, time.Local); err == nil {
		return t.Add(23*time.Hour + 59*time.Minute).Unix(), true
	}
	return 0, false
}

// formatDue is parseDue's inverse, for showing a stored due date back to the
// teacher in the same form they would type it.
func formatDue(unix int64) string {
	if unix <= 0 {
		return ""
	}
	return time.Unix(unix, 0).Local().Format("2006-01-02 15:04")
}
