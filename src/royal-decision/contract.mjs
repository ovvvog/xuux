/**
 * تحميلُ حزمةِ القرارِ الملكيِّ والتحقّقُ من أنّها **مُدخلٌ لا قرارٌ** — تجهيزُ
 * الخطوةِ `M11.09`.
 *
 * الخطرُ الذي تُغلِقُه هذه الوحدةُ: حزمةٌ يُجهِّزُها المنفِّذُ لقرارٍ سياديٍّ هي
 * أقربُ ملفٍّ إلى انتحالِ سلطةٍ؛ يكفي أن يُملأَ حقلُ `decision` أو أن يُكتَبَ لفظُ
 * اعتمادٍ حتى تُقرأَ الوثيقةُ قراراً لم يصدرْ. فالتحميلُ يرفضُ قبلَ التوليدِ:
 * حقولُ القرارِ الخمسةُ يجبُ أن تبقى فارغةً، والشروطُ السابقةُ يجبُ أن تكونَ
 * **مُعلَنةً مؤجَّلةً** في سجلِّ التأجيلاتِ لا مُقرَّرةً هنا، والحكمُ الأوّلُ
 * وحدَه يخرجُ صفراً (`G-ROYAL-DECISION-NO-SELF-SIGNATURE`).
 *
 * وما لا تفعلُه: لا تحكمُ على كفايةِ الأدلّةِ ولا على صوابِ القرارِ — ذلك للمالكِ.
 *
 * @module royal-decision/contract
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

// حزمةُ Ajv تُصدِّرُ صنفَها افتراضاً في ESM، فيُقرأُ نوعُه صريحاً وإلا صار «غيرَ
// قابلٍ للإنشاءِ» في الفحصِ الصارمِ — كما في وحدةِ الجاهزيّةِ قبلَها.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

import { loadDeferrals } from '../readiness/contract.mjs';
import { ROYAL_DECISION_ERRORS, RoyalDecisionError } from './errors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** جذرُ المستودعِ المستنتَجُ من موضعِ هذه الوحدةِ. */
export const REPO_ROOT = path.resolve(HERE, '..', '..');

/** الحكمُ الوحيدُ الذي يخرجُ صفراً. */
export const PREPARED_VERDICT = 'royal-decision:prepared';

/** الحقولُ التي يملؤها المالكُ وحدَه — وتبقى فارغةً في التجهيزِ. */
export const OWNER_ONLY_FIELDS = Object.freeze([
  'decision',
  'signature',
  'signedBy',
  'issuedAt',
  'recordedEventId',
]);

/**
 * @typedef {object} RoyalDecisionPacketConfig
 * @property {string} version
 * @property {string} declaredIn
 * @property {string} decisionId
 * @property {string} step
 * @property {string} subject
 * @property {string} authority
 * @property {null} decision
 * @property {null} signature
 * @property {{ decides: string[], doesNotDecide: string[] }} scope
 * @property {{ id: string, requirement: string, statusSource: string }[]} preconditions
 * @property {{ id: string, meaning: string, consequences: string[], requiredArtifacts: string[] }[]} options
 * @property {Record<string, unknown>} signatureRequirement
 * @property {Record<string, unknown>} auditRecord
 * @property {{ proposed: boolean, phases: Record<string, unknown>[] }} rolloutPlan
 * @property {{ id: string, exitCode: number, meaning: string }[]} verdicts
 * @property {string[]} refusalCodes
 * @property {{ id: string, statement: string }[]} guarantees
 */

/**
 * يقرأُ العقدَ ويتحقّقُ من مخطَّطِه ثم من ترابطِه مع سجلِّ التأجيلاتِ.
 * @param {{ configDir?: string }} [options]
 * @returns {RoyalDecisionPacketConfig}
 */
