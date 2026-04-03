#!/bin/bash
# Comprehensive Platform Audit Script
# Identifies fake data, placeholders, and non-production code

echo "==================================================================="
echo "ADUMA MARKETING PLATFORM AUDIT REPORT"
echo "Generated: $(date)"
echo "==================================================================="
echo ""

echo "1. FAKE DATA GENERATION (Math.random, hardcoded scores)"
echo "-------------------------------------------------------------------"
grep -rn "Math\.random\|Math\.floor.*random" web --include="*.js" --include="*.html" | head -30
echo ""

echo "2. SIMULATED API DELAYS (setTimeout for fake loading)"
echo "-------------------------------------------------------------------"
grep -rn "setTimeout.*[0-9]\{3,\}\|await new Promise.*setTimeout" web --include="*.js" | head -30
echo ""

echo "3. PLACEHOLDER TEXT"
echo "-------------------------------------------------------------------"
grep -rni "placeholder\|lorem ipsum\|example\.com\|test@test\|demo" web --include="*.html" --include="*.js" | head -30
echo ""

echo "4. HARDCODED SCORES AND METRICS"
echo "-------------------------------------------------------------------"
grep -rn "healthScore.*=.*[0-9]\|score.*=.*100\|progress.*=.*[0-9]" web --include="*.js" | head -30
echo ""

echo "5. TODO, FIXME, HACK COMMENTS"
echo "-------------------------------------------------------------------"
grep -rn "TODO\|FIXME\|HACK\|XXX\|TEMP" web --include="*.js" --include="*.html" | head -30
echo ""

echo "6. MOCK/FAKE/DEMO DATA"
echo "-------------------------------------------------------------------"
grep -rni "mock.*data\|fake.*data\|demo.*data\|sample.*data" web --include="*.js" | head -30
echo ""

echo "7. COMMENTED OUT CODE"
echo "-------------------------------------------------------------------"
find web -name "*.js" -exec grep -l "^[[:space:]]*//.*function\|^[[:space:]]*/\*" {} \; | head -20
echo ""

echo "8. CONSOLE LOGS (should be removed in production)"
echo "-------------------------------------------------------------------"
grep -rn "console\.log\|console\.warn\|console\.error" web --include="*.js" | wc -l
echo "Total console statements found"
echo ""

echo "9. EMPTY/PLACEHOLDER FUNCTIONS"
echo "-------------------------------------------------------------------"
grep -rn "function.*{[[:space:]]*}\|=>.*{[[:space:]]*}" web --include="*.js" | head -20
echo ""

echo "==================================================================="
echo "END OF AUDIT REPORT"
echo "==================================================================="
