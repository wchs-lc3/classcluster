# SOCKS5 egress sidecar for the LC3 worker fleet.
#
# Runs xray-core as a trojan+TLS client: it dials out to the classroom's VPN
# box and exposes a plain SOCKS5 proxy on the device's loopback for anything
# on the host (containers via network_mode: host, or the balenaOS host proxy
# itself) to use as an egress path.
#
# aarch64 matches raspberrypi3-64 / raspberrypi4-64. For a 32-bit fleet build
# with --buildArg BASE_IMAGE=balenalib/armv7hf-debian:bookworm-run
#                 --buildArg XRAY_ARCH=arm32-v7a
ARG BASE_IMAGE=balenalib/aarch64-debian:bookworm-run
FROM ${BASE_IMAGE}

ARG XRAY_VERSION=v26.3.27
ARG XRAY_ARCH=arm64-v8a

RUN install_packages curl ca-certificates unzip \
    && curl -fsSL -o /tmp/xray.zip \
        "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-linux-${XRAY_ARCH}.zip" \
    && unzip -o /tmp/xray.zip -d /usr/local/bin xray \
    && chmod +x /usr/local/bin/xray \
    && rm -rf /tmp/xray.zip \
    && apt-get purge -y unzip \
    && apt-get autoremove -y

COPY balena/egress-proxy/start.sh /usr/local/bin/lc3-egress-start
RUN chmod +x /usr/local/bin/lc3-egress-start

# --- required: set the password on the fleet or device ---
ENV LC3_EGRESS_ENABLE="0"
ENV LC3_EGRESS_PASSWORD=""

# LC3_EGRESS_SERVER is the EC2 box's IP, not its hostname: a balena device
# only has whatever DNS the classroom LAN/router gives it, so resolving
# vpn.cheesle.com there is one more thing that can silently fail. The cert is
# still issued for the hostname, so LC3_EGRESS_SNI carries that instead and
# is what TLS actually validates against.
ENV LC3_EGRESS_SERVER="54.210.85.169"
ENV LC3_EGRESS_SNI="vpn.cheesle.com"

# --- overridable ---
ENV LC3_EGRESS_SOCKS_PORT="1080"
ENV LC3_EGRESS_SERVER_PORT="443"
ENV LC3_EGRESS_ALPN="http/1.1"
ENV LC3_EGRESS_ALLOW_INSECURE="false"

CMD ["/usr/local/bin/lc3-egress-start"]
