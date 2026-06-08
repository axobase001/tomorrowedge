#!/usr/bin/env bash
# CI Detective — automated code quality checks
# Run: bash scripts/ci-detective.sh
set -euo pipefail

PASS=0; FAIL=0
red(){ echo -e "\033[31m$*\033[0m"; }
green(){ echo -e "\033[32m$*\033[0m"; }
check(){ local label="$1"; shift; if "$@"; then green "  ✅ $label"; ((PASS++)); else red "  ❌ $label"; ((FAIL++)); fi; echo; }

echo "══════════════════════════════════════════════"
echo "  CI Detective — $(date +%H:%M:%S)"
echo "══════════════════════════════════════════════"
echo

# 1. testid consistency: E2E tests vs component DOM
echo "── 1. testid 引用一致性 ──"
grep -roh "data-testid=['\"][^'\"]*['\"]" src/cockpit-web/src/ | sed "s/data-testid=['\"]//g;s/['\"]//g" | sort -u > /tmp/ci_defined.txt
grep -roh "data-testid=['\"][^'\"]*['\"]" scripts/ | sed "s/data-testid=['\"]//g;s/['\"]//g" | sort -u > /tmp/ci_used.txt
MISSING=$(comm -23 /tmp/ci_used.txt /tmp/ci_defined.txt)
check "testid引用存在对应DOM元素" test -z "$MISSING"
if [ -n "$MISSING" ]; then echo "    缺失: $MISSING"; fi

# 2. No 'Offline candidate' without [MOCK] prefix
echo "── 2. Mock输出必须有 [MOCK] 标签 ──"
UNMARKED=$(grep -rn "Offline candidate" src/ --include="*.ts" | grep -v "\[MOCK\]" | grep -v test | grep -v "\.test\." | grep -v node_modules || true)
check "所有mock输出标注了 [MOCK]" test -z "$UNMARKED"
if [ -n "$UNMARKED" ]; then echo "    未标注: $UNMARKED"; fi

# 3. No fixtureMode: true hardcoded in GUI
echo "── 3. GUI无fixtureMode=true硬编码 ──"
HARDCODED=$(grep -rn "fixtureMode:\s*true" src/cockpit-web/ --include="*.ts" --include="*.tsx" | grep -v test | grep -v "\.test\." || true)
check "main.tsx 无 fixtureMode: true 硬编码" test -z "$HARDCODED"
if [ -n "$HARDCODED" ]; then echo "    硬编码: $HARDCODED"; fi

# 4. Type contract: CockpitRunRequest has livePatch/liveAdvisory
echo "── 4. API类型契约完整 ──"
HAS_LIVE=$(grep -c "livePatch\|liveAdvisory" src/cockpit/contracts.ts || true)
check "CockpitRunRequest 有 livePatch/liveAdvisory 字段" test "$HAS_LIVE" -ge 2

# 5. No silent catch {} blocks (catch without error param)
echo "── 5. 无静默catch块 ──"
SILENT_CATCHES=$(grep -rn "} catch {" src/ --include="*.ts" | grep -v "catch (error)" | grep -v "catch (e)" | grep -v "catch (err)" | grep -v test | grep -v "\.test\." | grep -v node_modules | grep -v "// skip\|lint" || true)
check "catch块都有错误参数" test -z "$SILENT_CATCHES"
if [ -n "$SILENT_CATCHES" ]; then echo "    静默catch:"; echo "$SILENT_CATCHES"; fi

# 6. Bundle size regression
echo "── 6. 打包体积不超标 ──"
if [ -f dist/cockpit-web/assets/index-*.js ]; then
  JS_SIZE=$(wc -c dist/cockpit-web/assets/index-*.js 2>/dev/null | tail -1 | awk '{print $1}')
  check "JS bundle <= 200KB" test "${JS_SIZE:-0}" -le 204800
else
  echo "    ⚠ dist/cockpit-web 未构建，跳过"
fi

echo "══════════════════════════════════════════════"
echo "  结果: $PASS passed, $FAIL failed"
echo "══════════════════════════════════════════════"
exit $FAIL
