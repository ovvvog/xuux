/**
 * شاهدُ وقتٍ محليٌّ — مصدرٌ موقَّعٌ يُنطَقُ به على سلكٍ حقيقيٍّ (‏`D-7`، `WL-192`).
 *
 * **لِمَ يوجدُ هذا الشاهدُ ولماذا لا يصلحُ مصدرَ ثقةٍ:** التحقُّقُ من توقيعٍ
 * يُختبَرُ بمتَّجهاتٍ خارجيّةٍ (رُدودٌ حقيقيّةٌ محفوظةٌ)، لكنَّ **المسارَ كاملاً**
 * — طلبٌ يُبنى، ويُرسَلُ على مِقبسٍ، ويُوقَّعُ رَدُّه، ويُفَكُّ، وتُقاسُ فترتُه —
 * لا يُقاسُ بمتَّجهٍ محفوظٍ. ومتَّجهٌ محفوظٌ لا يكشفُ خطأً في بناءِ الطلبِ ولا في
 * حسابِ ورقةِ ميركل على رزمةِ الطلبِ ولا في مُهلةِ النقلِ.
 *
 * ولذلك يوقِّعُ هذا الشاهدُ **بمفتاحٍ عابرٍ يُولَّدُ في كلِّ تشغيلٍ**، ولا مِفتاحَ
 * له مثبَّتٌ في المستودعِ ولا في `config/time.yaml`. فلا يمكنُ أن يصيرَ مصدرَ
 * وقتٍ في الإنتاجِ: من لا مِفتاحَ معلَنٌ له لا يُقبَلُ رَدُّه، و`guard:time`
 * يرفضُ أيَّ مصدرٍ في السياسةِ يحملُ مِفتاحَ الشاهدِ أو اسمَه.
 *
 * وهو **ليس مصدرَ وقتٍ صحيحٍ**: يوقِّعُ ما تقولُه ساعةُ الجهازِ الذي يعملُ
 * عليه. فائدتُه إثباتُ أنَّ المسارَ يعملُ ويرفضُ، لا إثباتُ الوقتِ.
 *
 * @module time/witness
 */

import { createSocket } from 'node:dgram';
import { createHash, generateKeyPairSync, sign as signMessage } from 'node:crypto';

import { TIME_ERRORS, TimeError } from './errors.mjs';
import {
  PUBLIC_KEY_LENGTH,
  TAGS,
  dialect,
  encodeMessage,
  framePacket,
  parseMessage,
  unframePacket,
} from './roughtime.mjs';

const RESPONSE_CONTEXT = Buffer.from('RoughTime v1 response signature\u0000', 'latin1');
const TYPE_RESPONSE = 1;
const IETF_VERSION = 1;

/**
 * @param {{ hashLength: number }} spec
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
 * @param {number} value
 * @returns {Buffer}
 */
function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

/**
 * @param {number} value
 * @returns {Buffer}
 */
function uint64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(Math.trunc(value)), 0);
  return buffer;
}

/**
 * @typedef {object} WitnessOptions
 * @property {string} [dialectId] لهجةُ التوقيعِ؛ الافتراضُ `ietf`.
 * @property {() => number} [now] ساعةُ الشاهدِ بالميلي ثانيةِ.
 * @property {number} [radiusMs] نصفُ القُطرِ المُعلَنُ في الرَّدِّ.
 * @property {number} [delegationWindowMs] عرضُ نافذةِ التفويضِ حولَ الآنِ.
 * @property {number} [delegationShiftMs] إزاحةُ النافذةِ — تُستعملُ لبناءِ رَدٍّ
 *   وقتُه خارجَ نافذةِ تفويضِه كي يُقاسَ رفضُه.
 */