export function loadRoyalDecisionPacket(options = {}) {
  const configDir = options.configDir ?? path.join(REPO_ROOT, 'config');
  const file = path.join(configDir, 'royal-decision.yaml');
  if (!fs.existsSync(file)) {
    throw new RoyalDecisionError(
      ROYAL_DECISION_ERRORS.CONFIG_INVALID,
      `حزمةُ القرارِ غائبةٌ: ${file}`,
      { file },
    );
  }
  const parsed = /** @type {Record<string, unknown>} */ (YAML.parse(fs.readFileSync(file, 'utf8')));
  // القرارُ يُفحَص **قبلَ** المخطَّطِ: حقلٌ مملوءٌ انتحالُ سلطةٍ لا مخالفةُ صياغةٍ،
  // فلا يُقرأ «نقصاً في التجهيزِ» ولا يُخفى تحت رسالةِ مخطَّطٍ.
  assertUnsigned(parsed);
  const schema = JSON.parse(
    fs.readFileSync(path.join(configDir, 'schemas', 'royal-decision.schema.json'), 'utf8'),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  if (!validate(parsed)) {
    const errors = (validate.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim())
      .join('؛ ');
    throw new RoyalDecisionError(
      ROYAL_DECISION_ERRORS.CONFIG_INVALID,
      `حزمةُ القرارِ تخالفُ مخطَّطَها: ${errors}`,
      { file },
    );
  }
  const packet = /** @type {RoyalDecisionPacketConfig} */ (/** @type {unknown} */ (parsed));
  assertUnsigned(packet);
  assertVerdicts(packet);
  assertPreconditionsDeferred(packet, { configDir });
  return packet;
}

/**
 * يرفضُ أيَّ قرارٍ أو توقيعٍ مكتوبٍ في حزمةِ التجهيزِ.
 * @param {Record<string, unknown>} packet
 * @returns {void}
 */
export function assertUnsigned(packet) {
  for (const field of OWNER_ONLY_FIELDS) {
    if (packet[field] !== null) {
      throw new RoyalDecisionError(
        ROYAL_DECISION_ERRORS.SELF_SIGNED,
        `الحقلُ «${field}» مملوءٌ في حزمةِ تجهيزٍ — والقرارُ لا يُكتَبُ نيابةً عن المالكِ.`,
        { field },
      );
    }
  }
}

/**
 * @param {RoyalDecisionPacketConfig} packet
 * @returns {void}
 */
function assertVerdicts(packet) {
  const codes = new Set(packet.verdicts.map((verdict) => verdict.exitCode));
  if (codes.size !== packet.verdicts.length) {
    throw new RoyalDecisionError(
      ROYAL_DECISION_ERRORS.CONFIG_INVALID,
      'حكمانِ يتشاركانِ رمزَ خروجٍ واحداً — فلا يُميَّزُ أحدُهما من الآخرِ آلياً.',
    );
  }
  const zero = packet.verdicts.filter((verdict) => verdict.exitCode === 0);
  if (zero.length !== 1 || zero[0]?.id !== PREPARED_VERDICT) {
    throw new RoyalDecisionError(
      ROYAL_DECISION_ERRORS.CONFIG_INVALID,
      `الحكمُ «${PREPARED_VERDICT}» وحدَه يخرجُ صفراً — والعقدُ يخالفُ ذلك.`,
    );
  }
  const optionIds = packet.options.map((option) => option.id);
  for (const required of ['approve', 'defer', 'reject']) {
    if (!optionIds.includes(required)) {
      throw new RoyalDecisionError(
        ROYAL_DECISION_ERRORS.OPTION_INCOMPLETE,
        `الخيارُ «${required}» غائبٌ — وحزمةٌ بخيارَينِ تُرجِّحُ ثالثاً بصمتِها.`,
        { option: required },
      );
    }
  }
}

/**
 * يُثبِتُ أنَّ كلَّ شرطٍ سابقٍ **مُعلَنٌ مؤجَّلاً** في سجلِّ التأجيلاتِ: فحزمةٌ
 * تذكرُ شرطاً لا أثرَ له في السجلِّ تُقرأُ استيفاءً ضمنياً.
 * @param {RoyalDecisionPacketConfig} packet
 * @param {{ configDir?: string }} [options]
 * @returns {void}
 */
export function assertPreconditionsDeferred(packet, options = {}) {
  const deferrals = loadDeferrals(options);
  const declared = new Set(deferrals.map((deferral) => String(deferral.id)));
  const missing = packet.preconditions
    .map((precondition) => precondition.id)
    .filter((id) => !declared.has(id));
  if (missing.length > 0) {
    throw new RoyalDecisionError(
      ROYAL_DECISION_ERRORS.PRECONDITION_UNDECLARED,
      `شرطٌ سابقٌ غيرُ معلَنٍ مؤجَّلاً في سجلِّ التأجيلاتِ: ${missing.join('، ')}`,
      { missing },
    );
  }
}

/**
 * يُثبِتُ أنَّ صفَّ `M11.09` في لوحةِ الخطواتِ ما زال `⬜`: تجهيزُ الحزمةِ لا
 * يُغلِقُ خطوةً (`G-ROYAL-DECISION-STEP-STAYS-OPEN`).
 * @param {{ root?: string }} [options]
 * @returns {void}
 */
export function assertStepOpen(options = {}) {
  const root = options.root ?? REPO_ROOT;
  const roadmap = fs.readFileSync(
    path.join(root, 'docs', 'roadmap', '03-roadmap-to-100.md'),
    'utf8',
  );
  const row = roadmap.split('\n').find((line) => line.includes('| M11.09 |'));
  if (row === undefined) {
    throw new RoyalDecisionError(
      ROYAL_DECISION_ERRORS.STEP_CLOSED,
      'صفُّ «M11.09» غائبٌ عن لوحةِ الخطواتِ — ولا تُجهَّزُ حزمةٌ لخطوةٍ بلا صفٍّ.',
    );
  }
  if (!row.trimEnd().endsWith('⬜ |')) {
    throw new RoyalDecisionError(
      ROYAL_DECISION_ERRORS.STEP_CLOSED,
      'صفُّ «M11.09» ليس `⬜` — وتجهيزُ الحزمةِ لا يُغلِقُ خطوةً ولا يرفعُ نسبةً.',
      { row: row.trim() },
    );
  }
}
