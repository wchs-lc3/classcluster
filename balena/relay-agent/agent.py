#!/usr/bin/env python3
"""Poll-based remote command agent.

Repeatedly polls the relay server for a pending command, runs it, and
posts the result back. Never accepts inbound connections and never holds
a sustained connection open — each poll is one short HTTPS request, so
there's nothing for a network to reset mid-flight.

Env vars:
  RELAY_URL          e.g. https://relay.example.com:8787
  DEVICE_ID          this device's id, as registered on the server
  DEVICE_TOKEN       this device's auth token
  POLL_INTERVAL_SEC  seconds between polls (default 15)
  COMMAND_TIMEOUT_SEC  max seconds a single command may run (default 300)
  HOST_ROOT_EXEC     "1" to run commands on the real host via nsenter
                      (requires this container to run privileged, with
                      pid: host and the host root filesystem bind-mounted
                      at /host); anything else runs the command inside
                      this container only, which is what you want for
                      testing this agent before trusting it with the host.
  RELAY_IP           connect to this IP directly instead of resolving
                      RELAY_URL's hostname via DNS. A device on a network
                      you don't control has whatever DNS that network
                      hands it — resolving through it is one more thing
                      that network can quietly break (stale/hijacked
                      records, a filtering resolver, etc). The hostname
                      from RELAY_URL is still sent as the TLS SNI / Host
                      header, so virtual hosting still works.
  RELAY_CERT_SHA256  pin the relay's TLS certificate by SHA-256 fingerprint
                      (hex, colons optional — same format `openssl x509
                      -fingerprint -sha256` prints). Required whenever
                      RELAY_IP is set: connecting by IP means normal
                      hostname verification no longer proves you're
                      talking to the real server, so pinning the exact
                      cert is what does that instead — it also means a
                      network-level TLS-intercepting proxy (a MITM
                      middlebox presenting its own cert) gets rejected
                      outright rather than silently trusted.

This executes whatever the server hands it, as root if HOST_ROOT_EXEC=1.
There is no command allowlist by design — the access control point is the
server's auth, not this agent. Do not point this at a relay server you
don't fully trust.
"""
import hashlib
import http.client
import json
import os
import socket
import ssl
import subprocess
import sys
import time
from urllib.parse import urlsplit

RELAY_URL = os.environ.get("RELAY_URL", "").rstrip("/")
DEVICE_ID = os.environ.get("DEVICE_ID", "")
DEVICE_TOKEN = os.environ.get("DEVICE_TOKEN", "")
POLL_INTERVAL_SEC = float(os.environ.get("POLL_INTERVAL_SEC", "15"))
COMMAND_TIMEOUT_SEC = float(os.environ.get("COMMAND_TIMEOUT_SEC", "300"))
HOST_ROOT_EXEC = os.environ.get("HOST_ROOT_EXEC", "0") == "1"
RELAY_IP = os.environ.get("RELAY_IP", "")
RELAY_CERT_SHA256 = os.environ.get("RELAY_CERT_SHA256", "").replace(":", "").lower()

_parsed = urlsplit(RELAY_URL) if RELAY_URL else None
RELAY_HOST = _parsed.hostname if _parsed else None
RELAY_PORT = (_parsed.port or 443) if _parsed else 443


class RelayError(Exception):
    pass


def _require_config():
    missing = [n for n, v in [("RELAY_URL", RELAY_URL), ("DEVICE_ID", DEVICE_ID), ("DEVICE_TOKEN", DEVICE_TOKEN)] if not v]
    if missing:
        sys.exit(f"missing required env var(s): {', '.join(missing)}")
    if RELAY_IP and not RELAY_CERT_SHA256:
        sys.exit("RELAY_IP is set but RELAY_CERT_SHA256 is not — connecting by IP without pinning the "
                 "cert means nothing actually proves it's the real server. Set RELAY_CERT_SHA256 "
                 "(see `openssl x509 -fingerprint -sha256` against the relay).")


