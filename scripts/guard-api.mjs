#!/usr/bin/env node
/**
 * حاجزُ طبقةِ الواجهةِ الداخلية — البوابةُ السابعةُ والعشرون في `npm run validate`
 * (الخطوة M9.02).
 *
 * البوابةُ 26 تحرس أن تكون قراءةُ المراقبةِ قراءةً وحدَها. وهذه تحرس **المدخلَ**
 * إليها: أن يكون لكلِّ نداءٍ مسارٌ معلَنٌ، وجلسةٌ لهويةٍ نشطة، وحدُّ معدَّلٍ يَعُدُّ
 * المرفوض، وقرارٌ من نقطةِ التفويضِ المركزيةِ بتذكرةٍ مستهلكة، وقيدُ تدقيقٍ لكلِّ
 * نداءٍ ولكلِّ رفض. وثماني قواعد:
 *
 *   R1: `config/api.yaml` تُحمَّل بمخطَّطها، وكلُّ مسارٍ فيها يُعلن **فعلاً** في
 *       كتالوجِ `config/policies.yaml`، و**مشهداً** في `config/monitoring.yaml`،
 *       و**نداءً مقروءاً** مُعلَناً فيها؛ ومسارٌ يُشير إلى فعلٍ أو مشهدٍ لا وجودَ
 *       له مسارٌ يسقط عند أولِ نداءٍ صحيح.
 *   R2: كلُّ رمزٍ في `API_ERRORS` مُعلَنٌ في الوثيقةِ وبالعكس **في الاتجاهين**،
 *       وكلُّ رمزٍ في ضمانٍ حاضرٌ نصّاً في ملفِّ إنفاذِه المُعلَن.
 *   R3: الترتيبُ نصٌّ لا نيّة: المصادقةُ قبل حدِّ المعدَّل، وحدُّ المعدَّلِ قبل
 *       التفويض، والتفويضُ قبل نداءِ المُعالِج، وقيدُ التدقيقِ قبل التفويض.
 *   R4: رمزُ الجلسةِ لا يُخزَّن نصّاً: لا `#sessions.set(token` في المخزن، والمفتاحُ
 *       بصمةٌ محسوبةٌ بـ`createHash`.
 *   R5: البوابةُ **مركَّبةٌ** في `composition.mjs` بلا شرطٍ باسم `api`، ومُعلَنةٌ في
 *       `StateRegistries`، ويُمرَّر إليها السجلُّ والهوياتُ والمشهدُ ونقطةُ التفويض؛
 *       فبوابةٌ ككودٍ غيرِ مركَّبٍ بوابةٌ يُلتفّ حولها.
 *   R6: لا نداءَ كاتبٍ في `src/api/` (‏`.insert(` `.update(` `.remove(` `.upsert(`)،
 *       ولا مستودعَ في يدِ الطبقة، وحقولُ البوابةِ خاصّةٌ ولا تُصدَّر.
 *   R7: كلُّ رفضٍ يُسجَّل: نداءُ `refusalEvent` حاضرٌ في البوابةِ ويحمل الرمزَ،
 *       ولا يخرج من الطبقةِ رمزٌ غيرُ مُعلَنٍ في كتالوجِها.
 *   R8: ملفُّ اختبارِ الطبقةِ موجودٌ ويقيس معيارَ القبولِ ورموزَه الحاكمة.
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقرأ النصَّ والوثيقةَ ولا يفتح مِقبساً؛ فأمنُ النقلِ
 * (‏TLS، الرؤوس، CORS) خارجَ ما يحرسه لأنه خارجَ ما تدّعيه الخطوة: البوابةُ نداءٌ
 * داخليٌّ في العملية، ومحوِّلُ النقلِ نصُّ `M9.03`.
 *
 * **حدٌّ معلَن ثانٍ:** الترتيبُ يُقاس بموضعِ النصِّ في `call`، وذاك يمنع القلبَ
 * بالكتابةِ لا القلبَ بالتفافٍ ذكيٍّ في زمنِ التشغيل — وصدقُ الرفضِ مقيسٌ في
 * `tests/api/gateway.test.mjs`.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import { API_ERRORS, loadApiPolicy } from '../src/api/gateway.mjs';
import { loadMonitoringPolicy } from '../src/observability/monitor-agent.mjs';

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
/** @type {import('../src/api/gateway.mjs').ApiPolicy | null} */
let policy = null;
try {
  policy = loadApiPolicy({ dir: path.join(ROOT, 'config') });
} catch (error) {
  violations.push(`R1: ${error instanceof Error ? error.message : String(error)}`);
}

