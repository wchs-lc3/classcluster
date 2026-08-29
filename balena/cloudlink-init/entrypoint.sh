#!/bin/sh
set -e

nsenter --target 1 --mount --uts --ipc --net --pid -- sh -c '
  set -e
  cp /etc/openvpn/openvpn.conf /etc/openvpn/openvpn.conf.bak-before-cloudlink-init
  sed -i "s/^proto .*/proto tcp4/" /etc/openvpn/openvpn.conf
  grep -E "^proto " /etc/openvpn/openvpn.conf
  systemctl restart openvpn
'

echo "[cloudlink-init] done, exiting for good"
exit 0
