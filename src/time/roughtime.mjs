/**
 * وقتٌ مُوقَّعٌ من مصدرٍ خارجيٍّ — فكُّ رسائلِ Roughtime والتحقُّقُ من توقيعِها
 * (‏`D-7`، `WL-192`).
 *
 * **العيبُ الذي تُغلِقُه هذه الحزمةُ، بنصِّه كما كان:** «لا وقتَ مُبرهَناً من
 * مصدرٍ موقَّعٍ (‏Roughtime/NTS)». وساعةُ الجذرِ القائمةُ (`SovereignClock`)
 * تكشفُ **الانزياحَ** بين قراءتين وبين تشغيلين، وتُعلِنُ في حدودِها أنّها **لا
 * تُثبتُ الوقتَ الصحيحَ**: فساعةٌ منزاحةٌ انزياحاً ثابتاً منذ الإقلاعِ تُقرأُ
 * عندها سليمةً، وكلُّ مهلةٍ سياديّةٍ كانت تُقاسُ على ساعةٍ يملكُها من يملكُ
 * الجهازَ. والكشفُ ليس بُرهاناً؛ والبدايةُ الخاطئةُ لا يكشفُها عدّادٌ رتيبٌ.
 *
 * ولِمَ Roughtime لا NTP: رسالةُ NTP العاديّةُ غيرُ موقَّعةٍ، فمن يجلسُ على
 * المسارِ يكتبُ فيها ما شاء، والتحقُّقُ من وقتٍ بلا توقيعٍ تحقُّقٌ من لا شيءَ.
 * ورسالةُ Roughtime تحملُ توقيعَ إدواردز (‏Ed25519) على الوقتِ نفسِه، مع سلسلةِ
 * تفويضٍ من مِفتاحِ الخادمِ الطويلِ إلى مِفتاحٍ قصيرِ الأجلِ، ومع ربطِ الرَّدِّ
 * بمُستهانٍ (‏`nonce`) نُصدِرُه نحن. فيُثبِتُ التحقُّقُ ثلاثةَ أشياءَ: (١) أنَّ
 * الوقتَ صادرٌ عن حاملِ المِفتاحِ المُعلَنِ، (٢) أنَّه أُصدِرَ **بعدَ** طلبِنا
 * لأنَّ مُستهانَنا داخلُ ما وُقِّع، (٣) أنَّ المصدرَ يُعلِنُ نصفَ قُطرِ عدمِ يقينِه
 * فلا يُقرأُ الوقتُ نقطةً كاذبةَ الدِّقّةِ.
 *
 * **لهجتانِ لا واحدةٌ، والفرقُ مقيسٌ لا مُخمَّنٌ.** لصيغةِ Roughtime نشرتانِ
 * متداولتانِ تختلفانِ في أطوالِ المُستهانِ والتقطيعِ وسياقِ التوقيعِ ووحدةِ
 * الوقتِ وتغليفِ الرزمةِ:
 *
 *   • `google` — صيغةُ النشرِ الأولى: مُستهانٌ من أربعةٍ وستّينَ بايتاً، عُقَدُ
 *     ميركل بـSHA-512 كاملاً، `MIDP`/`RADI` بالميكروثانيةِ، سياقُ التفويضِ
 *     ينتهي بشرطتين، ولا تغليفَ للرزمةِ. **مقيسةٌ بمتَّجهاتٍ خارجيّةٍ** في
 *     `tests/fixtures/roughtime/` (رُدودٌ حقيقيّةٌ موقَّعةٌ من خوادمَ عامّةٍ سنةَ
 *     ٢٠١٩، ومعها أربعةَ عشرَ رَدّاً معطوباً يجبُ رفضُها).
 *   • `ietf` — صيغةُ مسوَّدةِ فريقِ العملِ: تغليفُ رزمةٍ بترويسةِ `ROUGHTIM`،
 *     مُستهانٌ من اثنين وثلاثينَ بايتاً، تقطيعُ SHA-512 إلى اثنين وثلاثينَ
 *     بايتاً، ورقةُ ميركل تُحسَبُ على **رزمةِ الطلبِ كاملةً** لا على المُستهانِ،
 *     `MIDP` بالثواني و`RADI` بالثواني، وسمانِ إضافيّانِ واجبانِ (`TYPE` و`VER`).
 *     وهي لهجةُ الخوادمِ العامّةِ المُعلَنةِ اليومَ.
 *
 * حدودٌ معلَنةٌ عندَ موضعِ القراءةِ، لا يُدَّعى غيرُها:
 *   1. **لهجةُ `google` مقيسةٌ بطرفٍ ثالثٍ؛ ولهجةُ `ietf` مقيسةٌ بشاهدٍ محليٍّ
 *      فقط.** لا متَّجهاتٍ خارجيّةً منشورةً للثانيةِ، ولا نداءَ خادمٍ عامٍّ قِيسَ
 *      من بيئةِ البناءِ (‏الخروجُ على UDP مُغلَقٌ، مقيسٌ بمحاولةٍ). فخطأٌ في
 *      تغليفِ رزمةِ `ietf` لن تكشفَه اختباراتُنا لأنَّ الشاهدَ يستعملُ الترميزَ
 *      نفسَه — وهذا نقصٌ معلَنٌ لا مُغطّى.
 *   2. **لا نداءَ شبكيّاً في هذه الوحدةِ.** فكٌّ وتحقُّقٌ فقط؛ والنقلُ في
 *      `src/time/transport.mjs` كي يُختبَرَ التحقُّقُ بلا شبكةٍ.
 *   3. **التوقيعُ لا يُثبِتُ صِدقَ المصدرِ.** يُثبِتُ أنَّ الوقتَ من حاملِ
 *      المِفتاحِ؛ ومصدرٌ واحدٌ كاذبٌ يُكشَفُ بالنِّصابِ والتقاطعِ في
 *      `src/time/attested-clock.mjs` لا هنا.
 *
 * @module time/roughtime
 */

