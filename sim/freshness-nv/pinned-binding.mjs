// @ts-nocheck
// sim/freshness-nv/pinned-binding.mjs
//
// WL-433 — **ربطٌ مثبَّتٌ خارجَ `R`** لمرجعِ الحداثةِ على NV (‏قرارُ المالكِ D1-أ في WL-432). **محاكاة.**
//
// **المشكلةُ (‏T7):** `base` كان يُقرأُ من `R` نفسِه، فمن يملكُ تفويضَ كتابةِ `R` يضعُ
// `base' = C − e_old` فيصيرُ العهدُ المحسوبُ `e_old` ويُقبَلُ استرجاعُ لقطةِ التطبيقِ وحدَها.
//
// **التصميم:** عندَ التهيئةِ يُختَمُ متنٌ ثابتٌ لا يتغيّرُ بعدَها أبدًا:
//   `{schema, counterIndex, recordIndex, counterName, recordName, base}`
// بتوقيعِ Ed25519 من مفتاحٍ **خارجَ متناولِ كاتبِ `R`** (‏في الإنتاجِ: داخلَ HSM كمفتاحِ البيان؛
// وفي المحاكاة: زوجٌ يملكُه الاختبار). المرجعُ يتحقّقُ منه في كلِّ قراءةٍ وانتقال:
//   - التوقيعُ والمخطّطُ والمقبضان ⇒ وإلّا `FRESHNESS_NV_BINDING_INVALID`.
//   - اسما NV الحاليّانِ (‏`TPM2_NV_ReadPublic`: تجزئةُ المنطقةِ العامّة) ⇒ وإلّا `FRESHNESS_NV_BINDING_MISMATCH`.
//   - `R.base` يساوي `base` المثبَّت ⇒ وإلّا `FRESHNESS_NV_BINDING_MISMATCH`.
// فالعهدُ = `C − base(المثبَّت)` لا يأخذُ من `R` إلّا المرساة. ولأنّ `C` رتيبٌ (حتى عبرَ الحذفِ وإعادةِ
// التعريف — قيسَ في swtpm: 5 ثمّ 6)، **فالعهدُ المقروءُ لا ينقصُ أبدًا**، وكلُّ ما يكتبُه كاتبُ `R`
// إمّا يُرفَضُ وإمّا يرفعُ العهدَ (حرمانٌ من الخدمة) — لا استرجاع.
//
// **لماذا لا يكسرُه استرجاعُ لقطةِ التطبيق:** المتنُ ثابتٌ منذُ التهيئة، فالنسخةُ القديمةُ منه هي
// النسخةُ الحاليّةُ نفسُها. وحذفُه أو تحريرُه ⇒ رفضٌ مغلق. وربطٌ من تهيئةٍ سابقةٍ على الـTPM نفسِه
// يحملُ `base` أصغر (العدّادُ رتيب) فيعطي عهدًا أكبر ⇒ رفض.
//
// **ما لا يكشفُه الاسم:** إعادةُ تعريفٍ مطابقةٌ تعطي الاسمَ نفسَه بعدَ أوّلِ كتابة (‏قيسَ في swtpm)؛
// يكشفُها `base` لا الاسم. الاسمُ يكشفُ تغييرَ السماتِ أو السياسةِ أو الحجمِ أو المقبض.
//
// **ما ليسَه:** ليس backend إنتاجيًّا ولا جزءًا من البيانِ المختومِ الحقيقيّ (‏`src/root-of-trust/` لم يُمَسّ).
// نقلُه إلى المسارِ الحقيقيِّ تصميمٌ يحتاجُ مراجعةً منفصلة (‏`docs/adr/0007-annex-c-pinned-binding.md`).

