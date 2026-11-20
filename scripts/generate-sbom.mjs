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
/** طولُ الملخّصِ بالبايتِ لكلِّ خوارزميّة — ما سواه ليس ملخّصاً صالحاً (‏مثلاً `sha512-YQ` بايتٌ واحد). */
const SRI_BYTES = { sha1: 20, sha256: 32, sha384: 48, sha512: 64 };
/** ترتيبُ القوّةِ كما في ssri (‏‏pickAlgorithm)؛ npm sbom يأخذُ الأقوى. */
const SRI_STRENGTH = ['sha1', 'sha256', 'sha384', 'sha512'];
/** رمزُ SRI بلا خيارات `?`: خوارزميّةٌ معروفةٌ ثمّ Base64 قياسيٌّ بحشوٍ كامل. */
const SRI_TOKEN = /^(sha1|sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/;
/** السجلُّ الافتراضيُّ الوحيدُ المدعوم — أيُّ مصدرٍ آخرَ (‏git، ملفّ، سجلٌّ آخر، http) يُرفَض صراحةً. */
const DEFAULT_REGISTRY_HOST = 'registry.npmjs.org';
/** اسمُ حزمةٍ npm (‏نطاقيٌّ اختياريّاً) بلا مقاطعَ تبدأُ بنقطةٍ أو شرطةٍ سفليّة. */
const PKG_NAME = /^(?:@[A-Za-z0-9~-][A-Za-z0-9._~-]*\/)?[A-Za-z0-9~-][A-Za-z0-9._~-]*$/;
/** إصدارٌ آمنٌ داخلَ مسارِ URL (‏لا فواصلَ ولا ترميزَ ولا `..` ولا فراغ). */
const SAFE_VERSION = /^(?!.*\.\.)[A-Za-z0-9.+_-]+$/;
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

/**
 * WL-576: يفسّرُ `integrity` في القفلِ تفسيراً صارماً، ويُرجعُ بصمةَ أوّلِ رمزٍ sha512 بصيغة `ALG:hex`، أو سببَ الرفض.
 * تصحيحٌ (‏مراجعةُ fd47091c): ‏`ssri.parse(…, {single: true})` في ssri 10 (‏npm 10.8) لا يختارُ الأقوى بل يبني Hash من
 * النصِّ كلِّه بخوارزميّةِ الرمزِ الأوّل: إن كان sha512 طابقَت بصمةُ SBOM أوّلَ رمزٍ sha512 (‏Node يقفُ عندَ الحشو) فيُقبَل،
 * وإلّا (‏sha1 أو sha256 أوّلاً) خرجت بخوارزميّةٍ أخرى فيُرفَضُ المكوّنُ مغلقاً — لا تجاوزَ في الحالين. القفلُ الحقيقيُّ
 * رمزٌ واحدٌ sha512 لكلِّ مدخلة.
 * @param {unknown} sri @returns {{ hash: string } | { error: string }}
 */
export function parseSri(sri) {
  if (typeof sri !== 'string') return { error: 'integrity ليست نصّاً' };
  const tokens = sri.split(/[ \t\n\r\f]+/).filter(Boolean);
  if (tokens.length === 0) return { error: 'integrity فارغة' };
  /** @type {Map<string, string>} */
  const first = new Map();
  for (const token of tokens) {
    const m = SRI_TOKEN.exec(token);
    if (!m) return { error: `رمزُ SRI «${token.slice(0, 24)}» غيرُ صالحِ الصيغة` };
    const alg = /** @type {keyof typeof SRI_BYTES} */ (m[1]);
    const b64 = /** @type {string} */ (m[2]);
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.toString('base64') !== b64) {
      return { error: `رمزُ ${alg} ليس Base64 قانونيّاً (‏حشوٌ أو ترميزٌ مشوّه)` };
    }
    if (bytes.length !== SRI_BYTES[alg]) {
      return { error: `ملخّصُ ${alg} بطول ${bytes.length} بايت ≠ ${SRI_BYTES[alg]}` };
    }
    if (!first.has(alg)) first.set(alg, bytes.toString('hex'));
  }
  const strongest = SRI_STRENGTH.filter((a) => first.has(a)).pop();
  if (strongest !== 'sha512') {
    return { error: `أقوى خوارزميّةٍ ${String(strongest)} — مطلوبٌ sha512` };
  }
  return { hash: `${SRI_ALG.sha512}:${first.get('sha512')}` };
}

