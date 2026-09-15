#!/usr/bin/env node
/**
 * حاجزُ المراقبةِ للقراءةِ فقط — البوابةُ السادسةُ والعشرون في `npm run validate`
 * (الخطوة M9.01).
 *
 * البوابةُ 25 تحرس تقريرَ الدولةِ: أن يكون كلُّ حقلٍ فيه مقيساً أو تقديريّاً
 * مُعلَناً. وهذه تحرس **الطريقَ إلى الحال**: أن تكون قراءةُ المراقبةِ قراءةً
 * وحدَها — بلا سلطةِ كتابةٍ في يدِ القارئ، وبلا مسارٍ ثانٍ يقرأ خارجَ التدقيق،
 * وبلا قدرةٍ في دورِ المراقبةِ زائدةٍ على المُعلَن. وثماني قواعد:
 *
 *   R1: `config/monitoring.yaml` تُحمَّل بمخطَّطها، ومشاهدُها كلُّها على مستوداتٍ
 *       معلَنةٍ في `StateRepositories`؛ ومشهدٌ على مستودعٍ لا وجودَ له مشهدٌ يسقط
 *       عند أولِ تركيب.
 *   R2: قدراتُ دورِ المراقبةِ في `config/roles.yaml` تُطابق `allowedCapabilities`
 *       **تطابقاً تامّاً** في الاتجاهين؛ فقدرةُ كتابةٍ تُمنح للدورِ في ملفٍّ آخر
 *       توقف البوابةَ هنا لا في زمنِ التشغيلِ وحده.
 *   R3: كلُّ رمزٍ في `MONITOR_ERRORS` له ضمانٌ في الوثيقةِ وبالعكس، وكلُّ رمزٍ
 *       حاضرٌ نصّاً في ملفِّ إنفاذِه المُعلَن.
 *   R4: المشهدُ يرفض بنيوياً: `read-only-view.mjs` يملك مصائدَ `set` و
 *       `deleteProperty` و`defineProperty` و`setPrototypeOf`، ويرمي على كلِّ اسمٍ
 *       غيرِ موجود، ولا يحفظ مستودعاً — لا كلمة `repository` في الملفِّ أصلاً.
 *   R5: وكيلُ المراقبةِ **مركَّبٌ** في `composition.mjs` بلا شرط، ومُعلَنٌ في
 *       `StateRegistries`، ويُمرَّر إليه سجلُّ الأحداثِ وسجلُّ الهويات؛ فمراقبةٌ
 *       ككودٍ غيرِ مركَّبٍ مراقبةٌ لا مسارَ لها في التشغيل.
 *   R6: القيدُ **قبل** الأثر: نداءُ `log.append` لحدثِ القراءةِ يسبق نصّاً نداءَ
 *       `view.read`؛ فقيدٌ بعد القراءةِ يعني قراءةً قد تقع بلا أثر.
 *   R7: لا مسارَ ثانٍ ولا نداءَ كاتبٍ في مسارِ المراقبة: لا `.insert(` ولا
 *       `.update(` ولا `.remove(` في `src/observability/`، ولا نداءَ يُصدِّر مشهداً
 *       أو مستودعاً من الوكيل، والمشاهدُ والمواصفاتُ في حقولٍ خاصّة.
 *   R8: ملفُّ اختبارِ المراقبةِ موجودٌ ويقيس الرموزَ الحاكمةَ والتجميدَ العميق؛
 *       فبوابةٌ تحرس النصَّ بلا اختبارٍ يقيس السلوكَ نصفُ حاجز.
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقرأ النصَّ والوثيقةَ ولا يشغّل قاعدةً؛ وكان لا يزعم أن
 * كلَّ قارئٍ في المستودعِ يمرّ من هذا المسار — والمنعُ بنيويٌّ **لهذا المسار** كما
 * ينصّ معيارُ القبولِ، وسعةُ استعمالِه في بقيةِ المستودعِ كانَ عملاً لخطواتٍ
 * لاحقةٍ في المسار P1. **وأُغلقَ هذا الحدُّ بسدادِ `D-10` في `WL-188`:** صارَ ما
 * لم يَزعُمْهُ هذا الحاجزُ يَزعُمُهُ حاجزُ المشهدِ المُعمَّمُ
 * (`scripts/guard-state-scene.mjs`) — فكلُّ قارئٍ يَمرُّ بالمشهدِ، بحاجزٍ يَرفضُ
 * قارئاً يَتجاوزُه. فما كانَ عملاً لخطواتٍ لاحقةٍ صارَ عملاً مُنجَزاً.
 *
 * **حدٌّ معلَن ثانٍ:** الحاجزُ يحرس وقوعَ النداءِ وترتيبَه نصّاً، لا صدقَ الرفضِ
 * في زمنِ التشغيل — وذلك مقيسٌ في `tests/observability/monitor-agent.test.mjs`.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  MONITOR_ERRORS,
  loadMonitoringPolicy,
  readRoleCapabilities,
} from '../src/observability/monitor-agent.mjs';

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
/** @type {import('../src/observability/monitor-agent.mjs').MonitoringPolicy | null} */
let policy = null;
try {
  policy = loadMonitoringPolicy({ dir: path.join(ROOT, 'config') });
} catch (error) {
  violations.push(`R1: ${error instanceof Error ? error.message : String(error)}`);
}