/** شاهدُ وقتٍ يوقِّعُ بمفتاحٍ عابرٍ. */
export class TimeWitness {
  /** @param {WitnessOptions} [options] */
  constructor(options = {}) {
    this.spec = dialect(options.dialectId ?? 'ietf');
    this.now = options.now ?? (() => Date.now());
    this.radiusMs = options.radiusMs ?? 1000;
    this.delegationWindowMs = options.delegationWindowMs ?? 3600000;
    this.delegationShiftMs = options.delegationShiftMs ?? 0;

    const longTerm = generateKeyPairSync('ed25519');
    const delegated = generateKeyPairSync('ed25519');
    this.longTermPrivateKey = longTerm.privateKey;
    this.delegatedPrivateKey = delegated.privateKey;
    /** المِفتاحُ الطويلُ العامُّ خامّاً: اثنانِ وثلاثونَ بايتاً. */
    this.publicKey = longTerm.publicKey
      .export({ format: 'der', type: 'spki' })
      .subarray(-PUBLIC_KEY_LENGTH);
    this.delegatedPublicKey = delegated.publicKey
      .export({ format: 'der', type: 'spki' })
      .subarray(-PUBLIC_KEY_LENGTH);
  }

  /**
   * شهادةُ التفويضِ الموقَّعةُ بالمفتاحِ الطويلِ.
   *
   * @param {number} midpointRaw
   * @returns {Buffer}
   */
  #certificate(midpointRaw) {
    const scale = 1 / this.spec.timeScaleToMs;
    const window = this.delegationWindowMs * scale;
    const shift = this.delegationShiftMs * scale;
    const delegation = encodeMessage([
      [TAGS.PUBK, this.delegatedPublicKey],
      [TAGS.MINT, uint64(midpointRaw - window + shift)],
      [TAGS.MAXT, uint64(midpointRaw + window + shift)],
    ]);
    const signature = signMessage(
      null,
      Buffer.concat([this.spec.delegationContext, delegation]),
      this.longTermPrivateKey,
    );
    return encodeMessage([
      [TAGS.SIG, signature],
      [TAGS.DELE, delegation],
    ]);
  }

  /**
   * يبني رُدوداً لدفعةِ طلباتٍ بجذرِ ميركل واحدٍ موقَّعٍ.
   *
   * والدفعةُ ليست ترفاً: توقيعُ جذرٍ واحدٍ لعددٍ من الطلباتِ هو ما يجعلُ
   * التوقيعَ الواحدَ يشهدُ لكلِّ سائلٍ، وهو ما يُقاسُ رفضُه إذا شهدَ لسائلٍ
   * غيرِنا.
   *
   * @param {Buffer[]} requests رزمُ الطلباتِ (لهجةُ `ietf`) أو المُستهاناتُ (`google`).
   * @returns {Buffer[]} رزمُ الرُّدودِ بترتيبِ الطلباتِ.
   */
  respondBatch(requests) {
    if (!Array.isArray(requests) || requests.length === 0) {
      throw new TimeError(TIME_ERRORS.INPUT_INVALID, 'دفعةُ طلباتٍ فارغةٌ لا يُبنى لها رَدٌّ.');
    }
    const spec = this.spec;
    const nonces = requests.map((request) => this.#nonceOf(request));
    const leafInputs = requests.map((request, index) =>
      spec.merkleLeaf === 'packet' ? request : (nonces[index] ?? Buffer.alloc(0)),
    );

    /** @type {Buffer[]} */
    let level = leafInputs.map((leaf) => hashNode(spec, [Buffer.of(0x00), leaf]));
    /** @type {Buffer[][]} */
    const levels = [level];
    while (level.length > 1) {
      /** @type {Buffer[]} */
      const next = [];
      for (let index = 0; index < level.length; index += 2) {
        const left = level[index] ?? Buffer.alloc(spec.hashLength);
        const right = level[index + 1] ?? left;
        next.push(hashNode(spec, [Buffer.of(0x01), left, right]));
      }
      level = next;
      levels.push(level);
    }
    const root = level[0] ?? Buffer.alloc(spec.hashLength);

    const midpointRaw = Math.trunc(this.now() / this.spec.timeScaleToMs);
    const signedResponse = spec.requiresTypeTag
      ? encodeMessage([
          [TAGS.VER, uint32(IETF_VERSION)],
          [TAGS.RADI, uint32(Math.trunc(this.radiusMs / this.spec.timeScaleToMs))],
          [TAGS.MIDP, uint64(midpointRaw)],
          [TAGS.VERS, uint32(IETF_VERSION)],
          [TAGS.ROOT, root],
        ])
      : encodeMessage([
          [TAGS.RADI, uint32(Math.trunc(this.radiusMs / this.spec.timeScaleToMs))],
          [TAGS.MIDP, uint64(midpointRaw)],
          [TAGS.ROOT, root],
        ]);
    const signature = signMessage(
      null,
      Buffer.concat([RESPONSE_CONTEXT, signedResponse]),
      this.delegatedPrivateKey,
    );
    const certificate = this.#certificate(midpointRaw);

    return requests.map((_request, index) => {
      /** @type {Buffer[]} */
      const path = [];
      let position = index;
      for (let depth = 0; depth < levels.length - 1; depth += 1) {
        const current = levels[depth] ?? [];
        const siblingIndex = (position & 1) === 0 ? position + 1 : position - 1;
        const sibling = current[siblingIndex] ?? current[position] ?? Buffer.alloc(spec.hashLength);
        path.push(sibling);
        position >>>= 1;
      }
      /** @type {Array<[string, Buffer]>} */
      const entries = [
        [TAGS.SIG, signature],
        [TAGS.PATH, Buffer.concat(path)],
        [TAGS.SREP, signedResponse],
        [TAGS.CERT, certificate],
        [TAGS.INDX, uint32(index)],
      ];
      if (spec.requiresTypeTag) {
        entries.push([TAGS.NONC, nonces[index] ?? Buffer.alloc(spec.nonceLength)]);
        entries.push([TAGS.TYPE, uint32(TYPE_RESPONSE)]);
      }
      const message = encodeMessage(entries);
      return spec.framed ? framePacket(message) : message;
    });
  }

  /**
   * رَدٌّ واحدٌ لطلبٍ واحدٍ.
   *
   * @param {Buffer} request
   * @returns {Buffer}
   */
  respond(request) {
    const [response] = this.respondBatch([request]);
    if (response === undefined) {
      throw new TimeError(TIME_ERRORS.INPUT_INVALID, 'تعذَّرَ بناءُ رَدٍّ للطلبِ.');
    }
    return response;
  }

  /**
   * @param {Buffer} request
   * @returns {Buffer}
   */
  #nonceOf(request) {
    if (!this.spec.framed) return request;
    const fields = parseMessage(unframePacket(request));
    const nonce = fields.get(TAGS.NONC);
    if (nonce === undefined || nonce.length !== this.spec.nonceLength) {
      throw new TimeError(TIME_ERRORS.INPUT_INVALID, 'طلبٌ بلا مُستهانٍ بطولِه المُثبَّتِ.');
    }
    return nonce;
  }
}