/**
 * WL-576: سياسةُ المصدر — السجلُّ الافتراضيُّ وحدَه وبرابطِ tarball القانونيِّ للحزمةِ والإصدارِ بالضبط.
 * git وgithub: وfile: والمساراتُ المحلّيّةُ وhttp والسجلّاتُ الأخرى تُرفَضُ صراحةً حتّى لو طابقَ SBOM القفل.
 * المدمجُ (‏`inBundle`) بلا resolved ولا integrity كما يكتبُه npm؛ وأيُّ مدخلةٍ أخرى بلا resolved مصدرُها
 * غيرُ محدَّدٍ (‏يُحَلُّ من إعدادِ السجلِّ وقتَ التثبيت) فتُرفَض.
 * @param {Record<string, any>} entry @param {string} pkgName @returns {string} سببُ الرفضِ أو ''
 */
export function sourceProblem(entry, pkgName) {
  const resolved = entry.resolved;
  if (entry.inBundle === true) {
    return resolved === undefined && entry.integrity === undefined
      ? ''
      : 'مدمجةٌ (‏inBundle) بمصدرٍ أو بصمةٍ — غيرُ مدعومة';
  }
  if (!nonEmpty(resolved)) return 'بلا `resolved` — مصدرٌ غيرُ محدَّد';
  if (/^(?:git\+|git:|github:|gitlab:|bitbucket:|gist:)/i.test(resolved)) {
    return `مصدرُ git «${resolved}» — غيرُ مدعوم`;
  }
  if (/^file:/i.test(resolved) || !/^[a-z][a-z0-9+.-]*:\/\//i.test(resolved)) {
    return `مصدرٌ محلّيٌّ «${resolved}» — غيرُ مدعوم`;
  }
  /** @type {URL} */
  let url;
  try {
    url = new URL(resolved);
  } catch {
    return `مصدرٌ «${resolved}» ليس URL صالحاً`;
  }
  if (url.protocol !== 'https:') return `مصدرٌ بغيرِ https «${resolved}» — غيرُ مدعوم`;
  if (url.hostname !== DEFAULT_REGISTRY_HOST || url.port !== '' || url.username || url.password) {
    return `سجلٌّ غيرُ افتراضيٍّ «${url.host}» — المدعومُ ${DEFAULT_REGISTRY_HOST} وحدَه`;
  }
  if (!PKG_NAME.test(pkgName)) return `اسمُ الحزمةِ «${pkgName}» غيرُ صالح`;
  if (!SAFE_VERSION.test(entry.version))
    return `الإصدارُ «${entry.version}» غيرُ آمنٍ في رابطِ tarball`;
  const base = pkgName.slice(pkgName.lastIndexOf('/') + 1);
  const canonical = `https://${DEFAULT_REGISTRY_HOST}/${pkgName}/-/${base}-${entry.version}.tgz`;
  if (resolved !== canonical) return `«${resolved}» ليس رابطَ tarball القانونيَّ «${canonical}»`;
  if (entry.integrity === undefined) return 'من السجلِّ بلا `integrity`';
  return '';
}

/**
 * WL-576: مصدرُ المدخلةِ وبصمتُها وحدَهما (‏بلا SBOM) — للمدخلاتِ الاختياريّةِ الغائبةِ عن SBOM.
 * @param {string} key @param {Record<string, any>} entry @returns {string[]}
 */
export function provenanceProblems(key, entry) {
  const folder = key.slice(key.lastIndexOf(NM_MARK) + NM_MARK.length);
  const pkgName = nonEmpty(entry.name) ? entry.name : folder;
  const why = [];
  const src = sourceProblem(entry, pkgName);
  if (src !== '') why.push(`مصدرٌ غيرُ مدعوم: ${src}`);
  if (entry.integrity !== undefined) {
    const sri = parseSri(entry.integrity);
    if ('error' in sri) why.push(`integrity في القفلِ غيرُ قابلةٍ للتفسير: ${sri.error}`);
  }
  return why;
}

/** حقولُ الاعتماديّاتِ التي تصنعُ حوافَّ arborist لعقدةٍ غيرِ جذريّة (‏`Node[_loadDeps]` في npm 10.8.2). */
const EDGE_FIELDS = ['peerDependencies', 'dependencies', 'optionalDependencies'];

/**
 * أسماءُ الحزمِ في مسارِ القفل (‏`node_modules/a/node_modules/@s/b` ⇒ `['a', '@s/b']`)، أو null إن التبسَ التقسيم.
 * @param {string} key @returns {string[] | null}
 */
function lockPathNames(key) {
  if (key === '') return [];
  if (!NM_PATH.test(key)) return null;
  const names = key.slice(NM_MARK.length).split(`/${NM_MARK}`);
  return names.every((n) => PKG_NAME.test(n) && n !== 'node_modules') ? names : null;
}

