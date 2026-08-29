package main

// Students create their own accounts with a class code.
//
// The teacher reads a code off the Class Management view, opens signup for the
// lesson, and the class types the code into the login page. This replaces
// importing a roster: nobody has to prepare a CSV of usernames and passwords,
// and no list of passwords exists to hand around.
//
// The tradeoff is that this endpoint takes no session, so it is the one door
// into the system that an unauthenticated caller can knock on. Three things
// hold it shut: a class accepts signups only while the teacher has it open,
// codes are wide enough that guessing is not worth attempting, and an address
// that keeps guessing wrong is locked out long before it could work through
// them.

import (
	"crypto/rand"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Unambiguous and unpronounceable: no vowels, so a code cannot come out as a
// word, and none of 0/O, 1/I/L, which is what a class reads back wrong.
const codeAlphabet = "BCDFGHJKMNPQRSTVWXYZ23456789"

const (
	codeLen      = 8 // 28^8, about 3.8e11 codes
	signupWindow = 10 * time.Minute
	// Wrong codes and new accounts are limited separately, because they are
	// different problems. A run of wrong codes is someone guessing at a code,
	// and a tight cap costs a student who mistypes nothing they will notice.
	//
	// Successes need a much looser hand. A whole class signing up in the first
	// ten minutes of a lesson is the case this feature exists for, and behind a
	// school's NAT every one of those students arrives from the same address, so
	// a cap tight enough to stop abuse would lock out most of the room. The
	// teacher's open/close switch is the real control over who may join; this
	// cap only stops a script from running away unattended.
	signupMaxFails     = 20
	signupMaxSuccesses = 60
	minPasswordLen     = 6
)

// joinCode returns a code in XXXX-XXXX form. The dash is cosmetic; it is
// stripped on the way in, so a student who omits it still gets in.
func joinCode() string {
	b := make([]byte, codeLen)
	if _, err := rand.Read(b); err != nil {
		return ""
	}
	out := make([]byte, 0, codeLen+1)
	for i, v := range b {
		if i == codeLen/2 {
			out = append(out, '-')
		}
		out = append(out, codeAlphabet[int(v)%len(codeAlphabet)])
	}
	return string(out)
}

// normalizeCode makes what the student typed comparable with what was issued:
// case and the dash carry no meaning.
func normalizeCode(s string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(strings.TrimSpace(s)) {
		if strings.ContainsRune(codeAlphabet, r) {
			b.WriteRune(r)
		}
	}
	if b.Len() != codeLen {
		return ""
	}
	c := b.String()
	return c[:codeLen/2] + "-" + c[codeLen/2:]
}

type signupTally struct{ fails, ok []time.Time }

var (
	signupHits   = map[string]*signupTally{}
	signupHitsMu sync.Mutex
)

func recent(ts []time.Time, now time.Time) []time.Time {
	kept := ts[:0]
	for _, t := range ts {
		if now.Sub(t) < signupWindow {
			kept = append(kept, t)
		}
	}
	return kept
}

// signupOverLimit reports whether this address has used up either allowance.
// Checked before doing any work, so a locked-out caller cannot even probe for
// which usernames exist.
func signupOverLimit(ip string) bool {
	now := time.Now()
	signupHitsMu.Lock()
	defer signupHitsMu.Unlock()
	if len(signupHits) > 4096 { // the map is the only thing here that grows
		for k, v := range signupHits {
			if len(recent(v.fails, now)) == 0 && len(recent(v.ok, now)) == 0 {
				delete(signupHits, k)
			}
		}
	}
	t := signupHits[ip]
	if t == nil {
		return false
	}
	t.fails = recent(t.fails, now)
	t.ok = recent(t.ok, now)
	return len(t.fails) >= signupMaxFails || len(t.ok) >= signupMaxSuccesses
}

func signupRecord(ip string, success bool) {
	now := time.Now()
	signupHitsMu.Lock()
	defer signupHitsMu.Unlock()
	t := signupHits[ip]
	if t == nil {
		t = &signupTally{}
		signupHits[ip] = t
	}
	if success {
		t.ok = append(recent(t.ok, now), now)
	} else {
		t.fails = append(recent(t.fails, now), now)
	}
}

func handleSignup(w http.ResponseWriter, r *http.Request) {
	var body struct{ Code, Username, Password string }
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	ip := clientIP(r)
	if signupOverLimit(ip) {
		fail(w, 429, "too many attempts from this device; wait a few minutes")
		return
	}

	// A malformed username or too short a password is the student's own typing,
	// not an attempt on a code, so neither counts against them.
	username := strings.TrimSpace(body.Username)
	if !validID(username) {
		fail(w, 400, "username must be letters, numbers, - or _")
		return
	}
	if len(body.Password) < minPasswordLen {
		fail(w, 400, "password must be at least 6 characters")
		return
	}

	code := normalizeCode(body.Code)
	if code == "" {
		signupRecord(ip, false)
		fail(w, 400, "that is not a class code")
		return
	}
	class := store.ClassByCode(code)
	if class == nil {
		signupRecord(ip, false)
		// One message for a wrong code and for a class that is not accepting
		// signups: telling them apart would confirm a guessed code.
		fail(w, 403, "that class code is not accepting sign-ups")
		return
	}
	if store.GetUser(username) != nil {
		// The code was right, so this is a real student picking a taken name.
		fail(w, 409, "that username is taken; pick another")
		return
	}

	store.PutUser(username, body.Password, "student", class.ID)
	if err := os.MkdirAll(filepath.Join(studentsDir(), username), 0o755); err != nil {
		fail(w, 500, "could not create your files")
		return
	}
	// Whatever the class already has published belongs to them too.
	reconcileStudent(username)

	signupRecord(ip, true)
	// Straight in: on a first lesson a class of 25 should not have to sign in
	// again immediately after choosing a password.
	setSession(w, username)
	writeJSON(w, 200, map[string]any{
		"ok": true, "username": username, "class": class.ID, "lang": class.Lang})
}

// signupClear forgets the attempts recorded against an address, or against
// every address when given none.
func signupClear(ip string) {
	signupHitsMu.Lock()
	defer signupHitsMu.Unlock()
	if ip == "" {
		signupHits = map[string]*signupTally{}
		return
	}
	delete(signupHits, ip)
}

// ---------- teacher side ----------

// A student who mistypes the code enough times is locked out for the rest of
// the window, which during a lesson is the teacher's problem to solve and not
// something they should have to wait out. Clearing the lockout is safe to
// expose: it is teacher-only, and the code and the open switch still stand
// between the student and an account.
func handleAdminSignupUnlock(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	var body struct{ IP string }
	_ = readBody(r, &body) // no body means every address
	signupClear(strings.TrimSpace(body.IP))
	writeJSON(w, 200, map[string]any{"ok": true})
}

func handleAdminClassCode(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	var body struct{ ID string }
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	if store.ClassLang(body.ID) == "" {
		fail(w, 404, "unknown class")
		return
	}
	code := joinCode()
	if code == "" {
		fail(w, 500, "could not generate a code")
		return
	}
	store.SetClassCode(body.ID, code)
	writeJSON(w, 200, map[string]any{"ok": true, "code": code})
}

func handleAdminClassSignup(w http.ResponseWriter, r *http.Request) {
	if requireTeacher(w, r) == nil {
		return
	}
	var body struct {
		ID   string
		Open bool
	}
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	if store.ClassLang(body.ID) == "" {
		fail(w, 404, "unknown class")
		return
	}
	store.SetClassSignup(body.ID, body.Open)
	writeJSON(w, 200, map[string]any{"ok": true, "signup_open": body.Open})
}
