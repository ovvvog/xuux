// اختبار صرامة فحص الأنواع — يحرس ما أُنجز في M2.00 من الانحدار.
// السبب: الدين النوعي الذي صُفِّر في M2.00 لم ينشأ من كود خاطئ فقط، بل من إعداد
// كان يبدو صارماً وهو لا يفحص شيئاً (`checkJs: false` مع كود كله `.mjs`). تصفير
// الأخطاء بلا حرس على الإعداد يعني أن سطراً واحداً في `tsconfig.json` يستطيع
// إعادة النجاح الكاذب دون أن تسقط أي بوابة. هذا الاختبار يجعل ذلك السطر مكشوفاً.
// التشغيل: node --test tests/tooling/typecheck-strictness.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * إعداد المدقّق كما هو مكتوب في المستودع.
 * @returns {Record<string, unknown>} كائن `compilerOptions`
 */
function compilerOptions() {
  const raw = readFileSync(join(repoRoot, 'tsconfig.json'), 'utf8');
  const parsed = /** @type {{ compilerOptions?: Record<string, unknown> }} */ (JSON.parse(raw));
  const options = parsed.compilerOptions;
  assert.ok(options, 'tsconfig.json يجب أن يحتوي compilerOptions');
  return options;
}

test('checkJs مُفعَّل — وإلا فالفحص لا يقرأ الكود أصلاً', () => {
  const options = compilerOptions();
  assert.equal(options.allowJs, true, 'allowJs مطلوب لأن كل الكود بامتداد .mjs');
  assert.equal(
    options.checkJs,
    true,
    'checkJs معطَّل: المدقّق سيمرّ على الكود بلا فحص ويُنتج نجاحاً كاذباً',
  );
});

test('أعلام الصرامة التي اعتمد عليها تصفير M2.00 باقية', () => {
  const options = compilerOptions();
  for (const flag of [
    'strict',
    'noUncheckedIndexedAccess',
    'exactOptionalPropertyTypes',
    'noImplicitOverride',
    'noFallthroughCasesInSwitch',
    'noImplicitReturns',
    'noUnusedLocals',
    'noUnusedParameters',
  ]) {
    assert.equal(options[flag], true, `العلم ${flag} أُسقط: هذا تخفيف للصرامة لا إصلاح`);
  }
});

test('نطاق الفحص يشمل الكود والاختبارات والأدوات معاً', () => {
  const raw = readFileSync(join(repoRoot, 'tsconfig.json'), 'utf8');
  const parsed = /** @type {{ include?: string[] }} */ (JSON.parse(raw));
  const include = parsed.include ?? [];
  for (const pattern of ['src/**/*.mjs', 'tests/**/*.mjs', 'scripts/**/*.mjs']) {
    assert.ok(include.includes(pattern), `النطاق لا يشمل ${pattern}`);
  }
});
