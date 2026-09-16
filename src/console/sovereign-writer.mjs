/**
 * كاتبُ الديوانِ السياديُّ — سدادُ الشطرِ الأخيرِ من الدَينِ `D-1`.
 *
 * **ما كان قبلَ هذه الوحدةِ، مقيساً لا مرويّاً:** `RoyalConsole.issue` تقبلُ
 * `signature` **نصّاً يأتيها من المُنادي**، وكلُّ مُنادٍ في المستودعِ — الاختبارُ
 * وغرفةُ الأزماتِ — يُنتِجُهُ بـ`KingIdentity.sign`، أي **بمادّةِ مفتاحٍ خاصّةٍ
 * في ذاكرةِ العمليّةِ نفسِها التي تُصدِرُ الأمر**. فمن بلغَ العمليّةَ بلغَ
 * السلطةَ، وكانَ «التوقيعُ» فحصَ تكاملٍ لا إثباتَ سلطةٍ. وفي الوقتِ نفسِه كانَ
 * `HsmSigner` (‏`WL-088`) يوقّعُ **داخلَ التوكنِ** — وكانَ مربوطاً بالتثبيتاتِ
 * وبدفترِ الأوامرِ **ولا شيءَ منه يوقّعُ أمراً ملكيّاً**. قدرةٌ قائمةٌ في موضعٍ،
 * وحاجةٌ قائمةٌ في موضعٍ آخر، ولا وصلةَ بينَهما.
 *
 * **وما تفعلُه هذه الوحدةُ:** تجعلُ الكتابةَ من الديوانِ تمرُّ بموقِّعٍ **مربوطٍ
 * بوحدةِ أمانٍ** لا بمادّةٍ في ذاكرةِ المُنادي، وتَرُدُّ ما سوى ذلك برمزٍ مُسمّىً.
 * وهي **لا تُخفِّفُ** فحصاً واحداً من فحوصِ الديوانِ ولا تُبنى بجوارِه: الأمرُ
 * يمضي بعدَ التوقيعِ إلى `RoyalConsole.issue` نفسِها، فيَلقى الجلسةَ القويّةَ
 * وبوابةَ التاجِ ودفترَ الأوامرِ والسجلَّ الدائمَ كما هي. ولو كانت تُنادي التاجَ
 * أو زرَّ الإيقافِ مباشرةً لكانت مسارَ كتابةٍ ثانياً — وهو عينُ ما أغلقَه `M9.03`.
 *
 * **وثلاثُ قواعدَ حاكمةٍ، كلٌّ منها رفضٌ مُسمّىً لا تعليقٌ في الهامش:**
 *
 * 1. **لا توقيعَ يأتي من المُنادي.** `issue` **لا تقبلُ حقلَ `signature`
 *    أصلاً**، فمن حملَ توقيعاً جاهزاً رُدَّ بـ`WRITER_SIGNATURE_NOT_ACCEPTED`.
 *    والسببُ بنيويٌّ: لو قَبِلَتْهُ لصارَ هذا الكاتبُ ممرّاً يُمرِّرُ توقيعَ غيرِه،
 *    فلا يبقى معنىً لكونِ الموقِّعِ مربوطاً بوحدةِ أمان. ومَن عندَه أمرٌ موقَّعٌ
 *    من وحدةِ أمانٍ خارجَ هذه العمليّةِ فسبيلُهُ `RoyalConsole.issue` مباشرةً
 *    أو طبقةُ النقلِ — لا هذه الوحدة.
 *
 * 2. **الموقِّعُ يُعلِنُ نفسَه ويُقاسُ إعلانُه.** العقدُ هو عقدُ `KeyProvider`
 *    نفسُه في `describe()` (‏`canExport`/`kind`/`productionReady`)، لا عقدٌ
 *    جديدٌ يُخترعُ هنا: موقِّعٌ يُعلِنُ أنّه يُصدِّرُ المادّةَ يُرَدُّ
 *    بـ`WRITER_SIGNER_EXPORTS_MATERIAL` **في كلِّ بيئةٍ**، ومَن أعلنَ أنّه غيرُ
 *    إنتاجيٍّ يُرَدُّ **في الإنتاجِ** بحُكمِ `assertProductionKeyProviderAllowed`
 *    نفسِه الذي يحكمُ مخازنَ المفاتيحِ — فلا حاكمانِ لشيءٍ واحدٍ يتباعدان.
 *    وموقِّعٌ لا `describe()` له ليس موقِّعاً يُعرَفُ مداهُ، فيُرَدُّ
 *    بـ`WRITER_SIGNER_UNDECLARED`.
 *
 * 3. **التوقيعُ يُتحقَّقُ منه بالمفتاحِ العامِّ قبلَ أن يُرسَل.** وهذا **ليس**
 *    تكراراً لفحصِ بوابةِ التاج: البوابةُ تسألُ «هل يُطابِقُ هذا التوقيعُ مفتاحَ
 *    الملكِ الذي تعرفُه هي؟»، وهذه الوحدةُ تسألُ «هل أنتجَتِ الوحدةُ التي
 *    ناديتُها توقيعاً صالحاً على المادّةِ التي أعطيتُها؟». وهما سؤالانِ
 *    مختلفانِ يفشلانِ لسببينِ مختلفَينِ: وحدةٌ تُرجِعُ بايتاتٍ فاسدةً، أو مفتاحُ
 *    وحدةٍ لا يُطابِقُ مفتاحَ الملكِ عندَ التاجِ — وخلطُهما يُعطي رمزَ رفضٍ
 *    يُضلِّلُ من يقرأُه. والرمزُ هنا `WRITER_SIGNATURE_UNVERIFIED`.
 *
 * **حدودٌ مُعلَنةٌ لا تُدَّعى غيرُها:**
 *   • هذه الوحدةُ تُوقِّعُ حيثُ تُنادى. فإن نُوديت **في العمليّةِ التي تستضيفُ
 *     البابَ** كانَ التوقيعُ عندَ البابِ، وذاك تركيبٌ يُعطي كلَّ من بلغَ البابَ
 *     سلطةَ طلبِ توقيعٍ — ولذلك موضعُها المقصودُ **جانبُ الملكِ**
 *     (`scripts/royal-command.mjs`)، والبابُ يتحقَّقُ ولا يوقِّع.
 *   • بوابةُ التاجِ تتحقَّقُ اليومَ بـ`KingIdentity` وهي هويّةٌ **برمجيّةٌ**
 *     مادّتُها في الذاكرةِ (‏ومرفوضةٌ في الإنتاجِ بـ
 *     `SOFTWARE_KING_IDENTITY_FORBIDDEN_IN_PRODUCTION`). فمُتحقِّقٌ ملكيٌّ
 *     **بمفتاحٍ عامٍّ وحدَه** — يتحقَّقُ ولا يستطيعُ أن يوقِّعَ — دَينٌ مُعلَنٌ
 *     في `docs/roadmap/06-debt-register.md`، ولا يُقالُ هنا إنّه قائم.
 */

