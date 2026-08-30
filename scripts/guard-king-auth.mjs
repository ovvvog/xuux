#!/usr/bin/env node
/**
 * حاجزُ مصادقةِ الملكِ القوية — بوابةٌ في `npm run validate` (الخطوة M9.04).
 *
 * وموضعُها المقيسُ في السلسلةِ بعد حاجزِ الديوانِ وقبل حاجزِ الإصدار؛ والسلسلةُ
 * بعدها **ثلاثون بوابةً ثم كلُّ الاختبارات** — والعددُ معدودٌ من `package.json` لا
 * منقولٌ من وصفٍ سابق. (وأرقامُ الترتيبِ المكتوبةُ في ترويساتِ بعضِ الحواجزِ
 * الأخرى تزيد واحداً على مواقعِها الفعليةِ في السلسلة؛ دَينٌ مُعلَنٌ لا يُورَّث هنا.)
 *
 * وحاجزُ الديوانِ يحرس ممارسةَ السلطة: أمرٌ معلَنٌ وتوقيعٌ متحقَّقٌ منه
 * وقيدٌ قبل الأثر. وهذه تحرس **إثباتَ من يمارسها**: أن تبقى الجلسةُ القويةُ
 * شرطاً لا إعداداً، وأن يبقى العاملُ الثاني والجهازُ الموثوقُ **بياناتٍ معلَنةً**
 * لا نيّةَ كاتب، وأن لا يُسرَّب سرٌّ ولا رمزٌ إلى سجلٍّ أو رسالة. وثمانِ قواعد:
 *
 *   R1: `config/king-authentication.yaml` تُحمَّل بمخطَّطها، وأنواعُ الأوامرِ التي
 *       تُشترط لها الجلسةُ القويةُ **تساوي** أنواعَ أوامرِ `config/royal-console.yaml`
 *       في الاتجاهين؛ فأمرٌ سياديٌّ جديدٌ في الديوانِ بلا نوعٍ هنا يُخفق البوابةَ
 *       يومَ إعلانِه لا بعد أشهر.
 *   R2: كلُّ رمزٍ في `AUTHN_ERRORS` مُعلَنٌ في الوثيقةِ وبالعكس **في الاتجاهين**،
 *       وكلُّ رمزٍ في ضمانٍ حاضرٌ نصّاً في ملفِّ إنفاذِه المُعلَن.
 *   R3: الترتيبُ نصٌّ لا نيّة: هويةُ الملكِ قبل الجهاز، والجهازُ قبل العامل،
 *       وحضورُ العاملِ قبل صحّتِه، وصحّتُه قبل سؤالِ استهلاكِه، والاستهلاكُ قبل
 *       إنشاءِ الجلسة؛ فمن قلبها منح جلسةً قبل أن يقيس عاملاً.
 *   R4: نظافةُ الطبقة: لا استيرادَ من `src/persistence/` ولا `src/observability/`
 *       ولا `src/data/` ولا `src/console/`، والحقولُ خاصّةٌ لا تُصدَّر، ولا مِقبضَ
 *       عامٌّ على الجلساتِ ولا على الأسرار، والمقارنةُ ثابتةُ الزمنِ لا `===`.
 *   R5: المصادقةُ **مركَّبةٌ** في `composition.mjs` بلا شرطٍ باسمِها، ومُعلَنةٌ في
 *       `StateRegistries`، وتُمرَّر إلى الديوانِ في نداءِ إنشائِه؛ فمصادقةٌ ككودٍ
 *       غيرِ مركَّبٍ عاملٌ ثانٍ اختياريٌّ اسمُه إلزاميّ.
 *   R6: الديوانُ يُنفِذها: رمزُ `CONSOLE_AUTHENTICATION_REQUIRED` مُعلَنٌ في وثيقتِه
 *       وضمانُه مربوطٌ به، والاشتراطُ يقع **قبل** مطابقةِ الفعلِ الموقَّعِ وقبل
 *       التاجِ والأثر، والمصادقةُ حقلٌ خاصٌّ في الديوانِ لا وسيطٌ يُمرَّر مع كلِّ نداء.
 *   R7: لا يُكتب سرٌّ ولا رمزٌ في قيدٍ ولا رسالة: لا `token` ولا `factorCode` ولا
 *       بصمةٌ في أيِّ `log.append(` في الوحدة.
 *   R8: ملفُّ اختبارِ المصادقةِ موجودٌ ويقيس معيارَ القبولِ ورموزَه الحاكمة.
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقرأ النصَّ والوثيقةَ ولا يفتح جلسةً ولا يحسب رمزاً؛
 * فصدقُ العاملِ ومنعُ إعادتِه وانتهاءُ الجلسةِ بلا تمديدٍ مقيسةٌ في
 * `tests/authn/king-auth.test.mjs` على سجلٍّ دائمٍ على القرصِ وديوانٍ حقيقيّ.
 *
 * **حدٌّ معلَن ثانٍ:** الترتيبُ يُقاس بموضعِ النصِّ في الوحدة، وذاك يمنع القلبَ
 * بالكتابةِ لا القلبَ بالتفافٍ في زمنِ التشغيل.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { AUTHN_ERRORS, loadKingAuthPolicy } from '../src/authn/index.mjs';
import { loadConsolePolicy } from '../src/console/index.mjs';

const argv = process.argv.slice(2);
const rootIndex = argv.indexOf('--root');
const rootArg = rootIndex >= 0 ? argv[rootIndex + 1] : undefined;
const ROOT =
  rootArg !== undefined && rootArg !== ''
    ? path.resolve(rootArg)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {string[]} */
