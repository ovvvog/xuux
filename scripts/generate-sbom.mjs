#!/usr/bin/env node
// مولِّد SBOM — M11.02
//
// يولِّد قائمة مكوّنات البرمجيات (SBOM) بصيغة CycloneDX باستخدام `npm sbom`.
// يُشغَّل في CI قبل حاجز سلسلة التوريد، ويُنتج `sbom.cdx.json` في جذر المستودع.
// ‏WL-575: يُزيلُ SBOM السابقَ قبلَ التوليد، ويختمُ الجديدَ ببصمةِ SHA-256 لبايتاتِ `package-lock.json` الخامِ في
// ‏`metadata.properties` (‏`xuux:lockfileSha256` — مسارُ الامتدادِ القياسيُّ في CycloneDX)، ويكتبُه ذرّيّاً (‏مؤقّتٌ ثمّ rename)،
// ‏ويفشلُ بلا SBOM إن تغيّرَ القفلُ أثناءَ التوليد (‏بصمةً أو توقيعَ stat ‏bigint: dev/ino/size/mtimeNs/ctimeNs — فلا يُخفيه ABA)؛ و R2 في guard:supply-chain يرفضُ SBOM غيرَ مربوطٍ بالقفلِ الحاليّ.

import { readFileSync, writeFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { lockDigest } from './audit-check.mjs';

/** WL-575: اسمُ خاصّيّةِ الربطِ في `metadata.properties`. */
export const SBOM_LOCK_PROPERTY = 'xuux:lockfileSha256';
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * WL-575: توقيعُ ملفِّ القفل — stat بـbigint: الجهازُ وinode والحجمُ وmtime وctime بالنانوثانية.
 * ‏ctime لا تضبطُه واجهةُ مستخدم (‏utimes تضبطُ atime/mtime وحدَهما)، فإعادةُ البايتاتِ ووقتِ التعديلِ الأصليّين (‏ABA) لا تُخفي
 * ‏تغيّراً وقعَ بينَ قراءتين — في حدودِ دقّةِ ساعةِ نظامِ الملفّات. يرمي إن تعذّرَ الفحص.
 * @param {string} filePath @returns {string}
 */
export function lockSignature(filePath) {
  const s = statSync(filePath, { bigint: true });
  return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
}

/**
 * WL-575: عيّنةٌ متماسكةٌ من القفل — stat ‏(‏bigint) ثمّ قراءةُ البايتاتِ الخام ثمّ stat ثانٍ؛ اختلافُ التوقيعين ⇒ يرمي (‏تغيّرٌ أثناءَ
 * ‏القراءة، ومنه ABA يُعيدُ البايتاتِ وmtime فلا يُرى إلّا في ctimeNs). البصمةُ للبايتاتِ المقروءةِ فعلاً بينَ التوقيعين المتطابقين.
 * ‏تعذّرُ stat أو القراءةِ يرمي كذلك. لا تعني العيّنةُ أنَّ القفلَ لن يتغيّرَ بعدَها.
 * @param {string} lockPath @returns {{ signature: string, digest: string, bytes: Buffer }}
 */
export function readStableLock(lockPath) {
  const signature = lockSignature(lockPath);
  const bytes = readFileSync(lockPath);
  if (lockSignature(lockPath) !== signature) {
    throw new Error('عيّنةُ القفلِ غيرُ مستقرّة: package-lock.json تغيّرَ أثناءَ قراءتِه');
  }
  return { signature, digest: lockDigest(bytes), bytes };
}

/**
 * WL-575: هل القفلُ هو نفسُه الآن؟ عيّنةٌ متماسكةٌ (‏`readStableLock`) توقيعُها وبصمتُها مساويان لخطِّ الأساس؛ عيّنةٌ غيرُ
 * ‏مستقرّةٍ أو تعذّرُ الفحصِ أو القراءة ⇒ false (‏فشلٌ مغلق).
 * @param {string} lockPath @param {{ signature: string, digest: string }} baseline عيّنةُ ما قبلَ `npm sbom`
 * @returns {boolean}
 */
function lockUnchanged(lockPath, baseline) {
  try {
    const now = readStableLock(lockPath);
    return now.signature === baseline.signature && now.digest === baseline.digest;
  } catch {
    return false;
  }
}

/** @param {unknown} x @returns {x is Record<string, any>} */
const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * WL-575: يُضيفُ خاصّيّةَ الربطِ إلى `metadata.properties` دونَ مسِّ بقيّةِ SBOM (‏ولا الأصل)؛ ويرمي إن وُجدَت سابقاً.
 * @param {Record<string, any>} sbom ناتجُ `npm sbom` @param {Buffer} lockBytes بايتاتُ القفلِ الذي وُلِّدَ عليه
 */
export function stampSbom(sbom, lockBytes) {
  const metadata = isObj(sbom.metadata) ? sbom.metadata : {};
  const properties = Array.isArray(metadata.properties) ? metadata.properties : [];
  if (properties.some((p) => isObj(p) && p.name === SBOM_LOCK_PROPERTY)) {
    throw new Error(`SBOM يحملُ ${SBOM_LOCK_PROPERTY} قبلَ الختم`);
  }
  return {
    ...sbom,
    metadata: {
      ...metadata,
      properties: [...properties, { name: SBOM_LOCK_PROPERTY, value: lockDigest(lockBytes) }],
    },
  };
}

/**
 * WL-575: هل SBOM مربوطٌ بالقفلِ الحاليّ؟ '' أو سببُ الرفض. خاصّيّةٌ واحدةٌ بالضبطِ في `metadata.properties`.
 * @param {any} sbom @param {Buffer | null} lockBytes بايتاتُ `package-lock.json` الحاليّ (‏null إن غاب)
 * @returns {string}
 */
export function checkSbomBinding(sbom, lockBytes) {
  if (!isObj(sbom)) return 'SBOM ليس كائناً';
  if (!isObj(sbom.metadata)) return '`metadata` غائبةٌ أو ليست كائناً';
  const properties = sbom.metadata.properties;
  if (!Array.isArray(properties)) return '`metadata.properties` غائبةٌ أو ليست مصفوفة';
  if (!properties.every((p) => isObj(p) && typeof p.name === 'string')) {
    return '`metadata.properties` فيها عنصرٌ ليس كائناً باسمٍ نصّيّ';
  }
  const hits = properties.filter((p) => isObj(p) && p.name === SBOM_LOCK_PROPERTY);
  if (hits.length === 0) return `خاصّيّةُ \`${SBOM_LOCK_PROPERTY}\` غائبة`;
  if (hits.length > 1) return `خاصّيّةُ \`${SBOM_LOCK_PROPERTY}\` مكرّرة`;
  const value = hits[0]?.value;
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) {
    return `قيمةُ \`${SBOM_LOCK_PROPERTY}\` ليست SHA-256 بـ 64 حرفاً hex صغيراً`;
  }
  if (lockBytes === null) return '`package-lock.json` غائبٌ فلا يُطابَق';
  if (value !== lockDigest(lockBytes)) {
    return 'بصمةُ SBOM لا تطابقُ `package-lock.json` الحاليّ (‏وُلِّدَ على قفلٍ آخر)';
  }
  return '';
}

