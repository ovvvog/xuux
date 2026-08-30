#!/usr/bin/env node
/**
 * حاجزُ الديوانِ الملكيّ — البوابةُ الثامنةُ والعشرون في `npm run validate`
 * (الخطوة M9.03).
 *
 * البوابةُ 27 تحرس المدخلَ القارئ. وهذه تحرس **ممارسةَ السلطة**: أن يكون لكلِّ
 * أمرٍ إعلانٌ بفعلِه وهدفِه ومسارِه، وتوقيعٌ متحقَّقٌ منه، وقيدٌ في سجلٍّ دائمٍ
 * **قبل** أثرِه، وأثرٌ واحدٌ مكتوبٌ في الكودِ لنوعِه. وثمانِ قواعد:
 *
 *   R1: `config/royal-console.yaml` تُحمَّل بمخطَّطها، وكلُّ مشهدٍ فيها يُشير إلى
 *       **مسارٍ معلَنٍ** في `config/api.yaml`، وكلُّ أمرٍ يُعلن `sovereignThreshold`
 *       فعلُه مُعلَنٌ في العتبةِ السياديةِ `config/royal-authority.yaml`؛ ومشهدٌ
 *       يُشير إلى مسارٍ لا وجودَ له مشهدٌ يسقط عند أولِ نداءٍ صحيح.
 *   R2: كلُّ رمزٍ في `CONSOLE_ERRORS` مُعلَنٌ في الوثيقةِ وبالعكس **في الاتجاهين**،
 *       وكلُّ رمزٍ في ضمانٍ حاضرٌ نصّاً في ملفِّ إنفاذِه المُعلَن.
 *   R3: الترتيبُ نصٌّ لا نيّة: إعلانُ الأمرِ قبل مطابقةِ فعلِه، والمطابقةُ قبل
 *       إثباتِ السلطة، وإثباتُ السلطةِ (وقيدُه الدائم) قبل الأثر، والأثرُ قبل قيدِ
 *       التنفيذ.
 *   R4: لا مستودعَ في يدِ الديوان: لا استيرادَ من `src/persistence/` ولا من
 *       `src/observability/` في زمنِ التشغيل، ولا نداءَ كاتبٍ (`.insert(`،
 *       `.update(`، `.remove(`، `.upsert(`)، وحقولُ الديوانِ خاصّةٌ لا تُصدَّر.
 *   R5: الديوانُ **مركَّبٌ** في `composition.mjs` بلا شرطٍ باسمِه، ومُعلَنٌ في
 *       `StateRegistries`، ويُمرَّر إليه السجلُّ وطبقةُ الواجهة؛ فديوانٌ ككودٍ غيرِ
 *       مركَّبٍ ديوانٌ يُلتفّ حوله بنداءِ التاجِ مباشرةً بلا قيدٍ ولا إعلان.
 *   R6: مسارُ التعافي محدودٌ: مجموعةُ الأنواعِ المُعلَنةِ عليه في الوثيقةِ **تساوي**
 *       `RECOVERY_KINDS` في الكودِ حرفاً بحرف، فلا يُوسَّع في أحدِهما بلا الآخر.
 *   R7: كلُّ رفضٍ يُسجَّل: نداءُ `commandRefusedEvent` حاضرٌ ويحمل الرمزَ، ورمزُ
 *       بوابةِ التاجِ يُحفَظ في تفصيلِ الرفضِ لا يُسرَّب خارجَ كتالوجِ الرموز.
 *   R8: ملفُّ اختبارِ الديوانِ موجودٌ ويقيس معيارَ القبولِ ورموزَه الحاكمة.
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقرأ النصَّ والوثيقةَ ولا يوقّع أمراً ولا يفتح
 * مِقبساً؛ فصدقُ التوقيعِ ومنعُ الإعادةِ وترتيبُ القيدِ قبل الأثرِ مقيسةٌ في
 * `tests/console/royal-console.test.mjs` على تاجٍ حقيقيٍّ وسجلٍّ دائمٍ على القرص.
 *
 * **حدٌّ معلَن ثانٍ:** الترتيبُ يُقاس بموضعِ النصِّ في `#issueChecked`، وذاك يمنع
 * القلبَ بالكتابةِ لا القلبَ بالتفافٍ في زمنِ التشغيل.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import { CONSOLE_ERRORS, RECOVERY_KINDS, loadConsolePolicy } from '../src/console/index.mjs';
import { loadApiPolicy } from '../src/api/index.mjs';

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

// ═══ R1 ═══
/** @type {import('../src/console/royal-console.mjs').ConsolePolicy | null} */
let policy = null;
try {
  policy = loadConsolePolicy({ dir: path.join(ROOT, 'config') });
} catch (error) {
  violations.push(
    `R1: وثيقةُ الديوانِ لا تُحمَّل (CONSOLE_CONFIG_INVALID): ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

if (policy !== null) {
  /** @type {Set<string>} */
  let apiRoutes = new Set();
  try {
    apiRoutes = new Set(
      loadApiPolicy({ dir: path.join(ROOT, 'config') }).routes.map((route) => route.id),
    );
  } catch (error) {
    violations.push(
      `R1: وثيقةُ طبقةِ الواجهةِ لا تُحمَّل فلا تُقابَل مشاهدُ الديوانِ بمساراتِها: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  for (const view of policy.views) {
    if (apiRoutes.size > 0 && !apiRoutes.has(view.route)) {
      violations.push(
        `R1: المشهد ${view.id} يُشير إلى المسار «${view.route}» وهو غيرُ مُعلَنٍ في config/api.yaml؛ ومشهدٌ بمسارٍ لا وجودَ له وعدٌ لا يقع.`,
      );
    }
  }

  /** @type {Set<string>} */
  let thresholdActions = new Set();
  try {
    const raw = /** @type {{ threshold?: Array<{ action?: unknown }> }} */ (
      YAML.parse(readFile('config/royal-authority.yaml'))
    );
    thresholdActions = new Set(
      (raw.threshold ?? [])
        .map((entry) => entry.action)
        .filter((action) => typeof action === 'string'),
    );
  } catch (error) {
    violations.push(
      `R1: العتبةُ السياديةُ لا تُقرأ: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const command of policy.commands) {
    if (command.sovereignThreshold === true && !thresholdActions.has(command.action)) {
      violations.push(
        `R1: الأمر ${command.id} يُعلن أن فعلَه «${command.action}» في العتبةِ السيادية، وليس في config/royal-authority.yaml؛ ودعوى عتبةٍ لا سندَ لها أخطرُ من غيابِها.`,
      );
    }
    // والعكسُ يُفحَص كذلك: فعلٌ في العتبةِ يُنادى من الديوانِ بلا إعلانِ عتبةٍ
    // يُقرأ أمراً عاديّاً في الوثيقة، فيُخفي على قارئها أنه من المحجوزِ للملك.
    if (command.sovereignThreshold !== true && thresholdActions.has(command.action)) {
      violations.push(
        `R1: الأمر ${command.id} فعلُه «${command.action}» مُعلَنٌ في العتبةِ السياديةِ ولا يُعلنه الديوانُ كذلك؛ وإخفاءُ ذلك في الوثيقةِ يُقرأ أمراً عاديّاً وهو محجوزٌ للملك.`,
      );
    }
  }
}

// ═══ R2 ═══
if (policy !== null) {
  /** @type {Set<string>} */
  const listed = new Set(policy.refusalCodes);
  /** @type {Set<string>} */
  const raised = new Set(Object.values(CONSOLE_ERRORS));
  for (const code of Object.values(CONSOLE_ERRORS)) {
    if (!listed.has(code)) {
      violations.push(`R2: الرمز ${code} يرفعه الكودُ ولا إعلانَ له في وثيقةِ الديوان.`);
    }
  }
  for (const code of listed) {
    if (!raised.has(code)) {
      violations.push(
        `R2: الرمز ${code} مُعلَنٌ في الوثيقةِ ولا يرفعه كودٌ؛ ووثيقةٌ تَعِد برفضٍ لا يقع وثيقةٌ تكذب.`,
      );
    }
  }
  for (const guarantee of policy.guarantees) {
    const enforcing = readFile(guarantee.enforcedBy);
    if (enforcing === '') {
      violations.push(
        `R2: الضمان ${guarantee.id} يُشير إلى ملفِّ إنفاذٍ غائب: ${guarantee.enforcedBy}.`,
      );
      continue;
    }
    for (const code of guarantee.codes) {
      const bare = code.replace(/^CONSOLE_/, '');
      if (!enforcing.includes(code) && !enforcing.includes(bare)) {
        violations.push(
          `R2: الضمان ${guarantee.id} يَعِد بالرمز ${code} ولا أثرَ له في ${guarantee.enforcedBy}؛ وضمانٌ بلا إنفاذٍ في موضعِه المُعلَنِ نصٌّ لا حاجز.`,
        );
      }
    }
  }
}

// ═══ R3 ═══
const consoleSource = readFile('src/console/royal-console.mjs');
if (consoleSource === '') {
  violations.push('R3: `src/console/royal-console.mjs` غائب — ولا ديوانَ يُحرس.');
} else {
  const issueAt = consoleSource.indexOf('async #issueChecked(');
  const body = issueAt < 0 ? '' : consoleSource.slice(issueAt);
  if (body === '') {
    violations.push('R3: `#issueChecked` غائبةٌ من الديوان؛ والترتيبُ يُقاس فيها.');
  } else {
    /** @type {Array<[string, string]>} */
    const sequence = [
      ['COMMAND_UNDECLARED', 'إعلانُ الأمر'],
      ['ACTION_MISMATCH', 'مطابقةُ الفعل'],
      ['#acceptThroughCrown', 'إثباتُ السلطةِ وقيدُها الدائم'],
      ['#applyEffect', 'الأثر'],
      ['commandExecutedEvent', 'قيدُ التنفيذ'],
    ];
    /** @type {number[]} */
    const positions = [];
    for (const [needle, label] of sequence) {
      const at = body.indexOf(needle);
      if (at < 0) {
        violations.push(`R3: ${label} غيرُ موجودٍ نصّاً في مسارِ الأمر (${needle}).`);
        positions.push(Number.MAX_SAFE_INTEGER);
      } else {
        positions.push(at);
      }
    }
    for (let index = 1; index < positions.length; index += 1) {
      const previous = positions[index - 1] ?? 0;
      const current = positions[index] ?? 0;
      if (previous >= current) {
        violations.push(
          `R3: الترتيبُ مقلوبٌ نصّاً: «${sequence[index - 1]?.[1]}» يجب أن يسبق «${sequence[index]?.[1]}» — وقيدٌ يُكتب بعد أثرِه لا يمنع شيئاً.`,
        );
      }
    }
  }

  // ═══ R4 ═══
  for (const forbidden of ['../persistence/', '../observability/', '../data/']) {
    if (consoleSource.includes(`from '${forbidden}`)) {
      violations.push(
        `R4: الديوانُ يستورد «${forbidden}» في زمنِ التشغيل؛ والقراءةُ من طبقةِ الواجهةِ وحدَها أو لا قراءة.`,
      );
    }
  }
  for (const writer of ['.insert(', '.update(', '.remove(', '.upsert(']) {
    if (consoleSource.includes(writer)) {
      violations.push(
        `R4: نداءُ كتابةٍ «${writer}» في الديوان؛ والكتابةُ من هنا أمرٌ ملكيٌّ موقَّعٌ لا نداءٌ على مستودع.`,
      );
    }
  }
  for (const field of ['#gateway', '#crown', '#haltSwitch', '#king', '#ledger', '#log']) {
    if (!consoleSource.includes(`${field};`) && !consoleSource.includes(`${field} =`)) {
      violations.push(
        `R4: الحقل ${field} ليس حقلاً خاصّاً في الديوان؛ ومن ملك مرجعاً إلى الديوانِ لا يملك بذلك مرجعاً إلى ما تحته.`,
      );
    }
  }
  if (/^\s*get\s+(gateway|crown|haltSwitch|king)\s*\(/m.test(consoleSource)) {
    violations.push(
      'R4: الديوانُ يُصدِّر تابعاً من توابعِه بقارئٍ عامّ؛ فمن أخذه تجاوز الديوانَ إلى ما تحته بلا أمرٍ ولا قيد.',
    );
  }

  // ═══ R7 ═══
  if (!consoleSource.includes('commandRefusedEvent')) {
    violations.push('R7: لا قيدَ رفضٍ في الديوان؛ ورفضٌ صامتٌ رفضٌ لا يُراجَع.');
  }
  if (!consoleSource.includes('code: codeOf(error)')) {
    violations.push(
      'R7: قيدُ الرفضِ لا يحمل رمزَه؛ وقيدٌ يقول «رُفض» ولا يقول «لماذا» لا يُفهم بعد شهر.',
    );
  }
  if (!consoleSource.includes('crownCode')) {
    violations.push(
      'R7: رمزُ بوابةِ التاجِ لا يُحفَظ في تفصيلِ الرفض؛ فإما يُسرَّب خارجَ كتالوجِ الرموزِ وإما يضيع.',
    );
  }
}

// ═══ R5 ═══
const composition = readFile('src/persistence/composition.mjs');
if (composition === '') {
  violations.push('R5: `src/persistence/composition.mjs` غائب.');
} else {
  if (!composition.includes('new RoyalConsole(')) {
    violations.push(
      'R5: الديوانُ غيرُ مركَّبٍ في `createRegistries`؛ وديوانٌ ككودٍ غيرِ مركَّبٍ ديوانٌ يُلتفّ حوله.',
    );
  }
  if (!composition.includes('royalConsole,')) {
    violations.push('R5: الديوانُ غيرُ مُعادٍ في `StateRegistries`؛ فمن يركّب الدولةَ لا يجده.');
  }
  const consoleAt = composition.indexOf('new RoyalConsole(');
  if (consoleAt >= 0) {
    const block = composition.slice(consoleAt, consoleAt + 700);
    for (const wire of ['gateway: api', 'log,']) {
      if (!block.includes(wire)) {
        violations.push(
          `R5: الديوانُ مركَّبٌ بلا «${wire}»؛ وديوانٌ بلا سجلٍّ أو بلا طبقةِ واجهةٍ ديوانٌ يرفض عملَه كلَّه.`,
        );
      }
    }
    const before = composition.slice(Math.max(0, consoleAt - 400), consoleAt);
    if (/if\s*\([^)]*\)\s*\{[^}]*$/.test(before)) {
      violations.push(
        'R5: الديوانُ مركَّبٌ داخلَ شرط؛ وتركيبٌ مشروطٌ يعني أن ممارسةَ السلطةِ تعود إلى نداءٍ في الكودِ بلا أمرٍ ولا قيد.',
      );
    }
  }
}

// ═══ R6 ═══
if (policy !== null) {
  // ولا مسارَ ثالث: مسارٌ لا يعرفه الكودُ يُرفَض في زمنِ التشغيل بـ
  // `CONSOLE_PATH_UNDECLARED`، وهذا الحاجزُ يمنعه من الدخولِ في الوثيقةِ أصلاً.
  const knownPaths = new Set(['crown', 'sovereign-recovery']);
  for (const command of policy.commands) {
    if (!knownPaths.has(command.path)) {
      violations.push(
        `R6: الأمر ${command.id} يُعلن مساراً لا يعرفه الكودُ «${command.path}» (CONSOLE_PATH_UNDECLARED)؛ ومسارٌ لا كودَ له أمرٌ يسقط عند أولِ نداء.`,
      );
    }
  }
  /** @type {Set<string>} */
  const declaredRecovery = new Set(
    policy.commands.filter((command) => command.path === 'sovereign-recovery').map((c) => c.kind),
  );
  /** @type {Set<string>} */
  const inCode = new Set(RECOVERY_KINDS);
  for (const kind of declaredRecovery) {
    if (!inCode.has(kind)) {
      violations.push(
        `R6: النوع «${kind}» يسلك مسارَ التعافي في الوثيقةِ وليس في \`RECOVERY_KINDS\`؛ وتوسيعُ التجاوزِ بالوثيقةِ وحدها يفتح باباً حولَ بوابةِ التاج.`,
      );
    }
  }
  for (const kind of inCode) {
    if (!declaredRecovery.has(kind)) {
      violations.push(
        `R6: النوع «${kind}» يُعلَن في الكودِ نوعَ تعافٍ ولا أمرَ في الوثيقةِ يسلكه؛ ومسارُ تجاوزٍ بلا أمرٍ يستعمله بابٌ مفتوحٌ بلا حاجة.`,
      );
    }
  }
}

// ═══ R8 ═══
const test = readFile('tests/console/royal-console.test.mjs');
if (test === '') {
  violations.push(
    'R8: `tests/console/royal-console.test.mjs` غائب — حاجزٌ يقرأ النصَّ بلا اختبارٍ يقيس السلوكَ نصفُ حاجز.',
  );
} else {
  /** @type {Array<[string, string]>} */
  const measured = [
    ['PersistentEventLog', 'معيارُ القبولِ غيرُ مقيسٍ على سجلٍّ دائمٍ على القرص'],
    ['crown.command.accepted', 'ظهورُ الأمرِ في السجلِّ الدائمِ غيرُ مقيس'],
    ['console.command.executed', 'قيدُ التنفيذِ غيرُ مقيس'],
    ['SIGNATURE_INVALID', 'ردُّ التوقيعِ المُختلَقِ غيرُ مقيس'],
    ['REPLAYED_COMMAND', 'منعُ إعادةِ الأمرِ غيرُ مقيس'],
    ['ACTION_MISMATCH', 'مطابقةُ الفعلِ الموقَّعِ غيرُ مقيسة'],
    ['TARGET_MISMATCH', 'مطابقةُ الهدفِ الموقَّعِ غيرُ مقيسة'],
    ['COMMAND_UNDECLARED', 'ردُّ الأمرِ غيرِ المُعلَنِ غيرُ مقيس'],
    ['AUDIT_REQUIRED', 'الفشلُ المغلقُ بلا سجلٍّ غيرُ مقيس'],
    ['CROWN_REQUIRED', 'الفشلُ المغلقُ بلا بوابةِ تاجٍ غيرُ مقيس'],
    ['HALT_REQUIRED', 'الفشلُ المغلقُ بلا زرِّ إيقافٍ غيرُ مقيس'],
    ['KING_REQUIRED', 'الفشلُ المغلقُ في مسارِ التعافي بلا هويةِ ملكٍ غيرُ مقيس'],
    ['VIEW_UNDECLARED', 'ردُّ المشهدِ غيرِ المُعلَنِ غيرُ مقيس'],
    ['VIEW_REFUSED', 'تغليفُ رفضِ طبقةِ الواجهةِ غيرُ مقيس'],
    ['sovereign-recovery', 'مسارُ التعافي غيرُ مقيس'],
    ['read().state', 'وقوعُ الإيقافِ الشاملِ فعلاً على القرصِ غيرُ مقيس'],
    ['Object.isFrozen', 'تجميدُ المُعادِ غيرُ مقيس'],
  ];
  for (const [needle, why] of measured) {
    if (!test.includes(needle)) violations.push(`R8: ${why} (${needle}).`);
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز الديوان الملكي رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const viewCount = policy === null ? 0 : policy.views.length;
const commandCount = policy === null ? 0 : policy.commands.length;
const codeCount = policy === null ? 0 : policy.refusalCodes.length;
const guaranteeCount = policy === null ? 0 : policy.guarantees.length;
console.log(
  `✅ حاجز الديوان الملكي: ${viewCount} مشهداً كلُّها مساراتٌ مُعلَنةٌ في وثيقةِ الواجهة، و${commandCount} أمراً موقَّعاً أفعالُ العتبةِ منها مقابَلةٌ بالعتبةِ السيادية في الاتجاهين، و${codeCount} رمزَ رفضٍ متقابلةً في الاتجاهين، و${guaranteeCount} ضماناً كلُّها مربوطةٌ برمزٍ حاضرٍ في ملفِّ إنفاذِه، والترتيبُ محفوظ: إعلانٌ ثم مطابقةُ فعلٍ وهدفٍ ثم إثباتُ سلطةٍ وقيدٌ دائمٌ ثم أثرٌ ثم قيدُ تنفيذ، ومسارُ التعافي محدودٌ بـ${RECOVERY_KINDS.join('، ')} في الكودِ والوثيقةِ معاً، والديوانُ مركَّبٌ بلا شرطٍ ولا مستودعَ في يدِه.`,
);