const violations = [];

/**
 * @param {string} relative
 * @returns {string}
 */
function readFile(relative) {
  const full = path.join(ROOT, relative);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

const MODULE_PATH = 'src/authn/king-auth.mjs';
const authnSource = readFile(MODULE_PATH);
if (authnSource === '') {
  violations.push(
    `R0: وحدةُ المصادقة ${MODULE_PATH} غائبةٌ من الشجرة؛ ولا حاجزَ على ما لا وجودَ له.`,
  );
}

// ═══ R1: الوثيقةُ تُحمَّل، وأنواعُ الاشتراطِ تساوي أنواعَ أوامرِ الديوان ═══
/** @type {import('../src/authn/king-auth.mjs').KingAuthPolicy | null} */
let policy = null;
try {
  policy = loadKingAuthPolicy({ dir: path.join(ROOT, 'config') });
} catch (error) {
  violations.push(`R1: وثيقةُ المصادقةِ لا تُحمَّل (AUTHN_CONFIG_INVALID): ${errorText(error)}`);
}

/** @type {import('../src/console/royal-console.mjs').ConsolePolicy | null} */
let consolePolicy = null;
try {
  consolePolicy = loadConsolePolicy({ dir: path.join(ROOT, 'config') });
} catch (error) {
  violations.push(
    `R1: وثيقةُ الديوانِ لا تُحمَّل فلا تُقابَل أنواعُ أوامرِها: ${errorText(error)}`,
  );
}

if (policy !== null && consolePolicy !== null) {
  const required = /** @type {Set<string>} */ (new Set(policy.assurance.requiredForCommandKinds));
  const consoleKinds = /** @type {Set<string>} */ (
    new Set(consolePolicy.commands.map((command) => command.kind))
  );
  for (const kind of consoleKinds) {
    if (!required.has(kind)) {
      violations.push(
        `R1: نوعُ الأمر «${kind}» مُعلَنٌ في وثيقةِ الديوانِ ولا اشتراطَ له في وثيقةِ المصادقة؛ وأمرٌ سياديٌّ بلا اشتراطٍ يُصدَر بمفتاحٍ وحده.`,
      );
    }
  }
  for (const kind of required) {
    if (!consoleKinds.has(kind)) {
      violations.push(
        `R1: نوعُ الأمر «${kind}» مُشترَطٌ في وثيقةِ المصادقةِ ولا أمرَ من نوعِه في وثيقةِ الديوان؛ واشتراطٌ على نوعٍ لا وجودَ له وعدٌ لا يُنفَّذ.`,
      );
    }
  }
}

// ═══ R2: الرموزُ متقابلةٌ في الاتجاهين، وكلُّ ضمانٍ مربوطٌ بملفِّ إنفاذِه ═══
if (policy !== null) {
  const declared = /** @type {Set<string>} */ (new Set(Object.values(AUTHN_ERRORS)));
  const listed = new Set(policy.refusalCodes);
  for (const code of declared) {
    if (!listed.has(code)) violations.push(`R2: الرمز ${code} في الكودِ ولا إعلانَ له في الوثيقة.`);
  }
  for (const code of listed) {
    if (!declared.has(code)) violations.push(`R2: الرمز ${code} في الوثيقةِ ولا يرفعه كودٌ.`);
  }
  for (const guarantee of policy.guarantees) {
    const enforcer = readFile(guarantee.enforcedBy);
    if (enforcer === '') {
      violations.push(
        `R2: الضمان ${guarantee.id} يُنفَّذ بـ${guarantee.enforcedBy} ولا وجودَ للملف؛ وضمانٌ ملفُّ إنفاذِه غائبٌ ضمانٌ بلا إنفاذ.`,
      );
      continue;
    }
    for (const code of guarantee.codes) {
      const bare = code.replace(/^AUTHN_/, '');
      if (!enforcer.includes(code) && !enforcer.includes(bare)) {
        violations.push(
          `R2: الضمان ${guarantee.id} يَعِد بالرمز ${code} ولا أثرَ له في ${guarantee.enforcedBy}.`,
        );
      }
    }
  }
}

// ═══ R3: ترتيبُ العقباتِ نصٌّ في الوحدة ═══
if (authnSource !== '') {
  /** @type {Array<[string, string]>} */
  const order = [
    ['IDENTITY_UNVERIFIED', 'هويةُ الملك'],
    ['DEVICE_UNKNOWN', 'الجهازُ المعلَن'],
    ['DEVICE_REVOKED', 'الجهازُ المسحوبةُ ثقتُه'],
    ['FACTOR_REQUIRED', 'حضورُ العاملِ الثاني'],
    ['FACTOR_INVALID', 'صحّةُ العاملِ الثاني'],
    ['FACTOR_REPLAYED', 'منعُ إعادةِ العامل'],
    ['#sessions.set(', 'إنشاءُ الجلسةِ القويّة'],
  ];
  // ويُقاس الترتيبُ في **جسمِ المصادقةِ** لا في ترويسةِ الوحدة: الترويسةُ تشرح
  // العقباتَ بترتيبٍ نثريٍّ، فقياسُها يقيس نصَّ شرحٍ لا نصَّ إنفاذ.
  const bodyAt = authnSource.indexOf('async #authenticateChecked(');
  const body = bodyAt < 0 ? '' : authnSource.slice(bodyAt);
  if (body === '') {
    violations.push('R3: جسمُ المصادقةِ #authenticateChecked غائبٌ فلا يُقاس ترتيبُ عقباتِه.');
  }
  let previous = -1;
  let previousLabel = '';
  for (const [needle, label] of order) {
    const at = body.indexOf(needle);
    if (at < 0) {
      violations.push(`R3: ${label} غيرُ مقيسٍ في الوحدة (${needle}).`);
      continue;
    }
    if (at < previous) {
      violations.push(
        `R3: الترتيبُ مقلوب: «${label}» يسبق «${previousLabel}» في نصِّ الوحدة؛ ومن منح جلسةً قبل أن يقيس عاملاً منحها بلا عامل.`,
      );
    }
    previous = at;
    previousLabel = label;
  }

  // والاستهلاكُ يقع **قبل** إنشاءِ الجلسةِ لا بعدها: من أنشأ الجلسةَ ثم استهلك
  // عاملَها منح جلسةً ثم قيّد، وذاك يترك جلسةً قائمةً إن أخفق القيدُ بعدها.
  const consumedAt = body.indexOf('#consumed.add(');
  const sessionAt = body.indexOf('#sessions.set(');
  if (consumedAt < 0) {
    violations.push('R3: استهلاكُ رمزِ العاملِ غيرُ مقيسٍ في الوحدة (#consumed.add).');
  } else if (sessionAt >= 0 && consumedAt > sessionAt) {
    violations.push('R3: الجلسةُ تُنشأ قبل استهلاكِ رمزِ العامل؛ فرمزٌ واحدٌ قد يفتح جلستين.');
  }
}

// ═══ R4: نظافةُ الطبقةِ وإغلاقُ مقابضِها ═══
if (authnSource !== '') {
  for (const forbidden of [
    '../persistence/',
    '../observability/',
    '../data/',
    '../console/',
    '../api/',
  ]) {
    if (authnSource.includes(`from '${forbidden}`)) {
      violations.push(
        `R4: المصادقةُ تستورد من ${forbidden}؛ وطبقةُ الإثباتِ لا تعرف مستودعاً ولا ديواناً ولا مدخلاً، وإلا صارت الحلقةُ دائرة.`,
      );
    }
  }
  for (const field of ['#sessions', '#consumed', '#secrets', '#log', '#king', '#policy']) {
    if (!authnSource.includes(`  ${field}`)) {
      violations.push(
        `R4: الحقل ${field} ليس حقلاً خاصّاً في الوحدة؛ وما لم يكن خاصّاً كان مِقبضاً.`,
      );
    }
  }
  for (const leak of ['get sessions(', 'get secrets(', 'get consumed(']) {
    if (authnSource.includes(leak)) {
      violations.push(
        `R4: مِقبضٌ عامٌّ على حالةِ المصادقة (${leak})؛ ومن قرأه ملك جلسةً لم يفتحها.`,
      );
    }
  }
  if (!authnSource.includes('timingSafeEqual')) {
    violations.push(
      'R4: مقارنةُ رمزِ العاملِ ليست ثابتةَ الزمن (timingSafeEqual غائب)؛ وفرقُ زمنِ الردِّ يُستخرج به الرمزُ حرفاً حرفاً.',
    );
  }
  if (!authnSource.includes('createHash(digest).update(token)')) {
    violations.push(
      'R4: رمزُ الجلسةِ لا يُخزَّن ببصمتِه؛ ورمزٌ محفوظٌ نصّاً في الذاكرةِ يُنتحل به من قرأ لقطتَها.',
    );
  }
}

// ═══ R5: التركيبُ بلا شرط ═══
const composition = readFile('src/persistence/composition.mjs');
if (composition === '') {
  violations.push('R5: ملفُّ التركيبِ غائبٌ فلا يُقاس تركيبُ المصادقة.');
} else {
  if (!composition.includes('new KingAuthenticator(')) {
    violations.push(
      'R5: المصادقةُ غيرُ مركَّبةٍ في composition.mjs؛ ومصادقةٌ ككودٍ غيرِ مركَّبٍ عاملٌ ثانٍ اختياريٌّ اسمُه إلزاميّ.',
    );
  } else {
    const at = composition.indexOf('new KingAuthenticator(');
    const before = composition.slice(Math.max(0, at - 220), at);
    if (/\bif\s*\(/.test(before)) {
      violations.push(
        'R5: المصادقةُ مركَّبةٌ داخلَ شرط؛ وشرطٌ على تركيبِها شرطٌ على العاملِ الثاني، ومن لم يستوفِه أصدر أمراً بمفتاحٍ وحده.',
      );
    }
  }
  if (!composition.includes('@property {KingAuthenticator} kingAuth')) {
    violations.push(
      'R5: المصادقةُ غيرُ مُعلَنةٍ في StateRegistries؛ وما لا يُعلَن لا يُقرأ عقدُه.',
    );
  }
  const consoleAt = composition.indexOf('new RoyalConsole(');
  if (consoleAt < 0) {
    violations.push('R5: الديوانُ غيرُ مركَّبٍ فلا تُمرَّر إليه مصادقة.');
  } else if (!composition.slice(consoleAt, consoleAt + 700).includes('kingAuth,')) {
    violations.push(
      'R5: المصادقةُ لا تُمرَّر إلى الديوانِ في نداءِ إنشائِه؛ وديوانٌ بلا مصادقةٍ يرفض كلَّ أمرٍ أو — أسوأُ — يُصلَح بحذفِ الشرط.',
    );
  }
}

// ═══ R6: الديوانُ يُنفِذ الاشتراطَ في موضعِه ═══
const consoleSource = readFile('src/console/royal-console.mjs');
const consoleConfig = readFile('config/royal-console.yaml');
if (consoleSource === '' || consoleConfig === '') {
  violations.push('R6: ملفُّ الديوانِ أو وثيقتُه غائبٌ فلا يُقاس إنفاذُ الاشتراط.');
} else {
  if (!consoleSource.includes("AUTHENTICATION_REQUIRED: 'CONSOLE_AUTHENTICATION_REQUIRED'")) {
    violations.push('R6: رمزُ CONSOLE_AUTHENTICATION_REQUIRED غيرُ مُعلَنٍ في رموزِ الديوان.');
  }
  if (!consoleConfig.includes('CONSOLE_AUTHENTICATION_REQUIRED')) {
    violations.push('R6: رمزُ CONSOLE_AUTHENTICATION_REQUIRED غيرُ مُعلَنٍ في وثيقةِ الديوان.');
  }
  if (!consoleConfig.includes('G-CONSOLE-STRONG-AUTH')) {
    violations.push(
      'R6: ضمانُ الجلسةِ القويةِ غيرُ مُعلَنٍ في وثيقةِ الديوان؛ وإنفاذٌ بلا ضمانٍ مكتوبٍ إنفاذٌ يُحذف بلا أثر.',
    );
  }
  if (!consoleSource.includes('#kingAuth')) {
    violations.push(
      'R6: المصادقةُ ليست حقلاً خاصّاً في الديوان؛ ومصادقةٌ تُمرَّر مع كلِّ نداءٍ يُمرِّرها المُنادي كما يشاء.',
    );
  }
  if (!consoleSource.includes('requireForCommand(request.sovereignSession')) {
    violations.push('R6: الديوانُ لا يشترط جلسةً قويةً على أمرِه (requireForCommand غائب).');
  }
  const undeclaredAt = consoleSource.indexOf('CONSOLE_ERRORS.COMMAND_UNDECLARED,');
  const requireAt = consoleSource.indexOf('requireForCommand(request.sovereignSession');
  const mismatchAt = consoleSource.indexOf('CONSOLE_ERRORS.ACTION_MISMATCH,');
  const crownAt = consoleSource.indexOf('#acceptThroughCrown(spec');
  const effectAt = consoleSource.indexOf('#applyEffect(spec');
  if (undeclaredAt >= 0 && requireAt >= 0 && !(undeclaredAt < requireAt)) {
    violations.push('R6: الاشتراطُ يسبق التحقّقَ من إعلانِ الأمر؛ فيُشترط لأمرٍ لا وجودَ له.');
  }
  for (const [label, at] of /** @type {Array<[string, number]>} */ ([
    ['مطابقةُ الفعلِ الموقَّع', mismatchAt],
    ['بوابةُ التاج', crownAt],
    ['أثرُ الأمر', effectAt],
  ])) {
    if (requireAt >= 0 && at >= 0 && at < requireAt) {
      violations.push(
        `R6: «${label}» يقع قبل اشتراطِ الجلسةِ القوية؛ وترتيبٌ كهذا يقيس أمراً لمن لا سلطةَ له.`,
      );
    }
  }
}

// ═══ R7: لا سرَّ ولا رمزَ في قيدٍ أو رسالة ═══
if (authnSource !== '') {
  const lines = authnSource.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (!(lines[index] ?? '').includes('log.append(')) continue;
    // ونافذةُ القيدِ تنتهي بإغلاقِ نداءِ التسجيلِ نفسِه لا بعددٍ ثابتٍ من
    // الأسطر: نافذةٌ أطولُ من النداءِ تقرأ ما بعده فتشكو مما ليس فيه.
    /** @type {string[]} */
    const block = [];
    for (let cursor = index; cursor < lines.length && cursor < index + 12; cursor += 1) {
      const line = lines[cursor] ?? '';
      block.push(line);
      if (/\}\);\s*$/.test(line) || /\);\s*$/.test(line.trim())) break;
    }
    const window = block.join('\n');
    for (const leak of ['token', 'factorCode', 'fingerprint', 'material', 'secret']) {
      if (window.includes(leak)) {
        violations.push(
          `R7: قيدُ تدقيقٍ في السطر ${index + 1} يحمل «${leak}»؛ وسجلٌّ يحمل رمزاً أو سرّاً يجعل قارئَ السجلِّ مالكاً للسلطة.`,
        );
      }
    }
  }
}

