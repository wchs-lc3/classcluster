# One-shot host fix for OpenVPN's IPv6-first connection attempt hanging
# on networks with no IPv6 route (this network). Sets proto tcp4 in
# /etc/openvpn/openvpn.conf and restarts openvpn, then exits for good --
# restart: 'no' in docker-compose.yml means it does not run again.
#
# This is NOT a persistent command-execution channel like relay-agent:
# the command is fixed at build time, not fetched from anywhere remote,
# and the container never restarts once it exits. Still privileged with
# host pid/network access for the one run, so build a release with this
# service, pin only the target device(s) to it, then remove the service
# from docker-compose.yml again before any further fleet-wide push --
# same discipline that should have applied to relay-agent from the start.
ARG BASE_IMAGE=balenalib/aarch64-debian:bookworm-run
FROM ${BASE_IMAGE}

RUN install_packages util-linux

COPY balena/cloudlink-init/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

CMD ["/usr/local/bin/entrypoint.sh"]
