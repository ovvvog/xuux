#!/usr/bin/env node
/**
 * حاجزُ طبقةِ النقلِ — يحرسُ سدادَ الدَينِ `D-1` من أن يُنقَضَ بعدَ سدادِه.
 *
 * الدَينُ كان: «لا طبقةَ نقلٍ (HTTP/TLS) ولا واجهةٌ رسوميّةٌ». وسدادُه يُدخِلُ على
 * الدولةِ ما لم يكنْ فيها قبلَه: **مِقبساً يَسمعُ**. ومِقبسٌ يَسمعُ سطحُ هجومٍ لا
 * ميزةٌ، فالحاجزُ يحرسُ أن يبقى هذا السطحُ **أضيقَ من البوابةِ لا أوسعَ**، بسبعِ
 * قواعدَ كلُّها نصٌّ مقروءٌ لا نيّةٌ:
 *
 *   T1: جدولُ المساراتِ **مُشتَقٌّ** من `config/api.yaml`: كلُّ مسارٍ فيها يُطابَقُ،
 *       وكلُّ مسارٍ في الجدولِ مُعلَنٌ فيها — **في الاتجاهين**. وليس في
 *       `src/transport/` عنوانٌ مكتوبٌ يداً، لأنّ المكتوبَ يداً يفترقُ عن الوثيقةِ
 *       في أوّلِ تعديلٍ: يُحذَفُ مسارٌ منها فيبقى مخدوماً، وذاك ثغرةٌ لا سهوٌ.
 *   T2: قراءةٌ وحدَها من `config/api.yaml`: لا فعلَ غيرَ `GET` في وثيقةِ القراءةِ
 *       ولا في جدولِها، ولا نداءَ كاتبٍ (`.insert(` `.update(` `.remove(` `.upsert(`)
 *       في الطبقةِ. وجسمُ طلبٍ في قراءةٍ يُرَدُّ لا يُهمَلُ.
 *   T3: لا سلطةَ في النقلِ: لا مستودعَ ولا قاعدةَ ولا نقطةَ تفويضٍ في يدِ الطبقةِ،
 *       ولا نداءَ إلا عبرَ `gateway.call` للقراءةِ أو `console.issue` للكتابةِ. فطبقةٌ
 *       تقرأُ القاعدةَ مباشرةً تُخرِجُ القراءةَ من العقباتِ الخمسِ كلِّها.
 *   T4: كلُّ رمزِ رفضٍ في `API_ERRORS` و`SESSION_ERRORS` و`TRANSPORT_ERRORS`
 *       و`CONSOLE_ERRORS` له ترجمةُ حالةٍ مُعلَنةٌ، ولا ترجمةَ لرمزٍ غيرِ مُعلَنٍ
 *       — **في الاتجاهين**. فرمزٌ بلا ترجمةٍ يُسلَّمُ بحالةٍ مخمَّنةٍ، و`200` على
 *       رفضٍ أسوأُ من انقطاعٍ.
 *       **وإقحامُ `SESSION_ERRORS` هنا سدادُ `LIVE-6`:** كان الحاجزُ يكتفي
 *       بـ`API_ERRORS`، وهي جدولُ تسميةٍ يُغفِلُ رموزَ إثباتِ الحيازةِ الأربعةَ
 *       مع أنَّها تخرجُ إلى المُنادي — فمرَّت بلا ترجمةٍ وسقطَتْ إلى `500`، والحاجزُ
 *       ساكتٌ. فالمقياسُ مصادرُ الرموزِ لا جدولُ تسميتِها.
 *   T5: بلا اعتمادِ npm واحدٍ: كلُّ استيرادٍ في الطبقةِ إمّا `node:` وإمّا نسبيٌّ.
 *   T6: الرمزُ لا يُقرأُ من مُلحقِ استعلامٍ — المُلحقاتُ تُكتَبُ في سجلّاتِ
 *       الوسائطِ وتاريخِ المتصفِّحِ فيُسرَّبُ الرمزُ — ولا يُخدَمُ ملفٌّ خارجَ
 *       الجذرِ ولا امتدادٌ غيرُ مُعلَنٍ.
 *   T7: الاختبارُ موجودٌ ويقيسُ الرفضَ لا المرورَ فقط: `401` و`403` و`404` و`405`.
 *   T8: لا سبيلَ إلى إسقاطِ تحقُّقِ الشهادةِ: لا `rejectUnauthorized` محسوبٌ ولا
 *       مُسنَدٌ إلى غيرِ `true`، ولا عَلَمَ تخطٍّ، ولا قراءةَ
 *       `NODE_TLS_REJECT_UNAUTHORIZED` إلا لتُرفَضَ حالُ التعطيلِ. فخيارٌ واحدٌ
 *       يُسقِطُ التحقُّقَ يُحوِّلُ القناةَ المُعمّاةَ إلى **إيهامِ تعميةٍ**.
 *   T9: لا رجوعَ غيرَ آمنٍ: نقصُ مادّةِ TLS يَرفعُ `TransportTlsError` ولا يُنشِئُ
 *       خادمَ نصٍّ بديلاً، ولا `node:http` في وحدةِ TLS، و`Strict-Transport-Security`
 *       لا تُرَدُّ إلا على ردٍّ خرجَ من مِقبسٍ مُعمّىً فعلاً.
 *  T10: ولا مادّةَ مفاتيحَ في المستودعِ: لا `.pem` ولا `.key` ولا `.p12` ولا `.pfx`
 *       مُتتبَّعٌ، ولا شهادةٌ مُدمَجةٌ في الشفرةِ؛ والمادّةُ تُقرأُ من مساراتٍ في
 *       البيئةِ. واختبارُ TLS موجودٌ ويقيسُ النجاحَ والرفضَ ومنعَ التسريبِ.
 *  T11: مساراتُ الكتابةِ السياديّةِ مُشتَقّةٌ من `config/royal-console.yaml` وحدَها:
 *       كلُّ أمرٍ مُعلَنٍ فيه مسارُ `POST` واحدٌ على `/state/console/<action>`،
 *       ولا مسارَ كتابةٍ مكتوبٌ يداً. والنقلُ يقبلُ الظرفَ المُوقَّعَ ويُمرِّرُه
 *       للديوانِ — لا يُوقِّعُ ولا يُتحقَّقُ ولا يُنفِّذُ بسلطتِه. وجسمُ الطلبِ يُقرأُ
 *       للمسارِ السياديِّ وحدَه بحدٍّ مُعلَنٍ، ولا يُقرأُ لغيرِه. واختبارُ الكتابةِ
 *       موجودٌ ويقيسُ مساراً مُعلَناً ومساراً غيرَ مُعلَنٍ وبلا ديوانٍ.
 *  T12: **ووسيطُ التطويرِ الموقِّعُ مُعلَنٌ ومحدودٌ وخارجَ الإنتاجِ (‏`LIVE-5`):**
 *       سلطتُهُ ومداهُ مكتوبانِ في `docs/TRANSPORT.md` **وفي واجهةِ المشهدِ
 *       نفسِها** لا في الوثيقةِ وحدَها، والمُشغِّلُ يُوصِلُ `assertLoopbackHost`
 *       فيَفشَلُ مُغلَقاً على مضيفٍ غيرِ محلّيٍّ، **ولا ملفَ تحتَ `src/` يستوردُهُ**.
 *       فوسيطٌ يُوقِّعُ لمَن لا مفتاحَ لهُ **سلطةٌ مُسنَدةٌ**، وسلطةٌ بلا
 *       إعلانٍ ولا حدٍّ لا تُفارقُ إسقاطَ الحمايةِ إلّا بالاسمِ.
 *  T13: **ومسلكُ فتحِ الجلسةِ ومستهلِكُهُ الخارجيُّ مُشتَقّانِ ومحدودانِ
 *       (‏`WL-194` — إغلاقُ `D-2`):** المسلكُ يُشتَقُّ من `config/api.yaml`
 *       (‏`wire.sessionEndpoint`) ولا يُكتَبُ عنوانُهُ يداً، **ولا يُعلَنُ في
 *       `routes`** فتُقرأَ مصادقةٌ قراءةً محكومةً بجلسةٍ لا تُوجَدُ بعدُ، والخادمُ
 *       يُنادي `gateway.openSession(` ولا يُصدِرُ رمزاً بنفسِهِ. **والمستهلِكُ
 *       الخارجيُّ خارجٌ فعلاً:** لا يستوردُ من `src/` إلا `pop-canonical.mjs`
 *       ولا يقرأُ ملفاً من `config/` — فعميلٌ يستوردُ البوابةَ أو يقرأُ وثيقتَها
 *       **يقيسُ نفسَهُ لا السلكَ**، ودَينٌ يُغلَقُ بشاهدٍ داخليٍّ لم يُغلَقْ.
 *
 * **حدٌّ مُعلَنٌ:** الحاجزُ يقرأُ النصَّ والوثيقةَ **ولا يفتحُ مِقبساً ولا يُصافِحُ**؛
 * فنجاحُ المُصافحةِ ورفضُ الشهادةِ غيرِ الموثوقةِ يُقاسانِ في
 * `tests/transport/tls.test.mjs` على مِقبسٍ حقيقيٍّ، والحاجزُ يحرسُ **ألّا يُنقَضَ
 * ما قاسَه الاختبارُ** لا أن يُنيبَ عنه.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { API_ERRORS, loadApiPolicy } from '../src/api/gateway.mjs';
import { SESSION_ERRORS } from '../src/api/session-store.mjs';
import { CONSOLE_ERRORS } from '../src/console/index.mjs';
import { STATUS_BY_CODE, TRANSPORT_ERRORS } from '../src/transport/problem.mjs';
import { compileCommandRoutes, compileRoutes, matchRoute } from '../src/transport/router.mjs';

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

const TRANSPORT_DIR = path.join(ROOT, 'src', 'transport');
/** @type {string[]} */
const transportFiles = fs.existsSync(TRANSPORT_DIR)
  ? fs
      .readdirSync(TRANSPORT_DIR)
      .filter((name) => name.endsWith('.mjs'))
      .sort()
  : [];