def _connect():
    """Open a verified HTTPS connection to the relay.

    Two modes: normal (resolve RELAY_HOST via DNS, verify against the
    system CA store) when RELAY_IP is unset, or connect straight to
    RELAY_IP with SNI/Host still set to RELAY_HOST and the cert checked
    against RELAY_CERT_SHA256 instead of hostname+CA — see RELAY_IP's
    help text above for why.
    """
    if not RELAY_IP:
        conn = http.client.HTTPSConnection(RELAY_HOST, RELAY_PORT, timeout=30)
        conn.connect()
        return conn

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    raw = socket.create_connection((RELAY_IP, RELAY_PORT), timeout=30)
    tls = ctx.wrap_socket(raw, server_hostname=RELAY_HOST)
    der = tls.getpeercert(binary_form=True)
    fingerprint = hashlib.sha256(der).hexdigest()
    if fingerprint != RELAY_CERT_SHA256:
        tls.close()
        raise RelayError(
            f"relay cert mismatch: got {fingerprint}, expected {RELAY_CERT_SHA256} "
            f"(connecting to {RELAY_IP}:{RELAY_PORT} as {RELAY_HOST}) — refusing, "
            f"this may be a network intercepting the connection"
        )
    conn = http.client.HTTPSConnection(RELAY_HOST, RELAY_PORT, timeout=30)
    conn.sock = tls
    return conn


def _request(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"X-Device-Token": token or DEVICE_TOKEN}
    if data is not None:
        headers["Content-Type"] = "application/json"
    conn = _connect()
    try:
        conn.request(method, path, body=data, headers=headers)
        resp = conn.getresponse()
        raw = resp.read()
        if resp.status >= 400:
            raise RelayError(f"HTTP {resp.status}: {raw.decode(errors='replace')}")
        return json.loads(raw)
    finally:
        conn.close()


def poll():
    return _request("GET", f"/v1/devices/{DEVICE_ID}/poll")


def report(cmd_id, exit_code, stdout, stderr):
    _request(
        "POST",
        f"/v1/devices/{DEVICE_ID}/result/{cmd_id}",
        {"exit_code": exit_code, "stdout": stdout, "stderr": stderr},
    )


def run_command(command):
    if HOST_ROOT_EXEC:
        argv = [
            "nsenter", "--target", "1", "--mount", "--uts", "--ipc", "--net", "--pid",
            "--", "bash", "-c", command,
        ]
    else:
        argv = ["bash", "-c", command]
    try:
        proc = subprocess.run(
            argv, capture_output=True, text=True, timeout=COMMAND_TIMEOUT_SEC,
        )
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired as e:
        out = e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or "")
        err = e.stderr.decode() if isinstance(e.stderr, bytes) else (e.stderr or "")
        return -1, out, err + f"\n[agent] command timed out after {COMMAND_TIMEOUT_SEC}s"


def main():
    _require_config()
    target = f"{RELAY_IP} (pinned cert, sni={RELAY_HOST})" if RELAY_IP else RELAY_URL
    print(
        f"[agent] polling {target} as {DEVICE_ID} every {POLL_INTERVAL_SEC}s "
        f"(host-root-exec={'on' if HOST_ROOT_EXEC else 'off'})",
        flush=True,
    )
    while True:
        try:
            job = poll()
        except (RelayError, OSError, ssl.SSLError) as e:
            print(f"[agent] poll failed: {e}", flush=True)
            time.sleep(POLL_INTERVAL_SEC)
            continue

        if job:
            cmd_id, command = job["id"], job["command"]
            print(f"[agent] running command {cmd_id}: {command!r}", flush=True)
            code, out, err = run_command(command)
            try:
                report(cmd_id, code, out, err)
            except (RelayError, OSError, ssl.SSLError) as e:
                print(f"[agent] failed to report result for {cmd_id}: {e}", flush=True)
            else:
                print(f"[agent] command {cmd_id} done, exit={code}", flush=True)

        time.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    main()
