#!/bin/sh
set -e

for var in TROJAN_SERVER_ADDRESS TROJAN_PASSWORD TROJAN_SNI; do
  eval "val=\$$var"
  if [ -z "$val" ]; then
    echo "missing required env var: $var" >&2
    exit 1
  fi
done

sed \
  -e "s/__TROJAN_SERVER_ADDRESS__/${TROJAN_SERVER_ADDRESS}/" \
  -e "s/__TROJAN_SERVER_PORT__/${TROJAN_SERVER_PORT}/" \
  -e "s/__TROJAN_PASSWORD__/${TROJAN_PASSWORD}/" \
  -e "s/__TROJAN_SNI__/${TROJAN_SNI}/" \
  /etc/xray-cloudlink/config.json.template > /tmp/config.json

# Point the host's own OpenVPN (balenaCloud "cloudlink") through the SOCKS5
# inbound below, via balenaOS's built-in redsocks host-proxy — the
# documented, non-root way to do this. Requires the supervisor-api label
# in docker-compose.yml (BALENA_SUPERVISOR_ADDRESS/_API_KEY come from that,
# not from anything in this image). Excludes the trojan server's own
# address from the redirect so this container's own outbound connection
# to it doesn't loop back through itself.
if [ -n "$BALENA_SUPERVISOR_ADDRESS" ] && [ -n "$BALENA_SUPERVISOR_API_KEY" ]; then
  echo "[xray-cloudlink] configuring host proxy via supervisor API..."
  curl -sS -X PATCH \
    "${BALENA_SUPERVISOR_ADDRESS}/v1/device/host-config?apikey=${BALENA_SUPERVISOR_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"network\":{\"proxy\":{\"type\":\"socks5\",\"ip\":\"127.0.0.1\",\"port\":1080,\"noProxy\":[\"${TROJAN_SERVER_ADDRESS}\"]}}}" \
    || echo "[xray-cloudlink] host-config request failed, continuing anyway" >&2
else
  echo "[xray-cloudlink] BALENA_SUPERVISOR_ADDRESS/_API_KEY not set (missing supervisor-api label?) -- skipping host proxy config" >&2
fi

exec /usr/local/bin/xray run -c /tmp/config.json