if (transportFiles.length === 0) {
  violations.push('T0: `src/transport/` غائبةٌ أو فارغةٌ — والدَينُ `D-1` يُقالُ مسدَّداً.');
}
/** @type {Map<string, string>} */
const sources = new Map();
for (const name of transportFiles) {
  sources.set(name, readFile(path.join('src', 'transport', name)));
}

/**
 * يُجرِّدُ النصَّ من التعليقاتِ كي لا يُحسَبَ شرحُ المنعِ منعاً منقوضاً.
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** @type {Map<string, string>} */
const code = new Map();
for (const [name, source] of sources) code.set(name, stripComments(source));

// ═══ T1: الجدولُ مُشتَقٌّ لا مكتوبٌ ═══
/** @type {import('../src/api/gateway.mjs').ApiPolicy | null} */
let policy = null;
try {
  policy = loadApiPolicy({ dir: path.join(ROOT, 'config') });
} catch (error) {
  violations.push(
    `T1: تعذّرت قراءةُ وثيقةِ الواجهةِ: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (policy !== null) {
  /** @type {ReturnType<typeof compileRoutes> | null} */
  let routes = null;
  try {
    routes = compileRoutes({ policy });
  } catch (error) {
    violations.push(
      `T1: تعذّر اشتقاقُ الجدولِ: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (routes !== null) {
    const declared = new Set(policy.routes.map((route) => route.id));
    const compiled = new Set(routes.map((route) => route.id));
    for (const id of declared) {
      if (!compiled.has(id)) violations.push(`T1: مسارٌ مُعلَنٌ لا يُخدَمُ: ${id}.`);
    }
    for (const id of compiled) {
      if (!declared.has(id)) violations.push(`T1: مسارٌ مخدومٌ غيرُ مُعلَنٍ في الوثيقةِ: ${id}.`);
    }
    for (const route of policy.routes) {
      const probe = route.path.replace(/:([A-Za-z0-9_]+)/g, 'قيمةٌ');
      /** @type {unknown} */
      let matched;
      try {
        matched = matchRoute(routes, 'GET', probe);
      } catch {
        matched = null;
      }
      if (matched === null || matched === undefined) {
        violations.push(`T1: عنوانٌ مُعلَنٌ لا يُطابَقُ: ${route.path}.`);
      }
    }
    // والغموضُ يُفشَلُ لا يُخمَّنُ: لا عنوانانِ مُختلفانِ يُطابِقانِ نفسَ الطلبِ
    // بنفسِ درجةِ الحرفيّةِ.
    /** @type {Map<string, string[]>} */
    const shapes = new Map();
    for (const route of routes) {
      const shape = `${route.literals}|${route.segments
        .map((segment) => segment.literal ?? '*')
        .join('/')}`;
      const bucket = shapes.get(shape) ?? [];
      bucket.push(route.id);
      shapes.set(shape, bucket);
    }
    for (const [shape, ids] of shapes) {
      if (ids.length > 1)
        violations.push(`T1: عنوانانِ يتنازعانِ نفسَ الشكلِ (${shape}): ${ids.join(', ')}.`);
    }
  }
}

for (const [name, source] of code) {
  // عنوانٌ مكتوبٌ يداً: نصٌّ يبدأُ بـ`/state/`.
  const literal = source.match(/['"`]\/state\/[^'"`]*['"`]/g);
  if (literal !== null) {
    violations.push(
      `T1: عنوانٌ مكتوبٌ يداً في src/transport/${name}: ${literal[0]} — والجدولُ يُشتَقُّ من الوثيقةِ.`,
    );
  }
}

// ═══ T2: قراءةٌ وحدَها من وثيقةِ القراءة ═══
if (policy !== null) {
  for (const route of policy.routes) {
    if (route.method !== 'GET')
      violations.push(`T2: مسارٌ بفعلٍ كاتبٍ في وثيقةِ القراءةِ: ${route.id}.`);
  }
}
for (const [name, source] of code) {
  for (const needle of ['.insert(', '.update(', '.remove(', '.upsert(']) {
    if (source.includes(needle))
      violations.push(`T2: نداءٌ كاتبٌ في src/transport/${name}: ${needle}.`);
  }
}

// ═══ T3: لا سلطةَ في النقلِ ═══
for (const [name, source] of code) {
  for (const needle of ['createPool', 'persistence/', 'pg', 'enforcementPoint', 'PolicyDecision']) {
    if (needle === 'pg' ? /from\s+['"]pg['"]/.test(source) : source.includes(needle)) {
      violations.push(
        `T3: سلطةٌ في يدِ النقلِ في src/transport/${name}: ${needle} — النقلُ يَنقُلُ ولا يَحكُمُ.`,
      );
    }
  }
}
const serverCode = code.get('server.mjs') ?? '';
if (serverCode !== '' && !serverCode.includes('gateway.call(')) {
  violations.push('T3: الخادمُ لا يُنادي `gateway.call` — فبأيِّ طريقٍ تُقرأُ الدولةُ؟');
}
if (
  serverCode !== '' &&
  !serverCode.includes('console_.issue(') &&
  !serverCode.includes('console.issue(')
) {
  violations.push('T3: الخادمُ لا يُنادي `console.issue` — فبأيِّ طريقٍ تُكتبُ الدولةُ؟');
}

// ═══ T4: خريطةُ الحالاتِ تامّةٌ في الاتجاهين ═══
const knownCodes = /** @type {Set<string>} */ (
  new Set([
    ...Object.values(API_ERRORS),
    ...Object.values(SESSION_ERRORS),
    ...Object.values(TRANSPORT_ERRORS),
    ...Object.values(CONSOLE_ERRORS),
  ])
);
for (const value of knownCodes) {
  if (!Object.prototype.hasOwnProperty.call(STATUS_BY_CODE, value)) {
    violations.push(`T4: رمزُ رفضٍ بلا ترجمةِ حالةٍ: ${value}.`);
  }
}
for (const key of Object.keys(STATUS_BY_CODE)) {
  if (!knownCodes.has(key)) violations.push(`T4: ترجمةُ حالةٍ لرمزٍ غيرِ مُعلَنٍ: ${key}.`);
}
for (const [key, status] of Object.entries(
  /** @type {Record<string, number>} */ (STATUS_BY_CODE),
)) {
  if (status < 400 || status > 599) {
    violations.push(`T4: رفضٌ يُسلَّمُ بحالةٍ ليست حالةَ خطأٍ: ${key} → ${status}.`);
  }
}

// ═══ T5: بلا اعتمادِ npm ═══
for (const [name, source] of sources) {
  for (const match of source.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)) {
    const specifier = match[1] ?? '';
    if (specifier !== '' && !specifier.startsWith('node:') && !specifier.startsWith('.')) {
      violations.push(
        `T5: اعتمادٌ خارجيٌّ في src/transport/${name}: ${specifier} — وعهدُ المشروعِ خادمٌ بلا اعتمادٍ.`,
      );
    }
  }
}

// ═══ T6: الرمزُ والملفّاتُ ═══
const routerCode = code.get('router.mjs') ?? '';
for (const [name, source] of code) {
  if (/(searchParams|query)\.get\(\s*['"](token|authorization)['"]/i.test(source)) {
    violations.push(`T6: رمزُ جلسةٍ يُقرأُ من مُلحقِ استعلامٍ في src/transport/${name}.`);
  }
}
// **والاسمُ يُقرأُ من موضعٍ واحدٍ** (‏`WL-194`): صار للطبقةِ عقدٌ منشورٌ يُعلِنُ
// الترويساتَ، فلو نُسِخَ الاسمُ في المولِّدِ لأمكنَ أن يفترقا، **فيُوقِّعَ العميلُ
// في ترويسةٍ لا يقرأُها الخادمُ ويُرَدَّ بغيابِ إثباتٍ**. فيُقاسُ أنّ الخادمَ يقرأُ
// من `WIRE_HEADERS` وأنّ الأسماءَ مُعلَنةٌ هناك نصّاً.
if (serverCode !== '' && !/headers\[\s*WIRE_HEADERS\.authorization\s*\]/.test(serverCode)) {
  violations.push('T6: الرمزُ لا يُقرأُ من ترويسةِ `Authorization` — فمن أينَ يُقرأُ؟');
}
const wireHeadersCode = code.get('wire-headers.mjs') ?? '';
if (wireHeadersCode === '') {
  violations.push(
    'T6: `src/transport/wire-headers.mjs` غائبٌ — وأسماءُ الترويساتِ بلا موضعٍ واحدٍ.',
  );
} else {
  for (const needle of [
    "'authorization'",
    "'x-state-pop-signature'",
    "'x-state-pop-timestamp'",
    "'x-state-pop-nonce'",
  ]) {
    if (!wireHeadersCode.includes(needle)) {
      violations.push(`T6: اسمُ ترويسةٍ غيرُ مُعلَنٍ في الموضعِ الواحدِ (${needle}).`);
    }
  }
}
const staticCode = code.get('static.mjs') ?? '';
if (staticCode !== '') {
  if (!staticCode.includes('startsWith(rootReal')) {
    violations.push(
      'T6: لا تحقُّقَ أنّ الملفَّ تحتَ الجذرِ بعدَ تحقيقِ المسارِ — بابُ خروجٍ من الجذرِ.',
    );
  }
  if (!staticCode.includes('TYPE_BY_EXTENSION')) {
    violations.push(
      'T6: لا قائمةَ امتداداتٍ مُعلَنةٍ — وامتدادٌ مخمَّنُ النوعِ بابُ تنفيذٍ في المتصفِّحِ.',
    );
  }
  if (/['"]\.json['"]\s*:/.test(staticCode)) {
    violations.push(
      'T6: `.json` مخدومٌ ملفّاً ساكناً — نسخةٌ من البياناتِ تُقرأُ بلا جلسةٍ ولا قيدٍ.',
    );
  }
}
if (routerCode !== '' && !routerCode.includes('literals')) {
  violations.push(
    'T6: لا تفضيلَ للمقطعِ الحرفيِّ على المُتغيِّرِ — فيُقرأُ `count` معرّفَ هويّةٍ.',
  );
}

// ═══ T7: الاختبارُ يقيسُ الرفضَ ═══
const test = readFile(path.join('tests', 'transport', 'server.test.mjs'));
if (test === '') {
  violations.push('T7: `tests/transport/server.test.mjs` غائبٌ — حاجزٌ بلا اختبارٍ نصفُ حاجزٍ.');
} else {
  /** @type {Array<[string, string]>} */
  const measured = [
    ['401', 'رفضُ النداءِ بلا رمزِ جلسةٍ غيرُ مقيسٍ'],
    ['403', 'رفضُ الدورِ بلا قدرةٍ غيرُ مقيسٍ'],
    ['404', 'ردُّ العنوانِ غيرِ المُعلَنِ غيرُ مقيسٍ'],
    ['405', 'ردُّ الفعلِ الكاتبِ غيرُ مقيسٍ'],
    ['server.listen', 'لا مِقبسَ يُفتَحُ في الاختبارِ — فما قِيسَ ليس نقلاً'],
    ['ApiGateway', 'الاختبارُ لا يُركِّبُ بوابةً حقيقيّةً — فقياسٌ على مُزيَّفٍ يقيسُ المُزيَّفَ'],
    ['resolveStaticFile', 'الخروجُ من جذرِ الملفّاتِ غيرُ مقيسٍ'],
    ['GATEWAY_REQUIRED', 'الفشلُ المُغلَقُ بلا بوابةٍ غيرُ مقيسٍ'],
  ];
  for (const [needle, why] of measured) {
    if (!test.includes(needle)) violations.push(`T7: ${why} (${needle}).`);
  }
}

// ═══ T8: لا سبيلَ إلى إسقاطِ تحقُّقِ الشهادةِ ═══
const tlsSource = sources.get('tls.mjs') ?? '';
const tlsCode = code.get('tls.mjs') ?? '';
if (tlsSource === '') {
  violations.push('T8: `src/transport/tls.mjs` غائبةٌ — وباقي الدَينِ `D-1` يُقالُ مسدَّداً.');
} else {
  for (const [name, source] of code) {
    for (const match of source.matchAll(/rejectUnauthorized\s*:\s*([^,}\n]+)/g)) {
      const value = (match[1] ?? '').trim();
      if (value !== 'true') {
        violations.push(
          `T8: \`rejectUnauthorized\` غيرُ مُثبَّتٍ على \`true\` في src/transport/${name}: ${value} — وقيمةٌ محسوبةٌ قد تصيرُ \`false\`.`,
        );
      }
    }
    for (const needle of [
      'NODE_TLS_REJECT_UNAUTHORIZED = ',
      'checkServerIdentity: () =>',
      'insecure',
    ]) {
      if (source.includes(needle)) {
        violations.push(`T8: سبيلٌ إلى إسقاطِ التحقُّقِ في src/transport/${name}: ${needle}.`);
      }
    }
  }
  if (!tlsCode.includes('rejectUnauthorized: true')) {
    violations.push(
      'T8: وحدةُ TLS لا تُثبِّتُ `rejectUnauthorized: true` — فبأيِّ شيءٍ يُتحقَّقُ؟',
    );
  }
  if (!tlsCode.includes('VERIFICATION_DISABLED')) {
    violations.push(
      'T8: تعطيلُ التحقُّقِ في العمليّةِ كلِّها لا يُرفَضُ — فيُشغَّلُ خادمٌ يظنُّ مُشغِّلُه أنّه يتحقَّقُ.',
    );
  }
  if (!/minVersion:\s*MIN_TLS_VERSION/.test(tlsCode) || !tlsCode.includes("'TLSv1.2'")) {
    violations.push('T8: لا حدَّ أدنى مُعلَنٌ لإصدارِ TLS — وإصدارٌ قديمٌ تعميةٌ بالاسمِ.');
  }
}

