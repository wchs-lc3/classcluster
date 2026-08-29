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

exec /usr/local/bin/xray run -c /tmp/config.json
