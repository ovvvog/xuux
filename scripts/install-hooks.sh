#!/bin/sh
# تثبيت git hooks لمشروع xuux.
#
# الاستخدام: sh scripts/install-hooks.sh
#
# يَنسخُ pre-push hook إلى .git/hooks/ ويَجعلهُ قابلاً للتنفيذ.
# الـ hook يُشغِّل npm run validate قبل كل دفعة.
#
# WL-216: ضابطٌ تعويضيٌّ لحمايةِ الفرعِ (EXT-1) بعد نقل CI إلى self-hosted runner.

set -e

HOOKS_DIR="$(git rev-parse --git-dir)/hooks"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$HOOKS_DIR"

# pre-push hook
cp "$SCRIPT_DIR/hooks/pre-push" "$HOOKS_DIR/pre-push"
chmod +x "$HOOKS_DIR/pre-push" 2>/dev/null || true

echo "✅ تم تثبيت pre-push hook."
echo "   سيُشغَّل npm run validate قبل كل دفعة."
echo "   للتجاوز الاضطراري: git push --no-verify"