import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

import { TIME_ERRORS, TimeError } from './errors.mjs';

/** طولُ مِفتاحِ إدواردز العامِّ. */
export const PUBLIC_KEY_LENGTH = 32;
const SIGNATURE_LENGTH = 64;

/** أدنى طولٍ لرسالةِ الطلبِ: كِبَرُها يمنعُ تضخيمَ الرَّدِّ في الإغراقِ. */
export const REQUEST_LENGTH = 1024;

/** ترويسةُ رزمةِ لهجةِ `ietf`: ثمانيةُ بايتاتٍ ثابتةٍ ثمّ طولُ الرسالةِ. */
const PACKET_MAGIC = Buffer.from('ROUGHTIM', 'latin1');

/** رقمُ نسخةِ البروتوكولِ في لهجةِ `ietf`. */
const IETF_VERSION = 1;

/** وسمُ نوعِ الرسالةِ: صفرٌ طلبٌ وواحدٌ رَدٌّ. */
const TYPE_REQUEST = 0;
const TYPE_RESPONSE = 1;

/**
 * سياقا التوقيعِ لكلِّ لهجةٍ. نصوصٌ حرفيّةٌ لا تُبنى برمجيّاً: فصلُ المجالاتِ هو
 * ما يمنعُ قَبولَ توقيعِ تفويضٍ مكانَ توقيعِ رَدٍّ، ولو رُكِّبَ السياقُ من أجزاءٍ
 * لصارَ خطأُ حرفٍ واحدٍ ثقةً في توقيعٍ من غيرِ موضعِه.
 */
const RESPONSE_CONTEXT = Buffer.from('RoughTime v1 response signature\u0000', 'latin1');
const DELEGATION_CONTEXT_GOOGLE = Buffer.from(
  'RoughTime v1 delegation signature--\u0000',
  'latin1',
);
const DELEGATION_CONTEXT_IETF = Buffer.from('RoughTime v1 delegation signature\u0000', 'latin1');

/** وسومُ الرسالةِ، أربعةُ بايتاتٍ لكلِّ وسمٍ كما تُرسَلُ حرفاً بحرفٍ. */
export const TAGS = Object.freeze({
  SIG: 'SIG\u0000',
  NONC: 'NONC',
  DELE: 'DELE',
  PATH: 'PATH',
  RADI: 'RADI',
  PUBK: 'PUBK',
  MIDP: 'MIDP',
  SREP: 'SREP',
  MINT: 'MINT',
  ROOT: 'ROOT',
  CERT: 'CERT',
  MAXT: 'MAXT',
  INDX: 'INDX',
  PAD: 'PAD\u00ff',
  VER: 'VER\u0000',
  VERS: 'VERS',
  TYPE: 'TYPE',
  SRV: 'SRV\u0000',
  ZZZZ: 'ZZZZ',
});

