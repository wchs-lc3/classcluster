package main

// Turns a fresh Arch Linux ARM Pi 3 into an LC3 worker over SSH.
//
// Bootstrap: if direct root login is closed (Arch ARM default), log in as
// the regular user, use `su` over a pty to install the gateway's SSH key for
// root, then reconnect as root with the key and do everything over clean
// (binary-safe) sessions: install packages, push the grading runner and
// java libs, mirror the heavy static assets, configure nginx and the
// egress lockdown, enable services.

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

const workerNginxConf = `worker_processes 2;
events { worker_connections 512; }
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    types { application/wasm wasm; }
    sendfile on;
    server {
        listen 80;
        location = /health { return 200 'ok'; }
        location /heavy/ {
            alias /srv/lc3-cdn/;
            add_header Cache-Control "public, max-age=2592000, immutable";
        }
    }
}
`

// runnerUnitFor builds the worker's runner service with the heartbeat settings
// so it reports in to the gateway under a stable id (and its IP can change).
func runnerUnitFor(gatewayIP, workerID, token string) string {
	return `[Unit]
Description=LC3 grading runner
After=network.target

[Service]
ExecStart=/usr/bin/python /opt/lc3/runner.py
Restart=always
RestartSec=3
Environment=LC3_RUNNER_BIND=0.0.0.0
Environment=LC3_RUNNER_CDN_PORT=80
Environment=LC3_GATEWAY=` + gatewayIP + `
Environment=LC3_WORKER_ID=` + workerID + `
Environment=LC3_WORKER_TOKEN=` + token + `

[Install]
WantedBy=multi-user.target
`
}

const egressUnit = `[Unit]
Description=LC3 worker egress lockdown
After=network-pre.target

[Service]
Type=oneshot
ExecStart=/opt/lc3/egress-lock.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
`

const egressScript = `#!/bin/bash
# Allow loopback, traffic with the gateway, and established flows.
# Everything else outbound is dropped: graded code cannot phone home.
GW=%s
iptables -F OUTPUT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -d "$GW" -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -j DROP
`

// gatewayKey loads or creates the ed25519 key the gateway uses for root
// access to workers.
func gatewayKey() (ssh.Signer, string, error) {
	seedPath := filepath.Join(dataDir, "state", "worker_key.seed")
	seed, err := os.ReadFile(seedPath)
	if err != nil || len(seed) != ed25519.SeedSize {
		seed = make([]byte, ed25519.SeedSize)
		if _, err := rand.Read(seed); err != nil {
			return nil, "", err
		}
		if err := os.WriteFile(seedPath, seed, 0o600); err != nil {
			return nil, "", err
		}
	}
	priv := ed25519.NewKeyFromSeed(seed)
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		return nil, "", err
	}
	pub := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(signer.PublicKey()))) +
		" lc3-gateway"
	return signer, pub, nil
}

func sshDial(host, user string, auth ssh.AuthMethod) (*ssh.Client, error) {
	return ssh.Dial("tcp", host+":22", &ssh.ClientConfig{
		User:            user,
		Auth:            []ssh.AuthMethod{auth},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         15 * time.Second,
	})
}

// runViaSu runs one command as root through `su` on a pty session.
// Only used for bootstrap; output is discarded.
func runViaSu(client *ssh.Client, rootPassword, cmd string) error {
	sess, err := client.NewSession()
	if err != nil {
		return err
	}
	defer sess.Close()
	if err := sess.RequestPty("dumb", 24, 80, ssh.TerminalModes{}); err != nil {
		return err
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		return err
	}
	var out bytes.Buffer
	sess.Stdout = &out
	sess.Stderr = &out
	quoted := "su -c '" + strings.ReplaceAll(cmd, "'", `'\''`) + "'"
	if err := sess.Start(quoted); err != nil {
		return err
	}
	// wait for the password prompt, then answer it
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(strings.ToLower(out.String()), "password") {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	_, _ = stdin.Write([]byte(rootPassword + "\n"))
	done := make(chan error, 1)
	go func() { done <- sess.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			return fmt.Errorf("su command failed: %s", tail(out.String(), 200))
		}
		return nil
	case <-time.After(60 * time.Second):
		return fmt.Errorf("su command timed out")
	}
}

