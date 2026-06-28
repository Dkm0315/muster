#!/usr/bin/env bash
set -euo pipefail

unset NO_COLOR
export HOME
HOME="/tmp/muster-demo-home"
DEMO_WORK="/tmp/muster-demo-work"
rm -rf "$HOME" "$DEMO_WORK"
mkdir -p "$HOME" "$DEMO_WORK"
export MUSTER_ONBOARDING_HOME="$HOME"
export FORCE_COLOR=1

export SLACK_BOT_TOKEN="xoxb-demo"
export SLACK_SIGNING_SECRET="slack-signing-demo"
export TELEGRAM_BOT_TOKEN="123456:telegram-demo"
export GOOGLE_CHAT_SIGNING_SECRET="gchat-demo"

MUSTER_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MUSTER_BIN="$MUSTER_REPO_ROOT/packages/cli/dist/index.js"

cd "$DEMO_WORK"

muster() {
  node "$MUSTER_BIN" "$@"
}

export -f muster
