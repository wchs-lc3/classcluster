# TEMPORARY debug sidecar for the LC3 worker fleet — not for production.
#
# See start.sh for what this does and why. Deploy this to a single canary
# device only, never fleet-wide; remove once balenaCloud's own connectivity
# is confirmed working through egress-proxy.
ARG BASE_IMAGE=balenalib/aarch64-debian:bookworm-run
FROM ${BASE_IMAGE}

RUN install_packages openssh-server openssh-client netcat-openbsd curl ca-certificates

COPY balena/debug-ssh-tunnel/start.sh /usr/local/bin/lc3-debug-tunnel-start
RUN chmod +x /usr/local/bin/lc3-debug-tunnel-start

ENV LC3_DEBUG_TUNNEL_ENABLE="0"
ENV LC3_DEBUG_TUNNEL_KEY_B64=""
ENV LC3_DEBUG_TUNNEL_OPERATOR_PUBKEY=""
ENV LC3_DEBUG_TUNNEL_REMOTE_PORT="12222"
ENV LC3_DEBUG_TUNNEL_USER="admin"
ENV LC3_DEBUG_TUNNEL_SSH_ENABLE="0"

CMD ["/usr/local/bin/lc3-debug-tunnel-start"]
