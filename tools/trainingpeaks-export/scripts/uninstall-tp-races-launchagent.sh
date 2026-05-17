#!/bin/sh

set -eu

LABEL="com.igor.trainingpeaks-races-loop"
USER_HOME="${HOME}"
PLIST_PATH="${USER_HOME}/Library/LaunchAgents/${LABEL}.plist"

if [ -f "${PLIST_PATH}" ]; then
  launchctl bootout "gui/$(id -u)" "${PLIST_PATH}" >/dev/null 2>&1 || true
  launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
  launchctl unload "${PLIST_PATH}" >/dev/null 2>&1 || true
  rm -f "${PLIST_PATH}"
  echo "LaunchAgent removed: ${PLIST_PATH}"
else
  echo "LaunchAgent plist not found: ${PLIST_PATH}"
fi

echo "Logs preserved in ~/igor-tp-reports-bot/tools/trainingpeaks-export/logs"
