#!/bin/sh

set -eu

LABEL="com.igor.trainingpeaks-actions-loop"
USER_HOME="${HOME}"
REPO_DIR="${USER_HOME}/igor-tp-reports-bot"
WORK_DIR="${REPO_DIR}/tools/trainingpeaks-export"
LOG_DIR="${WORK_DIR}/logs"
PLIST_DIR="${USER_HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${LABEL}.plist"
OUT_LOG="${LOG_DIR}/tp-actions-loop.out.log"
ERR_LOG="${LOG_DIR}/tp-actions-loop.err.log"
TP_ACTIONS_LOOP_SINCE_VALUE="${TP_ACTIONS_LOOP_SINCE:-}"
NPM_BIN="$(command -v npm)"
NODE_BIN="$(command -v node)"
NPM_DIR="$(dirname "$NPM_BIN")"
NODE_DIR="$(dirname "$NODE_BIN")"

if [ -z "${NPM_BIN}" ]; then
  echo "npm not found in PATH" >&2
  exit 1
fi

if [ -z "${NODE_BIN}" ]; then
  echo "node not found in PATH" >&2
  exit 1
fi

mkdir -p "${LOG_DIR}"
mkdir -p "${PLIST_DIR}"

SINCE_PROGRAM_ARGUMENT=""
if [ -n "${TP_ACTIONS_LOOP_SINCE_VALUE}" ]; then
  echo "Using cutoff: ${TP_ACTIONS_LOOP_SINCE_VALUE}"
  SINCE_PROGRAM_ARGUMENT="    <string>--since=${TP_ACTIONS_LOOP_SINCE_VALUE}</string>"
else
  echo "No cutoff configured"
fi

# Which mechanism executes a move, and whether the read-only shadow comparator records it.
#
# These are pinned HERE, in the service definition, and not left to .env.local. Two reasons:
#   1. The plist WINS over .env.local (the dotenv loader never overwrites an existing process env
#      var), so this is the single source of truth — no ambiguity about what production is doing.
#   2. TP_MOVE_RESOLVER_MODE used to live only in .env.local, where its absence was indistinguishable
#      from "shadow" — losing that file silently reverted every move to the slow browser path.
#
# Consequence, stated plainly: to change the mode you edit THIS script and reinstall the agent.
# Editing .env.local will no longer have any effect on it.
TP_MOVE_RESOLVER_MODE_VALUE="${TP_MOVE_RESOLVER_MODE:-live_primary}"
TP_MOVE_SHADOW_ENABLED_VALUE="${TP_MOVE_SHADOW_ENABLED:-true}"
echo "Move resolver mode: ${TP_MOVE_RESOLVER_MODE_VALUE}"
echo "Move shadow comparator: ${TP_MOVE_SHADOW_ENABLED_VALUE}"

cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${WORK_DIR}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NPM_BIN}</string>
    <string>run</string>
    <string>tp-actions-loop</string>
    <string>--</string>
    <string>--execute-real</string>
    <string>--interval-seconds=30</string>
${SINCE_PROGRAM_ARGUMENT}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TP_ACTIONS_REAL_EXECUTION</key>
    <string>true</string>
    <key>TP_ACTIONS_USE_API_MOVE</key>
    <string>true</string>
    <key>TP_MOVE_RESOLVER_MODE</key>
    <string>${TP_MOVE_RESOLVER_MODE_VALUE}</string>
    <key>TP_MOVE_SHADOW_ENABLED</key>
    <string>${TP_MOVE_SHADOW_ENABLED_VALUE}</string>
    <key>PATH</key>
    <string>${NODE_DIR}:${NPM_DIR}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${OUT_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${ERR_LOG}</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
launchctl unload "${PLIST_PATH}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}"
launchctl enable "gui/$(id -u)/${LABEL}"

echo "LaunchAgent installed: ${PLIST_PATH}"
echo "Status: launchctl print gui/$(id -u)/${LABEL}"
echo "Tail stdout: tail -f \"${OUT_LOG}\""
echo "Tail stderr: tail -f \"${ERR_LOG}\""
