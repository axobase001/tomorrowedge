#!/usr/bin/env bash
# Release Watchdog — polls GitHub for new releases, runs audit, creates PRs
# Designed to run persistently: caffeinate-aware, power-checked, lid-safe
set -euo pipefail

REPO="axobase001/tomorrowedge"
CHECK_INTERVAL="${WATCHDOG_INTERVAL:-300}"  # 5 min default
WORKDIR="${WATCHDOG_WORKDIR:-$(pwd)}"
LAST_TAG_FILE="${WATCHDOG_STATE:-$HOME/.tomorrowedge-watchdog/last-tag}"
REPORT_DIR="${WATCHDOG_REPORT_DIR:-$HOME/.tomorrowedge-watchdog/reports}"
LOG_FILE="${WATCHDOG_LOG:-$HOME/.tomorrowedge-watchdog/watchdog.log}"

mkdir -p "$(dirname "$LAST_TAG_FILE")" "$REPORT_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# ── Power Guard ──
check_power() {
  if [[ "$(uname)" == "Darwin" ]]; then
    # macOS: check if on AC power
    pmset -g ps | grep -q "AC Power" && return 0 || return 1
  else
    return 0  # Linux: assume always on
  fi
}

# ── Keep Awake ──
keep_awake() {
  if [[ "$(uname)" == "Darwin" ]] && command -v caffeinate &>/dev/null; then
    log "☕ Caffeinate active — preventing system sleep while on power"
    caffeinate -i -d -m -s $$ &
    CAFFEINATE_PID=$!
    trap 'kill $CAFFEINATE_PID 2>/dev/null; log "☕ Caffeinate released"' EXIT
  fi
}

# ── Fetch latest release ──
fetch_latest() {
  if command -v gh &>/dev/null && gh auth status &>/dev/null 2>&1; then
    gh release view --repo "$REPO" --json tagName 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['tagName'])" 2>/dev/null
  else
    # Fallback: git ls-remote
    git ls-remote --tags "https://github.com/$REPO.git" 2>/dev/null | grep -o 'v[0-9.]*$' | sort -V | tail -1
  fi
}

# ── Run audit ──
run_audit() {
  local tag="$1"
  log "🔍 New release detected: $tag — starting audit"
  
  cd "$WORKDIR"
  https_proxy="${https_proxy:-http://127.0.0.1:7897}" git pull origin master 2>&1 | tail -1 | while read line; do log "  git: $line"; done
  
  # Install deps and build
  npm install --silent 2>&1 | tail -1 | while read line; do log "  npm: $line"; done
  npm run build 2>&1 | tail -1 | while read line; do log "  build: $line"; done
  npm run web:build 2>&1 | tail -1 | while read line; do log "  web: $line"; done
  
  # Run CI Detective
  local report="$REPORT_DIR/audit-${tag}-$(date +%Y%m%d-%H%M%S).md"
  {
    echo "# Audit Report — $tag"
    echo "**Date**: $(date)"
    echo "**Commit**: $(git rev-parse --short HEAD)"
    echo ""
    echo "## CI Detective Results"
    echo '```'
    bash scripts/ci-detective.sh 2>&1 || true
    echo '```'
  } > "$report"
  
  log "📝 Report saved: $report"
  
  # Auto-create issues if failures found
  if [ "${WATCHDOG_AUTO_ISSUE:-false}" = "true" ]; then
    log "🐛 Auto-creating issues for failures..."
    bash scripts/auto-release-guardian.sh --create-issues 2>&1 | while read line; do log "  $line"; done
  fi
  
  # Save last seen tag
  echo "$tag" > "$LAST_TAG_FILE"
  log "✅ Audit complete for $tag"
}

# ── Main Loop ──
main() {
  log "══════════════════════════════════════════════"
  log "  🛡️ Release Watchdog started"
  log "  📦 Repo: $REPO"
  log "  ⏱️  Interval: ${CHECK_INTERVAL}s"
  log "  🤖 Auto-issue: ${WATCHDOG_AUTO_ISSUE:-false}"
  log "══════════════════════════════════════════════"
  
  keep_awake
  
  # Read last known tag
  local last_tag=""
  [ -f "$LAST_TAG_FILE" ] && last_tag=$(cat "$LAST_TAG_FILE")
  log "📌 Last known: ${last_tag:-none}"
  
  while true; do
    if ! check_power; then
      log "🔋 On battery — pausing checks (sleep ${CHECK_INTERVAL}s)"
      sleep "$CHECK_INTERVAL"
      continue
    fi
    
    local current_tag
    current_tag=$(fetch_latest)
    
    if [ -z "$current_tag" ]; then
      log "⚠️  Could not fetch release tag — retrying in ${CHECK_INTERVAL}s"
      sleep "$CHECK_INTERVAL"
      continue
    fi
    
    if [ "$current_tag" != "$last_tag" ]; then
      log "🆕 New version: $last_tag → $current_tag"
      run_audit "$current_tag"
      last_tag="$current_tag"
    else
      log "✓ $current_tag — up to date"
    fi
    
    sleep "$CHECK_INTERVAL"
  done
}

main
