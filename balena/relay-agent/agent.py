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
  HTTPS_PROXY / HTTP_PROXY  standard proxy env vars, honored automatically
                      by urllib — set these if this device needs to reach
                      the relay through a SOCKS5/HTTP proxy.

This executes whatever the server hands it, as root if HOST_ROOT_EXEC=1.
There is no command allowlist by design — the access control point is the
server's auth, not this agent. Do not point this at a relay server you
don't fully trust.
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

RELAY_URL = os.environ.get("RELAY_URL", "").rstrip("/")
DEVICE_ID = os.environ.get("DEVICE_ID", "")
DEVICE_TOKEN = os.environ.get("DEVICE_TOKEN", "")
POLL_INTERVAL_SEC = float(os.environ.get("POLL_INTERVAL_SEC", "15"))
COMMAND_TIMEOUT_SEC = float(os.environ.get("COMMAND_TIMEOUT_SEC", "300"))
HOST_ROOT_EXEC = os.environ.get("HOST_ROOT_EXEC", "0") == "1"


def _require_config():
    missing = [n for n, v in [("RELAY_URL", RELAY_URL), ("DEVICE_ID", DEVICE_ID), ("DEVICE_TOKEN", DEVICE_TOKEN)] if not v]
    if missing:
        sys.exit(f"missing required env var(s): {', '.join(missing)}")


def _request(method, path, body=None, token=None):
    url = f"{RELAY_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("X-Device-Token", token or DEVICE_TOKEN)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


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
    print(
        f"[agent] polling {RELAY_URL} as {DEVICE_ID} every {POLL_INTERVAL_SEC}s "
        f"(host-root-exec={'on' if HOST_ROOT_EXEC else 'off'})",
        flush=True,
    )
    while True:
        try:
            job = poll()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            print(f"[agent] poll failed: {e}", flush=True)
            time.sleep(POLL_INTERVAL_SEC)
            continue

        if job:
            cmd_id, command = job["id"], job["command"]
            print(f"[agent] running command {cmd_id}: {command!r}", flush=True)
            code, out, err = run_command(command)
            try:
                report(cmd_id, code, out, err)
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
                print(f"[agent] failed to report result for {cmd_id}: {e}", flush=True)
            else:
                print(f"[agent] command {cmd_id} done, exit={code}", flush=True)

        time.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    main()
