#!/bin/sh
# تثبيت git hooks لمشروع xuux.
#
# الاستخدام: sh scripts/install-hooks.sh
#
# يُوجِّهُ Git إلى scripts/hooks (core.hooksPath) — والـ hook يُشغِّل
# npm run guard:project-state ثم npm run validate قبل كل دفعة.
#
# WL-216: ضابطٌ تعويضيٌّ لحمايةِ الفرعِ (EXT-1) بعد نقل CI إلى GitHub-hosted runner.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# WL-329: يُوجَّهُ Git إلى scripts/hooks مباشرةً (core.hooksPath) بدلَ النسخِ — فلا نسخةَ تَبلى.
# ويُثبَّتُ آليّاً بـ`npm ci` عبرَ `prepare` (scripts/install-hooks.mjs)؛ وهذا الأمرُ للتثبيتِ اليدويِّ.
chmod +x "$SCRIPT_DIR/hooks/pre-push" 2>/dev/null || true
git config core.hooksPath scripts/hooks

echo "✅ تم تثبيت pre-push hook."
echo "   سيُشغَّل npm run guard:project-state ثم npm run validate قبل كل دفعة."
echo "   للتجاوز الاضطراري: git push --no-verify"
