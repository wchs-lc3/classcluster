#!/bin/bash
# Build an xray client config from env vars and run it.
#
# Exposes a local SOCKS5 proxy (127.0.0.1:$LC3_EGRESS_SOCKS_PORT) backed by an
# outbound trojan+TLS tunnel to the gateway's VPN box. Because this service
# runs with network_mode: host, that port is the balenaOS host's own
# loopback.
#
# Once xray is listening, this also PATCHes the host proxy onto itself via
# the local Supervisor API (BALENA_SUPERVISOR_ADDRESS, injected because this
# service carries the io.balena.features.supervisor-api label) so the
# supervisor's own connection to balenaCloud routes through the tunnel too.
# This is deliberately done locally on the device, not from balenaCloud's
# dashboard/CLI: the whole point of egress-proxy is to route around bad
# connectivity to balenaCloud, so setting it up an already-working
# balenaCloud connection would be circular.
set -euo pipefail

if [ "${LC3_EGRESS_ENABLE:-0}" != "1" ]; then
    echo "[lc3-egress] LC3_EGRESS_ENABLE!=1, idling"
    exec sleep infinity
fi

: "${LC3_EGRESS_PASSWORD:?set LC3_EGRESS_PASSWORD to the trojan client password}"

# LC3_EGRESS_SERVER is an IP on purpose, not vpn.cheesle.com: a balena device
# has whatever DNS the classroom LAN hands it, so resolving the hostname
# there is one more silent failure mode to avoid. LC3_EGRESS_SNI carries the
# hostname instead, since that's what the cert is issued for and what TLS
# actually validates against.
SOCKS_PORT="${LC3_EGRESS_SOCKS_PORT:-1080}"
SERVER_PORT="${LC3_EGRESS_SERVER_PORT:-443}"
SNI="${LC3_EGRESS_SNI:?set LC3_EGRESS_SNI to the certs hostname, e.g. vpn.cheesle.com}"
ALPN="${LC3_EGRESS_ALPN:-http/1.1}"

CONFIG=/etc/xray/config.json
mkdir -p /etc/xray

# This xray version rejects "allowInsecure" outright (removed in favor of
# pinnedPeerCertSha256), so the key is only ever written when actually
# needed for a self-signed server — never emitted at all otherwise.
TLS_SETTINGS="{ \"serverName\": \"${SNI}\", \"alpn\": [\"${ALPN}\"] }"
if [ "${LC3_EGRESS_ALLOW_INSECURE:-false}" = "true" ]; then
    PIN=$(echo | openssl s_client -connect "${LC3_EGRESS_SERVER}:${SERVER_PORT}" -servername "${SNI}" 2>/dev/null \
        | openssl x509 -noout -fingerprint -sha256 2>/dev/null \
        | sed -e 's/^.*=//' -e 's/://g')
    if [ -n "$PIN" ]; then
        TLS_SETTINGS="{ \"serverName\": \"${SNI}\", \"alpn\": [\"${ALPN}\"], \"pinnedPeerCertSha256\": \"${PIN}\" }"
        echo "[lc3-egress] LC3_EGRESS_ALLOW_INSECURE=true: pinned server cert sha256 ${PIN}"
    else
        echo "[lc3-egress] LC3_EGRESS_ALLOW_INSECURE=true but could not fetch the server cert to pin; falling back to normal validation"
    fi
fi

cat > "$CONFIG" <<JSON
{
  "log": { "loglevel": "warning" },
  "inbounds": [
    {
      "listen": "127.0.0.1",
      "port": ${SOCKS_PORT},
      "protocol": "socks",
      "settings": { "udp": true }
    }
  ],
  "outbounds": [
    {
      "protocol": "trojan",
      "settings": {
        "servers": [
          {
            "address": "${LC3_EGRESS_SERVER}",
            "port": ${SERVER_PORT},
            "password": "${LC3_EGRESS_PASSWORD}"
          }
        ]
      },
      "streamSettings": {
        "network": "tcp",
        "security": "tls",
        "tlsSettings": ${TLS_SETTINGS}
      }
    }
  ]
}
JSON