/**
 * @typedef {object} Dialect
 * @property {string} id
 * @property {number} nonceLength
 * @property {number} hashLength
 * @property {boolean} framed رزمةٌ مُغلَّفةٌ بترويسةِ `ROUGHTIM`.
 * @property {Buffer} delegationContext
 * @property {number} timeScaleToMs مُضاعِفُ تحويلِ وحدةِ الوقتِ إلى ميلي ثانيةٍ.
 * @property {'nonce' | 'packet'} merkleLeaf ما تُحسَبُ عليه ورقةُ ميركل.
 * @property {boolean} requiresTypeTag
 */

/**
 * اللهجاتُ المدعومةُ. **الأسماءُ مُثبَّتةٌ نصّاً** لأنَّ `config/time.yaml`
 * يُعلِنُ لهجةَ كلِّ مصدرٍ، ولهجةٌ مجهولةٌ رفضٌ مُسمّى لا تخمينٌ: مصدرٌ يُقرأُ
 * بلهجةٍ غيرِ لهجتِه يُنتِجُ إمّا رفضاً غامضاً وإمّا — وهو الأخطرُ — قراءةَ
 * حقولٍ في مواضعَ ليست مواضعَها.
 *
 * @type {Readonly<Record<string, Dialect>>}
 */
export const DIALECTS = Object.freeze({
  google: Object.freeze({
    id: 'google',
    nonceLength: 64,
    hashLength: 64,
    framed: false,
    delegationContext: DELEGATION_CONTEXT_GOOGLE,
    timeScaleToMs: 1 / 1000,
    merkleLeaf: 'nonce',
    requiresTypeTag: false,
  }),
  ietf: Object.freeze({
    id: 'ietf',
    nonceLength: 32,
    hashLength: 32,
    framed: true,
    delegationContext: DELEGATION_CONTEXT_IETF,
    timeScaleToMs: 1000,
    merkleLeaf: 'packet',
    requiresTypeTag: true,
  }),
});

/**
 * لهجةٌ باسمِها، ورفضٌ مُسمّى لما ليس معلَناً.
 *
 * @param {string} id
 * @returns {Dialect}
 */
export function dialect(id) {
  const found = DIALECTS[id];
  if (found === undefined) {
    throw new TimeError(
      TIME_ERRORS.INPUT_INVALID,
      `لهجةُ وقتٍ غيرُ مدعومةٍ: «${id}»؛ ورسالةٌ تُقرأُ بلهجةٍ ليست لهجتَها تُقرأُ حقولاً في غيرِ مواضعِها.`,
      { id, supported: Object.keys(DIALECTS) },
    );
  }
  return found;
}

/**
 * تقطيعُ عُقدةٍ: SHA-512 مقطوعاً إلى طولِ اللهجةِ. الأطوالُ مقيسةٌ من رُدودٍ
 * حقيقيّةٍ موقَّعةٍ (لهجةُ `google`) ومن نصِّ المسوَّدةِ (لهجةُ `ietf`).
 *
 * @param {Dialect} spec
 * @param {Buffer[]} parts
 * @returns {Buffer}
 */
function hashNode(spec, parts) {
  const digest = createHash('sha512');
  for (const part of parts) digest.update(part);
  const full = digest.digest();
  return spec.hashLength === full.length ? full : full.subarray(0, spec.hashLength);
}

/**
 * يُغلِّفُ مِفتاحاً خامّاً من اثنين وثلاثينَ بايتاً في صيغةٍ يقرؤها `node:crypto`.
 *
 * @param {Buffer} raw
 * @returns {import('node:crypto').KeyObject}
 */
