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
 *   T2: قارئةٌ فقط: لا فعلَ غيرَ `GET` في الوثيقةِ ولا في الجدولِ، ولا نداءَ كاتبٍ
 *       (`.insert(` `.update(` `.remove(` `.upsert(`) في الطبقةِ، ولا جسمَ طلبٍ
 *       يُقرأُ (`req.on('data'`).
 *   T3: لا سلطةَ في النقلِ: لا مستودعَ ولا قاعدةَ ولا نقطةَ تفويضٍ في يدِ الطبقةِ،
 *       ولا نداءَ إلا عبرَ `gateway.call`. فطبقةٌ تقرأُ القاعدةَ مباشرةً تُخرِجُ
 *       القراءةَ من العقباتِ الخمسِ كلِّها.
 *   T4: كلُّ رمزِ رفضٍ في `API_ERRORS` و`TRANSPORT_ERRORS` له ترجمةُ حالةٍ مُعلَنةٌ،
 *       ولا ترجمةَ لرمزٍ غيرِ مُعلَنٍ — **في الاتجاهين**. فرمزٌ بلا ترجمةٍ يُسلَّمُ
 *       بحالةٍ مخمَّنةٍ، و`200` على رفضٍ أسوأُ من انقطاعٍ.
 *   T5: بلا اعتمادِ npm واحدٍ: كلُّ استيرادٍ في الطبقةِ إمّا `node:` وإمّا نسبيٌّ.
 *   T6: الرمزُ لا يُقرأُ من مُلحقِ استعلامٍ — المُلحقاتُ تُكتَبُ في سجلّاتِ
 *       الوسائطِ وتاريخِ المتصفِّحِ فيُسرَّبُ الرمزُ — ولا يُخدَمُ ملفٌّ خارجَ
 *       الجذرِ ولا امتدادٌ غيرُ مُعلَنٍ.
 *   T7: الاختبارُ موجودٌ ويقيسُ الرفضَ لا المرورَ فقط: `401` و`403` و`404` و`405`.
 *
 * **حدٌّ مُعلَنٌ:** الحاجزُ يقرأُ النصَّ والوثيقةَ ولا يفتحُ مِقبساً، وإنهاءُ TLS
 * خارجَ ما تُدَّعيه هذه الطبقةُ أصلاً (وهي تُعلِنُه بترويسةٍ صريحةٍ)، فلا يُقاسُ
 * هنا شيءٌ عن TLS كي لا يُوهِمَ حاجزٌ بضمانٍ لا يَملِكُه.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { API_ERRORS, loadApiPolicy } from '../src/api/gateway.mjs';
import { STATUS_BY_CODE, TRANSPORT_ERRORS } from '../src/transport/problem.mjs';
import { compileRoutes, matchRoute } from '../src/transport/router.mjs';

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

// ═══ T2: قارئةٌ فقط ═══
if (policy !== null) {
  for (const route of policy.routes) {
    if (route.method !== 'GET') violations.push(`T2: مسارٌ بفعلٍ كاتبٍ في الوثيقةِ: ${route.id}.`);
  }
}
for (const [name, source] of code) {
  for (const needle of ['.insert(', '.update(', '.remove(', '.upsert(']) {
    if (source.includes(needle))
      violations.push(`T2: نداءٌ كاتبٌ في src/transport/${name}: ${needle}.`);
  }
  if (/\.on\(\s*['"]data['"]/.test(source)) {
    violations.push(`T2: جسمُ طلبٍ يُقرأُ في src/transport/${name} — والطبقةُ لا تُعلِنُ جسماً.`);
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

// ═══ T4: خريطةُ الحالاتِ تامّةٌ في الاتجاهين ═══
const knownCodes = /** @type {Set<string>} */ (
  new Set([...Object.values(API_ERRORS), ...Object.values(TRANSPORT_ERRORS)])
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
if (serverCode !== '' && !/headers\[\s*'authorization'\s*\]/.test(serverCode)) {
  violations.push('T6: الرمزُ لا يُقرأُ من ترويسةِ `Authorization` — فمن أينَ يُقرأُ؟');
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

if (violations.length > 0) {
  console.error('⛔ حاجز طبقة النقل رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const routeCount = policy === null ? 0 : policy.routes.length;
console.log(
  `✅ حاجز طبقة النقل: ${routeCount} مساراً قارئاً كلُّها مُشتَقّةٌ من \`config/api.yaml\` متقابلةً في الاتجاهين بلا عنوانٍ مكتوبٍ يداً ولا شكلٍ متنازَعٍ، ولا فعلَ غيرَ \`GET\` ولا جسمَ طلبٍ يُقرأُ، ولا مستودعَ ولا قاعدةَ ولا نقطةَ تفويضٍ في يدِ النقلِ بل \`gateway.call\` وحدَه، و${Object.keys(STATUS_BY_CODE).length} رمزَ رفضٍ لكلٍّ ترجمةُ حالةِ خطأٍ متقابلةً في الاتجاهين، وبلا اعتمادِ npm واحدٍ، والرمزُ من ترويسةٍ لا من مُلحقٍ، والملفّاتُ بامتداداتٍ مُعلَنةٍ تحتَ جذرٍ محقَّقٍ.`,
);
