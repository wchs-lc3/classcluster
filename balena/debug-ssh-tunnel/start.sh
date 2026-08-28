#!/bin/bash
# TEMPORARY DEBUG SIDECAR — not for production use.
#
# Runs a tiny sshd, then dials a reverse tunnel out through egress-proxy's
# local SOCKS5 port to the VPN box, forwarding <VPN box>:12222 back to this
# container's own sshd. Exists only because balenaCloud's own connectivity
# (SSH, dashboard, supervisor) is unreliable on this network, which is the
# whole reason egress-proxy exists — this sidecar lets a human verify the
# tunnel and the device without depending on the thing being verified.
#
# Remove this service once balenaOS's host proxy (Device Configuration >
# Proxy) is pointed at egress-proxy and balenaCloud connectivity is
# confirmed working through it.
set -euo pipefail

if [ "${LC3_DEBUG_TUNNEL_ENABLE:-0}" != "1" ]; then
    echo "[lc3-debug-tunnel] LC3_DEBUG_TUNNEL_ENABLE!=1, idling"
    exec sleep infinity
fi

: "${LC3_DEBUG_TUNNEL_KEY_B64:?set LC3_DEBUG_TUNNEL_KEY_B64 to the base64 of the restricted tunnel private key (balenaCloud vars cannot hold line breaks)}"
: "${LC3_DEBUG_TUNNEL_OPERATOR_PUBKEY:?set LC3_DEBUG_TUNNEL_OPERATOR_PUBKEY to the key allowed to log in here}"

SOCKS_PORT="${LC3_EGRESS_SOCKS_PORT:-1080}"
REMOTE_PORT="${LC3_DEBUG_TUNNEL_REMOTE_PORT:-12222}"
TUNNEL_USER="${LC3_DEBUG_TUNNEL_USER:-admin}"
VPN_IP="${LC3_EGRESS_SERVER:-54.210.85.169}"
# The trojan tunnel accepts any destination, so dial the VPN box's own
# loopback rather than its public IP: AWS VPCs generally can't hairpin a
# connection from an instance back to its own public/Elastic IP through the
# IGW, so connecting to the public IP here fails even though the SSH server
# is right there. 127.0.0.1 is only meaningful once the connection has
# reached the box, so this is unrelated to the SNI/IP split used for the
# outer trojan connection itself.
SSH_TARGET="127.0.0.1"

mkdir -p /etc/ssh /root/.ssh /run/sshd
chmod 700 /root/.ssh

# --- local sshd, so the far end of the tunnel has something to land on ---
ssh-keygen -A >/dev/null 2>&1
printf '%s\n' "$LC3_DEBUG_TUNNEL_OPERATOR_PUBKEY" > /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
cat > /etc/ssh/sshd_config <<CONF
Port 22
PermitRootLogin prohibit-password
PasswordAuthentication no
AuthorizedKeysFile /root/.ssh/authorized_keys
CONF
/usr/sbin/sshd -D &

# --- the tunnel key, never baked into the image ---
KEYFILE=/root/.ssh/tunnel_key
echo "$LC3_DEBUG_TUNNEL_KEY_B64" | base64 -d > "$KEYFILE"
chmod 600 "$KEYFILE"

echo "[lc3-debug-tunnel] waiting for egress-proxy's SOCKS5 on 127.0.0.1:${SOCKS_PORT}"
until nc -z 127.0.0.1 "$SOCKS_PORT" 2>/dev/null; do
    sleep 2
done

# A quick, short HTTPS request matches the actual traffic shape egress-proxy
# exists to carry (balenaCloud API calls), unlike the SSH reverse tunnel
# below — that's a long-lived interactive flow, a different shape that a
# traffic-pattern-based DPI filter can reset even when this succeeds. Run
# this every 30s regardless of whether the SSH tunnel is up, so there's
# always a real, independent signal of whether the tunnel carries traffic at
# all on this network.
( while true; do
    RESULT=$(curl -s --max-time 10 -x "socks5h://127.0.0.1:${SOCKS_PORT}" https://api.ipify.org 2>&1) \
        && echo "[lc3-debug-tunnel] HTTPS-through-proxy OK, egress IP: ${RESULT}" \
        || echo "[lc3-debug-tunnel] HTTPS-through-proxy FAILED: ${RESULT}"
    sleep 30
done ) &

# Isolates "is the VPN box's IP:443 itself blocked on this network" from "is
# trojan/xray's traffic specifically what's getting reset": this bypasses
# xray and egress-proxy entirely, connecting straight from this container to
# the VPN box's TCP 443. -k because the cert is for vpn.cheesle.com, not the
# bare IP; a real TLS handshake completing (even with a cert mismatch) is
# still a meaningful signal distinct from a connection reset.
( while true; do
    RESULT=$(curl -sk -o /dev/null -w "http_code=%{http_code} connect=%{time_connect}s" --max-time 10 "https://${VPN_IP}/" 2>&1) \
        && echo "[lc3-debug-tunnel] DIRECT-no-proxy to VPN box: ${RESULT}" \
        || echo "[lc3-debug-tunnel] DIRECT-no-proxy to VPN box FAILED: ${RESULT}"
    sleep 30
done ) &

# The reverse tunnel's key/host assumptions are wired for whichever box
# LC3_EGRESS_SERVER pointed at when the key was issued (originally the EC2
# VPN box's own loopback sshd, to dodge its hairpin-to-public-IP problem).
# Pointing egress-proxy at a different server (e.g. a known-good box, for
# testing) breaks this without also reissuing a matching key there. The
# curl diagnostics above are the real signal and don't depend on this at
# all, so this stays off unless explicitly pointed at a box it matches.
if [ "${LC3_DEBUG_TUNNEL_SSH_ENABLE:-0}" = "1" ]; then
    echo "[lc3-debug-tunnel] dialing reverse tunnel: vpn box loopback:${REMOTE_PORT} -> this container:22"
    while true; do
        ssh -N \
            -o StrictHostKeyChecking=accept-new \
            -o UserKnownHostsFile=/root/.ssh/known_hosts \
            -o ServerAliveInterval=15 \
            -o ServerAliveCountMax=3 \
            -o ExitOnForwardFailure=yes \
            -o ProxyCommand="nc -X 5 -x 127.0.0.1:${SOCKS_PORT} %h %p" \
            -i "$KEYFILE" \
            -R "${REMOTE_PORT}:localhost:22" \
            -p 22 \
            "${TUNNEL_USER}@${SSH_TARGET}" || echo "[lc3-debug-tunnel] tunnel dropped, retrying"
        sleep 5
    done
else
    echo "[lc3-debug-tunnel] LC3_DEBUG_TUNNEL_SSH_ENABLE!=1, skipping the reverse SSH tunnel"
    wait
fi