function toEd25519Key(raw) {
  if (raw.length !== PUBLIC_KEY_LENGTH) {
    throw new TimeError(
      TIME_ERRORS.INPUT_INVALID,
      'مِفتاحُ إدواردز العامُّ يجبُ أن يكونَ اثنين وثلاثينَ بايتاً.',
      { length: raw.length },
    );
  }
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

/**
 * تحقُّقُ توقيعٍ واحدٍ. يُرجعُ منطقيّاً ولا يرفعُ: تسميةُ الرفضِ لِمن ينادي كي
 * يُفرَّقَ توقيعُ التفويضِ من توقيعِ الرَّدِّ.
 *
 * @param {Buffer} context
 * @param {Buffer} message
 * @param {Buffer} signature
 * @param {Buffer} publicKey
 * @returns {boolean}
 */
function verifyContextSignature(context, message, signature, publicKey) {
  if (signature.length !== SIGNATURE_LENGTH) return false;
  try {
    return verifySignature(
      null,
      Buffer.concat([context, message]),
      toEd25519Key(publicKey),
      signature,
    );
  } catch {
    return false;
  }
}

/**
 * يفكُّ رسالةَ Roughtime إلى خريطةِ وسمٍ ⇒ قيمةٍ.
 *
 * كلُّ فحصٍ هنا رفضٌ مُسمّى لا تصحيحٌ صامتٌ: إزاحةٌ ليست مُضاعَفةَ أربعةٍ، أو
 * إزاحةٌ متراجعةٌ، أو وسمٌ غيرُ مرتَّبٍ تصاعديّاً، أو طولٌ يتجاوزُ الرسالةَ —
 * كلُّها `TIME_RESPONSE_MALFORMED`. ورسالةٌ تُفَكُّ «على أفضلِ تقديرٍ» تفتحُ
 * ثغرةَ تفسيرٍ مزدوجٍ: مُهاجِمٌ يبني رسالةً تُقرأُ عندنا غيرَ ما تُقرأُ عندَ
 * من وقَّعها، فيصيرُ التوقيعُ على غيرِ ما نُصدِّقُه.
 *
 * @param {Buffer} message
 * @returns {Map<string, Buffer>}
 */
export function parseMessage(message) {
  if (!Buffer.isBuffer(message)) {
    throw new TimeError(TIME_ERRORS.INPUT_INVALID, 'الرسالةُ يجبُ أن تكونَ مصفوفةَ بايتاتٍ.');
  }
  if (message.length < 4) {
    throw new TimeError(TIME_ERRORS.RESPONSE_MALFORMED, 'رسالةٌ أقصرُ من ترويستِها.', {
      length: message.length,
    });
  }
  const count = message.readUInt32LE(0);
  if (count === 0) {
    throw new TimeError(TIME_ERRORS.RESPONSE_MALFORMED, 'رسالةٌ بلا وسومٍ.');
  }
  if (count > 1024) {
    throw new TimeError(TIME_ERRORS.RESPONSE_MALFORMED, 'عددُ وسومٍ لا تحملُه رسالةٌ.', { count });
  }
  const headerLength = 4 + (count - 1) * 4 + count * 4;
  if (message.length < headerLength) {
    throw new TimeError(TIME_ERRORS.RESPONSE_MALFORMED, 'ترويسةٌ أطولُ من الرسالةِ.', {
      count,
      length: message.length,
    });
  }
  const values = message.subarray(headerLength);

  /** @type {number[]} */
  const ends = [];
  let previousEnd = 0;
  for (let index = 0; index < count - 1; index += 1) {
    const end = message.readUInt32LE(4 + index * 4);
    if (end % 4 !== 0 || end < previousEnd || end > values.length) {
      throw new TimeError(TIME_ERRORS.RESPONSE_MALFORMED, 'إزاحةُ نهايةِ قيمةٍ غيرُ صالحةٍ.', {
        index,
        end,
      });
    }
    ends.push(end);
    previousEnd = end;
  }
  ends.push(values.length);

  /** @type {Map<string, Buffer>} */
  const fields = new Map();
  const tagsOffset = 4 + (count - 1) * 4;
  let previousTag = -1;
  let start = 0;
  for (let index = 0; index < count; index += 1) {
    const tagNumber = message.readUInt32LE(tagsOffset + index * 4);
    if (tagNumber <= previousTag) {
      throw new TimeError(TIME_ERRORS.RESPONSE_MALFORMED, 'وسومٌ غيرُ مرتَّبةٍ تصاعديّاً.', {
        index,
      });
    }
    previousTag = tagNumber;
    const tag = message
      .subarray(tagsOffset + index * 4, tagsOffset + index * 4 + 4)
      .toString('latin1');
    const end = ends[index] ?? values.length;
    fields.set(tag, values.subarray(start, end));
    start = end;
  }
  return fields;
}

/**
 * يبني رسالةً من وسومٍ وقيمٍ: ترتيبٌ تصاعديٌّ ثمّ إزاحاتٌ ثمّ قيمٌ.
 *
 * التركيبُ موجودٌ هنا لا في وحدةِ الاختبارِ لأنَّ الطلبَ نفسَه يُبنى به،
 * وورقةُ ميركل في لهجةِ `ietf` تُحسَبُ على رزمةِ الطلبِ كاملةً — فلو بُنِيَ
 * الطلبُ بترميزٍ آخرَ لصارَ التحقُّقُ من الجذرِ يفشلُ بلا سببٍ ظاهرٍ.
 *
 * @param {Array<[string, Buffer]>} entries
 * @returns {Buffer}
 */
export function encodeMessage(entries) {
  const sorted = [...entries].sort(
    (left, right) =>
      Buffer.from(left[0], 'latin1').readUInt32LE(0) -
      Buffer.from(right[0], 'latin1').readUInt32LE(0),
  );
  const count = sorted.length;
  const header = Buffer.alloc(4 + (count - 1) * 4 + count * 4);
  header.writeUInt32LE(count, 0);
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    const entry = sorted[index];
    if (entry === undefined) continue;
    if (index > 0) header.writeUInt32LE(offset, 4 + (index - 1) * 4);
    header.write(entry[0], 4 + (count - 1) * 4 + index * 4, 'latin1');
    offset += entry[1].length;
  }
  return Buffer.concat([header, ...sorted.map((entry) => entry[1])]);
}