import { Buffer } from 'node:buffer';
import { createPublicKey, verify as verifySignature } from 'node:crypto';
import process from 'node:process';

import {
  assertProductionKeyProviderAllowed,
  isProductionRuntime,
} from '../root-of-trust/production-boot.mjs';

/**
 * رموزُ رفضِ الكاتبِ. مثبَّتةٌ نصّاً لأنّ الاختبارَ والحاجزَ يوازنانِها بالمكتوبِ
 * في الوثائقِ في الاتجاهَينِ، فرمزٌ يُضافُ هنا بلا إعلانٍ يُكشَف.
 */
export const WRITER_ERRORS = Object.freeze({
  CONSOLE_REQUIRED: 'WRITER_CONSOLE_REQUIRED',
  SIGNER_REQUIRED: 'WRITER_SIGNER_REQUIRED',
  SIGNER_UNDECLARED: 'WRITER_SIGNER_UNDECLARED',
  SIGNER_EXPORTS_MATERIAL: 'WRITER_SIGNER_EXPORTS_MATERIAL',
  SIGNER_FORBIDDEN_IN_PRODUCTION: 'WRITER_SIGNER_FORBIDDEN_IN_PRODUCTION',
  SIGNATURE_NOT_ACCEPTED: 'WRITER_SIGNATURE_NOT_ACCEPTED',
  SIGNATURE_UNAVAILABLE: 'WRITER_SIGNATURE_UNAVAILABLE',
  SIGNATURE_UNVERIFIED: 'WRITER_SIGNATURE_UNVERIFIED',
  COMMAND_REQUIRED: 'WRITER_COMMAND_REQUIRED',
});

