# Canary-only. Persistent SOCKS5 client so the host's own OpenVPN
# (balenaCloud "cloudlink") can reach the internet through the trojan
# tunnel on the home Pi, transparently via balenaOS's built-in redsocks
# host-proxy feature (config at /mnt/boot/system-proxy on the device,
# not part of this image) instead of relying on OpenVPN's own
# unreliable socks-proxy support.
#
# network_mode: host in docker-compose.yml so this binds 127.0.0.1:1080
# on the device's real network namespace, where redsocks expects it.
ARG BASE_IMAGE=balenalib/aarch64-debian:bookworm-run
FROM ${BASE_IMAGE}

ARG XRAY_VERSION=v26.3.27
RUN install_packages curl unzip ca-certificates \
    && curl -fsSL -o /tmp/xray.zip \
       "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-linux-arm64-v8a.zip" \
    && unzip -o /tmp/xray.zip -d /usr/local/bin xray \
    && chmod +x /usr/local/bin/xray \
    && rm -rf /tmp/xray.zip \
    && apt-get purge -y unzip && apt-get autoremove -y

COPY balena/xray-cloudlink/config.json.template /etc/xray-cloudlink/config.json.template
COPY balena/xray-cloudlink/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# The trojan server this tunnels through (the home Pi's workers-only
# xray instance) and its SNI/password. Set as device variables, never
# fleet-wide — same rule as RELAY_* in relay-agent/Dockerfile.
ENV TROJAN_SERVER_ADDRESS=""
ENV TROJAN_SERVER_PORT="443"
ENV TROJAN_PASSWORD=""
ENV TROJAN_SNI=""

CMD ["/usr/local/bin/entrypoint.sh"]