const composition = readFile('src/persistence/composition.mjs');
if (policy !== null) {
  if (composition === '') {
    violations.push('R1: `src/persistence/composition.mjs` غير مقروء — لا يُقاس تركيبُ المشاهد.');
  } else {
    for (const view of policy.views) {
      if (
        !composition.includes(`} ${view.registry}\n`) &&
        !composition.includes(`${view.registry}:`)
      ) {
        violations.push(
          `R1: المشهد «${view.id}» يُعلن المستودع «${view.registry}» وهو غيرُ معلَنٍ في سجلاتِ الحالة — مشهدٌ على مستودعٍ لا وجودَ له يسقط عند أولِ تركيب.`,
        );
      }
    }
  }
}

// ═══ R2 ═══
if (policy !== null) {
  /** @type {readonly string[]} */
  let held = [];
  try {
    held = readRoleCapabilities({ dir: path.join(ROOT, 'config'), role: policy.role });
  } catch (error) {
    violations.push(`R2: ${error instanceof Error ? error.message : String(error)}`);
  }
  const allowed = new Set(policy.allowedCapabilities);
  for (const capability of held) {
    if (!allowed.has(capability)) {
      violations.push(
        `R2: دورُ المراقبة ${policy.role} يحمل القدرة «${capability}» وهي خارجُ القدراتِ المسموحة — القدرةُ غيرُ المستعملةِ قدرة.`,
      );
    }
  }
  const heldSet = new Set(held);
  for (const capability of policy.allowedCapabilities) {
    if (!heldSet.has(capability)) {
      violations.push(
        `R2: القدرة «${capability}» معلَنةٌ في وثيقةِ المراقبةِ ولا يحملها الدور ${policy.role} — وثيقةٌ تَعِد بما لا يُملَك.`,
      );
    }
  }
}

// ═══ R3 ═══
if (policy !== null) {
  const guaranteed = new Map(policy.guarantees.map((entry) => [entry.code, entry.enforcedBy]));
  for (const code of Object.values(MONITOR_ERRORS)) {
    const enforcedBy = guaranteed.get(code);
    if (enforcedBy === undefined) {
      violations.push(`R3: الرمز ${code} يرفعه الكودُ ولا ضمانَ له في الوثيقة.`);
      continue;
    }
    const source = readFile(enforcedBy);
    if (source === '') {
      violations.push(`R3: ملفُّ إنفاذِ ${code} (${enforcedBy}) غيرُ موجود.`);
    } else if (!source.includes(code)) {
      violations.push(`R3: الرمز ${code} غيرُ حاضرٍ في ملفِّ إنفاذِه ${enforcedBy}.`);
    }
  }
  /** @type {Set<string>} */
  const declared = new Set(Object.values(MONITOR_ERRORS));
  for (const code of guaranteed.keys()) {
    if (!declared.has(code)) {
      violations.push(`R3: الضمان ${code} مكتوبٌ في الوثيقةِ ولا رمزَ له في الكود.`);
    }
  }
}