/** @typedef {(typeof WRITER_ERRORS)[keyof typeof WRITER_ERRORS]} WriterErrorCode */

/**
 * خطأُ الكاتبِ: رسالتُه تشرحُ ولا تحملُ مادّةَ مفتاحٍ ولا توقيعاً ولا رمزَ جلسةٍ
 * سياديّةٍ — فرسالةُ خطأٍ تُطبَعُ في سجلٍّ وتُلصَقُ في تقريرٍ.
 */
export class SovereignWriteError extends Error {
  /** @type {WriterErrorCode} */
  code;
  /** @type {Readonly<Record<string, unknown>>} */
  details;

  /**
   * @param {WriterErrorCode} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SovereignWriteError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

/**
 * عقدُ الموقِّعِ المربوطِ بوحدةِ أمان. `HsmSigner` يُحقِّقُ `signAsync`
 * و`publicKeyPem` حرفيّاً، ويلزمُه `describe()` — وذاك ما يفعلُه
 * `moduleSignerFromHsm` أدناه بلا مسِّ جذرِ الثقةِ.
 * @typedef {object} ModuleSigner
 * @property {() => { kind: string, canExport: boolean, productionReady: boolean, location?: string }} describe
 * @property {(payload: object) => Promise<string>} signAsync
 * @property {string} publicKeyPem
 */

/**
 * @typedef {object} ConsoleIssuerLike
 * @property {(request: { command: string, royalCommand: Record<string, unknown>, signature: string, sovereignSession?: string }) => Promise<Record<string, unknown>>} issue
 */

/**
 * يُلبِسُ `HsmSigner` عقدَ الإعلانِ بلا تعديلِ جذرِ الثقة. والقيمُ ليست مُجامَلةً:
 * التوكنُ **لا يُصدِّرُ** المادّةَ (‏وذاك مفحوصٌ في `HsmSigner.open` نفسِه
 * بـ`assertNonExportingSource`)، ونوعُه هو نوعُ الإنتاجِ المُعلَنُ في
 * `production-boot.mts` لا نصٌّ يُختلَقُ هنا.
 * @param {{ publicKeyPem: string, role: string, signAsync: (payload: object) => Promise<string> }} signer
 * @returns {ModuleSigner}
 */
export function moduleSignerFromHsm(signer) {
  if (signer.role !== 'kingSigning') {
    throw new SovereignWriteError(
      WRITER_ERRORS.SIGNER_REQUIRED,
      `الأمرُ الملكيُّ يوقّعُه مفتاحُ الملكِ (‏دورُ «kingSigning»)، والمُعطى دورُه «${String(signer.role)}»؛ ومفتاحُ دفترِ الأوامرِ يُصادِقُ قراراتِ الدفترِ ولا يُصدِرُ أمراً ملكيّاً.`,
      { role: String(signer.role) },
    );
  }
  return {
    describe: () => ({
      kind: 'pkcs11-hsm',
      canExport: false,
      productionReady: true,
      location: 'token',
    }),
    signAsync: (payload) => signer.signAsync(payload),
    publicKeyPem: signer.publicKeyPem,
  };
}

/**
 * كاتبُ الديوانِ: يوقّعُ في وحدةِ الأمانِ ثمّ يُصدِرُ من الديوانِ نفسِه.
 */
export class SovereignWriter {
  /** @type {ConsoleIssuerLike} */
  #console;
  /** @type {ModuleSigner} */
  #signer;
  /** @type {ReturnType<typeof createPublicKey>} */
  #publicKey;
  /** @type {{ kind: string, canExport: boolean, productionReady: boolean, location?: string }} */
  #declaration;