// ─── WL-576: مطابقةُ مكوّناتِ SBOM لشجرةِ القفل ───────────────────────────────
// المرجعُ هو سلوكُ npm نفسِه (‏lib/utils/sbom-cyclonedx.js في npm 10.8.2): كلُّ عقدةٍ غيرِ جذريّةٍ وغيرِ
// رابطٍ مكوّنٌ واحد، و`cdx:npm:package:path` هو موقعُها = مفتاحُها في `packages`. فالمطابقةُ بالمسار
// (‏لا بالاسمِ وحدَه) ثمّ تُشتقُّ هويّةُ المكوّنِ كاملةً من مدخلةِ القفلِ وتُقارَن حقلاً حقلاً.
/** خصائصُ npm المعروفة؛ أيُّ خاصّيّةٍ أخرى في مكوّنٍ تُرفَض (‏لا تُتجاهَل). */
const NPM_PROP = {
  path: 'cdx:npm:package:path',
  development: 'cdx:npm:package:development',
  bundled: 'cdx:npm:package:bundled',
  private: 'cdx:npm:package:private',
  extraneous: 'cdx:npm:package:extraneous',
};
const KNOWN_PROPS = new Set(Object.values(NPM_PROP));
const SRI_ALG = { sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };
/** مسارُ تثبيتٍ تحتَ node_modules بتداخلٍ اختياريّ؛ لا مقطعَ يبدأُ بـ `.` (‏فلا `..`). */
const SEG = '(?:@[^/@.][^/]*/)?[^/@.][^/]*';
const NM_PATH = new RegExp(`^node_modules/${SEG}(?:/node_modules/${SEG})*$`);
const NM_MARK = 'node_modules/';
const MAX_REASONS = 5;

/** @param {unknown} x */
const nonEmpty = (x) => typeof x === 'string' && x.length > 0;