/** @param {string[]} names */
const lockKey = (names) => (names.length === 0 ? '' : NM_MARK + names.join(`/${NM_MARK}`));

/**
 * WL-578: إثباتُ التجميعِ من بياناتِ القفلِ وحدَها — يُعيدُ حسابَ `Node.getBundler()` في arborist ‏(npm 10.8.2،
 * ‏`lib/node.js`) ويقارنُه بعلامةِ `inBundle` التي يكتبُها npm (‏`Shrinkwrap.metaFromNode`: ‏`node.inBundle`):
 * مدخلةٌ يُجمِّعُها **أوّلاً** مُجمِّعُ أمِّها الماديّةِ إن كانت الأمُّ مُجمَّعة؛ وإلّا أمُّها إن سمّتها
 * `bundleDependencies` الأمِّ في القفل؛ وإلّا أمُّها إن كانت مدخلةٌ مُجمَّعةٌ بالأمِّ نفسِها تعتمدُ عليها وتُحَلُّ
 * إليها (‏البحثُ في node_modules صعوداً من المعتمِد). العلامةُ في القفلِ أو في SBOM ليست دليلاً: كلُّ اختلافٍ بينَ
 * المحسوبِ والمعلَّمِ يُرفَض — علامةٌ بلا مُجمِّع (‏يتيمة، أو تحتَ أبٍ خاطئٍ أو مسارٍ مشابه)، أو مُجمِّعٌ بلا علامة
 * (‏حُذِفَت)، أو مُجمِّعٌ هو الجذر (‏غيرُ مدعوم)، أو قيمةُ علامةٍ غيرُ `true`، أو `bundleDependencies` ليست مصفوفةَ
 * أسماءٍ صالحة، أو حقلُ اعتماديّاتٍ ليس كائناً، أو مسارٌ ملتبسُ التقسيم. المُجمِّعُ نفسُه مدخلةٌ عاديّةٌ تخضعُ لسياسةِ
 * المصدرِ وSRI، وبايتاتُ المُجمَّعِ داخلَ tarball المُجمِّعِ المختومِ ببصمتِه. قفلٌ بلا أيِّ `inBundle` ولا
 * `bundleDependencies` لا يُفحَصُ (‏لا أثرَ على غيرِه). الحدود: الدوراتُ تُقطَعُ بمسارٍ مشتركٍ كما في arborist وبترتيبِ
 * المفاتيح، فقد يختلفُ الحكمُ عن npm في دوراتٍ نادرة — والاختلافُ رفضٌ لا قبول؛ و`legacy-peer-deps` يُسقِطُ حوافَّ
 * peer عندَ npm فيُرفَضُ ما جُمِّعَ بها وحدَها؛ ومطابقةُ `bundleDependencies` لـ`package.json` داخلَ tarball غيرُ مفحوصة.
 * @param {Record<string, any>} packages @returns {Map<string, string>} المفتاح ⇒ سببُ الرفض
 */
