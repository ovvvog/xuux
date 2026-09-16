/**
 * ساعةٌ مُبرهَنةٌ: وقتٌ من مصادرَ موقَّعةٍ متقاطعةِ الفتراتِ (‏`D-7`، `WL-192`).
 *
 * تُنفِّذُ عقدَ `TrustedClock` (‏`src/root-of-trust/clock.mts`) وتزيدُ عليه
 * `attestation()` — فما يميّزُها ليس أنّها تُصدرُ رقماً، بل أنّها **تُصدرُ
 * رقماً وتُبيِّنُ من شهدَ له ومتى**، وتُصدِرُ عدماً حينَ لا شاهدَ.
 *
 * أربعةُ قراراتٍ فيها تُقاسُ برفضٍ لا بوصفٍ:
 *
 *  1. **النِّصابُ.** أقلُّ من نِصابِ السياسةِ رَدّاً مُتحقَّقاً ⇒
 *     `TIME_QUORUM_NOT_MET`. ومصدرٌ واحدٌ موقَّعٌ يمنعُ من على المسارِ ولا
 *     يمنعُ المصدرَ نفسَه؛ والكذبُ لا يُكشَفُ إلا بخلافِ ثانٍ.
 *  2. **التقاطعُ.** الوقتُ ليس متوسِّطَ الرُّدودِ بل **تقاطعُ فتراتِها**؛
 *     وفراغُ التقاطعِ ⇒ `TIME_SOURCES_DISAGREE`. والمتوسِّطُ يمرِّرُ كاذباً
 *     يسحبُ الوسطَ نحوَه بلا أن يُخالفَ أحداً صراحةً.
 *  3. **الطزاجةُ.** عمرُ البُرهانِ يُقاسُ **بمقياسٍ رتيبٍ** لا بساعةِ الجهازِ:
 *     لو قيسَ بها لأمكنَ لمن يملكُ الجهازَ أن يُبقيَ بُرهاناً قديماً «طازَجاً»
 *     بإرجاعِ الساعةِ. والقديمُ يُقرأُ عدماً ⇒ `attestation()` تعودُ بـ`null`،
 *     و`now()` ترفعُ `TIME_ATTESTATION_STALE`.
 *  4. **انزياحُ ساعةِ الجهازِ.** يُقاسُ ويُعلَنُ ولا يُرفَضُ به البُرهانُ:
 *     البُرهانُ يعلو على ساعةِ الجهازِ لا العكسُ. ومن أرادَ رفضاً صريحاً
 *     ناداها بـ`assertLocalClockAgrees()` فترفعُ `TIME_LOCAL_SKEW_EXCEEDED`.
 *
 * والحدُّ المُعلَنُ: هذه الساعةُ لا تُثبِّتُ شيئاً على القرصِ، فهي لا تكشفُ
 * رجوعَ الوقتِ بينَ تشغيلَينِ — وذلك عملُ `SovereignClock`، وهما يتكاملانِ:
 * تلك تكشفُ الاضطرابَ، وهذه تُثبتُ اللحظةَ.
 *
 * @module time/attested-clock
 */

import { hrtime } from 'node:process';
import { randomBytes } from 'node:crypto';

import { TIME_ERRORS, TimeError } from './errors.mjs';
import { dialect, encodeRequest, verifyResponse } from './roughtime.mjs';
import { askSource } from './transport.mjs';

/**
 * @typedef {object} SourceProof
 * @property {string} sourceId
 * @property {string} dialect
 * @property {number} midpointMs
 * @property {number} radiusMs
 * @property {number} earliestMs
 * @property {number} latestMs
 */

/**
 * @typedef {object} TimeAttestationView
 * @property {number} atMs الوقتُ المُبرهَنُ لحظةَ الإبرهانِ.
 * @property {number} radiusMs نصفُ قُطرِ التقاطعِ.
 * @property {number} ageMs عمرُ البُرهانِ بالمقياسِ الرتيبِ.
 * @property {readonly string[]} sources أسماءُ المصادرِ التي شهدت.
 * @property {number} localSkewMs خلافُ ساعةِ الجهازِ عن المُبرهَنِ لحظةَ الإبرهانِ.
 */

/**
 * @typedef {object} AttestedClockOptions
 * @property {import('./policy.mjs').TimePolicy} policy
 * @property {() => number} [wallClock] ساعةُ الجهازِ — تُقرأُ للمقارنةِ لا للثقةِ.
 * @property {() => bigint} [monotonic] مقياسٌ رتيبٌ بالنانو ثانيةِ.
 * @property {(input: { source: import('./policy.mjs').TimeSource, request: Buffer, timeoutMs: number }) => Promise<Buffer>} [ask]
 *   ناقلٌ يُسأَلُ به مصدرٌ واحدٌ؛ يُبدَلُ في الاختبارِ بشاهدٍ محليٍّ.
 * @property {(length: number) => Buffer} [nonceFactory] مولِّدُ المُستهانِ — يُبدَلُ في الاختبارِ فقط.
 */

