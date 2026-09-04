#!/bin/bash
# LC3 gateway installer. Run as root on the Pi 4 with the repo at /opt/lc3.
# Idempotent: safe to re-run after updating files.
set -euo pipefail

PYODIDE_VERSION=0.28.3

echo "== packages =="
pacman -Sy --noconfirm --needed nginx python bubblewrap python-pytest \
    jdk-openjdk

echo "== clock =="
# The classroom network's DNS answers "pool.ntp.org" (via a local time
# appliance) but not the "N.arch.pool.ntp.org" names systemd-timesyncd
# defaults to, so the clock never syncs and drifts arbitrarily far behind.
# Due-date grading (server/main.go) compares against this clock, so a wrong
# clock means wrong late/on-time verdicts. The Pi has no RTC, so this must
# run on every boot, not just once.
sed -i 's/^#\?NTP=.*/NTP=pool.ntp.org/' /etc/systemd/timesyncd.conf
systemctl restart systemd-timesyncd

echo "== directories =="
mkdir -p /opt/lc3/java/lc3runner /srv/lc3/{students,assignments,heavy}

echo "== java grading libs =="
cd /opt/lc3/java
[ -f junit.jar ] || curl -sL --fail -o junit.jar \
    https://repo1.maven.org/maven2/junit/junit/4.13.2/junit-4.13.2.jar
[ -f hamcrest.jar ] || curl -sL --fail -o hamcrest.jar \
    https://repo1.maven.org/maven2/org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.jar
if [ ! -f lc3runner/LC3Runner.class ]; then
    javac -cp junit.jar:hamcrest.jar -d lc3runner /opt/lc3/worker/LC3Runner.java
fi

echo "== pyodide (heavy asset, downloaded once) =="
if [ ! -f /srv/lc3/heavy/pyodide/pyodide.js ]; then
    cd /srv/lc3/heavy
    curl -L --fail -o pyodide.tar.bz2 \
        "https://github.com/pyodide/pyodide/releases/download/${PYODIDE_VERSION}/pyodide-${PYODIDE_VERSION}.tar.bz2"
    tar xjf pyodide.tar.bz2
    rm pyodide.tar.bz2
fi
( cd /srv/lc3/heavy && find . -type f | sed 's|^\./||' ) > /srv/lc3/heavy-manifest.txt

echo "== nginx =="
install -m 644 /opt/lc3/deploy/nginx.conf /etc/nginx/nginx.conf
if [ ! -f /etc/nginx/lc3-upstream.conf ]; then
    printf 'upstream lc3cdn {\n    least_conn;\n    server 127.0.0.1:8081;\n}\n' \
        > /etc/nginx/lc3-upstream.conf
fi
nginx -t

echo "== services =="
mkdir -p /opt/lc3/bin
install -m 755 /opt/lc3/deploy/lc3d /opt/lc3/bin/lc3d
install -m 644 /opt/lc3/deploy/lc3-api.service /etc/systemd/system/
install -m 644 /opt/lc3/deploy/lc3-runner.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now lc3-runner lc3-api nginx
systemctl restart lc3-runner lc3-api nginx

echo "== done =="
systemctl --no-pager --plain status lc3-api lc3-runner nginx | grep -E 'lc3|nginx|Active'