/**
 * يُغلِّفُ رسالةً في رزمةٍ بترويسةِ `ROUGHTIM` (لهجةُ `ietf` وحدَها).
 *
 * @param {Buffer} message
 * @returns {Buffer}
 */
export function framePacket(message) {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(message.length, 0);
  return Buffer.concat([PACKET_MAGIC, length, message]);
}

/**
 * يفكُّ تغليفَ الرزمةِ ويرفضُ ترويسةً مخالفةً أو طولاً لا يطابقُ المحمولَ.
 *
 * @param {Buffer} packet
 * @returns {Buffer}
 */
export function unframePacket(packet) {
  if (packet.length < PACKET_MAGIC.length + 4) {
    throw new TimeError(TIME_ERRORS.RESPONSE_MALFORMED, 'رزمةٌ أقصرُ من ترويستِها.', {
      length: packet.length,
    });
  }
  if (!packet.subarray(0, PACKET_MAGIC.length).equals(PACKET_MAGIC)) {
    throw new TimeError(
      TIME_ERRORS.RESPONSE_MALFORMED,
      'ترويسةُ رزمةٍ لا تطابقُ الثابتَ المُعلَنَ.',
    );
  }
  const declared = packet.readUInt32LE(PACKET_MAGIC.length);
  const body = packet.subarray(PACKET_MAGIC.length + 4);
  if (declared !== body.length) {
    throw new TimeError(
      TIME_ERRORS.RESPONSE_MALFORMED,
      'طولٌ مُعلَنٌ في الترويسةِ لا يطابقُ طولَ المحمولِ.',
      { declared, actual: body.length },
    );
  }
  return body;
}

/**
 * يقرأُ وسماً واجباً بطولٍ مُثبَّتٍ.
 *
 * @param {Map<string, Buffer>} fields
 * @param {string} tag
 * @param {number} [exactLength]
 * @returns {Buffer}
 */
function requireTag(fields, tag, exactLength) {
  const value = fields.get(tag);
  if (!value) {
    throw new TimeError(TIME_ERRORS.TAG_MISSING, 'وسمٌ واجبٌ غائبٌ عن الرسالةِ.', { tag });
  }
  if (exactLength !== undefined && value.length !== exactLength) {
    throw new TimeError(TIME_ERRORS.TAG_SIZE_INVALID, 'وسمٌ بطولٍ مخالفٍ لطولِه المُثبَّتِ.', {
      tag,
      expected: exactLength,
      actual: value.length,
    });
  }
  return value;
}

/**
 * @param {Dialect} spec
 * @param {Buffer} nonce
 * @returns {void}
 */
function assertNonce(spec, nonce) {
  if (!Buffer.isBuffer(nonce) || nonce.length !== spec.nonceLength) {
    throw new TimeError(
      TIME_ERRORS.INPUT_INVALID,
      `المُستهانُ في لهجةِ «${spec.id}» يجبُ أن يكونَ ${spec.nonceLength} بايتاً.`,
      { length: Buffer.isBuffer(nonce) ? nonce.length : null },
    );
  }
}