echo "[lc3-egress] SOCKS5 on 127.0.0.1:${SOCKS_PORT} -> trojan+tls -> ${LC3_EGRESS_SERVER}:${SERVER_PORT} (sni ${SNI})"
xray run -config "$CONFIG" &
XRAY_PID=$!

set_host_proxy() {
    if [ "${LC3_EGRESS_SET_HOST_PROXY:-1}" != "1" ]; then
        echo "[lc3-egress] LC3_EGRESS_SET_HOST_PROXY=0, leaving the host proxy alone"
        return
    fi
    if [ -z "${BALENA_SUPERVISOR_ADDRESS:-}" ] || [ -z "${BALENA_SUPERVISOR_API_KEY:-}" ]; then
        echo "[lc3-egress] no supervisor API access (missing io.balena.features.supervisor-api label?), skipping host proxy setup"
        return
    fi
    until (exec 3<>"/dev/tcp/127.0.0.1/${SOCKS_PORT}") 2>/dev/null; do
        sleep 1
    done
    exec 3>&- 3<&-
    # The supervisor holds an internal lock while it's still applying the
    # release that just started this container, so the very first attempt
    # right after boot routinely 423s. That's not a real failure — it clears
    # itself once the apply finishes — so retry instead of giving up once.
    #
    # A 423 that never clears is a different problem: balenaOS's newer
    # core-next supervisor component can get stuck retrying a target release
    # it already failed to validate, forever, without ever re-polling for a
    # newer one — starving every supervisor operation (this PATCH included)
    # of the lock it needs. force:true does not help; it's not a normal
    # update lock. The only known way to unstick it is a full device reboot,
    # which is also a pure local call (no balenaCloud connectivity needed)
    # and safe to fire once here: after reboot the supervisor restarts clean
    # and re-fetches target state from scratch.
    FAILURES=0
    STUCK_THRESHOLD="${LC3_EGRESS_STUCK_REBOOT_AFTER:-20}"
    while true; do
        HTTP_CODE=$(curl -s -o /tmp/host-config-response -w "%{http_code}" \
            -X PATCH "${BALENA_SUPERVISOR_ADDRESS}/v1/device/host-config?apikey=${BALENA_SUPERVISOR_API_KEY}" \
            -H "Content-Type: application/json" \
            -d "{\"network\":{\"proxy\":{\"type\":\"socks5\",\"ip\":\"127.0.0.1\",\"port\":${SOCKS_PORT}},\"force\":true}}")
        if [ "$HTTP_CODE" = "200" ]; then
            echo "[lc3-egress] host proxy set: socks5 127.0.0.1:${SOCKS_PORT} — balenaCloud's own connection now routes through the tunnel"
            return
        fi
        FAILURES=$((FAILURES + 1))
        echo "[lc3-egress] host proxy PATCH failed (HTTP ${HTTP_CODE}, attempt ${FAILURES}/${STUCK_THRESHOLD}): $(cat /tmp/host-config-response); retrying in 15s"
        if [ "$HTTP_CODE" = "423" ] && [ "$FAILURES" -ge "$STUCK_THRESHOLD" ]; then
            echo "[lc3-egress] host-config has been locked for ${STUCK_THRESHOLD} straight attempts (~$((STUCK_THRESHOLD * 15))s) — this looks like a stuck supervisor, not a normal apply-in-progress lock. Rebooting once to force a clean restart."
            curl -s -X POST "${BALENA_SUPERVISOR_ADDRESS}/v1/reboot?apikey=${BALENA_SUPERVISOR_API_KEY}" \
                -H "Content-Type: application/json" -d '{"force":true}'
            # The device is rebooting; nothing more to do in this run.
            sleep 300
            FAILURES=0
        fi
        sleep 15
    done
}
set_host_proxy &

wait "$XRAY_PID"