export function bundleProblems(packages) {
  /** @type {Map<string, string>} */
  const out = new Map();
  if (!isObj(packages)) return out;
  const keys = Object.keys(packages).sort();
  const relevant = keys.some(
    (k) =>
      isObj(packages[k]) &&
      (packages[k].inBundle !== undefined || packages[k].bundleDependencies !== undefined),
  );
  if (!relevant) return out;
  /** @param {string} k @param {string} why */
  const flag = (k, why) => {
    if (!out.has(k)) out.set(k, why);
  };
  /** @type {Map<string, string[]>} */
  const names = new Map();
  for (const k of keys) {
    const n = lockPathNames(k);
    if (n === null) flag(k, 'مسارٌ ملتبسُ التقسيم — لا تُحسَبُ أمُّه');
    else names.set(k, n);
  }
  /** @type {Map<string, Set<string>>} */
  const bundled = new Map();
  for (const k of keys) {
    const e = packages[k];
    if (!isObj(e) || e.bundleDependencies === undefined) continue;
    const bd = e.bundleDependencies;
    if (!Array.isArray(bd) || !bd.every((n) => typeof n === 'string' && PKG_NAME.test(n))) {
      flag(k, '`bundleDependencies` ليست مصفوفةَ أسماءِ حزمٍ صالحة');
      continue;
    }
    bundled.set(k, new Set(bd));
  }
  /** @param {string} from @param {string} name @returns {string | null} */
  const resolve = (from, name) => {
    const base = names.get(from);
    if (!base) return null;
    for (let i = base.length; i >= 0; i--) {
      const cand = lockKey([...base.slice(0, i), name]);
      if (names.has(cand) && isObj(packages[cand])) return cand;
    }
    return null;
  };
  /** @type {Map<string, string[]>} */
  const edgesIn = new Map();
  for (const k of keys) {
    const e = packages[k];
    if (k === '' || !isObj(e) || !names.has(k)) continue;
    /** @type {Set<string>} */
    const deps = new Set();
    for (const field of EDGE_FIELDS) {
      if (e[field] === undefined) continue;
      if (!isObj(e[field])) {
        flag(k, `\`${field}\` ليست كائناً — لا تُحسَبُ حوافُّها`);
        continue;
      }
      for (const n of Object.keys(e[field])) deps.add(n);
    }
    for (const n of deps) {
      const to = resolve(k, n);
      if (to === null) continue;
      if (!edgesIn.has(to)) edgesIn.set(to, []);
      /** @type {string[]} */ (edgesIn.get(to)).push(k);
    }
  }
  /** @param {string} k @param {Set<string>} seen @returns {string | null} */
  const bundler = (k, seen) => {
    if (seen.has(k)) return null;
    seen.add(k);
    const n = names.get(k);
    if (!n || n.length === 0) return null;
    const parent = lockKey(n.slice(0, -1));
    const pb = bundler(parent, seen);
    if (pb !== null) return pb;
    if (bundled.get(parent)?.has(/** @type {string} */ (n[n.length - 1]))) return parent;
    for (const from of edgesIn.get(k) ?? []) {
      if (bundler(from, seen) === parent) return parent;
    }
    return null;
  };
  for (const k of keys) {
    const e = packages[k];
    if (k === '' || !isObj(e) || !names.has(k)) continue;
    if (e.inBundle !== undefined && e.inBundle !== true) {
      flag(k, `\`inBundle\` قيمتُها ${JSON.stringify(e.inBundle)} لا true`);
      continue;
    }
    const by = bundler(k, new Set());
    if (e.inBundle === true) {
      if (by === null) {
        const parent = lockKey(/** @type {string[]} */ (names.get(k)).slice(0, -1));
        flag(
          k,
          names.has(parent) && isObj(packages[parent])
            ? `\`inBundle\` بلا مُجمِّعٍ مُثبَتٍ في القفل — «${parent || '(الجذر)'}» لا تُجمِّعُها`
            : `\`inBundle\` والحزمةُ الأمُّ «${parent}» غائبةٌ عن القفل`,
        );
      } else if (by === '')
        flag(k, 'مُجمَّعةٌ في حزمةِ الجذر (‏`bundleDependencies` للمشروع) — غيرُ مدعومة');
    } else if (by !== null) {
      flag(k, `يُجمِّعُها «${by || '(الجذر)'}» في القفل وعلامةُ \`inBundle\` غائبة`);
    }
  }
  return out;
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
  // ‏WL-576: التطابقُ وحدَه لا يكفي — مصدرٌ غيرُ مدعومٍ يُرفَضُ ولو طابقَ SBOM القفل.
  const src = sourceProblem(entry, pkgName);
  if (src !== '') why.push(`مصدرٌ غيرُ مدعوم: ${src}`);
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
    const want = parseSri(entry.integrity);
    if ('error' in want) why.push(`integrity في القفلِ غيرُ قابلةٍ للتفسير: ${want.error}`);
    else if (hashes.length !== 1 || `${hashes[0].alg}:${hashes[0].content}` !== want.hash) {
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
  // ‏WL-578: علامةُ `inBundle` تُقبَلُ بإثباتِ التجميعِ من القفلِ وحدَه، لا بتصريحِ القفلِ أو SBOM.
  for (const [key, why] of bundleProblems(lock.packages)) {
    problems.push(`مدخلةُ القفل «${key}»: تجميعٌ غيرُ مُثبَت (‏WL-578): ${why}`);
  }
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
    if (entry.optional === true || entry.devOptional === true) {
      // ‏WL-576 (‏مراجعةُ fd47091c): الاختياريّةُ الغائبةُ عن SBOM كانت تتخطّى سياسةَ المصدرِ وSRI — مدخلةٌ بمنصّةٍ
      // أخرى (‏os/cpu) مصدرُها git أو سجلٌّ آخر تمرُّ بإعلانٍ ℹ️ ويجلبُها `npm ci` على تلك المنصّة. تُفحَصُ كالممثَّلة.
      const why = provenanceProblems(key, entry);
      if (why.length > 0)
        problems.push(`مدخلةُ القفل الاختياريّة «${key}» (‏غائبةٌ عن SBOM): ${why.join('، ')}`);
      else omittedOptional.push(key);
    } else problems.push(`مدخلةُ القفل «${key}@${entry.version}» مطلوبةٌ وغائبةٌ عن SBOM`);
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