// ═══ T9: لا رجوعَ غيرَ آمنٍ ═══
if (tlsCode !== '') {
  if (/from\s+['"]node:http['"]/.test(tlsCode)) {
    violations.push('T9: `node:http` في وحدةِ TLS — وبابُ نصٍّ في وحدةِ تعميةٍ بابُ رجوعٍ صامتٍ.');
  }
  for (const thrower of ['CERT_MISSING', 'KEY_MISSING', 'MATERIAL_UNREADABLE']) {
    if (!tlsCode.includes(thrower)) {
      violations.push(`T9: نقصُ المادّةِ لا يُرفَعُ به خطأٌ: ${thrower} — فالنقصُ يُتجاهَلُ.`);
    }
  }
}
if (serverCode !== '') {
  if (!serverCode.includes('strict-transport-security')) {
    violations.push('T9: لا `Strict-Transport-Security` في ردودِ القناةِ المُعمّاةِ.');
  }
  if (!/socket\.encrypted/.test(serverCode)) {
    violations.push(
      'T9: ترويسةُ النقلِ لا تُشتقُّ من حقيقةِ المِقبسِ — فقد يُزعَمُ تأمينٌ على قناةِ نصٍّ.',
    );
  }
  const hstsIndex = serverCode.indexOf('strict-transport-security');
  const baseIndex = serverCode.indexOf("'x-state-transport': 'plaintext");
  if (hstsIndex >= 0 && baseIndex >= 0 && hstsIndex < baseIndex) {
    violations.push(
      'T9: `Strict-Transport-Security` في ترويساتِ قناةِ النصِّ — زعمُ تأمينٍ لم يقعْ.',
    );
  }
}

// ═══ T10: لا مادّةَ مفاتيحَ في المستودعِ، والاختبارُ يقيسُ TLS ═══
for (const [name, source] of sources) {
  if (source.includes('-----BEGIN')) {
    violations.push(`T10: مادّةُ شهادةٍ أو مفتاحٍ مُدمَجةٌ في src/transport/${name}.`);
  }
}
/**
 * يَجمعُ الملفّاتَ المُتتبَّعةَ حديثاً بلا نداءِ `git` كي يعملَ الحاجزُ في بيئةٍ
 * بلا مستودعٍ؛ فالفحصُ يَمشي على الشجرةِ ويتجاوزُ ما لا يُتتبَّعُ أصلاً.
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'coverage', '.local'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else found.push(path.relative(ROOT, full));
  }
  return found;
}
const material = walk(ROOT).filter((file) => /\.(pem|key|p12|pfx)$/.test(file));
if (material.length > 0) {
  violations.push(
    `T10: مادّةُ مفاتيحَ في شجرةِ المستودعِ: ${material.join(', ')} — والسرُّ في مستودعٍ مُسرَّبٌ من يومِ كتابتِه.`,
  );
}
const tlsTest = readFile(path.join('tests', 'transport', 'tls.test.mjs'));
if (tlsTest === '') {
  violations.push(
    'T10: `tests/transport/tls.test.mjs` غائبٌ — وحاجزٌ بلا مُصافحةٍ مقيسةٍ نصفُ حاجزٍ.',
  );
} else {
  /** @type {Array<[string, string]>} */
  const measuredTls = [
    ['createSecureStateServer', 'لا خادمَ مُعمّىً يُنشَأُ في الاختبارِ'],
    ['server.listen', 'لا مِقبسَ مُعمّىً يُفتَحُ — فما قِيسَ ليس مُصافحةً'],
    ['assert.rejects', 'رفضُ الشهادةِ غيرِ الموثوقةِ غيرُ مقيسٍ'],
    ['PRIVATE KEY', 'منعُ تسريبِ مادّةِ المفتاحِ غيرُ مقيسٍ'],
    ['VERIFICATION_DISABLED', 'رفضُ التشغيلِ عندَ تعطيلِ التحقُّقِ غيرُ مقيسٍ'],
    ['strict-transport-security', 'ترويسةُ القناةِ المُعمّاةِ غيرُ مقيسةٍ'],
    ['os.tmpdir()', 'مادّةُ الاختبارِ لا تُولَّدُ خارجَ المستودعِ'],
  ];
  for (const [needle, why] of measuredTls) {
    if (!tlsTest.includes(needle)) violations.push(`T10: ${why} (${needle}).`);
  }
}

