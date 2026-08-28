package main

// Manual, hardware-in-the-loop check of the su-over-pty bootstrap against a
// real Arch Linux ARM box. Does NOT run the destructive provisioning steps.
// Run with:
//   LC3_MANUAL_HOST=10.0.0.5 LC3_MANUAL_USER=alarm \
//   LC3_MANUAL_PW=alarm LC3_MANUAL_ROOTPW=root \
//   go test -run TestSuBootstrapManual -v ./...
// Skipped automatically when LC3_MANUAL_HOST is unset.

import (
	"os"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func TestSuBootstrapManual(t *testing.T) {
	host := os.Getenv("LC3_MANUAL_HOST")
	if host == "" {
		t.Skip("set LC3_MANUAL_HOST to run the hardware bootstrap check")
	}
	user := envOr("LC3_MANUAL_USER", "alarm")
	pw := envOr("LC3_MANUAL_PW", "alarm")
	rootPw := envOr("LC3_MANUAL_ROOTPW", "root")

	client, err := sshDial(host, user, ssh.Password(pw))
	if err != nil {
		t.Fatalf("ssh as %s: %v", user, err)
	}
	defer client.Close()

	// run a harmless root command through the same su-over-pty path
	// provisioning uses for its bootstrap step
	if err := runViaSu(client, rootPw, "id -u > /tmp/lc3-sutest && echo done"); err != nil {
		t.Fatalf("su bootstrap failed: %v", err)
	}

	// confirm it actually ran as root by reading back the marker
	sess, err := client.NewSession()
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()
	out, err := sess.Output("cat /tmp/lc3-sutest 2>/dev/null")
	if err != nil {
		t.Fatalf("readback: %v", err)
	}
	if strings.TrimSpace(string(out)) != "0" {
		t.Fatalf("su did not run as root, uid marker was %q", string(out))
	}
	t.Logf("su-over-pty bootstrap ran as root on %s", host)
	_ = time.Second
}
