/**
 * G2 — تجميعُ قالبِ EK للحالاتِ الأربعِ من [ملفِ اعتمادِ EK](https://trustedcomputinggroup.org/wp-content/uploads/TCG-EK-Credential-Profile-V-2.5-R2_published.pdf)
 * §2.2.1.6 حرفيًا، كما تحدّدهُ الملحقُ هـ لـADR 0007 في §4.3 (صفُّ `CreatePrimary`):
 *
 * (1) القالبُ غائبٌ والـnonce غائب: القالبُ الافتراضيُّ L-1/L-2 بـ`unique` كما فيه.
 * (2) القالبُ موجودٌ والـnonce غائب: القالبُ المقروءُ **بلا تعديل**.
 * (3) الاثنانِ موجودان: القالبُ المقروءُ ثمّ الـnonce محشوًّا بإلحاقِ 0x00 إلى 256 في `unique.rsa`
 *     (أو إلى 32 في `unique.ecc.x` مع `unique.ecc.y` = 32 صفرًا).
 * (4) القالبُ غائبٌ والـnonce موجود: «unspecified and MUST NOT be provisioned» ⇒ **توقّفٌ**
 *     بـ`FRESHNESS_TPM_IDENTITY_UNPROVEN` بلا `CreatePrimary` أصلًا.
 *
 * **حدٌّ معلَنٌ:** هذه وحدةُ نطاقِ المحاكاةِ (`sim/`) — «وجودُ الفهرسِ» مُدخَلٌ من جردِ التمهيدِ
 * T1 غيرِ الموثَّقِ (يتحقّقُ منهُ C1 لاحقًا)، والقالبُ المقروءُ يُحلَّلُ `TPMT_PUBLIC` كاملًا
 * بلا بايتٍ زائد، ونوعُهُ يطابقُ نوعَ الشهادةِ، و`nameAlg` = SHA-256، وإلّا فرفضٌ قبلَ أيِّ إرسال.
 * لا يُثبتُ شيئًا عن عتادٍ ولا يفتحُ مسارًا إنتاجيًّا، و`SUPPORTED_FRESHNESS_BACKENDS` فارغة.
 */

import {
  parseTpmtPublic,
  defaultEkTemplateRsa2048,
  defaultEkTemplateEccP256,
  ekTemplateWithNonce,
  CommandBuilderError,
  COMMAND_BUILDER_ERRORS,
  TPM_ALG,
} from './command_builder.mjs';
import { GATE_ERRORS, GateError } from './gate.mjs';

/** @typedef {'rsa2048'|'eccP256'} EkKeyType */

/**
 * يبني `inPublic` لصفِّ `CreatePrimary` (T5) بحسبِ الحالةِ المنطبقةِ من الحالاتِ الأربع.
 * لا يُرسِلُ شيئًا ولا يفتحُ اتصالًا — تركيبٌ صرفٌ فوقَ جردِ التمهيدِ غيرِ الموثَّق.
 *
 * @param {{ keyType: EkKeyType, templateBytes: Buffer | null, nonceBytes: Buffer | null }} fields
 * @returns {Buffer} بايتاتُ `TPMT_PUBLIC` جاهزةٌ للتمريرِ إلى `gate.t5createPrimary`
 * @throws {GateError} برمزِ `FRESHNESS_TPM_IDENTITY_UNPROVEN` في الحالةِ (4) — توقّفٌ بلا `CreatePrimary`
 * @throws {CommandBuilderError} لقالبٍ لا يُحلَّلُ `TPMT_PUBLIC` كاملًا أو نوعِهِ يخالفُ الشهادةَ
 */
export function assembleEkInPublic(fields) {
  const keyType = /** @type {EkKeyType} */ (fields.keyType);
  const expectedAlg = keyType === 'eccP256' ? TPM_ALG.ECC : TPM_ALG.RSA;
  const hasTemplate = Buffer.isBuffer(fields.templateBytes) && fields.templateBytes.length > 0;
  const hasNonce = Buffer.isBuffer(fields.nonceBytes) && fields.nonceBytes.length > 0;

  // (1) الغائبَانِ: القالبُ الافتراضيُّ L-1/L-2.
  if (!hasTemplate && !hasNonce) {
    return keyType === 'eccP256' ? defaultEkTemplateEccP256() : defaultEkTemplateRsa2048();
  }

  // (4) قالبٌ غائبٌ وnonce موجود: «MUST NOT be provisioned» ⇒ توقّفٌ لا CreatePrimary.
  if (!hasTemplate && hasNonce) {
    throw new GateError(
      GATE_ERRORS.IDENTITY_UNPROVEN,
      'T5',
      'case 4 (template absent + nonce present): unspecified and MUST NOT be provisioned — halt before CreatePrimary',
    );
  }

  // قالبٌ موجودٌ: يُحلَّلُ كاملًا بلا بايتٍ زائد، ونوعُهُ يطابقُ الشهادة، وnameAlg = SHA-256
  // (كلُّ ذلكَ يفرضهُ parseTpmtPublic على البايتاتِ نفسِها).
  const templateBytes = /** @type {Buffer} */ (fields.templateBytes);
  const parsed = parseTpmtPublic(templateBytes);
  if (parsed.type !== expectedAlg) {
    throw new CommandBuilderError(
      COMMAND_BUILDER_ERRORS.PUBLIC_INVALID,
      'TPMT_PUBLIC',
      `template type 0x${parsed.type.toString(16)} does not match certificate key type ${keyType}`,
    );
  }

  // (2) قالبٌ بلا nonce: القالبُ المقروءُ بلا تعديل.
  if (!hasNonce) return Buffer.from(templateBytes);

  // (3) الاثنانِ: القالبُ المقروءُ ثمّ الـnonce محشوًّا (الاستبدالُ الواعي بالتحليلِ في ekTemplateWithNonce).
  return ekTemplateWithNonce(templateBytes, /** @type {Buffer} */ (fields.nonceBytes), keyType === 'eccP256' ? 'ecc' : 'rsa');
}
