#!/bin/bash
# Push the repo to a password-auth Pi (user "alarm") and run the installer.
# Same as sync_to_pi4.sh but for a non-root user reached with a password
# instead of an SSH key, so every hop goes through sshpass and sudo -S.
#   PI_HOST=<ip> ./sync_to_pi_alarm.sh            push code + binary, keep the VS Code build
#   PI_HOST=<ip> ./sync_to_pi_alarm.sh --vscode   also re-extract and re-trim it
# PI_USER and PI_PASS default to alarm/alarm.
set -euo pipefail

if [ -z "${PI_HOST:-}" ]; then
    echo "set PI_HOST to the target's address, e.g. PI_HOST=10.0.0.5 $0" >&2
    exit 2
fi
PI_USER="${PI_USER:-alarm}"
PI_PASS="${PI_PASS:-alarm}"

command -v sshpass >/dev/null || {
    echo "sshpass not found. Install it: brew install hudochenkov/sshpass/sshpass" >&2
    exit 1
}

PI="$PI_USER@$PI_HOST"
SSH="sshpass -p $PI_PASS ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"

# Remote sudo needs both a pty (-tt, remote sudoers has requiretty) and the
# password piped to a single `sudo -S bash -c '...'` so one prompt covers the
# whole command chain instead of re-prompting per sudo call.
remote_sudo() {
    sshpass -p "$PI_PASS" ssh -tt -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
        "$PI" "echo '$PI_PASS' | sudo -S bash -c '$1'"
}

cd "$(dirname "$0")/.."

# Built-in VS Code extensions the classroom keeps; everything else is removed
# so the workbench stays small (editor, explorer, terminal, problems, and the
# Python/Java grammars).
KEEP="theme-defaults python java json markdown-basics configuration-editing"

( cd server && GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o ../deploy/lc3d . )

remote_sudo "mkdir -p /opt/lc3 && chown -R $PI_USER:$PI_USER /opt/lc3"
COPYFILE_DISABLE=1 tar czf - server worker ext web deploy examples README.md | $SSH $PI 'tar xzf - -C /opt/lc3'

# VS Code web build -> /opt/lc3/web/ide (re-extract only if missing or forced).
if $SSH $PI '[ ! -f /opt/lc3/web/ide/out/vs/loader.js ]' || [ "${1:-}" = "--vscode" ]; then
    COPYFILE_DISABLE=1 tar czf - -C vendor/vscode-web/dist . | $SSH $PI 'mkdir -p /opt/lc3/web/ide && tar xzf - -C /opt/lc3/web/ide'
    $SSH $PI "cd /opt/lc3/web/ide/extensions && for d in */; do
        keep=0; for k in $KEEP; do [ \"\${d%/}\" = \"\$k\" ] && keep=1; done
        [ \$keep -eq 0 ] && rm -rf \"\$d\"; done; echo trimmed to: \$(ls)"
fi

# LC3 web extension (extension.js + admin.html) served at /ide-ext/lc3/.
$SSH $PI 'mkdir -p /opt/lc3/web/ext && cp -r /opt/lc3/ext/lc3 /opt/lc3/web/ext/'

# install_pi4.sh needs root (pacman, systemctl, /etc/nginx, /etc/systemd).
remote_sudo "bash /opt/lc3/deploy/install_pi4.sh"

echo synced