import { verify as edVerify } from 'node:crypto';
import { closeSync, fsyncSync, linkSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';

import { codedError } from './swtpm-harness.mjs';

export const BINDING_SCHEMA = 'xuux.fnv-binding/1';
export const BINDING_CODES = Object.freeze({
  INVALID: 'FRESHNESS_NV_BINDING_INVALID',
  MISMATCH: 'FRESHNESS_NV_BINDING_MISMATCH',
});

const HANDLE = /^0x[0-9a-f]{8}$/;
const NAME = /^000b[0-9a-f]{64}$/;

/**
 * البايتاتُ الموقَّعة: ترتيبُ حقولٍ ثابتٌ وسابقةُ مجالٍ تمنعُ إعادةَ استعمالِ التوقيعِ لغرضٍ آخر.
 * @param {{counterIndex: string, recordIndex: string, counterName: string, recordName: string, base: bigint}} b
 */
export function bindingBytes(b) {
  return Buffer.from(
    JSON.stringify([
      'xuux/freshness-nv/binding/v1',
      BINDING_SCHEMA,
      b.counterIndex,
      b.recordIndex,
      b.counterName,
      b.recordName,
      b.base.toString(),
    ]),
    'utf8',
  );
}

function assertShape(b) {
  const bad = (why) => codedError(BINDING_CODES.INVALID, `binding ${why}`);
  if (b === null || typeof b !== 'object') throw bad('not an object');
  if (b.schema !== BINDING_SCHEMA) throw bad('schema');
  if (!HANDLE.test(b.counterIndex) || !HANDLE.test(b.recordIndex)) throw bad('handle');
  if (b.counterIndex === b.recordIndex) throw bad('C == R');
  if (!NAME.test(b.counterName) || !NAME.test(b.recordName)) throw bad('name');
  if (typeof b.base !== 'string' || !/^[0-9]+$/.test(b.base)) throw bad('base');
}

/** يوحّدُ صيغةَ المقبض (‏`0x1500030` ⇒ `0x01500030`). */
export function normalizeHandle(h) {
  const n = Number.parseInt(String(h), 16);
  if (!Number.isInteger(n) || n < 0) throw codedError(BINDING_CODES.INVALID, `handle ${h}`);
  return `0x${n.toString(16).padStart(8, '0')}`;
}

/**
 * يختمُ الربطَ ويكتبُه ذرّيًّا **بلا كتابةٍ فوقَ ربطٍ قائم** (‏ملفٌّ مؤقّتٌ ثمّ `fsync` ثمّ `link` الذي يفشلُ
 * إن وُجدَ الهدف). الربطُ يُختَمُ مرّةً واحدةً عندَ التهيئة؛ إعادةُ الربطِ مراسمُ مالكٍ لا مسارٌ صامت.
 * @param {string} file - المسار
 * @param {{counterIndex: string, recordIndex: string, counterName: string, recordName: string, base: bigint}} b
 * @param {(bytes: Buffer) => Promise<Buffer>} sign - موقِّعُ Ed25519 (‏HSM في الإنتاج)
 */
export async function sealBindingFile(file, b, sign) {
  const body = {
    schema: BINDING_SCHEMA,
    counterIndex: normalizeHandle(b.counterIndex),
    recordIndex: normalizeHandle(b.recordIndex),
    counterName: b.counterName,
    recordName: b.recordName,
    base: b.base.toString(),
  };
  assertShape(body);
  const sig = await sign(bindingBytes({ ...body, base: b.base }));
  const text = JSON.stringify({ body, alg: 'ed25519', sig: Buffer.from(sig).toString('base64') }) + '\n';
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, 'wx', 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(tmp, file);
  } catch (error) {
    if (error.code === 'EEXIST') throw codedError(BINDING_CODES.INVALID, 'binding already exists; re-binding is an owner ceremony');
    throw error;
  } finally {
    rmSync(tmp, { force: true });
  }
  return body;
}

/**
 * يفتحُ الربطَ ويتحقّقُ من ختمِه — كلُّ فشلٍ رفضٌ مسمّىً لا قيمةٌ بديلة.
 * @param {string} file
 * @param {import('node:crypto').KeyObject} publicKey
 * @returns {{counterIndex: string, recordIndex: string, counterName: string, recordName: string, base: bigint}}
 */
export function openBindingFile(file, publicKey) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw codedError(BINDING_CODES.INVALID, `binding unreadable: ${error.code ?? error.name}`);
  }
  if (parsed === null || typeof parsed !== 'object' || parsed.alg !== 'ed25519' || typeof parsed.sig !== 'string') {
    throw codedError(BINDING_CODES.INVALID, 'binding envelope');
  }
  const body = parsed.body;
  assertShape(body);
  const out = { ...body, base: BigInt(body.base) };
  const ok = edVerify(null, bindingBytes(out), publicKey, Buffer.from(parsed.sig, 'base64'));
  if (!ok) throw codedError(BINDING_CODES.INVALID, 'binding signature');
  return out;
}

/**
 * اسمُ NV من مخرجِ `tpm2_nvreadpublic` (‏`name: 000b…`).
 * @param {Buffer|string} out
 */
export function parseNvName(out) {
  const m = /^\s*name:\s*([0-9a-f]+)\s*$/m.exec(String(out));
  if (m === null || !NAME.test(m[1])) throw codedError(BINDING_CODES.MISMATCH, 'nv name unreadable');
  return m[1];
}
