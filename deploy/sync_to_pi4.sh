#!/bin/bash
# Push the repo to the Pi 4 at /opt/lc3 and assemble the web tree.
#   ./sync_to_pi4.sh            push code + binary, keep existing VS Code build
#   ./sync_to_pi4.sh --vscode   also re-extract and re-trim the VS Code build
set -euo pipefail
PI=root@192.168.1.146
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

# LC3 web extension (extension.js + admin.html) served at /ide-ext/lc3/.
$SSH $PI 'mkdir -p /opt/lc3/web/ext && cp -r /opt/lc3/ext/lc3 /opt/lc3/web/ext/'
echo synced