  /**
   * **فشلٌ مُغلَقٌ عندَ التركيبِ لا عندَ أوّلِ أمرٍ:** كاتبٌ يُبنى على موقِّعٍ
   * مرفوضٍ ثمّ يُرفَضُ حينَ يُنادى يُخفي عيبَ التركيبِ إلى لحظةِ الحاجةِ — وهي
   * أسوأُ لحظةٍ ليُكتشَفَ فيها أنّ لا موقِّعَ. فالفحصُ كلُّه هنا.
   * @param {{ console: ConsoleIssuerLike | null, signer: ModuleSigner | null, env?: NodeJS.ProcessEnv }} deps
   */
  constructor(deps) {
    const console_ = deps?.console ?? null;
    if (console_ === null || typeof console_.issue !== 'function') {
      throw new SovereignWriteError(
        WRITER_ERRORS.CONSOLE_REQUIRED,
        'الكاتبُ بلا ديوانٍ يُصدِرُ منه؛ ولو وقّعَ بلا ديوانٍ لكانَ قد صنعَ توقيعاً لا أمراً، ولا سجلَّ دائمَ يشهدُ عليه.',
      );
    }
    const signer = deps?.signer ?? null;
    if (signer === null || typeof signer.signAsync !== 'function') {
      throw new SovereignWriteError(
        WRITER_ERRORS.SIGNER_REQUIRED,
        'الكاتبُ بلا موقِّعٍ؛ وموقِّعٌ غائبٌ رفضٌ لا رجوعٌ إلى توقيعٍ برمجيٍّ من مادّةٍ في الذاكرةِ — وذاك عينُ الدَينِ الذي تسدُّه هذه الوحدة.',
      );
    }
    if (typeof signer.describe !== 'function') {
      throw new SovereignWriteError(
        WRITER_ERRORS.SIGNER_UNDECLARED,
        'الموقِّعُ لا يُعلِنُ نفسَه (‏لا `describe()`)؛ وموقِّعٌ لا يُعرَفُ هل يُصدِّرُ مادّتَه ولا هل هو إنتاجيٌّ لا يُقاسُ مداهُ، وما لا يُقاسُ مداهُ لا يُؤتمَنُ على أمرٍ سياديّ.',
      );
    }
    const declaration = signer.describe();
    // `!== false` نصّاً لا صدقيّةً — بحُكمِ `UF-10` نفسِه: موقِّعٌ لا يقولُ «لا
    // أُصدِّرُ» صريحاً ليس موقِّعاً غيرَ مُصدِّرٍ، و`undefined` ليس «لا».
    if (declaration?.canExport !== false) {
      throw new SovereignWriteError(
        WRITER_ERRORS.SIGNER_EXPORTS_MATERIAL,
        `الموقِّعُ «${String(declaration?.kind)}» يُعلِنُ أنّ مادّتَه قابلةٌ للتصديرِ (‏أو لا يُعلِنُ خِلافَه)؛ ومادّةٌ تُصدَّرُ تُنسَخُ، فتوقيعُها إثباتُ حيازةِ نسخةٍ لا إثباتُ سلطةٍ.`,
        { kind: String(declaration?.kind) },
      );
    }
    // والإنتاجُ يُحكَمُ بحاكمِ مخازنِ المفاتيحِ نفسِه لا بشرطٍ يُكتَبُ هنا: شرطانِ
    // لشيءٍ واحدٍ في موضعَينِ يتباعدانِ بالزمنِ فيصيرُ أحدُهما ثقباً.
    try {
      assertProductionKeyProviderAllowed(declaration, deps?.env ?? process.env);
    } catch (error) {
      throw new SovereignWriteError(
        WRITER_ERRORS.SIGNER_FORBIDDEN_IN_PRODUCTION,
        `الموقِّعُ «${String(declaration?.kind)}» لا يجوزُ في بيئةِ إنتاجٍ: ${
          error instanceof Error ? error.message : String(error)
        } — والإنتاجُ لا يوقِّعُ أمراً سياديّاً إلا من وحدةٍ لا تُصدِّرُ مادّتَها.`,
        { kind: String(declaration?.kind), production: isProductionRuntime(deps?.env) },
      );
    }
    /** @type {ReturnType<typeof createPublicKey>} */
    let publicKey;
    try {
      publicKey = createPublicKey(signer.publicKeyPem);
    } catch {
      throw new SovereignWriteError(
        WRITER_ERRORS.SIGNER_UNDECLARED,
        'الموقِّعُ لا يُعطي مفتاحاً عامّاً يُقرأُ؛ وبلا مفتاحٍ عامٍّ لا يُتحقَّقُ من توقيعِه قبلَ إرسالِه، فيُرسَلُ ما لا يُعرَفُ.',
      );
    }
    if (publicKey.asymmetricKeyType !== 'ed25519') {
      throw new SovereignWriteError(
        WRITER_ERRORS.SIGNER_UNDECLARED,
        `مفتاحُ الموقِّعِ من نوعِ «${String(publicKey.asymmetricKeyType)}» لا Ed25519؛ وبوابةُ التاجِ تتحقَّقُ بـEd25519 وحدَها، فتوقيعٌ بغيرِه يُرَدُّ عندَها بعدَ أن يُرسَل.`,
      );
    }
    this.#console = console_;
    this.#signer = signer;
    this.#publicKey = publicKey;
    this.#declaration = Object.freeze({ ...declaration });
  }

