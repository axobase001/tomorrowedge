#!/usr/bin/env bash
# Auto-Release Guardian — watch GitHub releases, run checks, create issues
# Usage: bash scripts/auto-release-guardian.sh [--create-issues] [--dry-run]
set -euo pipefail

REPO="axobase001/tomorrowedge"
DRY_RUN=true
CREATE_ISSUES=false

for arg in "$@"; do
  case $arg in
    --create-issues) CREATE_ISSUES=true; DRY_RUN=false;;
    --dry-run) DRY_RUN=true;;
  esac
done

# ── 1. Fetch latest release ──
echo "══════════════════════════════════════════════"
echo "  Auto-Release Guardian"
echo "  Repo: $REPO"
echo "  Mode: $( $DRY_RUN && echo 'DRY RUN' || echo 'LIVE' )"
echo "══════════════════════════════════════════════"

LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "none")
LATEST_COMMIT=$(git rev-parse --short HEAD)
echo ""
echo "📦 Current: $LATEST_TAG ($LATEST_COMMIT)"

# ── 2. Run CI detective ──
echo ""
echo "🔍 Running CI Detective..."
bash scripts/ci-detective.sh 2>&1 | tee /tmp/guardian_checks.txt
CHECK_EXIT=${PIPESTATUS[0]}

# ── 3. Analyze findings ──
echo ""
echo "📊 Analysis..."

# Count by category
TESTID_FAILS=$(grep -c "❌ testid" /tmp/guardian_checks.txt 2>/dev/null || echo 0)
MOCK_FAILS=$(grep -c "❌.*MOCK" /tmp/guardian_checks.txt 2>/dev/null || echo 0)
FIXTURE_FAILS=$(grep -c "❌.*fixtureMode" /tmp/guardian_checks.txt 2>/dev/null || echo 0)
CONTRACT_FAILS=$(grep -c "❌.*类型契约" /tmp/guardian_checks.txt 2>/dev/null || echo 0)
CATCH_FAILS=$(grep -c "❌.*catch" /tmp/guardian_checks.txt 2>/dev/null || echo 0)
BUNDLE_FAILS=$(grep -c "❌.*bundle\|体积" /tmp/guardian_checks.txt 2>/dev/null || echo 0)

TOTAL_FAILS=$((TESTID_FAILS + MOCK_FAILS + FIXTURE_FAILS + CONTRACT_FAILS + CATCH_FAILS + BUNDLE_FAILS))

echo "  testid:      $( [ "$TESTID_FAILS" -eq 0 ] && echo '✅' || echo '❌' )"
echo "  mock labels: $( [ "$MOCK_FAILS" -eq 0 ] && echo '✅' || echo '❌' )"
echo "  fixtureMode: $( [ "$FIXTURE_FAILS" -eq 0 ] && echo '✅' || echo '❌' )"
echo "  API contract:$( [ "$CONTRACT_FAILS" -eq 0 ] && echo '✅' || echo '❌' )"
echo "  silent catch:$( [ "$CATCH_FAILS" -eq 0 ] && echo '✅' || echo '❌' )"
echo "  bundle size: $( [ "$BUNDLE_FAILS" -eq 0 ] && echo '✅' || echo '❌' )"
echo "  ─────────────────"
echo "  Total issues: $TOTAL_FAILS"

# ── 4. Generate report ──
REPORT_FILE=".tomorrowedge/guardian-report-$(date +%Y%m%d-%H%M%S).md"
mkdir -p .tomorrowedge

cat > "$REPORT_FILE" << REPORT
# Guardian Report — $(date '+%Y-%m-%d %H:%M')

**Release**: $LATEST_TAG ($LATEST_COMMIT)
**Checks passed**: $((6 - TOTAL_FAILS))/6
**Issues found**: $TOTAL_FAILS

## Check Results

| Check | Status |
|-------|--------|
| testid consistency | $( [ "$TESTID_FAILS" -eq 0 ] && echo '✅ Pass' || echo '❌ Fail' ) |
| Mock [MOCK] labels | $( [ "$MOCK_FAILS" -eq 0 ] && echo '✅ Pass' || echo '❌ Fail' ) |
| fixtureMode guard | $( [ "$FIXTURE_FAILS" -eq 0 ] && echo '✅ Pass' || echo '❌ Fail' ) |
| API type contract | $( [ "$CONTRACT_FAILS" -eq 0 ] && echo '✅ Pass' || echo '❌ Fail' ) |
| Silent catch blocks | $( [ "$CATCH_FAILS" -eq 0 ] && echo '✅ Pass' || echo '❌ Fail' ) |
| Bundle size guard | $( [ "$BUNDLE_FAILS" -eq 0 ] && echo '✅ Pass' || echo '❌ Fail' ) |

## Raw Output

\`\`\`
$(cat /tmp/guardian_checks.txt)
\`\`\`
REPORT

echo ""
echo "📝 Report: $REPORT_FILE"

# ── 5. Create issues if live mode ──
if $CREATE_ISSUES && [ "$TOTAL_FAILS" -gt 0 ]; then
  echo ""
  echo "🐛 Creating issues..."

  if [ "$TESTID_FAILS" -gt 0 ]; then
    gh issue create --repo "$REPO" \
      --title "CI: data-testid mismatch detected in $LATEST_TAG" \
      --body "Automated detection. See $(basename "$REPORT_FILE") for details." \
      --label "bug,automated" 2>/dev/null || echo "  (gh auth required for issue creation)"
  fi

  if [ "$MOCK_FAILS" -gt 0 ]; then
    gh issue create --repo "$REPO" \
      --title "CI: unlabeled mock output detected in $LATEST_TAG" \
      --body "Mock outputs must have [MOCK] prefix. Automated by guardian." \
      --label "bug,automated" 2>/dev/null || echo "  (gh auth required)"
  fi

  if [ "$CATCH_FAILS" -gt 0 ]; then
    gh issue create --repo "$REPO" \
      --title "CI: silent catch blocks found in $LATEST_TAG" \
      --body "Automated detection. Catch blocks should log errors." \
      --label "bug,automated" 2>/dev/null || echo "  (gh auth required)"
  fi

  echo "  Done."
elif $CREATE_ISSUES; then
  echo ""
  echo "✅ No issues to create — all checks passed!"
else
  echo ""
  echo "💡 Run with --create-issues to auto-create GitHub issues for failures."
fi

echo ""
echo "══════════════════════════════════════════════"
echo "  Guardian complete."
echo "══════════════════════════════════════════════"
