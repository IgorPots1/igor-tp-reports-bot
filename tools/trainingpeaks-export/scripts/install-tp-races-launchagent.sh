#!/bin/sh

set -eu

LABEL="com.igor.trainingpeaks-races-loop"
USER_HOME="${HOME}"
REPO_DIR="${USER_HOME}/igor-tp-reports-bot"
WORK_DIR="${REPO_DIR}/tools/trainingpeaks-export"
LOG_DIR="${WORK_DIR}/logs"
PLIST_DIR="${USER_HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${LABEL}.plist"
OUT_LOG="${LOG_DIR}/tp-races-loop.out.log"
ERR_LOG="${LOG_DIR}/tp-races-loop.err.log"
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
    <string>tp-races-loop</string>
    <string>--</string>
    <string>--interval-seconds=60</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
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
