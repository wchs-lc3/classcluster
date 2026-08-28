#!/bin/bash
# Entry point for the LC3 grading runner on balenaOS.
set -u

: "${LC3_JOBS_DIR:=/run/lc3-jobs}"
mkdir -p "$LC3_JOBS_DIR"
chmod 700 "$LC3_JOBS_DIR"

# Clear anything a previous container left behind (the tmpfs survives a
# container restart on the same boot).
rm -rf "${LC3_JOBS_DIR:?}"/* 2>/dev/null || true

if [ -z "${LC3_GATEWAY:-}" ] || [ -z "${LC3_WORKER_TOKEN:-}" ]; then
    echo "[lc3] LC3_GATEWAY and LC3_WORKER_TOKEN are not set."
    echo "[lc3] Set them in balenaCloud (Variables tab). The token is the file"
    echo "[lc3] /srv/lc3/state/worker_token on the gateway."
    echo "[lc3] Grading still works if the gateway is pointed here by hand;"
    echo "[lc3] without them this worker never registers itself."
fi

exec python3 /opt/lc3/worker/runner.py