// ═══ T11: مساراتُ الكتابةِ السياديّةِ مُشتَقّةٌ من royal-console.yaml ═══
const CONSOLE_POLICY_PATH = path.join(ROOT, 'config', 'royal-console.yaml');
if (!fs.existsSync(CONSOLE_POLICY_PATH)) {
  violations.push('T11: `config/royal-console.yaml` غائبةٌ — ولا كتابةَ بلا ديوان.');
} else {
  /** @type {ReturnType<typeof compileCommandRoutes> | null} */
  let commandRoutes = null;
  try {
    commandRoutes = compileCommandRoutes({ dir: path.join(ROOT, 'config') });
  } catch (error) {
    violations.push(
      `T11: تعذّر اشتقاقُ مساراتِ الكتابةِ: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (commandRoutes !== null) {
    for (const route of commandRoutes) {
      if (route.method !== 'POST') {
        violations.push(`T11: مسارُ كتابةٍ بفعلٍ غيرِ POST: ${route.id}.`);
      }
      if (!route.path.startsWith('/state/console/')) {
        violations.push(`T11: مسارُ كتابةٍ خارجَ الديوانِ: ${route.id} → ${route.path}.`);
      }
    }
    // والجدولُ غيرُ فارغٍ: لا ديوانَ بلا أوامرَ.
    if (commandRoutes.length === 0) {
      violations.push('T11: لا أوامرَ مُعلَنةٌ في `config/royal-console.yaml`.');
    }
  }
}
// ولا مفتاحَ خاصّاً في الطبقةِ: التوقيعُ خارجُها.
for (const [name, source] of code) {
  if (source.includes('privateKey') || source.includes('sign(')) {
    violations.push(
      `T11: مفتاحٌ خاصٌّ أو توقيعٌ في src/transport/${name} — والنقلُ يقبلُ الموقَّعَ لا يُوقِّعُ.`,
    );
  }
}
// وجسمُ الطلبِ يُقرأُ بحدٍّ مُعلَنٍ.
if (serverCode !== '' && !serverCode.includes('MAX_COMMAND_BODY')) {
  violations.push('T11: لا حدَّ مُعلَناً لحجمِ جسمِ الأمرِ — وجسمٌ بلا حدٍّ بابُ استنزافٍ.');
}
// والاختبارُ يقيسُ الكتابةَ.
const commandTest = readFile(path.join('tests', 'transport', 'server.test.mjs'));
if (commandTest !== '') {
  /** @type {Array<[string, string]>} */
  const measuredCommand = [
    ['POST', 'لا اختبارَ للكتابةِ السياديّةِ — فما لا يُقاسُ لا يُحرسُ.'],
    ['console', 'لا ديوانَ في الاختبارِ — فالقياسُ على مُزيَّفٍ يقيسُ المُزيَّفَ.'],
    ['COMMAND_UNDECLARED', 'رفضُ أمرٍ غيرِ مُعلَنٍ غيرُ مقيسٍ.'],
    ['GATEWAY_REQUIRED', 'بلا ديوانٍ غيرُ مقيسٍ.'],
  ];
  for (const [needle, why] of measuredCommand) {
    if (!commandTest.includes(needle)) violations.push(`T11: ${why} (${needle}).`);
  }
}

// ═══ T12: وسيطُ التطويرِ الموقِّعُ مُعلَنٌ ومحدودٌ وخارجَ الإنتاجِ ═══
const proxyModule = readFile(path.join('scripts', 'dev-pop-proxy.mjs'));
if (proxyModule === '') {
  violations.push('T12: `scripts/dev-pop-proxy.mjs` غائبٌ — ومشهدٌ يُخدَمُ ولا يقرأُ دَينٌ.');
} else {
  /** @type {Array<[string, string]>} */
  const declaredInProxy = [
    ['PROXY_AUTHORITY', 'سلطةُ الوسيطِ غيرُ مُعلَنةٍ رمزاً.'],
    ['DEV_PROXY_READ_ONLY', 'لا رمزَ رفضٍ للمدى — ومدىً بلا رفضٍ مدٌّ لا حدٌّ.'],
    ['assertLoopbackHost', 'لا حراسةَ مضيفٍ محلّيٍّ.'],
    [
      "signed ? 'yes' : 'no'",
      'لا يُعلِنُ الوسيطُ أوَقَّعَ أم مرَّرَ — وإعلانٌ لا يفرِّقُ لا يُفيدُ.',
    ],
    ['authorization', 'لا تمريرَ لرمزِ المُنادي كما هو — وتوقيعٌ فوقَ رمزِ غيرِكَ انتحالٌ.'],
  ];
  for (const [needle, why] of declaredInProxy) {
    if (!proxyModule.includes(needle)) violations.push(`T12: ${why} (${needle}).`);
  }
}
// والمُشغِّلُ يُوصِلُ الحراسةَ فعلاً لا يكتفي بوجودِها.
const devRunner = readFile(path.join('scripts', 'serve-state.mjs'));
if (devRunner !== '') {
  for (const needle of ['assertLoopbackHost', 'createSigningProxyHandler', 'PROXY_HEADER']) {
    if (!devRunner.includes(needle)) {
      violations.push(`T12: المُشغِّلُ لا يُوصِلُ الوسيطَ الموقِّعَ (${needle}).`);
    }
  }
}
// والإعلانُ في الوثيقةِ وفي واجهةِ المشهدِ نفسِها — وثيقةٌ وحدَها سترٌ.
const transportDoc = readFile(path.join('docs', 'TRANSPORT.md'));
if (transportDoc !== '' && !transportDoc.includes('dev-pop-proxy.mjs')) {
  violations.push('T12: `docs/TRANSPORT.md` لا تُعلِنُ الوسيطَ الموقِّعَ ولا سلطتَهُ ومداهُ.');
}
const viewerPage = readFile(path.join('web', 'index.html'));
if (viewerPage !== '' && !viewerPage.includes('x-state-pop-proxy')) {
  violations.push(
    'T12: واجهةُ المشهدِ لا تُعلِنُ مَن يُوقِّعُ قراءتَها — والقارِئُ أحقُّ بالعلمِ.',
  );
}
// وخارجَ الإنتاجِ: لا ملفَ تحتَ `src/` يستوردُ وسيطَ تطويرٍ.
/**
 * @param {string} dir
 * @returns {string[]}
 */
function collectSourceFiles(dir) {
  /** @type {string[]} */
  const found = [];
  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectSourceFiles(full));
    else if (entry.name.endsWith('.mjs')) found.push(full);
  }
  return found;
}
for (const file of collectSourceFiles(path.join(ROOT, 'src'))) {
  if (fs.readFileSync(file, 'utf8').includes('dev-pop-proxy')) {
    violations.push(`T12: ملفُّ إنتاجٍ يستوردُ وسيطَ تطويرٍ: ${path.relative(ROOT, file)}.`);
  }
}

// ═══ T13: مسلكُ فتحِ الجلسةِ ومستهلِكُهُ الخارجيُّ ═══
const CLIENT_REL = path.join('clients', 'state-reader', 'read-state.mjs');
if (policy === null) {
  violations.push('T13: لا وثيقةَ واجهةٍ تُقرأُ — ولا اشتقاقَ لمسلكِ جلسةٍ من غيابٍ.');
} else {
  const wire =
    /** @type {{ sessionEndpoint?: { id: string, method: string, path: string } } | null} */ (
      /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (policy))['wire'] ?? null
    );
  if (wire === null || wire.sessionEndpoint === undefined) {
    violations.push(
      'T13: `config/api.yaml` لا تُعلِنُ `wire.sessionEndpoint` — ومسلكُ مصادقةٍ غيرُ مُعلَنٍ مسلكٌ مكتوبٌ يداً.',
    );
  } else {
    const endpoint = wire.sessionEndpoint;
    if (endpoint.method !== 'POST') {
      violations.push(`T13: مسلكُ فتحِ الجلسةِ بفعلٍ غيرِ POST: ${endpoint.method}.`);
    }
    if (policy.routes.some((route) => route.path === endpoint.path)) {
      violations.push(
        `T13: مسلكُ فتحِ الجلسةِ مُعلَنٌ في \`routes\` (${endpoint.path}) — ومصادقةٌ محكومةٌ بجلسةٍ لا تُفتَحُ أبداً.`,
      );
    }
    if (policy.routes.some((route) => route.id === endpoint.id)) {
      violations.push(`T13: معرِّفُ مسلكِ الفتحِ يُزاحمُ مساراً قارئاً: ${endpoint.id}.`);
    }
    // والعنوانُ لا يُكتَبُ يداً في طبقةِ النقلِ ولا في العميلِ: يُشتَقُّ.
    for (const file of [path.join('src', 'transport', 'server.mjs'), CLIENT_REL]) {
      const text = readFile(file);
      if (text !== '' && text.includes(`'${endpoint.path}'`)) {
        violations.push(`T13: عنوانُ مسلكِ الفتحِ مكتوبٌ يداً في ${file} — والاشتقاقُ أصلٌ.`);
      }
    }
  }
}
const transportServer = readFile(path.join('src', 'transport', 'server.mjs'));
if (transportServer !== '') {
  /** @type {Array<[string, string]>} */
  const derivedInServer = [
    ['compileSessionRoute', 'مسلكُ الفتحِ غيرُ مُشتَقٍّ في الخادمِ.'],
    [
      'gateway.openSession(',
      'الخادمُ لا يُنادي البوابةَ لفتحِ الجلسةِ — ونقلٌ يُصدِرُ رمزاً بنفسِهِ سلطةٌ.',
    ],
    [
      TRANSPORT_ERRORS.SESSION_UNSERVED,
      'بوابةٌ بلا فتحِ جلسةٍ بلا رمزِ رفضٍ مُسمّىً — والغيابُ يُقرأُ عَطَباً داخليّاً.',
    ],
  ];
  for (const [needle, why] of derivedInServer) {
    if (!transportServer.includes(needle)) violations.push(`T13: ${why} (${needle}).`);
  }
}
const externalClient = readFile(CLIENT_REL);
if (externalClient === '') {
  violations.push(
    `T13: ${CLIENT_REL} غائبٌ — وطبقةٌ بلا مستهلِكٍ خارجيٍّ يُقاسُ بنداءٍ هي نصُّ الدَينِ \`D-2\`.`,
  );
} else {
  // **خارجٌ فعلاً:** كلُّ استيرادٍ من `src/` غيرِ صياغةِ التوقيعِ يُبطِلُ الشهادةَ.
  for (const match of externalClient.matchAll(/from\s+'([^']*src\/[^']*)'/g)) {
    const target = match[1] ?? '';
    if (!target.endsWith('src/api/pop-canonical.mjs')) {
      violations.push(
        `T13: المستهلِكُ الخارجيُّ يستوردُ من الداخلِ: ${target} — والمقبولُ صياغةُ التوقيعِ وحدَها.`,
      );
    }
  }
  if (/['"][^'"]*config\//.test(externalClient)) {
    violations.push(
      'T13: المستهلِكُ الخارجيُّ يقرأُ من `config/` — وما لم يُنشَرْ في العقدِ لا سبيلَ له إليه.',
    );
  }
  /** @type {Array<[string, string]>} */
  const declaredInClient = [
    ['API_CONTRACT', 'العميلُ لا يقرأُ العقدَ المنشورَ.'],
    ['canonicalOpenPayload', 'العميلُ لا يُوقِّعُ حمولةَ الفتحِ من الموضعِ الواحدِ.'],
    ['canonicalCallPayload', 'العميلُ لا يُوقِّعُ حمولةَ النداءِ من الموضعِ الواحدِ.'],
  ];
  for (const [needle, why] of declaredInClient) {
    if (!externalClient.includes(needle)) violations.push(`T13: ${why} (${needle}).`);
  }
}
// واختبارٌ يقيسُ النداءَ عمليَّتَينِ منفصلتَينِ — وشاهدٌ في العمليّةِ نفسِها ليس شاهداً.
const clientTest = readFile(path.join('tests', 'tooling', 'state-read-client.test.mjs'));
if (clientTest === '') {
  violations.push(
    'T13: `tests/tooling/state-read-client.test.mjs` غائبٌ — وإغلاقٌ بلا قياسٍ ادّعاءٌ.',
  );
} else {
  /** @type {Array<[string, string]>} */
  const measuredInTest = [
    ['spawn(', 'الاختبارُ لا يُشغِّلُ الطرفَينِ عمليَّتَينِ منفصلتَينِ.'],
    ['API_POP_INVALID', 'لا قياسَ لتوقيعٍ بمفتاحٍ غيرِ المُسجَّلِ.'],
    ['API_IDENTITY_UNVERIFIED', 'لا قياسَ لفاعلٍ غيرِ مُسجَّلٍ.'],
  ];
  for (const [needle, why] of measuredInTest) {
    if (!clientTest.includes(needle)) violations.push(`T13: ${why} (${needle}).`);
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز طبقة النقل رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const routeCount = policy === null ? 0 : policy.routes.length;
const commandRouteCount = /** @type {ReturnType<typeof compileCommandRoutes>} */ (
  (() => {
    try {
      return compileCommandRoutes({ dir: path.join(ROOT, 'config') });
    } catch {
      return [];
    }
  })()
).length;
console.log(
  `✅ حاجز طبقة النقل: ${routeCount} مساراً قارئاً كلُّها مُشتَقّةٌ من \`config/api.yaml\` متقابلةً في الاتجاهين بلا عنوانٍ مكتوبٍ يداً ولا شكلٍ متنازَعٍ، ولا فعلَ غيرَ \`GET\` في القراءةِ ولا نداءَ كاتبٍ، ولا مستودعَ ولا قاعدةَ ولا نقطةَ تفويضٍ في يدِ النقلِ بل \`gateway.call\` للقراءةِ و\`console.issue\` للكتابةِ، و${Object.keys(STATUS_BY_CODE).length} رمزَ رفضٍ لكلٍّ ترجمةُ حالةِ خطأٍ متقابلةً في الاتجاهين، وبلا اعتمادِ npm واحدٍ، والرمزُ من ترويسةٍ لا من مُلحقٍ، والملفّاتُ بامتداداتٍ مُعلَنةٍ تحتَ جذرٍ محقَّقٍ، وإنهاءُ TLS بتحقُّقٍ مُثبَّتٍ على \`true\` بلا سبيلِ إسقاطٍ ولا رجوعٍ إلى نصٍّ عندَ نقصِ المادّةِ، ولا مادّةَ مفاتيحَ في الشجرةِ، و${commandRouteCount} مسارَ كتابةٍ سياديّةٍ مُشتَقّةٍ من \`config/royal-console.yaml\` بلا عنوانٍ مكتوبٍ يداً ولا مفتاحٍ خاصٍّ في الطبقةِ وجسمٍ بحدٍّ مُعلَنٍ، ومشهدُ الويبِ يقرأُ بوسيطٍ موقِّعٍ مُعلَنِ السُّلطةِ والمدى مربوطٍ بالمضيفِ المحلّيِّ وحدَهُ خارجَ شجرةِ الإنتاجِ، ومسلكُ فتحِ الجلسةِ مُشتَقٌّ من \`wire.sessionEndpoint\` خارجَ جدولِ القراءةِ يُنادي \`gateway.openSession\` ولهُ رمزُ رفضٍ حينَ لا تُخدَمُ الجلسةُ، ومستهلِكٌ خارجيٌّ لا يستوردُ من الداخلِ إلا صياغةَ التوقيعِ ولا يقرأُ إلا العقدَ المنشورَ ويُقاسُ بنداءٍ في عمليّتَينِ منفصلتَينِ.`,
);
