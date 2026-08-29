# Fixing balenaCloud cloudlink on this network

The classroom network blocks OpenVPN, which is what balenaCloud's dashboard
connectivity ("cloudlink" — remote terminal, `IS ONLINE`, live actions like
`device restart`) depends on. A device can still be fully functional without
it: normal app deployment, target-state polling, and env var updates all go
over plain outbound HTTPS, which this network does *not* block. Cloudlink is
only needed for the live/interactive features.

This document is how cloudlink was made to work anyway, and how to repeat it
on a device that doesn't have it yet.

**Status:** applied fleet-wide. All 6 devices show `IS ONLINE: true`. Each
has its own unique `DEVICE_TOKEN` for `relay-agent`, and `relay-agent` is
kept baked into the release each device is pinned to (not in the base
`docker-compose.yml` -- see the comment there) so the fix can be reapplied
without a redeploy if a device ever needs it again (new SD card, config
drift, etc).

## The fix, in short

1. **Route the device's outbound traffic through a working tunnel.**
   `xray-cloudlink` (a per-device balena service, see
   `balena/xray-cloudlink/`) runs a SOCKS5 client on `127.0.0.1:1080` that
   tunnels through a trojan server on the home Pi (`108.28.90.192`), which is
   the one host proven reliable on this network (see
   `~/Downloads/remote-relay/README.md` for why not a cloud VM).
2. **Redirect the host's traffic into that SOCKS5 proxy transparently.**
   balenaOS ships `redsocks` + iptables plumbing for exactly this
   (`/usr/bin/balena-proxy-config`, triggered by
   `/mnt/boot/system-proxy/redsocks.conf` existing). Once configured, *all*
   outbound TCP — including OpenVPN's own connection attempt — gets
   transparently redirected through the SOCKS5 proxy at the kernel level.
   OpenVPN needs no awareness of this at all; its own `socks-proxy` config
   directive was tried first and never reliably engaged, which is why this
   redirect-based approach is used instead.
3. **Fix OpenVPN's IPv6-first connection attempt.** This network has no IPv6
   route. OpenVPN's default config resolves both address families and tries
   IPv6 first, which just hangs. Setting `proto tcp4` in
   `/etc/openvpn/openvpn.conf` fixes it.

Step 1 is a normal balena service, deployable like any other. Steps 2 and 3
are edits to files on the balenaOS **host** filesystem, which has no
supported non-root API for either — a `PATCH /v1/device/host-config` call
covers step 2 alone (see "Non-root attempt" below), but not step 3, and count
on needing both together.

## Doing it on a device (needs relay-agent)

This requires real host root, via `relay-agent` (see
`~/Downloads/remote-relay/README.md`) temporarily added to
`docker-compose.yml`, built, and pinned to the target device — **never** left
in the base compose file, and never fleet-wide. Each device gets its own
unique `DEVICE_TOKEN`, registered on the relay server:

    TOKEN=$(openssl rand -hex 32)
    ssh justin@raspberrypi.local \
      "cd /opt/relay && sudo -u relay RELAY_OPERATOR_TOKEN=<op-token> \
       python3 relay_server.py add-device <device-name> $TOKEN"

Then, device-scoped balena env vars (never fleet vars):

    balena env set DEVICE_ID <device-name> -d <uuid>
    balena env set DEVICE_TOKEN "$TOKEN" -d <uuid>
    balena env set HOST_ROOT_EXEC 1 -d <uuid>
    balena env set RELAY_URL https://relay.justin681.com -d <uuid>
    balena env set RELAY_IP 108.28.90.192 -d <uuid>
    balena env set RELAY_CERT_SHA256 <pinned fingerprint> -d <uuid>
    balena env set TROJAN_SERVER_ADDRESS 108.28.90.192 -d <uuid> -s xray-cloudlink
    balena env set TROJAN_SERVER_PORT 443 -d <uuid> -s xray-cloudlink
    balena env set TROJAN_PASSWORD "<workers trojan password>" -d <uuid> -s xray-cloudlink
    balena env set TROJAN_SNI workers.justin681.com -d <uuid> -s xray-cloudlink
    balena device pin <uuid> <release-with-relay-agent-and-xray-cloudlink>

Once `relay-agent` is polling (confirm with a trivial `echo` command through
`relay_operator.py run`), apply the host fix:

    mkdir -p /mnt/boot/system-proxy
    cat > /mnt/boot/system-proxy/redsocks.conf <<EOF
    base {
      log_debug = off;
      log_info = on;
      log = stderr;
      daemon = off;
      redirector = iptables;
    }
    redsocks {
      type = socks5;
      ip = 127.0.0.1;
      port = 1080;
      local_ip = 127.0.0.1;
      local_port = 12345;
    }
    EOF
    echo "108.28.90.192" > /mnt/boot/system-proxy/no_proxy

    cp /etc/openvpn/openvpn.conf /etc/openvpn/openvpn.conf.bak-before-redsocks
    sed -i "s/^remote .*/remote cloudlink.balena-cloud.com 443/" /etc/openvpn/openvpn.conf
    sed -i "/^socks-proxy/d" /etc/openvpn/openvpn.conf
    sed -i "s/^proto .*/proto tcp4/" /etc/openvpn/openvpn.conf

    sh /usr/bin/balena-proxy-config
    systemctl restart redsocks
    systemctl restart openvpn

The `no_proxy` entry for the trojan server's own address (`108.28.90.192`) is
required: without it, `xray-cloudlink`'s own outbound connection to the home
Pi would get captured by the same redirect and loop back through itself.

Verify with `ip addr show resin-vpn` (should show a real point-to-point IP,
not "can't find device") and `balena device <uuid>` showing `IS ONLINE: true`
and `PUBLIC ADDRESS` matching the home Pi's IP (proof traffic is actually
routing through the tunnel, not direct).

Once confirmed working, remove `relay-agent` from `docker-compose.yml` again
before any further fleet-wide push — it must never sit in the base compose
file (see the comment above `xray-cloudlink` in `docker-compose.yml`).

## Non-root attempt (tried, doesn't fully work)

`xray-cloudlink` can configure step 2 itself, non-root, via the
`io.balena.features.supervisor-api` label and a `PATCH
/v1/device/host-config` call at startup (see its `entrypoint.sh`) — this is
balenaOS's own documented mechanism and needs no relay-agent at all.

This alone was tried on one device (`empty-potato`) and did not produce a
working cloudlink, most likely because step 3 (`proto tcp4`) has no non-root
equivalent — OpenVPN's IPv6-first hang is the same failure mode that blocked
the canary before that fix was applied. A one-shot privileged init container
(`balena/cloudlink-init/`, `restart: 'no'`) was tried as a lower-footprint
alternative to a persistent relay-agent, but `restart: 'no'` does not survive
the *supervisor* itself restarting (only prevents Docker's own restart
policy) — during testing this actually caused repeated supervisor restarts
(likely triggered by its `systemctl restart openvpn` call), and it kept
re-running each time. Rolled back. If a genuinely non-root path is worth
pursuing again, that supervisor-restart interaction is the open question.