/** ساعةٌ لا تُصدرُ وقتاً إلا ببرهانٍ حاضرٍ. */
export class AttestedClock {
  /** @param {AttestedClockOptions} options */
  constructor(options) {
    if (options?.policy === undefined || options.policy === null) {
      throw new TimeError(
        TIME_ERRORS.CONFIG_INVALID,
        'الساعةُ المُبرهَنةُ تلزمُها سياسةُ وقتٍ مُعلَنةٌ: بلا نِصابٍ ولا حدودٍ لا معنى لكلمةِ «مُبرهَن».',
      );
    }
    this.policy = options.policy;
    this.wallClock = options.wallClock ?? (() => Date.now());
    this.monotonic = options.monotonic ?? (() => hrtime.bigint());
    this.nonceFactory = options.nonceFactory ?? ((length) => randomBytes(length));
    this.ask =
      options.ask ??
      (({ source, request, timeoutMs }) =>
        askSource({ host: source.host, port: source.port, request, timeoutMs }));
    /** @type {SourceProof[]} */
    this.lastProofs = [];
    /** @type {{ atMs: number, radiusMs: number, at: bigint, sources: string[], localSkewMs: number } | null} */
    this.state = null;
  }

  /**
   * يسألُ كلَّ مصادرِ السياسةِ، ويجمعُ ما تحقَّقَ توقيعُه، ثمّ يُقاطعُ الفتراتِ.
   *
   * والسؤالُ متزامنٌ لكلِّ المصادرِ لا متسلسلٌ: التسلسلُ يجعلُ فترةَ آخرِ مصدرٍ
   * تُقارَنُ بفترةِ أوّلِه بعدَ ثوانٍ، فيُقرأُ تباعدُ السؤالِ خلافاً بين شاهدَين.
   *
   * @returns {Promise<TimeAttestationView>}
   */
  async attest() {
    const policy = this.policy;
    const startedAt = this.monotonic();
    const wallBefore = this.wallClock();

    const attempts = await Promise.all(
      policy.sources.map(async (source) => {
        try {
          const spec = dialect(source.dialect);
          const nonce = this.nonceFactory(spec.nonceLength);
          const request = encodeRequest({
            nonce,
            dialectId: source.dialect,
            serverPublicKey: source.publicKey,
          });
          const response = await this.ask({
            source,
            request,
            timeoutMs: policy.requestTimeoutMs,
          });
          const proof = verifyResponse({
            response,
            nonce,
            publicKey: source.publicKey,
            dialectId: source.dialect,
            request,
            maxRadiusMs: policy.maxRadiusMs,
          });
          return {
            ok: /** @type {const} */ (true),
            proof: {
              sourceId: source.id,
              dialect: proof.dialect,
              midpointMs: proof.midpointMs,
              radiusMs: proof.radiusMs,
              earliestMs: proof.earliestMs,
              latestMs: proof.latestMs,
            },
          };
        } catch (error) {
          return {
            ok: /** @type {const} */ (false),
            sourceId: source.id,
            code: error instanceof TimeError ? error.code : 'TIME_TRANSPORT_FAILED',
            message: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    /** @type {SourceProof[]} */
    const proofs = [];
    /** @type {Array<{ sourceId: string, code: string, message: string }>} */
    const refusals = [];
    for (const attempt of attempts) {
      if (attempt.ok) proofs.push(attempt.proof);
      else
        refusals.push({
          sourceId: attempt.sourceId,
          code: attempt.code,
          message: attempt.message,
        });
    }
    this.lastProofs = proofs;

    if (proofs.length < policy.quorum) {
      throw new TimeError(
        TIME_ERRORS.QUORUM_NOT_MET,
        `تحقَّقَ ${proofs.length} من المصادرِ والنِّصابُ ${policy.quorum}؛ ووقتٌ من أقلَّ من النِّصابِ ليس مُبرهَناً.`,
        { verified: proofs.map((proof) => proof.sourceId), refusals },
      );
    }

    const earliest = Math.max(...proofs.map((proof) => proof.earliestMs));
    const latest = Math.min(...proofs.map((proof) => proof.latestMs));
    if (earliest > latest) {
      throw new TimeError(
        TIME_ERRORS.SOURCES_DISAGREE,
        'فتراتُ المصادرِ لا تتقاطعُ؛ وشاهدانِ متناقضانِ لا يُجمَعانِ بمتوسِّطٍ بل يُرفَضانِ.',
        {
          intervals: proofs.map((proof) => ({
            sourceId: proof.sourceId,
            earliestMs: proof.earliestMs,
            latestMs: proof.latestMs,
          })),
        },
      );
    }

    const atMs = Math.round((earliest + latest) / 2);
    const radiusMs = Math.round((latest - earliest) / 2);
    const wallAfter = this.wallClock();
    const localSkewMs = Math.round((wallBefore + wallAfter) / 2) - atMs;
    this.state = {
      atMs,
      radiusMs,
      at: startedAt,
      sources: proofs.map((proof) => proof.sourceId),
      localSkewMs,
    };
    return this.attestationOrThrow();
  }

  /**
   * عمرُ البُرهانِ بالميلي ثانيةِ، أو `null` إن لم يوجد بُرهانٌ.
   *
   * @returns {number | null}
   */
  ageMs() {
    if (this.state === null) return null;
    return Number((this.monotonic() - this.state.at) / 1000000n);
  }

  /**
   * بُرهانٌ حاضرٌ أو `null`. والقديمُ يُقرأُ عدماً لا مقبولاً: بوابةٌ تسألُ «هل
   * ثَمَّ بُرهانٌ» يجبُ أن تُجابَ بلا حينَ فاتَ عمرُه، لا أن تتذكَّرَ هي أن تفحصَ
   * العمرَ.
   *
   * @returns {TimeAttestationView | null}
   */
  attestation() {
    const state = this.state;
    if (state === null) return null;
    const ageMs = this.ageMs() ?? 0;
    if (ageMs > this.policy.maxAgeMs) return null;
    return Object.freeze({
      atMs: state.atMs,
      radiusMs: state.radiusMs,
      ageMs,
      sources: Object.freeze([...state.sources]),
      localSkewMs: state.localSkewMs,
    });
  }

  /**
   * @returns {TimeAttestationView}
   */
  attestationOrThrow() {
    const view = this.attestation();
    if (view === null) {
      throw new TimeError(
        this.state === null ? TIME_ERRORS.QUORUM_NOT_MET : TIME_ERRORS.ATTESTATION_STALE,
        this.state === null
          ? 'لا بُرهانَ وقتٍ بعدُ؛ ولا يُقرأُ وقتٌ قبلَ إبرهانٍ.'
          : `عمرُ بُرهانِ الوقتِ تجاوزَ ${this.policy.maxAgeMs} مِلّي ثانيةٍ؛ وبُرهانٌ لا ينتهي ليس بُرهاناً على الآنِ.`,
        { maxAgeMs: this.policy.maxAgeMs, ageMs: this.ageMs() },
      );
    }
    return view;
  }

  /**
   * الوقتُ الآنَ = وسطُ التقاطعِ المُبرهَنُ + ما انقضى بالمقياسِ الرتيبِ.
   *
   * ولا تُقرأُ ساعةُ الجهازِ في هذا الحسابِ أصلاً: قراءتُها هنا تُعيدُ العيبَ
   * الذي أُغلِقَ — أن يكونَ الوقتُ السياديُّ ما تقولُه ساعةٌ يملكُها من يملكُ
   * الجهازَ.
   *
   * @returns {number}
   */
  now() {
    const view = this.attestationOrThrow();
    return view.atMs + view.ageMs;
  }

  /** يرفعُ رفضاً إن لم يوجد بُرهانٌ حاضرٌ. */
  assertTrusted() {
    this.attestationOrThrow();
  }

  /**
   * يرفعُ `TIME_LOCAL_SKEW_EXCEEDED` إن خالفت ساعةُ الجهازِ البُرهانَ أكثرَ من
   * الحدِّ المُعلَنِ. يُنادى صراحةً — أدواتُ الفحصِ تُبلِّغُ، والمسارُ السياديُّ
   * يعملُ بالمُبرهَنِ ولا يحتاجُ ساعةَ الجهازِ.
   */
  assertLocalClockAgrees() {
    const view = this.attestationOrThrow();
    if (Math.abs(view.localSkewMs) > this.policy.maxLocalSkewMs) {
      throw new TimeError(
        TIME_ERRORS.LOCAL_SKEW_EXCEEDED,
        `ساعةُ الجهازِ تُخالفُ الوقتَ المُبرهَنَ بمقدارِ ${view.localSkewMs} مِلّي ثانيةٍ، والحدُّ ${this.policy.maxLocalSkewMs}.`,
        { localSkewMs: view.localSkewMs, maxLocalSkewMs: this.policy.maxLocalSkewMs },
      );
    }
  }

  /**
   * وصفٌ للتقاريرِ: حالةُ البُرهانِ والمصادرُ والحدودُ، بلا مِفتاحٍ ولا مُستهانٍ.
   *
   * @returns {{
   *   policyVersion: number,
   *   quorum: number,
   *   maxRadiusMs: number,
   *   maxAgeMs: number,
   *   maxLocalSkewMs: number,
   *   attested: boolean,
   *   attestation: TimeAttestationView | null,
   *   lastProofs: SourceProof[],
   * }}
   */
  describe() {
    const view = this.attestation();
    return {
      policyVersion: this.policy.version,
      quorum: this.policy.quorum,
      maxRadiusMs: this.policy.maxRadiusMs,
      maxAgeMs: this.policy.maxAgeMs,
      maxLocalSkewMs: this.policy.maxLocalSkewMs,
      attested: view !== null,
      attestation: view,
      lastProofs: this.lastProofs.map((proof) => ({ ...proof })),
    };
  }
}
