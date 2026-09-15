// حاجزُ كتالوجِ الرفضِ — **سدادُ `LIVE-6` في شطرِه الثاني.**
//
// وثيقةُ الواجهةِ تقولُ عن `refusalCodes` نصّاً: «مُعلَنةٌ هنا كي يُقابَل المُعلَنُ
// بالمكتوبِ في الكود **في الاتجاهين** عند كلِّ تحقُّق». **وكان هذا وعداً بلا
// حاجزٍ:** لم يكن في المستودعِ اختبارٌ واحدٌ يقابلُ الكتالوجَ بمجموعِ رموزِ
// الطبقةِ، فخرجَتْ رموزُ إثباتِ الحيازةِ الأربعةُ من الطبقةِ **وهي غيرُ مُعلَنةٍ
// في كتالوجِها** ولم يصرخْ أحدٌ.
//
// وسببُ الغفلةِ مقيسٌ لا مُخمَّنٌ: الاختبارُ القائمُ في `tests/api/gateway.test.mjs`
// يقابلُ الكتالوجَ **بالرموزِ التي وقعَتْ في سجلِّ أحداثِ ذلك الاختبارِ** لا
// بالكتالوجِ المكتوبِ في الشفرةِ — فما لم يقعْ في ذلك السجلِّ لم يُقاسْ. وهذا
// الاختبارُ يقابلُ **المصادرَ** لا **الوقائعَ**، فيَحكُمُ على ما لم يقعْ بعدُ.
//
// و«الاتجاهان» شرطانِ لا شرطٌ:
//   ١. **كلُّ رمزٍ في الشفرةِ مُعلَنٌ في الوثيقةِ** — وإلا خرجَ من الطبقةِ رمزٌ
//      يَعِدُ الكتالوجُ بأنّه لا يخرجُ، فالوعدُ كاذبٌ.
//   ٢. **كلُّ رمزٍ في الوثيقةِ موجودٌ في الشفرةِ** — وإلا كان في الكتالوجِ رمزٌ
//      لا يُرَدُّ أبداً، فالوثيقةُ تُخبِرُ عن سلوكٍ لا وجودَ له.
//
// **وحدُّه مُعلَنٌ:** هذا حاجزُ تقابلٍ لا حاجزُ صوابِ حالةٍ. أنّ الرمزَ مُعلَنٌ لا
// يقولُ إنّ رقمَ حالتِه صحيحٌ — ذاك يقيسُه حاجزُ الترجمةِ في
// `tests/transport/server.test.mjs` واختبارُ الإقلاعِ على السلكِ في
// `tests/tooling/serve-state-boot.test.mjs`.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  API_ERRORS,
  RATE_LIMIT_ERRORS,
  SESSION_ERRORS,
  loadApiPolicy,
} from '../../src/api/index.mjs';

const CONFIG_DIR = path.join(process.cwd(), 'config');
const API_POLICY = loadApiPolicy({ dir: CONFIG_DIR });

/**
 * كلُّ رمزِ رفضٍ **قد يخرجُ من طبقةِ الواجهةِ** إلى مُنادٍ — من مصادرِه في الشفرةِ
 * لا من واقعةٍ في اختبارٍ. و`API_CONFIG_INVALID` منها لأنّها تُرَدُّ `503`.
 */
function codesInCode() {
  return /** @type {Set<string>} */ (
    new Set([
      ...Object.values(API_ERRORS),
      ...Object.values(SESSION_ERRORS),
      ...Object.values(RATE_LIMIT_ERRORS),
    ])
  );
}

test('كلُّ رمزٍ يخرجُ من الطبقةِ مُعلَنٌ في كتالوجِ `refusalCodes` — لا وعدٌ بلا حاجزٍ', () => {
  const declared = /** @type {Set<string>} */ (new Set(API_POLICY.refusalCodes));
  const missing = [...codesInCode()].filter((code) => !declared.has(code)).sort();
  assert.deepEqual(
    missing,
    [],
    `رموزٌ تخرجُ من الطبقةِ وهي غيرُ مُعلَنةٍ في \`config/api.yaml\`: ${missing.join('، ')} — ` +
      'وكتالوجُ الرفضِ يَعِدُ بأنّ ما يخرجُ مُعلَنٌ فيه، فنقصُه يجعلُ الوعدَ كاذباً.',
  );
});

test('ولا رمزَ في الكتالوجِ لا وجودَ له في الشفرةِ — وثيقةٌ لا تُخبِرُ عن سلوكٍ ميتٍ', () => {
  const inCode = codesInCode();
  const orphans = API_POLICY.refusalCodes
    .filter((/** @type {string} */ code) => !inCode.has(code))
    .sort();
  assert.deepEqual(
    orphans,
    [],
    `رموزٌ مُعلَنةٌ في \`config/api.yaml\` ولا مصدرَ لها في الشفرةِ: ${orphans.join('، ')}.`,
  );
});

test('رموزُ إثباتِ الحيازةِ الأربعةُ مُعلَنةٌ بأسمائِها — والدَينُ لا يُغلَقُ بعمومٍ', () => {
  // تسميةُ الأربعةِ صريحاً لا اكتفاءً بالتقابلِ العامِّ: **لو حُذِفت من الشفرةِ
  // ومن الوثيقةِ معاً لبقيَ التقابلُ صحيحاً وسقطَتِ الحمايةُ صامتةً.**
  for (const code of [
    SESSION_ERRORS.POP_REQUIRED,
    SESSION_ERRORS.POP_INVALID,
    SESSION_ERRORS.POP_REPLAY,
    SESSION_ERRORS.POP_EXPIRED,
  ]) {
    assert.ok(
      API_POLICY.refusalCodes.includes(code),
      `رمزُ إثباتِ حيازةٍ غيرُ مُعلَنٍ في كتالوجِ الرفضِ: ${code}`,
    );
  }
});

test('ولإثباتِ الحيازةِ ضمانٌ مكتوبٌ يربطُ رموزَه بملفِّ إنفاذٍ — لا رموزٌ بلا وعدٍ', () => {
  const guarantee = API_POLICY.guarantees.find((entry) => entry.id === 'G-API-POP-PER-CALL');
  assert.ok(guarantee !== undefined, 'لا ضمانَ `G-API-POP-PER-CALL` في وثيقةِ الواجهةِ.');
  assert.equal(guarantee.enforcedBy, 'src/api/session-store.mjs');
  assert.deepEqual(
    [...guarantee.codes].sort(),
    [
      SESSION_ERRORS.POP_EXPIRED,
      SESSION_ERRORS.POP_INVALID,
      SESSION_ERRORS.POP_REPLAY,
      SESSION_ERRORS.POP_REQUIRED,
    ].sort(),
    'ضمانُ إثباتِ الحيازةِ لا يُغطّي رموزَه الأربعةَ.',
  );
});