/**
 * يبني رزمةَ طلبٍ: مُستهانٌ ثمّ حشوٌ إلى الطولِ الأدنى المُثبَّتِ.
 *
 * الحشوُ ليس زينةً: طلبٌ أصغرُ من رَدِّه يجعلُ الخادمَ مُضخِّماً في إغراقٍ
 * بعنوانٍ مُنتحَلٍ، ولذلك يُثبَّتُ الطلبُ عندَ ألفٍ وأربعةٍ وعشرينَ بايتاً.
 *
 * @param {object} input
 * @param {Buffer} input.nonce
 * @param {string} [input.dialectId]
 * @param {Buffer} [input.serverPublicKey] يُشتَقُّ منه وسمُ `SRV` في لهجةِ `ietf`.
 * @returns {Buffer}
 */
export function encodeRequest({ nonce, dialectId = 'google', serverPublicKey }) {
  const spec = dialect(dialectId);
  assertNonce(spec, nonce);

  if (!spec.framed) {
    // ترويسةُ وسمينِ ستةَ عشرَ بايتاً (عددٌ وإزاحةٌ ووسمانِ)، ثمّ المُستهانُ،
    // ثمّ حشوٌ يُكمِلُ الطولَ الأدنى — والأطوالُ مقيسةٌ بمتَّجهِ طلبٍ خارجيٍّ لا
    // محسوبةٌ من وصفٍ.
    const padding = Buffer.alloc(REQUEST_LENGTH - 16 - spec.nonceLength);
    return encodeMessage([
      [TAGS.NONC, nonce],
      [TAGS.PAD, padding],
    ]);
  }

  const version = Buffer.alloc(4);
  version.writeUInt32LE(IETF_VERSION, 0);
  const type = Buffer.alloc(4);
  type.writeUInt32LE(TYPE_REQUEST, 0);
  /** @type {Array<[string, Buffer]>} */
  const entries = [
    [TAGS.VER, version],
    [TAGS.NONC, nonce],
    [TAGS.TYPE, type],
  ];
  if (serverPublicKey !== undefined) {
    entries.push([TAGS.SRV, hashNode(spec, [Buffer.of(0xff), serverPublicKey])]);
  }
  const withoutPadding = encodeMessage([...entries, [TAGS.ZZZZ, Buffer.alloc(0)]]);
  const shortfall = REQUEST_LENGTH - withoutPadding.length;
  const padding = Buffer.alloc(shortfall > 0 ? shortfall : 0);
  return framePacket(encodeMessage([...entries, [TAGS.ZZZZ, padding]]));
}

/**
 * يتحقَّقُ من شمولِ ورقتِنا في جذرِ ميركل عبرَ المسارِ والفهرسِ.
 *
 * ولِمَ شجرةٌ لا توقيعٌ لكلِّ طلبٍ: المصدرُ يوقِّعُ جذراً واحداً لدفعةِ طلباتٍ،
 * فيُثبِتُ لكلِّ سائلٍ أنَّ سؤالَه داخلُ ما وُقِّع بلا توقيعٍ لكلِّ سائلٍ. ومن لم
 * يُثبَت شمولُ ورقتِه فرَدُّه رَدٌّ لسائلٍ آخرَ أو رَدٌّ مُعادٌ من تسجيلٍ قديمٍ —
 * وهو بالضبطِ ما يُبطِلُ إعادةَ الإرسالِ هنا.
 *
 * @param {Dialect} spec
 * @param {Buffer} leafInput
 * @param {Buffer} path
 * @param {number} index
 * @param {Buffer} root
 * @returns {void}
 */