func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}

type rootShell struct{ client *ssh.Client }

func (r *rootShell) run(cmd string, timeout time.Duration) (string, error) {
	sess, err := r.client.NewSession()
	if err != nil {
		return "", err
	}
	defer sess.Close()
	var out bytes.Buffer
	sess.Stdout = &out
	sess.Stderr = &out
	done := make(chan error, 1)
	if err := sess.Start(cmd); err != nil {
		return "", err
	}
	go func() { done <- sess.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			return out.String(), fmt.Errorf("[%s] %s", firstN(cmd, 60), tail(out.String(), 300))
		}
		return out.String(), nil
	case <-time.After(timeout):
		return out.String(), fmt.Errorf("[%s] timed out", firstN(cmd, 60))
	}
}

func (r *rootShell) push(data []byte, remote string, mode string) error {
	sess, err := r.client.NewSession()
	if err != nil {
		return err
	}
	defer sess.Close()
	sess.Stdin = bytes.NewReader(data)
	cmd := fmt.Sprintf("mkdir -p %s && cat > %s && chmod %s %s",
		filepath.Dir(remote), remote, mode, remote)
	if err := sess.Run(cmd); err != nil {
		return fmt.Errorf("push %s: %v", remote, err)
	}
	return nil
}

func (r *rootShell) pushFile(local, remote, mode string) error {
	data, err := os.ReadFile(local)
	if err != nil {
		return fmt.Errorf("read %s: %v", local, err)
	}
	return r.push(data, remote, mode)
}