/**
 * مدخلاتُ القفلِ القابلةُ للمطابقة: كلُّ مفتاحٍ سوى الجذرِ `""` وسوى الروابط (‏`link: true`) التي يستبعدُها npm.
 * @param {Record<string, any>} packages @param {string[]} problems
 * @returns {Map<string, Record<string, any>>}
 */
function matchableEntries(packages, problems) {
  const out = new Map();
  for (const [key, entry] of Object.entries(packages)) {
    if (key === '') continue;
    if (!isObj(entry)) {
      problems.push(`مدخلةُ القفل «${key}» ليست كائناً`);
      continue;
    }
    if (entry.link === true) {
      // الرابطُ يشيرُ إلى هدفٍ خارجَ node_modules (‏مساحةُ عمل/file:) — غيرُ مدعومٍ هنا فيُغلَقُ الحكم.
      problems.push(`مدخلةُ القفل «${key}» رابطٌ (\`link\`) — غيرُ مدعومةٍ في المطابقة`);
      continue;
    }
    if (!NM_PATH.test(key)) {
      problems.push(`مدخلةُ القفل «${key}» خارجَ node_modules — غيرُ قابلةٍ للمطابقة`);
      continue;
    }
    if (!nonEmpty(entry.version)) {
      problems.push(`مدخلةُ القفل «${key}» بلا إصدارٍ نصّيّ`);
      continue;
    }
    out.set(key, entry);
  }
  return out;
}