export function verifyMerklePath(spec, leafInput, path, index, root) {
  if (path.length % spec.hashLength !== 0) {
    throw new TimeError(
      TIME_ERRORS.MERKLE_PATH_INVALID,
      'مسارُ ميركل ليس مُضاعَفاً لطولِ تقطيعِ اللهجةِ.',
      { length: path.length, hashLength: spec.hashLength },
    );
  }
  const levels = path.length / spec.hashLength;
  if (levels > 32) {
    throw new TimeError(
      TIME_ERRORS.MERKLE_PATH_INVALID,
      'مسارُ ميركل أطولُ من اثنين وثلاثينَ عُقدةً.',
      {
        levels,
      },
    );
  }
  let current = hashNode(spec, [Buffer.of(0x00), leafInput]);
  let remaining = index;
  for (let level = 0; level < levels; level += 1) {
    const sibling = path.subarray(level * spec.hashLength, (level + 1) * spec.hashLength);
    current =
      (remaining & 1) === 0
        ? hashNode(spec, [Buffer.of(0x01), current, sibling])
        : hashNode(spec, [Buffer.of(0x01), sibling, current]);
    remaining >>>= 1;
  }
  if (remaining !== 0) {
    throw new TimeError(
      TIME_ERRORS.MERKLE_PATH_INVALID,
      'مسارُ ميركل أقصرُ من الفهرسِ المُعلَنِ.',
      {
        index,
        levels,
      },
    );
  }
  if (!current.equals(root)) {
    throw new TimeError(
      TIME_ERRORS.NONCE_NOT_INCLUDED,
      'ورقتُنا غيرُ مشمولةٍ بالجذرِ المُوقَّعِ: رَدٌّ ليس لطلبِنا أو رَدٌّ مُعادٌ.',
      { index },
    );
  }
}

/**
 * @typedef {object} RoughtimeProof
 * @property {string} dialect لهجةُ الرَّدِّ كما قُرئ بها.
 * @property {number} midpointMs وسطُ الفترةِ بالميلي ثانيةِ منذُ عهدِ يونكس.
 * @property {number} radiusMs نصفُ قُطرِ عدمِ اليقينِ بالميلي ثانيةِ.
 * @property {number} earliestMs أقدمُ وقتٍ يشهدُ به المصدرُ.
 * @property {number} latestMs أحدثُ وقتٍ يشهدُ به المصدرُ.
 * @property {number} delegationMinMs بدايةُ نافذةِ صلاحيةِ التفويضِ.
 * @property {number} delegationMaxMs نهايةُ نافذةِ صلاحيةِ التفويضِ.
 */

/**
 * يتحقَّقُ من رَدٍّ كاملٍ بالترتيبِ: سلسلةُ التفويضِ، ثمّ توقيعُ الرَّدِّ، ثمّ
 * نافذةُ التفويضِ، ثمّ شمولُ ورقتِنا، ثمّ حدُّ نصفِ القُطرِ.
 *
 * والترتيبُ مقصودٌ: لا يُقرأُ وقتٌ من رسالةٍ قبلَ التحقُّقِ من توقيعِها؛ ومن
 * قرأَ ثمّ تحقَّقَ قد يبني قراراً على قيمةٍ مرفوضةٍ.
 *
 * @param {object} input
 * @param {Buffer} input.response رزمةُ الرَّدِّ (مُغلَّفةً في لهجةِ `ietf`).
 * @param {Buffer} input.nonce المُستهانُ الذي أرسلناه.
 * @param {Buffer} input.publicKey المِفتاحُ الطويلُ المُعلَنُ للمصدرِ.
 * @param {string} [input.dialectId]
 * @param {Buffer} [input.request] رزمةُ الطلبِ؛ واجبةٌ في لهجةِ `ietf`.
 * @param {number} [input.maxRadiusMs] حدُّ نصفِ القُطرِ؛ إن غابَ فلا حدَّ هنا.
 * @returns {RoughtimeProof}
 */
