# LC3 asset mirror. The gateway load-balances Pyodide (and any other heavy
# static runtime) across every worker it has heard from, so each worker keeps
# its own copy of /srv/lc3/heavy and serves it back on /heavy/.
ARG BASE_IMAGE=balenalib/aarch64-debian:bookworm-run
FROM ${BASE_IMAGE}

RUN install_packages nginx-light curl ca-certificates coreutils findutils

COPY balena/cdn/start.sh /usr/local/bin/lc3-cdn-start
RUN chmod +x /usr/local/bin/lc3-cdn-start \
    && rm -f /etc/nginx/sites-enabled/default

# Overridable from the balenaCloud dashboard, same as the runner's variables.
ENV LC3_GATEWAY=""
ENV LC3_CDN_PORT="80"
ENV LC3_CDN_ROOT="/srv/lc3-cdn"
ENV LC3_MIRROR_ENABLE="1"
ENV LC3_MIRROR_JOBS="4"
ENV LC3_MIRROR_RETRY_SEC="30"
ENV LC3_MIRROR_REFRESH_SEC="900"
ENV LC3_MIRROR_PRUNE="0"
ENV LC3_MIRROR_FILE_TIMEOUT="300"
ENV LC3_CDN_MAX_AGE="2592000"

EXPOSE 80
CMD ["/usr/local/bin/lc3-cdn-start"]