/** بصماتُ SRI في القفل → مجموعةُ `ALG:hex`؛ null إن كانت غيرَ قابلةٍ للتفسير. @param {string} sri */
function sriHashes(sri) {
  const out = new Set();
  for (const token of sri.split(/\s+/).filter(Boolean)) {
    const dash = token.indexOf('-');
    const alg = SRI_ALG[/** @type {keyof typeof SRI_ALG} */ (token.slice(0, dash))];
    const b64 = token.slice(dash + 1).split('?')[0] ?? '';
    if (dash <= 0 || !alg || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
    out.add(`${alg}:${Buffer.from(b64, 'base64').toString('hex')}`);
  }
  return out.size > 0 ? out : null;
}

/**
 * يقارنُ مكوّناً واحداً بمدخلتِه في القفل؛ يُرجعُ أسبابَ الرفض.
 * @param {Record<string, any>} c @param {string} key @param {Record<string, any>} entry
 */
function componentMismatches(c, key, entry) {
  const why = [];
  const folder = key.slice(key.lastIndexOf(NM_MARK) + NM_MARK.length);
  // الاسمُ = اسمُ المجلّد (‏node.name)؛ اسمُ الحزمةِ الحقيقيّ = `name` في المدخلة إن وُجد (‏الأسماءُ المستعارة).
  const pkgName = nonEmpty(entry.name) ? entry.name : folder;
  const version = entry.version;
  if (c.name !== folder) why.push(`الاسمُ «${c.name}» ≠ «${folder}»`);
  if (c.version !== version) why.push(`الإصدارُ «${c.version}» ≠ «${version}»`);
  const purl = `pkg:npm/${pkgName.replace(/^@/, '%40')}@${version}`;
  if (c.purl !== purl) why.push(`purl «${c.purl}» ≠ «${purl}»`);
  if (c['bom-ref'] !== `${pkgName}@${version}`)
    why.push(`bom-ref «${c['bom-ref']}» ≠ «${pkgName}@${version}»`);
  const optional = entry.dev === true || entry.optional === true || entry.devOptional === true;
  const scope = optional ? 'optional' : 'required';
  if (c.scope !== scope) why.push(`scope «${c.scope}» ≠ «${scope}»`);
  const props = new Map((c.properties ?? []).map((/** @type {any} */ p) => [p.name, p.value]));
  /** @type {[string, boolean][]} */
  const flags = [
    [NPM_PROP.development, entry.dev === true],
    [NPM_PROP.bundled, entry.inBundle === true],
  ];
  for (const [name, want] of flags) {
    const has = props.has(name);
    if (has && props.get(name) !== 'true') why.push(`قيمةُ ${name} ليست "true"`);
    else if (has !== want) why.push(`${name} ${has ? 'زائدةٌ' : 'غائبةٌ'} خلافاً للقفل`);
  }
  if (props.has(NPM_PROP.private) && props.get(NPM_PROP.private) !== 'true') {
    why.push(`قيمةُ ${NPM_PROP.private} ليست "true"`);
  }
  // المصدر: مرجعُ توزيعٍ واحدٌ = `resolved` بالضبط، أو لا مرجعَ إن غاب من القفل.
  const refs = c.externalReferences ?? [];
  if (!Array.isArray(refs) || !refs.every((r) => isObj(r) && typeof r.type === 'string')) {
    why.push('`externalReferences` ليست مصفوفةَ كائناتٍ بنوعٍ نصّيّ');
  } else {
    const dist = refs.filter((r) => r.type === 'distribution').map((r) => r.url);
    const want = nonEmpty(entry.resolved) ? [entry.resolved] : [];
    if (dist.length !== want.length || dist.some((u, i) => u !== want[i])) {
      why.push(`مرجعُ التوزيعِ ${JSON.stringify(dist)} ≠ resolved ${JSON.stringify(want)}`);
    }
  }
  // السلامة: بصمةٌ واحدةٌ من بصماتِ `integrity`، أو لا بصمةَ إن غابت من القفل.
  const hashes = c.hashes ?? [];
  if (
    !Array.isArray(hashes) ||
    !hashes.every((h) => isObj(h) && nonEmpty(h.alg) && nonEmpty(h.content))
  ) {
    why.push('`hashes` ليست مصفوفةَ بصماتٍ صالحة');
  } else if (entry.integrity === undefined) {
    if (hashes.length > 0) why.push('بصمةٌ في SBOM والقفلُ بلا integrity');
  } else {
    const want = typeof entry.integrity === 'string' ? sriHashes(entry.integrity) : null;
    if (want === null) why.push('integrity في القفلِ غيرُ قابلةٍ للتفسير');
    else if (hashes.length !== 1 || !want.has(`${hashes[0].alg}:${hashes[0].content}`)) {
      why.push('البصمةُ لا تطابقُ integrity في القفل');
    }
  }
  return why;
}

/**
 * WL-576: هل مكوّناتُ SBOM وإصداراتُها ممثَّلةٌ فعلاً في شجرةِ القفل، وهل كلُّ مدخلةٍ مطلوبةٍ ممثَّلة؟
 * لا يرمي أبداً. `omittedOptional` مدخلاتٌ اختياريّةٌ غائبةٌ عن SBOM — مسموحةٌ لكن تُعلَنُ (‏لا تُسكَت).
 * @param {any} sbom @param {any} lock كائنُ `package-lock.json` المحلَّل (‏null إن غاب أو فسد)
 * @returns {{ problems: string[], omittedOptional: string[] }}
 */
export function checkSbomComponents(sbom, lock) {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const omittedOptional = [];
  if (!isObj(sbom) || !Array.isArray(sbom.components)) return { problems, omittedOptional };
  if (!isObj(lock) || !isObj(lock.packages)) {
    problems.push('`package-lock.json` غائبٌ أو بلا `packages` فلا تُطابَقُ المكوّنات');
    return { problems, omittedOptional };
  }
  if (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) {
    problems.push(`lockfileVersion ${String(lock.lockfileVersion)} غيرُ مدعومٍ (‏2 أو 3)`);
    return { problems, omittedOptional };
  }
  const entries = matchableEntries(lock.packages, problems);
  /** @type {Set<string>} */
  const seen = new Set();
  sbom.components.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
    const label = isObj(c) ? `#${i} ${String(c.name)}@${String(c.version)}` : `#${i}`;
    if (!isObj(c)) return void problems.push(`${label}: ليس كائناً`);
    if (c.type !== 'library') return void problems.push(`${label}: النوعُ «${c.type}» ليس library`);
    if (!nonEmpty(c.name) || !nonEmpty(c.version) || !nonEmpty(c.purl)) {
      return void problems.push(`${label}: هويّةٌ ناقصة (‏name/version/purl)`);
    }
    const props = c.properties;
    if (
      !Array.isArray(props) ||
      !props.every((p) => isObj(p) && nonEmpty(p.name) && typeof p.value === 'string')
    ) {
      return void problems.push(`${label}: \`properties\` غائبةٌ أو غيرُ صالحة`);
    }
    const unknown = props.filter((p) => !KNOWN_PROPS.has(p.name)).map((p) => p.name);
    if (unknown.length > 0)
      return void problems.push(`${label}: خصائصُ غيرُ معروفة ${unknown.join('، ')}`);
    if (props.some((p) => p.name === NPM_PROP.extraneous)) {
      return void problems.push(`${label}: مكوّنٌ دخيلٌ (\`extraneous\`) ليس في القفل`);
    }
    const names = props.map((p) => p.name);
    if (new Set(names).size !== names.length)
      return void problems.push(`${label}: خاصّيّةٌ مكرّرة`);
    const pathProp = props.find((p) => p.name === NPM_PROP.path);
    if (!pathProp) return void problems.push(`${label}: بلا \`${NPM_PROP.path}\` — هويّةٌ ملتبسة`);
    const key = pathProp.value;
    if (seen.has(key)) return void problems.push(`${label}: المسارُ «${key}» مكرّرٌ في SBOM`);
    seen.add(key);
    const entry = entries.get(key);
    if (!entry)
      return void problems.push(`${label}: المسارُ «${key}» ليس مدخلةً قابلةً للمطابقةِ في القفل`);
    const why = componentMismatches(c, key, entry);
    if (why.length > 0) problems.push(`${label} («${key}»): ${why.join('، ')}`);
  });
  for (const [key, entry] of entries) {
    if (seen.has(key)) continue;
    if (entry.optional === true || entry.devOptional === true) omittedOptional.push(key);
    else problems.push(`مدخلةُ القفل «${key}@${entry.version}» مطلوبةٌ وغائبةٌ عن SBOM`);
  }
  return { problems, omittedOptional };
}