// ═══ R8: الاختبارُ يقيس معيارَ القبول ═══
const testPath = 'tests/authn/king-auth.test.mjs';
const test = readFile(testPath);
if (test === '') {
  violations.push(`R8: ملفُّ الاختبار ${testPath} غائب؛ ودعوى إنفاذٍ بلا قياسٍ دعوى.`);
} else {
  /** @type {Array<[string, string]>} */
  const measured = [
    ['PersistentEventLog', 'المصادقةُ غيرُ مقيسةٍ على سجلٍّ دائمٍ على القرص'],
    ['CONSOLE_AUTHENTICATION_REQUIRED', 'ردُّ أمرِ الديوانِ بلا جلسةٍ قويةٍ غيرُ مقيس'],
    ['AUTHN_FACTOR_REQUIRED', 'اشتراطُ حضورِ العاملِ الثاني غيرُ مقيس'],
    ['AUTHN_FACTOR_INVALID', 'ردُّ العاملِ المُختلَقِ غيرُ مقيس'],
    ['AUTHN_FACTOR_REPLAYED', 'منعُ إعادةِ رمزِ العاملِ غيرُ مقيس'],
    ['AUTHN_DEVICE_UNKNOWN', 'ردُّ الجهازِ غيرِ المُعلَنِ غيرُ مقيس'],
    ['AUTHN_DEVICE_REVOKED', 'ردُّ الجهازِ المسحوبةِ ثقتُه غيرُ مقيس'],
    ['AUTHN_SESSION_EXPIRED', 'انتهاءُ الجلسةِ القصيرةِ غيرُ مقيس'],
    ['AUTHN_SECRET_MISSING', 'الفشلُ المغلقُ بلا مزوِّدِ أسرارٍ غيرُ مقيس'],
    ['AUTHN_IDENTITY_UNVERIFIED', 'حصرُ الجلسةِ بالملكِ نفسِه غيرُ مقيس'],
    ['AUTHN_AUDIT_REQUIRED', 'الفشلُ المغلقُ بلا سجلٍّ غيرُ مقيس'],
    ['authn.session.opened', 'قيدُ فتحِ الجلسةِ في السجلِّ الدائمِ غيرُ مقيس'],
    ['authn.refused', 'قيدُ الرفضِ في السجلِّ الدائمِ غيرُ مقيس'],
    ['guard-king-auth.mjs', 'الحاجزُ نفسُه غيرُ مقيسٍ على شجرةٍ مكسورةٍ قصداً'],
  ];
  for (const [needle, why] of measured) {
    if (!test.includes(needle)) violations.push(`R8: ${why} (${needle}).`);
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز مصادقة الملك القوية رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const deviceCount = policy === null ? 0 : policy.devices.length;
const trustedCount =
  policy === null ? 0 : policy.devices.filter((d) => d.state === 'trusted').length;
const kindCount = policy === null ? 0 : policy.assurance.requiredForCommandKinds.length;
const codeCount = policy === null ? 0 : policy.refusalCodes.length;
const guaranteeCount = policy === null ? 0 : policy.guarantees.length;
console.log(
  `✅ حاجز مصادقة الملك القوية: ${deviceCount} جهازاً مُعلَناً منها ${trustedCount} موثوقٌ، و${kindCount} نوعَ أمرٍ مشترَطاً مقابَلةً بأنواعِ أوامرِ الديوان في الاتجاهين، و${codeCount} رمزَ رفضٍ متقابلةً في الاتجاهين، و${guaranteeCount} ضماناً كلُّها مربوطةٌ برمزٍ حاضرٍ في ملفِّ إنفاذِه، والترتيبُ محفوظ: هويةٌ ثم جهازٌ ثم حضورُ عاملٍ ثم صحّتُه ثم منعُ إعادتِه ثم جلسةٌ قصيرة، والمصادقةُ مركَّبةٌ بلا شرطٍ ومُشترَطةٌ في الديوانِ قبل التوقيعِ والتاجِ والأثر، ولا رمزَ ولا سرَّ في قيدٍ.`,
);
