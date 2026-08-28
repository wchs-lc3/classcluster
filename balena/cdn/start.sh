#!/bin/bash
# Mirror the gateway's heavy assets, then serve them.
#
# /health returns 200 only once a full mirror pass has completed. The runner
# container polls it and holds its heartbeat until then, because the gateway
# fails a CDN upstream over on 5xx but not on 404: a half-mirrored worker in
# the pool would hand students missing files instead of a retry.
set -u

ROOT="${LC3_CDN_ROOT:-/srv/lc3-cdn}"
GW="${LC3_GATEWAY:-}"
JOBS="${LC3_MIRROR_JOBS:-4}"
READY="$ROOT/.ready"

mkdir -p "$ROOT"
rm -f "$READY"

write_nginx_conf() {
    cat > /etc/nginx/nginx.conf <<NGINX
worker_processes 2;
error_log /dev/stderr warn;
pid /run/nginx.pid;
events { worker_connections 512; }
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    access_log off;
    sendfile on;
    tcp_nopush on;
    server {
        listen ${LC3_CDN_PORT:-80};
        server_name _;

        # 200 only when .ready exists, i.e. the mirror is complete.
        location = /health {
            root $ROOT;
            default_type text/plain;
            try_files /.ready =503;
        }

        location /heavy/ {
            alias $ROOT/;
            add_header Cache-Control "public, max-age=${LC3_CDN_MAX_AGE:-2592000}, immutable";
        }
    }
}
NGINX
}

mirror_once() {
    [ -n "$GW" ] || { echo "[lc3-cdn] LC3_GATEWAY not set"; return 1; }
    local manifest missing count
    manifest=$(mktemp)
    if ! curl -fsS -m 60 "http://$GW/heavy-manifest.txt" -o "$manifest"; then
        echo "[lc3-cdn] cannot read the manifest from $GW"
        rm -f "$manifest"
        return 1
    fi

    missing=$(mktemp)
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        [ -f "$ROOT/$f" ] || printf '%s\n' "$f"
    done < "$manifest" > "$missing"

    count=$(wc -l < "$missing")
    if [ "$count" -gt 0 ]; then
        echo "[lc3-cdn] fetching $count file(s) from $GW"
        export ROOT GW LC3_MIRROR_FILE_TIMEOUT
        xargs -a "$missing" -r -P "$JOBS" -I{} sh -c '
            f="$1"
            mkdir -p "$ROOT/$(dirname "$f")"
            curl -fsS -m "${LC3_MIRROR_FILE_TIMEOUT:-300}" \
                -o "$ROOT/$f.part" "http://$GW/heavy/$f" \
                && mv "$ROOT/$f.part" "$ROOT/$f"' _ {}
    fi

    if [ "${LC3_MIRROR_PRUNE:-0}" = "1" ]; then
        ( cd "$ROOT" && find . -type f ! -name '.ready' -printf '%P\n' ) \
            | grep -vxFf "$manifest" \
            | while IFS= read -r stale; do rm -f "$ROOT/$stale"; done
    fi

    # Verify: one unreadable file and this worker stays out of the pool.
    local absent=0
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        [ -f "$ROOT/$f" ] || absent=$((absent + 1))
    done < "$manifest"
    rm -f "$manifest" "$missing"

    if [ "$absent" -gt 0 ]; then
        echo "[lc3-cdn] $absent file(s) still missing; retrying"
        return 1
    fi
    return 0
}

mirror_loop() {
    if [ "${LC3_MIRROR_ENABLE:-1}" != "1" ]; then
        echo "[lc3-cdn] mirroring disabled; serving whatever is in $ROOT"
        echo ok > "$READY"
        return
    fi
    until mirror_once; do
        sleep "${LC3_MIRROR_RETRY_SEC:-30}"
    done
    echo ok > "$READY"
    echo "[lc3-cdn] mirror complete, serving /heavy/ on port ${LC3_CDN_PORT:-80}"

    local refresh="${LC3_MIRROR_REFRESH_SEC:-900}"
    [ "$refresh" -gt 0 ] 2>/dev/null || return
    # Re-sync so a gateway that gains new assets (a Pyodide upgrade) propagates
    # without reprovisioning. .ready stays put: serving a stale-but-complete
    # mirror beats dropping out of the pool.
    while true; do
        sleep "$refresh"
        mirror_once >/dev/null 2>&1 || true
    done
}

write_nginx_conf
mirror_loop &
exec nginx -g 'daemon off;'