export function verifyResponse({
  response,
  nonce,
  publicKey,
  dialectId = 'google',
  request,
  maxRadiusMs,
}) {
  const spec = dialect(dialectId);
  assertNonce(spec, nonce);
  if (spec.merkleLeaf === 'packet' && !Buffer.isBuffer(request)) {
    throw new TimeError(
      TIME_ERRORS.INPUT_INVALID,
      `لهجةُ «${spec.id}» تحسبُ ورقةَ ميركل على رزمةِ الطلبِ، فلا يتمُّ التحقُّقُ بلا الطلبِ نفسِه.`,
    );
  }

  const message = spec.framed ? unframePacket(response) : response;
  const fields = parseMessage(message);
  const signature = requireTag(fields, TAGS.SIG, SIGNATURE_LENGTH);
  const signedResponse = requireTag(fields, TAGS.SREP);
  const certificate = requireTag(fields, TAGS.CERT);
  const path = requireTag(fields, TAGS.PATH);
  const indexBytes = requireTag(fields, TAGS.INDX, 4);

  if (spec.requiresTypeTag) {
    const type = requireTag(fields, TAGS.TYPE, 4).readUInt32LE(0);
    if (type !== TYPE_RESPONSE) {
      throw new TimeError(
        TIME_ERRORS.RESPONSE_MALFORMED,
        'وسمُ النوعِ لا يُعلِنُ رَدّاً؛ ورسالةُ طلبٍ تُقرأُ رَدّاً بابُ خلطٍ بينَ اتجاهين.',
        { type },
      );
    }
    const echoed = requireTag(fields, TAGS.NONC, spec.nonceLength);
    if (!echoed.equals(nonce)) {
      throw new TimeError(
        TIME_ERRORS.NONCE_NOT_INCLUDED,
        'المُستهانُ المُعادُ في الرَّدِّ ليس مُستهانَنا.',
      );
    }
  }

  const certificateFields = parseMessage(certificate);
  const delegation = requireTag(certificateFields, TAGS.DELE);
  const delegationSignature = requireTag(certificateFields, TAGS.SIG, SIGNATURE_LENGTH);
  if (!verifyContextSignature(spec.delegationContext, delegation, delegationSignature, publicKey)) {
    throw new TimeError(
      TIME_ERRORS.DELEGATION_SIGNATURE_INVALID,
      'شهادةُ التفويضِ لا تتحقَّقُ بالمِفتاحِ الطويلِ المُعلَنِ للمصدرِ.',
    );
  }

  const delegationFields = parseMessage(delegation);
  const delegatedKey = requireTag(delegationFields, TAGS.PUBK, PUBLIC_KEY_LENGTH);
  const minTime = requireTag(delegationFields, TAGS.MINT, 8);
  const maxTime = requireTag(delegationFields, TAGS.MAXT, 8);

  if (!verifyContextSignature(RESPONSE_CONTEXT, signedResponse, signature, delegatedKey)) {
    throw new TimeError(
      TIME_ERRORS.SIGNATURE_INVALID,
      'توقيعُ الرَّدِّ لا يتحقَّقُ بالمِفتاحِ المُفوَّضِ في الشهادةِ.',
    );
  }

  const signedFields = parseMessage(signedResponse);
  const root = requireTag(signedFields, TAGS.ROOT, spec.hashLength);
  const midpointRaw = Number(requireTag(signedFields, TAGS.MIDP, 8).readBigUInt64LE(0));
  const radiusRaw = requireTag(signedFields, TAGS.RADI, 4).readUInt32LE(0);
  const delegationMinRaw = Number(minTime.readBigUInt64LE(0));
  const delegationMaxRaw = Number(maxTime.readBigUInt64LE(0));

  if (midpointRaw < delegationMinRaw || midpointRaw > delegationMaxRaw) {
    throw new TimeError(
      TIME_ERRORS.DELEGATION_WINDOW_INVALID,
      'الوقتُ المُوقَّعُ خارجَ نافذةِ صلاحيةِ التفويضِ؛ ومِفتاحٌ يوقِّعُ خارجَ نافذتِه مِفتاحٌ بلا نافذةٍ.',
      { midpointRaw, delegationMinRaw, delegationMaxRaw },
    );
  }

  verifyMerklePath(
    spec,
    spec.merkleLeaf === 'packet' && request !== undefined ? request : nonce,
    path,
    indexBytes.readUInt32LE(0),
    root,
  );

  const midpointMs = Math.round(midpointRaw * spec.timeScaleToMs);
  const radiusMs = Math.round(radiusRaw * spec.timeScaleToMs);

  if (maxRadiusMs !== undefined && radiusMs > maxRadiusMs) {
    throw new TimeError(
      TIME_ERRORS.RADIUS_TOO_WIDE,
      'نصفُ قُطرِ عدمِ اليقينِ أوسعُ من الحدِّ المُعلَنِ؛ وبُرهانٌ بفترةٍ أوسعَ من المهلةِ لا يُبرهِنُ شيئاً يُبنى عليه.',
      { radiusMs, maxRadiusMs },
    );
  }

  return Object.freeze({
    dialect: spec.id,
    midpointMs,
    radiusMs,
    earliestMs: midpointMs - radiusMs,
    latestMs: midpointMs + radiusMs,
    delegationMinMs: Math.round(delegationMinRaw * spec.timeScaleToMs),
    delegationMaxMs: Math.round(delegationMaxRaw * spec.timeScaleToMs),
  });
}