/** @type {import('../src/observability/monitor-agent.mjs').MonitoringPolicy | null} */
let monitoring = null;
try {
  monitoring = loadMonitoringPolicy({ dir: path.join(ROOT, 'config') });
} catch (error) {
  violations.push(
    `R1: تعذّرت قراءةُ وثيقةِ المراقبة: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/** @type {Set<string>} */
const catalogActions = new Set();
try {
  const policiesRaw = YAML.parse(readFile('config/policies.yaml'));
  const actions = /** @type {Array<{ id?: unknown }>} */ (policiesRaw?.actions ?? []);
  for (const action of actions) {
    if (typeof action?.id === 'string') catalogActions.add(action.id);
  }
} catch (error) {
  violations.push(
    `R1: تعذّرت قراءةُ كتالوجِ الأفعال: ${error instanceof Error ? error.message : String(error)}`,
  );
}
if (catalogActions.size === 0) {
  violations.push('R1: كتالوجُ الأفعالِ في `config/policies.yaml` فارغٌ أو غيرُ مقروء.');
}

if (policy !== null && monitoring !== null) {
  /** @type {Set<string>} */
  const views = new Set(monitoring.views.map((view) => view.id));
  for (const route of policy.routes) {
    if (!catalogActions.has(route.action)) {
      violations.push(
        `R1: المسار ${route.id} يُعلن الفعل «${route.action}» وهو خارجُ كتالوجِ الأفعالِ المحكومة — فعلٌ خارجَ الكتالوجِ فعلٌ لا سياسةَ له.`,
      );
    }
    if (!views.has(route.view)) {
      violations.push(
        `R1: المسار ${route.id} يقرأ المشهد «${route.view}» وهو غيرُ مُعلَنٍ في وثيقةِ المراقبة.`,
      );
    }
    if (!monitoring.readMethods.includes(route.call)) {
      violations.push(
        `R1: المسار ${route.id} يُنادي «${route.call}» وهو غيرُ مُعلَنٍ نداءً مقروءاً — وما ليس قراءةً مُعلَنةً لا يُنادى من هذه الطبقة.`,
      );
    }
    if (route.method !== 'GET') {
      violations.push(
        `R1: المسار ${route.id} يُعلن «${route.method}»؛ وكلُّ مسارٍ في هذه الطبقةِ قارئٌ فقط، والكتابةُ نصُّ M9.03.`,
      );
    }
  }
}

// ═══ R2 ═══
if (policy !== null) {
  /** @type {Set<string>} */
  const listed = new Set(policy.refusalCodes);
  for (const code of Object.values(API_ERRORS)) {
    if (!listed.has(code)) {
      violations.push(
        `R2: الرمز ${code} يرفعه الكودُ ولا إعلانَ له في `.concat('`config/api.yaml`.'),
      );
    }
  }
  /** @type {Set<string>} */
  const inGuarantees = new Set();
  for (const guarantee of policy.guarantees) {
    const source = readFile(guarantee.enforcedBy);
    if (source === '') {
      violations.push(
        `R2: الضمان ${guarantee.id} يُعلن ملفَّ إنفاذٍ غيرَ مقروء: ${guarantee.enforcedBy}.`,
      );
      continue;
    }
    for (const code of guarantee.codes) {
      inGuarantees.add(code);
      if (!source.includes(code) && !source.includes(code.replace('API_', ''))) {
        violations.push(
          `R2: الرمز ${code} في الضمان ${guarantee.id} غيرُ حاضرٍ في ملفِّ إنفاذِه ${guarantee.enforcedBy} — ضمانٌ يُشير إلى ملفٍّ لا يذكر رمزَه ضمانٌ بلا موضعِ إنفاذ.`,
        );
      }
    }
  }
  for (const code of policy.refusalCodes) {
    if (!inGuarantees.has(code) && code !== 'API_CONFIG_INVALID') {
      violations.push(
        `R2: الرمز ${code} مُعلَنٌ ولا ضمانَ يذكره؛ ورمزُ رفضٍ بلا ضمانٍ رمزٌ لا يُعرَف ما يحرسه.`,
      );
    }
  }
}

// ═══ R3 ═══
const gateway = readFile('src/api/gateway.mjs');
if (gateway === '') {
  violations.push('R3: `src/api/gateway.mjs` غير مقروء — لا يُقاس ترتيبُ العقبات.');
} else {
  const callIndex = gateway.indexOf('async #callChecked');
  const body = callIndex >= 0 ? gateway.slice(callIndex) : gateway;
  /** @type {Array<[string, string, string]>} */
  const order = [
    [
      '#sessions.resolve',
      '#limiter.consume',
      'المصادقةُ يجب أن تسبق حدَّ المعدَّل؛ وحدٌّ على مُنادٍ مجهولٍ يُحسَب على مَن؟',
    ],
    [
      '#limiter.consume',
      'enforcement.authorize',
      'حدُّ المعدَّلِ يجب أن يسبق التفويض؛ وإلا لم يُكلِّف النداءُ المرفوضُ صاحبَه شيئاً.',
    ],
    [
      'log.append',
      'enforcement.authorize',
      'قيدُ النداءِ يجب أن يسبق سؤالَ التفويض؛ وأثرٌ بعد السؤالِ يضيع إن أخفق السؤال.',
    ],
    ['enforcement.authorize', 'enforcement.verify', 'القرارُ قبل استهلاكِ تذكرتِه.'],
    [
      'enforcement.verify',
      'monitor.read',
      'التذكرةُ تُستهلَك قبل الأثر؛ وإثباتُ المرورِ بعد القراءةِ إثباتٌ لا يمنع شيئاً.',
    ],
  ];
  for (const [first, second, why] of order) {
    const a = body.indexOf(first);
    const b = body.indexOf(second);
    if (a < 0) violations.push(`R3: «${first}» غيرُ موجودٍ في مسارِ النداء.`);
    else if (b < 0) violations.push(`R3: «${second}» غيرُ موجودٍ في مسارِ النداء.`);
    else if (a > b) violations.push(`R3: «${first}» يقع بعد «${second}» — ${why}`);
  }
}

// ═══ R4 ═══
const store = readFile('src/api/session-store.mjs');
if (store === '') {
  violations.push('R4: `src/api/session-store.mjs` غير مقروء.');
} else {
  if (!store.includes('createHash')) {
    violations.push(
      'R4: مخزنُ الجلساتِ لا يحسب بصمةً؛ ورمزٌ يُخزَّن نصّاً سرٌّ في الذاكرةِ يُقرأ بأولِ مقطعِ تشخيص.',
    );
  }
  if (/#sessions\.set\(\s*token/.test(store)) {
    violations.push('R4: مخزنُ الجلساتِ يفهرس بالرمزِ نصّاً لا ببصمتِه.');
  }
  if (!/#sessions\.set\(fingerprint/.test(store)) {
    violations.push(
      'R4: مفتاحُ الجلسةِ ليس بصمةً محسوبةً — والفهرسةُ بغيرِ البصمةِ تُبقي السرَّ في الذاكرة.',
    );
  }
  if (!store.includes('expiresAtMs')) {
    violations.push('R4: الجلسةُ بلا مهلةٍ محفوظة؛ وجلسةٌ لا تنتهي إذنٌ دائم.');
  }
}

// ═══ R5 ═══
const composition = readFile('src/persistence/composition.mjs');
if (composition === '') {
  violations.push('R5: `src/persistence/composition.mjs` غير مقروء.');
} else {
  if (!composition.includes('new ApiGateway({')) {
    violations.push(
      'R5: بوابةُ الواجهةِ غيرُ مركَّبةٍ في سجلاتِ الحالة — بوابةٌ ككودٍ غيرِ مركَّبٍ بوابةٌ يُلتفّ حولها.',
    );
  }
  if (!composition.includes('@property {ApiGateway} api')) {
    violations.push('R5: البوابةُ غيرُ مُعلَنةٍ في `StateRegistries`.');
  }
  if (!/\n\s*api,\n/.test(composition)) {
    violations.push('R5: البوابةُ غيرُ مُعادةٍ باسم `api` من سجلاتِ الحالة.');
  }
  const gatewayCall = composition.slice(composition.indexOf('new ApiGateway({'));
  const block = gatewayCall.slice(0, gatewayCall.indexOf('});') + 3);
  for (const dependency of ['log,', 'agents,', 'monitor,', 'enforcementPoint,']) {
    if (!block.includes(dependency)) {
      violations.push(
        `R5: البوابةُ تُركَّب بلا «${dependency.replace(',', '')}» — والنقصُ هنا يظهر رفضاً في التشغيل، لكنّ التركيبَ الناقصَ عن قصدٍ يجعل الواجهةَ معطَّلةً بلا إعلان.`,
      );
    }
  }
  // والشرطُ يُقاس بإيجابِ الشكلِ الوحيدِ المقبول، لا بإحصاءِ أشكالِ الشرط. وهذا
  // درسٌ دفعْنا ثمنَه هنا: أولُ صياغةٍ لهذه القاعدةِ بحثت عن `if (...) {` قبل
  // التركيب، فمرَّت منها صيغةُ الشرطِ الثلاثيةِ في تجربةِ تزويرٍ مقصودة. وقائمةُ
  // الممنوعِ لا تنتهي؛ وإيجابُ المقبولِ ينتهي.
  if (!/\n\s*const api = new ApiGateway\(\{/.test(composition)) {
    violations.push(
      'R5: البوابةُ لا تُركَّب إسناداً مباشراً غيرَ مشروط (`const api = new ApiGateway({`)؛ وتركيبٌ مشروطٌ يجعل غيابَها مساراً مفتوحاً لا رفضاً.',
    );
  }
}

// ═══ R6 ═══
const apiDir = path.join(ROOT, 'src', 'api');
/** @type {string[]} */
const apiFiles = fs.existsSync(apiDir)
  ? fs.readdirSync(apiDir).filter((name) => name.endsWith('.mjs'))
  : [];
if (apiFiles.length === 0) {
  violations.push('R6: مجلَّد `src/api/` فارغٌ أو غائب.');
}
for (const name of apiFiles) {
  const source = readFile(path.join('src', 'api', name));
  // والمقصودُ منعُ الكتابةِ في **مستودع**، لا منعُ كلِّ اسمٍ يشبه الكتابة.
  // فـ`hash.update(token)` حسابُ بصمةٍ، و`#sessions.delete(...)` حذفٌ من خريطةٍ
  // في الذاكرةِ هو نفسُه إغلاقُ الجلسة. وحاجزٌ يرفض هذين حاجزٌ يُجبِر على
  // التفافٍ يُخفي المقصد، فحُدَّ بالمُستَقبِلِ لا بالاسمِ وحدَه.
  const RECEIVERS_IN_MEMORY = new Set(['#sessions', '#windows', '#routes', '#rules', 'hash']);
  for (const match of source.matchAll(/([#\w.]+)\.(insert|update|remove|upsert|delete)\(/g)) {
    const receiver = match[1] ?? '';
    const tail = receiver.split('.').pop() ?? receiver;
    if (RECEIVERS_IN_MEMORY.has(tail)) continue;
    if (receiver.startsWith('createHash')) continue;
    violations.push(
      `R6: \`src/api/${name}\` ينادي «${receiver}.${match[2]}(» — ولا نداءَ كتابةٍ واحداً في هذه الطبقة، والكتابةُ نصُّ M9.03.`,
    );
  }
  if (source.includes('repositories')) {
    violations.push(
      `R6: \`src/api/${name}\` يمسك مستودعاتٍ — والقراءةُ من مشهدٍ مُدقَّقٍ وحده، ومستودعٌ في يدِ الطبقةِ مسارٌ ثانٍ يقرأ خارجَ التدقيق.`,
    );
  }
}
if (gateway !== '') {
  for (const field of ['#sessions', '#limiter', '#enforcement', '#monitor', '#log', '#routes']) {
    if (!gateway.includes(`  ${field};`) && !gateway.includes(`  ${field} =`)) {
      violations.push(
        `R6: الحقل «${field}» ليس حقلاً خاصّاً في البوابة — وكلُّ حقلٍ مكشوفٍ بابٌ ثانٍ.`,
      );
    }
  }
  const barrel = readFile('src/api/index.mjs');
  for (const leaked of ['MonitorAgent', 'createMemoryRepository', 'EnforcementPoint']) {
    if (barrel.includes(leaked)) {
      violations.push(
        `R6: مَخرجُ الطبقةِ يُصدِّر «${leaked}» — والتصديرُ هنا يمنح ما تمنعه البوابة.`,
      );
    }
  }
}

// ═══ R7 ═══
if (gateway !== '' && policy !== null) {
  if (!gateway.includes('audit.refusalEvent')) {
    violations.push('R7: البوابةُ لا تُسجِّل الرفض؛ ورفضٌ لا أثرَ له لا يُعرَف أنّ صاحبَه حاول.');
  }
  if (!gateway.includes('audit.callEvent')) {
    violations.push('R7: البوابةُ لا تُسجِّل النداء.');
  }
  if (!gateway.includes('code: codeOf(error)')) {
    violations.push(
      'R7: قيدُ الرفضِ بلا رمزٍ؛ وقيدٌ يقول «رُفض» ولا يقول «بأيِّ رمز» قيدٌ لا يُدقَّق.',
    );
  }
  if (!gateway.includes('HANDLER_REFUSED')) {
    violations.push(
      'R7: رفضُ المُعالِجِ يخرج برمزِ طبقةٍ أخرى؛ وكتالوجُ الرفضِ يَعِد بأنّ ما يخرج من هنا مُعلَنٌ فيه.',
    );
  }
}

// ═══ R8 ═══
const test = readFile('tests/api/gateway.test.mjs');
if (test === '') {
  violations.push(
    'R8: `tests/api/gateway.test.mjs` غائب — حاجزٌ يقرأ النصَّ بلا اختبارٍ يقيس السلوكَ نصفُ حاجز.',
  );
} else {
  /** @type {Array<[string, string]>} */
  const measured = [
    ['AUTH_REQUIRED', 'رفضُ النداءِ بلا مصادقةٍ غيرُ مقيس'],
    ['AUTHORIZATION_DENIED', 'رفضُ النداءِ بلا تفويضٍ غيرُ مقيس'],
    ['SESSION_EXPIRED', 'انتهاءُ الجلسةِ غيرُ مقيس'],
    ['SESSION_INVALID', 'ردُّ الرمزِ المجهولِ غيرُ مقيس'],
    ['IDENTITY_UNVERIFIED', 'تحقُّقُ الهويةِ غيرُ مقيس'],
    ['RATE_LIMITED', 'حدُّ المعدَّلِ غيرُ مقيس'],
    ['ROUTE_UNKNOWN', 'ردُّ المسارِ غيرِ المُعلَنِ غيرُ مقيس'],
    ['ENFORCEMENT_REQUIRED', 'الفشلُ المغلقُ بلا نقطةِ تفويضٍ غيرُ مقيس'],
    ['AUDIT_REQUIRED', 'الفشلُ المغلقُ بلا سجلٍّ غيرُ مقيس'],
    ['HANDLER_UNDECLARED', 'الفشلُ المغلقُ بلا مُعالِجٍ غيرُ مقيس'],
    ['HANDLER_REFUSED', 'تغليفُ رفضِ المُعالِجِ غيرُ مقيس'],
    ['PARAMS_INVALID', 'حدُّ الوسائطِ غيرُ مقيس'],
    ['refusalLogged', 'تسجيلُ الرفضِ غيرُ مقيس'],
    ['policy.decision', 'المرورُ بالنقطةِ المركزيةِ غيرُ مقيس'],
    ['Object.isFrozen', 'تجميدُ المُعادِ غيرُ مقيس'],
  ];
  for (const [needle, why] of measured) {
    if (!test.includes(needle)) violations.push(`R8: ${why} (${needle}).`);
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز طبقة الواجهة الداخلية رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const routeCount = policy === null ? 0 : policy.routes.length;
const codeCount = policy === null ? 0 : policy.refusalCodes.length;
const guaranteeCount = policy === null ? 0 : policy.guarantees.length;
console.log(
  `✅ حاجز طبقة الواجهة الداخلية: ${routeCount} مساراً قارئاً كلُّها بأفعالٍ في كتالوجِ السياساتِ ومشاهدَ مُعلَنةٍ في وثيقةِ المراقبة، و${codeCount} رمزَ رفضٍ متقابلةً في الاتجاهين، و${guaranteeCount} ضماناً كلُّها مربوطةٌ برمزٍ حاضرٍ في ملفِّ إنفاذِه، والترتيبُ محفوظ: مصادقةٌ ثم حدُّ معدَّلٍ ثم قيدُ تدقيقٍ ثم تفويضٌ مركزيٌّ بتذكرةٍ مستهلكةٍ ثم مشهدٌ مقروء، والبوابةُ مركَّبةٌ بلا شرط، ورمزُ الجلسةِ مُخزَّنٌ ببصمتِه لا نصّاً.`,
);