func firstN(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// gatewayIPToward finds the local address a given worker will reach us at.
func gatewayIPToward(host string) string {
	conn, err := net.Dial("udp", host+":9")
	if err != nil {
		return "192.168.1.146"
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String()
}

func ProvisionWorker(id, host, user, password, rootPassword string) error {
	signer, pubKey, err := gatewayKey()
	if err != nil {
		return fmt.Errorf("gateway key: %v", err)
	}

	note := func(s string) { store.SetWorkerStatus(host, "provisioning", s) }

	// --- bootstrap root key access ---
	note("connecting")
	rootClient, err := sshDial(host, "root", ssh.PublicKeys(signer))
	if err != nil {
		rootClient, err = sshDial(host, "root", ssh.Password(rootPassword))
	}
	if err != nil {
		userClient, uerr := sshDial(host, user, ssh.Password(password))
		if uerr != nil {
			return fmt.Errorf("ssh as %s failed: %v", user, uerr)
		}
		note("installing gateway key")
		bootstrap := "mkdir -p /root/.ssh && chmod 700 /root/.ssh && " +
			"echo " + shellQuote(pubKey) + " >> /root/.ssh/authorized_keys && " +
			"chmod 600 /root/.ssh/authorized_keys && " +
			"(grep -q '^PermitRootLogin' /etc/ssh/sshd_config && " +
			"sed -i 's/^PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config || " +
			"echo 'PermitRootLogin prohibit-password' >> /etc/ssh/sshd_config) && " +
			"systemctl reload sshd || systemctl restart sshd"
		if err := runViaSu(userClient, rootPassword, bootstrap); err != nil {
			userClient.Close()
			return fmt.Errorf("root bootstrap: %v", err)
		}
		userClient.Close()
		rootClient, err = sshDial(host, "root", ssh.PublicKeys(signer))
		if err != nil {
			return fmt.Errorf("root login after bootstrap: %v", err)
		}
	} else {
		// make sure our key is in place for next time
		sh := &rootShell{rootClient}
		_, _ = sh.run("mkdir -p /root/.ssh && grep -qF "+shellQuote(pubKey)+
			" /root/.ssh/authorized_keys 2>/dev/null || echo "+shellQuote(pubKey)+
			" >> /root/.ssh/authorized_keys", 20*time.Second)
	}
	defer rootClient.Close()
	sh := &rootShell{rootClient}

	if _, err := sh.run("pacman --version >/dev/null", 20*time.Second); err != nil {
		return fmt.Errorf("not an Arch system: %v", err)
	}

	// --- packages ---
	note("installing packages (several minutes)")
	if _, err := sh.run("pacman -Sy --noconfirm --needed nginx python python-pytest "+
		"bubblewrap iptables curl", 30*time.Minute); err != nil {
		return err
	}
	jdkOK := false
	for _, jdk := range []string{"jdk-openjdk", "jdk17-openjdk", "jdk11-openjdk", "jdk8-openjdk"} {
		if _, err := sh.run("pacman -S --noconfirm --needed "+jdk, 30*time.Minute); err == nil {
			jdkOK = true
			break
		}
	}
	if !jdkOK {
		return fmt.Errorf("no JDK package installable")
	}

	// --- runner + java libs ---
	note("installing grading runner")
	if err := sh.pushFile("/opt/lc3/worker/runner.py", "/opt/lc3/runner.py", "644"); err != nil {
		return err
	}
	runnerUnit := runnerUnitFor(gatewayIPToward(host), id, workerToken())
	if err := sh.push([]byte(runnerUnit), "/etc/systemd/system/lc3-runner.service", "644"); err != nil {
		return err
	}
	for _, f := range []string{"junit.jar", "hamcrest.jar"} {
		if err := sh.pushFile("/opt/lc3/java/"+f, "/opt/lc3/java/"+f, "644"); err != nil {
			return err
		}
	}
	if err := sh.pushFile("/opt/lc3/java/lc3runner/LC3Runner.class",
		"/opt/lc3/java/lc3runner/LC3Runner.class", "644"); err != nil {
		return err
	}

	// --- heavy asset mirror ---
	note("mirroring static assets (may take a while)")
	gw := gatewayIPToward(host)
	mirror := "mkdir -p /srv/lc3-cdn && cd /srv/lc3-cdn && " +
		"curl -s --fail http://" + gw + "/heavy-manifest.txt -o /tmp/lc3-manifest.txt && " +
		"while read -r f; do mkdir -p \"$(dirname \"$f\")\"; " +
		"[ -f \"$f\" ] || curl -s --fail -o \"$f\" \"http://" + gw + "/heavy/$f\" || exit 1; " +
		"done < /tmp/lc3-manifest.txt"
	if _, err := sh.run(mirror, 60*time.Minute); err != nil {
		return fmt.Errorf("asset mirror: %v", err)
	}

	// --- nginx + egress ---
	note("configuring nginx and network lockdown")
	if err := sh.push([]byte(workerNginxConf), "/etc/nginx/nginx.conf", "644"); err != nil {
		return err
	}
	if err := sh.push([]byte(fmt.Sprintf(egressScript, gw)), "/opt/lc3/egress-lock.sh", "755"); err != nil {
		return err
	}
	if err := sh.push([]byte(egressUnit), "/etc/systemd/system/lc3-egress.service", "644"); err != nil {
		return err
	}
	if _, err := sh.run("nginx -t && systemctl daemon-reload && "+
		"systemctl enable --now nginx lc3-runner lc3-egress && "+
		"systemctl restart nginx lc3-runner", 3*time.Minute); err != nil {
		return err
	}

	// --- verify from the gateway side ---
	note("verifying")
	client := &http.Client{Timeout: 4 * time.Second}
	deadline := time.Now().Add(45 * time.Second)
	for time.Now().Before(deadline) {
		r1, e1 := client.Get(fmt.Sprintf("http://%s:9500/health", host))
		r2, e2 := client.Get(fmt.Sprintf("http://%s/health", host))
		ok1 := e1 == nil && r1.StatusCode == 200
		ok2 := e2 == nil && r2.StatusCode == 200
		if r1 != nil {
			r1.Body.Close()
		}
		if r2 != nil {
			r2.Body.Close()
		}
		if ok1 && ok2 {
			return nil
		}
		time.Sleep(2 * time.Second)
	}
	return fmt.Errorf("worker services did not come up (runner :9500 / nginx :80)")
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