// ═══ R4 ═══
const viewSource = readFile('src/observability/read-only-view.mjs');
if (viewSource === '') {
  violations.push('R4: `src/observability/read-only-view.mjs` غائب — لا سطحَ يُحرَس.');
} else {
  for (const trap of ['set(', 'deleteProperty(', 'defineProperty(', 'setPrototypeOf(']) {
    if (!viewSource.includes(trap)) {
      violations.push(
        `R4: مصيدةُ \`${trap}\` غائبةٌ عن المشهد — سطحٌ يُوسَّع أو يُنقَص بعد إنشائه ليس رفضاً بنيوياً.`,
      );
    }
  }
  if (
    !viewSource.includes('new Proxy(') ||
    !viewSource.includes('Object.hasOwn(object, property)')
  ) {
    violations.push(
      'R4: المشهدُ لا يرفض الأسماءَ غيرَ الموجودةِ عند لمسِها — إعادةُ `undefined` تُؤجِّل الرفضَ إلى التنفيذ.',
    );
  }
  if (viewSource.includes('repository')) {
    violations.push(
      'R4: كلمة `repository` حاضرةٌ في ملفِّ المشهد — المستودعُ لا يُمرَّر إلى المشهدِ ولا يُحفَظ فيه، وإلا صار الوصولُ إليه ممكناً من سطحِه.',
    );
  }
}

// ═══ R5 ═══
if (composition !== '') {
  for (const [needle, why] of /** @type {Array<[string, string]>} */ ([
    ['new MonitorAgent({', 'وكيلُ المراقبةِ غيرُ مركَّبٍ في التشغيل'],
    ['@property {MonitorAgent} monitor', 'وكيلُ المراقبةِ غيرُ معلَنٍ في سجلاتِ الحالة'],
    ['loadMonitoringPolicy()', 'وثيقةُ المراقبةِ لا تُحمَّل عند التركيب'],
  ])) {
    if (!composition.includes(needle)) violations.push(`R5: ${why} (${needle}).`);
  }
  const at = composition.indexOf('new MonitorAgent({');
  if (at >= 0) {
    const block = composition.slice(at, at + 400);
    for (const dependency of ['agents,', 'log,', 'repositories,']) {
      if (!block.includes(dependency)) {
        violations.push(
          `R5: التركيبُ لا يمرّر \`${dependency}\` إلى وكيلِ المراقبة — بلا سجلٍّ لا أثرَ تدقيقٍ، وبلا هوياتٍ لا هويةَ محقَّقة.`,
        );
      }
    }
  }
  if (composition.includes('monitor: monitoringPolicy === null ? null')) {
    violations.push('R5: تركيبُ المراقبةِ مشروطٌ — مراقبةٌ اختياريةُ التركيبِ لا مسارَ لها.');
  }
}

// ═══ R6 ═══
const agentSource = readFile('src/observability/monitor-agent.mjs');
if (agentSource === '') {
  violations.push('R6: `src/observability/monitor-agent.mjs` غائب — لا مسارَ يُحرَس.');
} else {
  const appendAt = agentSource.indexOf('log.append(policy.audit.readEvent');
  const readAt = agentSource.indexOf('view.read(method, args)');
  if (appendAt < 0) {
    violations.push('R6: قيدُ القراءةِ غيرُ موجودٍ — قراءةٌ بلا أثرِ تدقيقٍ تقع ولا تُرى.');
  } else if (readAt < 0) {
    violations.push('R6: نداءُ القراءةِ الموحَّدُ غيرُ موجودٍ — لا يُقاس ترتيبُ القيدِ بالأثر.');
  } else if (appendAt > readAt) {
    violations.push(
      'R6: القيدُ يُكتب **بعد** القراءةِ — من سجّل بعد الأثرِ فقد ما وقع إن أخفق التسجيل.',
    );
  }
}

