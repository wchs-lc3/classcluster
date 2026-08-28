# Poll-based remote command agent for the LC3 worker fleet.
#
# Canary-only for now (deploy this to exactly one device via device-scoped
# variables, never fleet-wide). See ~/Downloads/remote-relay/README.md (a
# separate, standalone project) for the server side and the security
# model — in short, this hands out real host root to whoever holds the
# device's token, gated only by the relay server's auth.
ARG BASE_IMAGE=balenalib/aarch64-debian:bookworm-run
FROM ${BASE_IMAGE}

RUN install_packages python3 util-linux ca-certificates

COPY balena/relay-agent/agent.py /usr/local/bin/lc3-relay-agent

ENV RELAY_URL=""
ENV DEVICE_ID=""
ENV DEVICE_TOKEN=""
ENV POLL_INTERVAL_SEC="15"
ENV COMMAND_TIMEOUT_SEC="300"
ENV HOST_ROOT_EXEC="0"

CMD ["python3", "/usr/local/bin/lc3-relay-agent"]