  /**
   * سلطةُ الكاتبِ ومداهُ للتدقيقِ وللإعلانِ في الردودِ والواجهةِ. **لا يحملُ
   * سرّاً**: نوعُ الوحدةِ ومفتاحُها العامُّ، وهما ما يُنشَرُ قصداً.
   * @returns {{ kind: string, canExport: boolean, productionReady: boolean, publicKeyPem: string }}
   */
  describe() {
    return Object.freeze({
      kind: this.#declaration.kind,
      canExport: this.#declaration.canExport,
      productionReady: this.#declaration.productionReady,
      publicKeyPem: this.#signer.publicKeyPem,
    });
  }

  /**
   * **يَختِمُ ولا يُرسِلُ:** يطلبُ التوقيعَ من وحدةِ الأمانِ، ويتحقَّقُ منه
   * بمفتاحِها العامِّ، ويُرجِعُ **ظرفاً** بصيغةِ ما تقرأُه طبقةُ النقلِ في
   * `POST /state/console/<action>` حرفيّاً.
   *
   * **ولماذا يُفصَلُ الخَتمُ عن الإصدارِ؟** لأنّ موضعَ التوقيعِ المقصودَ **جانبُ
   * الملكِ** لا العمليّةُ التي تستضيفُ البابَ. فمن وقّعَ عندَ البابِ أعطى كلَّ من
   * بلغَ البابَ سلطةَ طلبِ توقيعٍ. فبهذا المِقبضِ يوقّعُ جانبُ الملكِ ثمّ يُرسِلُ
   * الظرفَ على السلكِ، **والبابُ يتحقَّقُ ولا يوقِّعُ أبداً**.
   *
   * ولا مسارَ توقيعٍ ثانياً: `issue` تُنادي هذا المِقبضَ نفسَه — فلو تباعدَ
   * المسارانِ لصارَ أحدُهما يفحصُ ما لا يفحصُه الآخرُ.
   * @param {{ command: string, royalCommand: Record<string, unknown>, sovereignSession?: string, signature?: never }} request
   * @returns {Promise<{ command: string, royalCommand: Record<string, unknown>, signature: string, sovereignSession?: string }>}
   */
  async seal(request) {
    if (request !== null && typeof request === 'object' && 'signature' in request) {
      throw new SovereignWriteError(
        WRITER_ERRORS.SIGNATURE_NOT_ACCEPTED,
        'هذا الكاتبُ لا يقبلُ توقيعاً من المُنادي: لو قَبِلَهُ لصارَ ممرّاً يُمرِّرُ توقيعَ غيرِه، فلا يبقى لكونِ الموقِّعِ في وحدةِ أمانٍ معنىً. ومَن معَه أمرٌ موقَّعٌ فسبيلُهُ الديوانُ مباشرةً أو طبقةُ النقل.',
      );
    }
    const command = typeof request?.command === 'string' ? request.command.trim() : '';
    if (command === '') {
      throw new SovereignWriteError(
        WRITER_ERRORS.COMMAND_REQUIRED,
        'لا معرّفَ أمرٍ يُوقَّعُ عليه؛ والأوامرُ مُعلَنةٌ بمعرّفاتِها في `config/royal-console.yaml` ولا يخترعُ المُنادي واحداً.',
      );
    }
    const royalCommand = request?.royalCommand ?? null;
    if (royalCommand === null || typeof royalCommand !== 'object' || Array.isArray(royalCommand)) {
      throw new SovereignWriteError(
        WRITER_ERRORS.COMMAND_REQUIRED,
        'الأمرُ الملكيُّ يجب أن يكونَ كائناً؛ وشكلٌ آخرُ ليس مادّةً تُوقَّعُ ولا تُتحقَّقُ.',
      );
    }
    /** @type {string} */
    let signature;
    try {
      signature = await this.#signer.signAsync(royalCommand);
    } catch (error) {
      throw new SovereignWriteError(
        WRITER_ERRORS.SIGNATURE_UNAVAILABLE,
        `وحدةُ الأمانِ لم تُوقِّعْ: ${
          error instanceof Error ? error.message : String(error)
        } — ولا رجوعَ من هنا إلى توقيعٍ برمجيٍّ؛ فشلُ الوحدةِ رفضٌ لا مسارٌ بديل.`,
        { kind: this.#declaration.kind },
      );
    }
    if (typeof signature !== 'string' || signature === '') {
      throw new SovereignWriteError(
        WRITER_ERRORS.SIGNATURE_UNAVAILABLE,
        'وحدةُ الأمانِ أرجعَتْ ما ليس توقيعاً؛ وأمرٌ يُرسَلُ بتوقيعٍ فارغٍ يُرَدُّ عندَ التاجِ بعدَ أن يُرسَل، والرفضُ هنا أصدقُ.',
      );
    }
    if (!this.#verify(royalCommand, signature)) {
      throw new SovereignWriteError(
        WRITER_ERRORS.SIGNATURE_UNVERIFIED,
        'توقيعُ وحدةِ الأمانِ لا يتحقَّقُ بمفتاحِها العامِّ على المادّةِ نفسِها؛ فإمّا الوحدةُ أرجعَتْ بايتاتٍ فاسدةً وإمّا وقّعَتْ غيرَ ما أُعطيَتْ — وكلاهما لا يُرسَل.',
        { kind: this.#declaration.kind },
      );
    }
    return {
      command,
      royalCommand,
      signature,
      ...(typeof request?.sovereignSession === 'string'
        ? { sovereignSession: request.sovereignSession }
        : {}),
    };
  }

  /**
   * يُصدِرُ أمراً ملكيّاً من الديوانِ **في هذه العمليّةِ**: يَختِمُ بالوحدةِ ثمّ
   * يمضي إلى `RoyalConsole.issue` بكلِّ فحوصِها غيرَ منقوصةٍ.
   * @param {{ command: string, royalCommand: Record<string, unknown>, sovereignSession?: string, signature?: never }} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async issue(request) {
    const envelope = await this.seal(request);
    return await this.#console.issue(envelope);
  }

  /**
   * تحقُّقٌ برمجيٌّ بالمفتاحِ **العامِّ** وحدَه، وبنفسِ ترتيبِ البايتاتِ الذي
   * توقّعُ عليه `KingIdentity` و`HsmSigner` (‏`JSON.stringify`) — فلو اختلفَ
   * الترتيبُ لكانَ توقيعٌ صحيحٌ يُقرأُ باطلاً. وكلُّ ما لا يُمكنُ التحقُّقُ منه
   * `false`: فشلٌ مُغلَق.
   * @param {object} payload
   * @param {string} signature
   * @returns {boolean}
   */
  #verify(payload, signature) {
    try {
      return verifySignature(
        null,
        Buffer.from(JSON.stringify(payload), 'utf8'),
        this.#publicKey,
        Buffer.from(signature, 'base64url'),
      );
    } catch {
      return false;
    }
  }
}