// ═══ R7 ═══
const monitorDir = path.join(ROOT, 'src', 'observability');
if (fs.existsSync(monitorDir)) {
  for (const entry of fs.readdirSync(monitorDir)) {
    if (!entry.endsWith('.mjs')) continue;
    const source = fs.readFileSync(path.join(monitorDir, entry), 'utf8');
    for (const call of ['.insert(', '.update(', '.remove(', '.upsert(']) {
      if (source.includes(call)) {
        violations.push(
          `R7: نداءُ كتابةٍ \`${call}\` في \`src/observability/${entry}\` — مسارُ المراقبةِ لا يكتب، والرفضُ البنيويُّ يبدأ بغيابِ النداءِ نفسِه.`,
        );
      }
    }
  }
}
if (agentSource !== '') {
  for (const [needle, why] of /** @type {Array<[string, string]>} */ ([
    ['#views = new Map()', 'المشاهدُ ليست في حقلٍ خاصٍّ فتُقرأ من خارجِ الصنف'],
    ['#specs = new Map()', 'المواصفاتُ ليست في حقلٍ خاصّ'],
    ['#log;', 'سجلُّ الأحداثِ ليس في حقلٍ خاصّ'],
  ])) {
    if (!agentSource.includes(needle)) violations.push(`R7: ${why} (${needle}).`);
  }
  for (const leak of ['get repositories', 'get views()', 'return this.#views.get']) {
    if (agentSource.includes(leak)) {
      violations.push(
        `R7: \`${leak}\` يُصدِّر مشهداً أو مستودعاً من الوكيل — قراءةٌ خارجَ التدقيقِ هي المسارُ الثاني الذي تمنعه هذه الخطوة.`,
      );
    }
  }
}

// ═══ R8 ═══
const test = readFile('tests/observability/monitor-agent.test.mjs');
if (test === '') {
  violations.push(
    'R8: `tests/observability/monitor-agent.test.mjs` غائب — حاجزٌ يقرأ النصَّ بلا اختبارٍ يقيس السلوكَ نصفُ حاجز.',
  );
} else {
  /** @type {Array<[string, string]>} */
  const measured = [
    ['WRITE_FORBIDDEN', 'الرفضُ البنيويُّ للكتابةِ غيرُ مقيس'],
    ['CAPABILITY_FORBIDDEN', 'منعُ التركيبِ على قدرةٍ زائدةٍ غيرُ مقيس'],
    ['CAPABILITY_UNDECLARED', 'التقابلُ العكسيُّ للقدراتِ غيرُ مقيس'],
    ['AUDIT_REQUIRED', 'الفشلُ المغلقُ بلا سجلِّ أحداثٍ غيرُ مقيس'],
    ['IDENTITY_UNVERIFIED', 'تحقُّقُ الهويةِ غيرُ مقيس'],
    ['VIEW_NOT_COMPOSED', 'ردُّ المشهدِ غيرِ المركَّبِ غيرُ مقيس'],
    ['ENTITY_MISMATCH', 'ردُّ الجدولِ المخالفِ غيرُ مقيس'],
    ['QUERY_UNSUPPORTED', 'حدُّ السؤالِ غيرُ مقيس'],
    ['VIEW_UNKNOWN', 'ردُّ المشهدِ غيرِ المُعلَنِ غيرُ مقيس'],
    ['CONFIG_INVALID', 'ردُّ الوثيقةِ المخالفةِ غيرُ مقيس'],
    ['Object.isFrozen', 'تجميدُ الصفوفِ المقروءةِ غيرُ مقيس'],
    ['setPrototypeOf', 'منعُ تبديلِ سلفِ المشهدِ غيرُ مقيس'],
  ];
  for (const [needle, why] of measured) {
    if (!test.includes(needle)) violations.push(`R8: ${why} (${needle}).`);
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز المراقبة للقراءة فقط رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const viewCount = policy === null ? 0 : policy.views.length;
const methodCount = policy === null ? 0 : policy.readMethods.length;
const guaranteeCount = policy === null ? 0 : policy.guarantees.length;
console.log(
  `✅ حاجز المراقبة للقراءة فقط: ${viewCount} مشهداً على مستوداتٍ معلَنةٍ، و${methodCount} نداءاتٍ مقروءةٍ لا كاتبةَ فيها، و${guaranteeCount} ضماناتٍ كلُّها مربوطةٌ برمزٍ حاضرٍ في ملفِّ إنفاذِه، وقدراتُ دورِ المراقبةِ مطابقةٌ للمُعلَنِ في الاتجاهين، والقيدُ يُكتب قبل القراءةِ، ولا نداءَ كتابةٍ واحداً في مسارِ المراقبة.`,
);