/** نصُّ مخالفةِ R2 من الأسباب (‏أوّلُ خمسةٍ ثمّ العدد). @param {string[]} problems */
export function formatComponentProblems(problems) {
  const head = problems.slice(0, MAX_REASONS).join('؛ ');
  const rest = problems.length - MAX_REASONS;
  return rest > 0 ? `${head}؛ (‏و${rest} أخرى من ${problems.length})` : head;
}

function main() {
  const rootIndex = process.argv.indexOf('--root');
  const repoRoot =
    rootIndex === -1 ? process.cwd() : (process.argv[rootIndex + 1] ?? process.cwd());

  console.log('═══ توليد SBOM (M11.02) ═══');

  const outPath = path.join(repoRoot, 'sbom.cdx.json');
  const tmpPath = `${outPath}.${process.pid}.tmp`;
  try {
    // ‏WL-575: أبطِلِ السابقَ قبلَ أيِّ شيء — فشلٌ لاحقٌ لا يتركُ SBOM قديماً يبدو صالحاً.
    rmSync(outPath, { force: true });
    const lockPath = path.join(repoRoot, 'package-lock.json');
    // ‏WL-575: خطُّ الأساسِ عيّنةٌ متماسكةٌ أيضاً — غيرُ المستقرّةِ ترمي ⇒ «فشل توليد SBOM» بلا SBOM.
    const baseline = readStableLock(lockPath);
    const output = execSync('npm sbom --sbom-format cyclonedx --json', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const sbom = JSON.parse(output);
    // ‏WL-575: القفلُ قبلَ التوليدِ هو نفسُه بعدَه (‏بصمةً وتوقيعَ stat كاملاً) — وإلا فالـSBOM لا يُنسَبُ لقفل؛
    // ‏وتعذّرُ الفحصِ أو القراءةِ بعدَه تغيّرٌ (‏فشلٌ مغلق). الفحصُ الأوّلُ من اثنين مستقلّين.
    if (!lockUnchanged(lockPath, baseline)) {
      console.error(
        '⛔ package-lock.json تغيّرَ أثناءَ توليدِ SBOM — لا SBOM. أعِدْ `npm run gen:sbom` بعدَ استقرارِ القفل.',
      );
      process.exit(1);
    }
    writeFileSync(tmpPath, JSON.stringify(stampSbom(sbom, baseline.bytes), null, 2) + '\n');
    // ‏WL-575: الفحصُ الثاني — بعدَ اكتمالِ المؤقّتِ وإغلاقِه وقبلَ rename مباشرةً (‏لا عملَ بينهما): تغيّرٌ بعدَ الفحصِ الأوّل
    // ‏(‏أثناءَ الختمِ أو الكتابة) ⇒ المؤقّتُ يُزالُ ولا يُعتمَد. يُضيِّقُ نافذةَ TOCTOU ولا يُلغيها: القفلُ وSBOM ليسا معاملةً واحدة.
    if (!lockUnchanged(lockPath, baseline)) {
      rmSync(tmpPath, { force: true });
      console.error(
        '⛔ package-lock.json تغيّرَ أثناءَ كتابةِ SBOM — لا SBOM. أعِدْ `npm run gen:sbom` بعدَ استقرارِ القفل.',
      );
      process.exit(1);
    }
    renameSync(tmpPath, outPath);
    console.log(`✅ SBOM مُولَّدٌ: ${outPath} (${sbom.components?.length ?? 0} مكوّن)`);
  } catch (error) {
    // ‏WL-575: لا يبقى مؤقّتٌ نصفُ مكتوبٍ بعدَ فشلٍ في الكتابةِ أو rename.
    rmSync(tmpPath, { force: true });
    console.error('⛔ فشل توليد SBOM:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
