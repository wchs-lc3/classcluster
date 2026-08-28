# LC3 grading worker for balenaOS.
#
# Same runner.py as the Arch workers and the Pi 4 gateway. The difference is
# that a container has no systemd, so per-job cgroup limits become shell
# rlimits plus this container's own mem_limit/pids_limit; the sandbox itself
# (bwrap: no network, no host filesystem, no host pids) is unchanged.
#
# aarch64 matches the raspberrypi3-64 / raspberrypi4-64 images. For a 32-bit
# fleet build with --buildArg BASE_IMAGE=balenalib/armv7hf-debian:bookworm-run
ARG BASE_IMAGE=balenalib/aarch64-debian:bookworm-run
FROM ${BASE_IMAGE}

# bubblewrap is the sandbox; the JDK is both the grading compiler and the JVM
# students' Java actually runs on; python-is-python3 provides the `python` the
# sandbox invokes.
RUN install_packages \
        python3 python-is-python3 \
        openjdk-17-jdk-headless \
        bubblewrap \
        curl ca-certificates coreutils procps

# runner.py's sandbox PATH ends in /usr/lib/jvm/default/bin (the Arch layout).
RUN ln -sfn "$(ls -d /usr/lib/jvm/java-17-openjdk-*)" /usr/lib/jvm/default

COPY vendor/junit.jar vendor/hamcrest.jar /opt/lc3/java/
COPY worker/LC3Runner.java /tmp/LC3Runner.java
RUN javac -cp /opt/lc3/java/junit.jar:/opt/lc3/java/hamcrest.jar \
        -d /opt/lc3/java/lc3runner /tmp/LC3Runner.java \
    && rm /tmp/LC3Runner.java

COPY worker/runner.py worker/lc3_pyharness.py /opt/lc3/worker/
COPY balena/worker/start.sh /usr/local/bin/lc3-worker-start
RUN chmod +x /usr/local/bin/lc3-worker-start

# ---------------------------------------------------------------------------
# Defaults for every tunable. Each one is overridden by a fleet, device, or
# service variable of the same name in the balenaCloud dashboard, so nothing
# here needs a rebuild to change.
# ---------------------------------------------------------------------------

# --- required: set these two in the dashboard ---
# LC3_WORKER_TOKEN is deliberately not given a default here: a shared secret
# does not belong in an image's metadata. It arrives as a fleet variable.
ENV LC3_GATEWAY=""

# --- identity and reporting ---
ENV LC3_WORKER_ID=""
ENV LC3_HEARTBEAT_SEC="30"
ENV LC3_CDN_GATE="1"
ENV LC3_RUNNER_CDN_PORT="80"

# --- service ---
ENV LC3_RUNNER_BIND="0.0.0.0"
ENV LC3_RUNNER_PORT="9500"
ENV LC3_JOBS_DIR="/run/lc3-jobs"
ENV LC3_JAVA_LIBS="/opt/lc3/java"
ENV LC3_PYTHON="python"
ENV LC3_SANDBOX_PATH="/usr/bin:/usr/lib/jvm/default/bin"
ENV LC3_SANDBOX_ROBINDS=""

# --- teacher shell ---
# LC3_SHELL_TOKEN has no default for the same reason as LC3_WORKER_TOKEN, and
# because its absence is what keeps the shell endpoints from existing at all.
ENV LC3_SHELL="/bin/bash"
ENV LC3_MAX_SHELLS="2"
ENV LC3_SHELL_IDLE_SEC="300"

# --- capacity ---
ENV LC3_MAX_RUNS=""
ENV LC3_GRADE_CONCURRENCY="2"

# --- per-job limits ---
ENV LC3_MAX_TIMEOUT="90"
ENV LC3_MEM_MIN_MB="64"
ENV LC3_MEM_MAX_MB="512"
ENV LC3_TASKS_MAX="64"
ENV LC3_CPU_QUOTA="200%"
ENV LC3_GRADE_JAVA_XMX_MB="200"
ENV LC3_RUN_JAVA_XMX_MB="64"
ENV LC3_RUN_MEM_MB="256"
ENV LC3_RUN_TIMEOUT="600"
ENV LC3_COMPILE_MEM_MB="384"
ENV LC3_COMPILE_TIMEOUT="60"
ENV LC3_ULIMIT_AS="1"
ENV LC3_ULIMIT_AS_MULT="2.0"
ENV LC3_ULIMIT_FSIZE_KB="131072"
ENV LC3_USE_SYSTEMD_RUN="1"

EXPOSE 9500
CMD ["/usr/local/bin/lc3-worker-start"]
