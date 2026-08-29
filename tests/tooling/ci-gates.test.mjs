// حاجزٌ على الحواجز — أُضيف في `WL-045`.
//
// **العيبُ الذي يُغلقه:** كان في `package.json` تسعةَ عشرَ نصَّ حاجزٍ
// (`guard:*`) مُعلَنةً في `npm run validate`، ولم يكن مسارُ التكامل المستمر
// يُشغِّل منها إلا اثنين: `guard:templates` و`guard:filecount`. فسبعةَ عشرَ
// حاجزاً — التخويلُ والتغليفُ والنسبُ والذاكرةُ والاحتفاظُ والسجلُّ والمعرفةُ
// والدستورُ والتشريعُ والقضاءُ والمؤسساتُ والولاياتُ والاتحادُ والسيادةُ
// والتقاريرُ والرقابةُ وطبقةُ الواجهة — كانت تُقاس على جهاز المطوّر إن شاء، ولا
// تمنع دمجاً واحداً. والبوابةُ التي لا تُشغَّل آلياً ليست بوابةً بل نيّة.
//
// **قرارٌ مقصود:** الدعوى تُقاس على `package.json` لا على قائمةٍ مكتوبةٍ هنا:
// قائمةٌ مثبَّتةٌ في الاختبار تُنسى مع أوّلِ حاجزٍ جديد، فتعود الفجوةُ نفسُها
// صامتة. فكلُّ نصٍّ يبدأ بـ`guard:` يجب أن يظهر في `ci.yml`، وحاجزٌ جديدٌ بلا
// خطوةٍ في المسار يُخفق هذا الاختبارَ يومَ إعلانه لا بعد أشهر.
//
// **حدٌّ معلَن:** الاختبارُ يقرأ `ci.yml` نصّاً ويطابق `npm run guard:x`؛ فهو
// يقيس **وصلَ** الحاجز بالمسار لا صحّةَ ما يفحصه الحاجزُ نفسُه. وذاك مقيسٌ في
// اختبارات كلِّ حاجزٍ على حِدة.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const workflow = readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

/** @type {Record<string, string>} */
const scripts = pkg.scripts ?? {};
const guardNames = Object.keys(scripts).filter((name) => name.startsWith('guard:'));

test('كل حاجز معلَن في package.json يُشغَّل في التكامل المستمر', () => {
  assert.ok(guardNames.length >= 19, `عدد الحواجز المُعلَنة ${guardNames.length} أقلّ من المتوقّع`);
  const missing = guardNames.filter((name) => !workflow.includes(`npm run ${name}`));
  assert.deepEqual(
    missing,
    [],
    `حواجزُ مُعلَنةٌ غائبةٌ عن ci.yml فلا تمنع دمجاً: ${missing.join(', ')}`,
  );
});

test('كل حاجز يُشغَّل في validate كذلك، فلا يبقى حاجزٌ لا يناديه أحد', () => {
  const validate = String(scripts['validate'] ?? '');
  const missing = guardNames.filter((name) => !validate.includes(`npm run ${name}`));
  assert.deepEqual(missing, [], `حواجزُ غائبةٌ عن validate: ${missing.join(', ')}`);
});

test('كل حاجز في ci.yml نصٌّ قائم في package.json', () => {
  const referenced = [...workflow.matchAll(/npm run (guard:[a-z-]+)/g)].map((m) => m[1]);
  assert.ok(referenced.length > 0);
  const unknown = referenced.filter((name) => !(String(name) in scripts));
  assert.deepEqual(unknown, [], `المسارُ ينادي حواجزَ لا وجودَ لها: ${unknown.join(', ')}`);
});

test('الاختبارات وفحوص الأنواع والأسلوب باقية في المسار', () => {
  for (const command of [
    'npm run lint',
    'npm run format:check',
    'npm run typecheck',
    'npm run build',
    'npm run scan:secrets',
    'npm test',
    'npm run validate:seed',
    'npm run check:registries',
  ]) {
    assert.ok(workflow.includes(command), `الخطوة ${command} غابت عن ci.yml`);
  }
});