/**
 * يُشغِّلُ الشاهدَ على مِقبسٍ محليٍّ حقيقيٍّ.
 *
 * ولِمَ مِقبسٌ حقيقيٌّ لا نداءُ دالّةٍ: مُهلةُ النقلِ وبناءُ الرزمةِ وحدودُ
 * الطولِ لا تُقاسُ بنداءٍ داخليٍّ. والعنوانُ محليٌّ دائماً كي لا يفتحَ اختبارٌ
 * خدمةً على الشبكةِ.
 *
 * @param {object} options
 * @param {TimeWitness} options.witness
 * @param {string} [options.host]
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
export function startWitness({ witness, host = '127.0.0.1' }) {
  const socket = createSocket('udp4');
  socket.on('message', (message, remote) => {
    try {
      const response = witness.respond(Buffer.from(message));
      socket.send(response, remote.port, remote.address);
    } catch {
      // شاهدٌ لا يُبلِّغُ خطأً على السلكِ: رسالةُ خطأٍ غيرُ موقَّعةٍ بابُ إفسادٍ،
      // والصمتُ يُترجَمُ عندَ العميلِ مُهلةً منتهيةً وهي رفضٌ مُسمّى.
    }
  });
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, host, () => {
      const address = socket.address();
      resolve({
        port: typeof address === 'string' ? 0 : address.port,
        close: () =>
          new Promise((done) => {
            socket.close(() => done());
          }),
      });
    });
  });
}
