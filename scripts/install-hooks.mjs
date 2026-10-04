#!/usr/bin/env node
// تثبيتُ خطّافِ `pre-push` آليّاً عندَ `npm ci`/`npm install` (‏`prepare`) — `WL-329`.
//
// **لماذا آليّاً:** الوكيلُ الجديدُ لا يعرفُ أن يُشغِّلَ `sh scripts/install-hooks.sh`، فالخطّافُ
// الذي يُثبَّتُ بيدٍ غائبٌ عندَ أوّلِ من يحتاجُه. فيُوجَّهُ Git إلى `scripts/hooks/` مباشرةً
// (‏`core.hooksPath`) — فلا نسخةَ تَبلى، وتعديلُ الخطّافِ في المستودعِ نافذٌ بلا إعادةِ تثبيت.
//
// **ولا يعملُ في CI** (‏`CI=true`): مسارُ النشرِ يُشغِّلُ `npm ci` ثمّ `git push`، والحكمُ هناك
// للفحصِ المطلوبِ لا للخطّاف. **والخطّافُ طبقةٌ أولى لا حمايةٌ:** يُتجاوَزُ بـ`--no-verify`،
// والطبقةُ الحاكمةُ «فحص الجودة الكامل» في `ci.yml`.

import { execFileSync } from 'node:child_process';
import process from 'node:process';

if (process.env['CI'] === 'true' || process.env['XUUX_SKIP_HOOKS'] === '1') process.exit(0);
try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
} catch {
  // ليس مستودعَ Git (‏حزمةٌ منشورةٌ مثلاً) — لا خطّافَ يُثبَّت، ولا يُفشِلُ التثبيت.
  process.exit(0);
}
execFileSync('git', ['config', 'core.hooksPath', 'scripts/hooks'], { stdio: 'inherit' });
console.log(
  '✅ core.hooksPath = scripts/hooks — يُشغَّلُ guard:project-state ثمّ validate قبلَ كلِّ دفعة.',
);
