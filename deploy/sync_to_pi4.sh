#!/bin/bash
# Push the repo to the Pi 4 at /opt/lc3, assemble the web tree, and run the
# installer there so the new gateway binary, nginx config and services are the
# ones running when this returns. The installer ends with a check of every URL
# the editor needs and fails loudly if one is not served.
#   LC3_PI=<ip> ./sync_to_pi4.sh            push code + binary, keep the VS Code build
#   LC3_PI=<ip> ./sync_to_pi4.sh --vscode   also re-extract and re-trim it
# LC3_PI_USER defaults to root.
set -euo pipefail
if [ -z "${LC3_PI:-}" ]; then
    echo "set LC3_PI to the gateway's address, e.g. LC3_PI=10.0.0.5 $0" >&2
    exit 2
fi
PI="${LC3_PI_USER:-root}@${LC3_PI}"
SSH="ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"
cd "$(dirname "$0")/.."

# Built-in VS Code extensions the classroom keeps; everything else is removed
# so the workbench stays small (editor, explorer, terminal, problems, and the
# Python/Java grammars).
KEEP="theme-defaults python java json markdown-basics configuration-editing"

( cd server && GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o ../deploy/lc3d . )

$SSH $PI 'mkdir -p /opt/lc3'
tar czf - server worker ext web deploy examples README.md | $SSH $PI 'tar xzf - -C /opt/lc3'

# VS Code web build -> /opt/lc3/web/ide (re-extract only if missing or forced).
if $SSH $PI '[ ! -f /opt/lc3/web/ide/out/vs/loader.js ]' || [ "${1:-}" = "--vscode" ]; then
    tar czf - -C vendor/vscode-web/dist . | $SSH $PI 'mkdir -p /opt/lc3/web/ide && tar xzf - -C /opt/lc3/web/ide'
    $SSH $PI "cd /opt/lc3/web/ide/extensions && for d in */; do
        keep=0; for k in $KEEP; do [ \"\${d%/}\" = \"\$k\" ] && keep=1; done
        [ \$keep -eq 0 ] && rm -rf \"\$d\"; done; echo trimmed to: \$(ls)"
fi

# LC3 web extension (package.json, extension.js, extension.ls) served at /ide-ext/lc3/.
$SSH $PI 'mkdir -p /opt/lc3/web/ext && cp -r /opt/lc3/ext/lc3 /opt/lc3/web/ext/'

# Copying files changes nothing that is running: the installer puts the binary
# and the nginx config in place and restarts the services.
$SSH $PI 'bash /opt/lc3/deploy/install_pi4.sh'
echo synced
