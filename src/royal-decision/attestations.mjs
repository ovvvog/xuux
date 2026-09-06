/**
 * حراسةُ **الاعتمادِ** في حزمةِ القرارِ الملكيِّ — قاعدةُ `R6` بعدَ تحويلِها إلى
 * تحقّقٍ **مغلقٍ على الفشلِ** (‏`fail-closed`)، تجهيزَ الخطوةِ `M11.09`.
 *
 * **العيبُ الذي أُزيلَ:** كانت `R6` تبحثُ عن **قائمةِ ألفاظٍ ممنوعةٍ**
 * (`VERIFIED`، `APPROVED`، «جاهزٌ للإطلاقِ»، …) في نصِّ العقدِ والوثيقةِ، ثمَّ
 * **تتجاوزُ السطرَ كلَّه** إن حملَ أداةَ نفيٍ. فكانَ فيها بابانِ:
 *
 *   1. **بابُ الصياغةِ:** قائمةُ الممنوعِ لا تنتهي، فأيُّ صياغةِ اعتمادٍ لم تُعَدَّ
 *      فيها تمرُّ — وهذا هو الدَينُ الذي كانَ معلَناً في `docs/REMAINING_WORK.md`.
 *   2. **بابُ النفيِ:** سطرٌ يحملُ لفظَ اعتمادٍ **وأداةَ نفيٍ** كانَ يُتجاوَزُ
 *      بأكملِه، فيمرُّ الاعتمادُ راكباً على النفيِ.
 *
 * **القاعدةُ الجديدةُ تقلبُ الاتجاهَ:** لا تُعدُّ الممنوعاتُ، بل **يُوجَبُ المسموحُ**.
 *
 *   أ. **الاعتمادُ لا يُقالُ إلا في حقلٍ مُقيَّدٍ:** كلُّ حكمِ حالةٍ في الحزمةِ
 *      يُكتَبُ في `attestations` وحدَها، وكلُّ عنصرٍ فيها ثلاثةُ حقولٍ:
 *      `subject` (الموضوعُ) و`valueSource` (مصدرُ القيمِ المسموحةِ) و`value`.
 *   ب. **القيمةُ من مصدرٍ فعليٍّ في المستودعِ لا من قائمةٍ مخترعةٍ:** لكلِّ
 *      `valueSource` مُحلِّلٌ يقرأُ مجموعةَ القيمِ المسموحةِ من الملفِّ الحقيقيِّ:
 *      رموزُ الحالةِ من سطرِ الرموزِ في `docs/roadmap/03-roadmap-to-100.md`،
 *      وأنواعُ الحواجزِ من `config/readiness-deferrals.yaml`، وأحكامُ الحزمةِ من
 *      `verdicts` في العقدِ نفسِه.
 *   ج. **المطابقةُ بايتاً ببايتٍ:** `value === عنصرٌ في المجموعةِ` بلا تشذيبٍ ولا
 *      توحيدِ حالةِ حرفٍ؛ فقيمةٌ فيها فراغٌ زائدٌ أو حرفٌ كبيرٌ أو نصٌّ إضافيٌّ أو
 *      قيمتانِ في حقلٍ واحدٍ **تُرَدُّ**.
 *   د. **القيمةُ تُقابَلُ بالواقعِ لا بالمجموعةِ وحدَها:** يُقرأُ الموضوعُ من مصدرِه
 *      (صفُّ الخطوةِ في اللوحةِ، أو مُدخلةُ التأجيلِ) فإن خالفَ المكتوبُ المقروءَ
 *      رُدَّ. **فلا يُكتَبُ اعتمادٌ لا يُثبِتُه مصدرُ الحقيقةِ.**
 *   ه. **الفشلُ مغلقٌ:** غيابُ الحقلِ، أو مصدرٌ غيرُ معروفٍ، أو موضوعٌ لا يُقرأُ،
 *      أو مجموعةٌ فارغةٌ، أو تكرارُ موضوعٍ — كلُّها رفضٌ لا تجاوزٌ.
 *   و. **النصُّ الحرُّ لا يحملُ حكماً أصلاً:** كلُّ رمزِ ادّعاءٍ في النصِّ (رمزُ حالةٍ،
 *      أو نسبةٌ مئويّةٌ، أو كلمةٌ لاتينيّةٌ كبيرةٌ) يجبُ أن يكونَ عضواً في مجموعةِ
 *      الرموزِ **المسموحةِ المستخرجةِ من الحقولِ المُعرِّفةِ ومن مصادرِ الحقيقةِ**؛
 *      وما ليسَ عضواً يُرَدُّ. **ولا استثناءَ بأداةِ نفيٍ** — البابُ الثاني مسدودٌ.
 *
 * **حدٌّ معلَنٌ ولا يُطوى:** هذا يمنعُ **الاعتمادَ كقيمةٍ** ويمنعُ رموزَ الادّعاءِ في
 * النصِّ؛ ولا يحكمُ على صوابِ القرارِ ولا على كفايةِ أدلّتِه — ذاك للمالكِ وحدَه.
 * ومرورُه ليس قراراً ولا توقيعاً ولا جاهزيّةً ولا إطلاقاً.
 *
 * @module royal-decision/attestations
 */

import fs from 'node:fs';
import path from 'node:path';

import YAML from 'yaml';

import { ROYAL_DECISION_ERRORS, RoyalDecisionError } from './errors.mjs';

/** أدنى طولٍ لكلمةٍ لاتينيّةٍ كبيرةٍ تُقاسُ رمزَ ادّعاءٍ — حدٌّ معلَنٌ لا مضمَرٌ. */
export const CLAIM_TOKEN_MIN_LENGTH = 2;

/** مصادرُ القيمِ المسموحةِ: مصدرٌ غيرُ مذكورٍ هنا يُرَدُّ (`fail-closed`). */
export const ATTESTATION_VALUE_SOURCES = Object.freeze([
  'roadmap-step-status',
  'readiness-deferral-blocker-kind',
  'royal-decision-verdict',
]);

/**
 * رموزُ الحالةِ المسموحةُ **مقروءةٌ من سطرِ الرموزِ في لوحةِ الطريقِ** لا مكتوبةٌ
 * هنا: من غيَّرَ اللوحةَ غيَّرَ المجموعةَ، ومن أفرغَها أوقفَ الحاجزَ.
 * @param {string} root
 * @returns {Set<string>}
 */
export function readRoadmapStatusGlyphs(root) {
  const file = path.join(root, 'docs', 'roadmap', '03-roadmap-to-100.md');
  const text = readOrThrow(file);
  const legend = text.split('\n').find((line) => line.startsWith('- رموز الحالة:'));
  if (legend === undefined) {
    throw new RoyalDecisionError(
      ROYAL_DECISION_ERRORS.CONFIG_INVALID,
      'سطرُ رموزِ الحالةِ غائبٌ عن لوحةِ الطريقِ — ولا تُستخرَجُ مجموعةُ قيمٍ من ملفٍّ لا يُعلِنُها.',
      { file },
    );
  }
  const glyphs = new Set(
    (legend.match(/`([^`]+)`/g) ?? []).map((quoted) => quoted.slice(1, -1)).filter(isGlyph),
  );
  if (glyphs.size === 0) {
    throw new RoyalDecisionError(
      ROYAL_DECISION_ERRORS.CONFIG_INVALID,
      'سطرُ رموزِ الحالةِ لا يحملُ رمزاً واحداً — ومجموعةٌ فارغةٌ تُوقفُ الحاجزَ ولا تُوسِّعُه.',
      { file },
    );
  }
  return glyphs;
}

/**
 * @param {string} candidate
 * @returns {boolean}
 */
function isGlyph(candidate) {
  return /^[^\p{L}\p{N}\s]{1,3}$/u.test(candidate);
}

/**
 * أنواعُ الحواجزِ المسموحةُ **مقروءةٌ من سجلِّ التأجيلاتِ** نفسِه.
 * @param {string} configDir
 * @returns {{ kinds: Set<string>, byId: Map<string, string> }}
 */
export function readDeferralBlockerKinds(configDir) {
  const file = path.join(configDir, 'readiness-deferrals.yaml');
  const parsed = /** @type {{ deferrals?: unknown }} */ (YAML.parse(readOrThrow(file)));
  const rows = Array.isArray(parsed.deferrals) ? parsed.deferrals : [];
  /** @type {Set<string>} */
  const kinds = new Set();
  /** @type {Map<string, string>} */
  const byId = new Map();
  for (const row of rows) {
    const record = /** @type {Record<string, unknown>} */ (row);
    const id = typeof record.id === 'string' ? record.id : '';
    const kind = typeof record.blockerKind === 'string' ? record.blockerKind : '';
    if (id === '' || kind === '') continue;
    kinds.add(kind);
    byId.set(id, kind);
  }
  if (kinds.size === 0) {
    throw new RoyalDecisionError(
      ROYAL_DECISION_ERRORS.CONFIG_INVALID,
      'سجلُّ التأجيلاتِ بلا نوعِ حاجزٍ واحدٍ — ولا تُقرأُ قيمةٌ مسموحةٌ من سجلٍّ فارغٍ.',
      { file },
    );
  }
  return { kinds, byId };
}

/**
 * حالةُ خطوةٍ **مقروءةٌ من صفِّها في اللوحةِ** لا من الحزمةِ.
 * @param {string} root
 * @param {string} step
 * @returns {string}
 */
export function readRoadmapStepStatus(root, step) {
  const file = path.join(root, 'docs', 'roadmap', '03-roadmap-to-100.md');
  const text = readOrThrow(file);
  const row = text.split('\n').find((line) => line.includes(`| ${step} |`));
  if (row === undefined) {
    throw new RoyalDecisionError(
      ROYAL_DECISION_ERRORS.SELF_APPROVAL,
      `الموضوعُ «step:${step}» لا صفَّ له في لوحةِ الطريقِ — وحكمٌ على موضوعٍ لا يُقرأُ حكمٌ لا يُثبَتُ.`,
      { step },
    );
  }
  const cells = row.split('|').map((cell) => cell.trim());
  const last = cells.filter((cell) => cell !== '').at(-1) ?? '';
  return last;
}

/**
 * يبني مجموعةَ القيمِ المسموحةِ لكلِّ مصدرٍ من **الملفاتِ الفعليّةِ**.
 * @param {{ root: string, configDir: string, packet: Record<string, unknown> }} context
 * @returns {Map<string, Set<string>>}
 */
export function resolveAllowedAttestationValues(context) {
  const verdicts = /** @type {{ id?: unknown }[]} */ (
    Array.isArray(context.packet.verdicts) ? context.packet.verdicts : []
  );
  const verdictIds = new Set(
    verdicts.map((verdict) => (typeof verdict.id === 'string' ? verdict.id : '')).filter(Boolean),
  );
  if (verdictIds.size === 0) {
    throw new RoyalDecisionError(
      ROYAL_DECISION_ERRORS.CONFIG_INVALID,
      'العقدُ بلا حكمٍ واحدٍ معلَنٍ — ولا تُشتَقُّ مجموعةُ أحكامٍ من عقدٍ صامتٍ.',
    );
  }
  return new Map([
    ['roadmap-step-status', readRoadmapStatusGlyphs(context.root)],
    ['readiness-deferral-blocker-kind', readDeferralBlockerKinds(context.configDir).kinds],
    ['royal-decision-verdict', verdictIds],
  ]);
}

/**
 * القيمةُ **الواقعيّةُ** للموضوعِ مقروءةً من مصدرِه.
 * @param {string} subject
 * @param {{ root: string, configDir: string }} context
 * @returns {string}
 */
export function resolveActualAttestationValue(subject, context) {
  if (subject.startsWith('step:')) {
    return readRoadmapStepStatus(context.root, subject.slice('step:'.length));
  }
  if (subject.startsWith('deferral:')) {
    const id = subject.slice('deferral:'.length);
    const actual = readDeferralBlockerKinds(context.configDir).byId.get(id);
    if (actual === undefined) {
      throw new RoyalDecisionError(
        ROYAL_DECISION_ERRORS.SELF_APPROVAL,
        `الموضوعُ «${subject}» لا مُدخلةَ تأجيلٍ له — ولا يُحكَمُ على ما لا يُقرأُ.`,
        { subject },
      );
    }
    return actual;
  }
  if (subject === 'packet:self') {
    return 'royal-decision:prepared';
  }
  throw new RoyalDecisionError(
    ROYAL_DECISION_ERRORS.SELF_APPROVAL,
    `الموضوعُ «${subject}» غيرُ معروفٍ — ومَن لا يُعرَفُ موضوعُه لا يُقاسُ حكمُه (فشلٌ مغلقٌ).`,
    { subject },
  );
}

/**
 * يُثبِتُ أنَّ كلَّ حكمِ حالةٍ في الحزمةِ **قيمةٌ مسموحةٌ صريحاً ومطابقةٌ للواقعِ**.
 * @param {Record<string, unknown>} packet
 * @param {{ root: string, configDir: string }} context
 * @returns {{ subject: string, value: string }[]}
 */
export function assertAttestations(packet, context) {
  const raw = packet.attestations;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new RoyalDecisionError(
      ROYAL_DECISION_ERRORS.CONFIG_INVALID,
      'حقلُ `attestations` غائبٌ أو فارغٌ — وحزمةٌ بلا قناةٍ مُقيَّدةٍ للحكمِ تُتركُ أحكامُها للنصِّ الحرِّ.',
    );
  }
  const allowed = resolveAllowedAttestationValues({ ...context, packet });
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {{ subject: string, value: string }[]} */
  const verified = [];
  for (const item of raw) {
    const record = /** @type {Record<string, unknown>} */ (item);
    const subject = record.subject;
    const source = record.valueSource;
    const value = record.value;
    if (typeof subject !== 'string' || subject === '') {
      throw new RoyalDecisionError(
        ROYAL_DECISION_ERRORS.CONFIG_INVALID,
        'حكمٌ بلا موضوعٍ مكتوبٍ — والفشلُ مغلقٌ عندَ غيابِ الحقلِ.',
      );
    }
    if (seen.has(subject)) {
      throw new RoyalDecisionError(
        ROYAL_DECISION_ERRORS.SELF_APPROVAL,
        `الموضوعُ «${subject}» مُكرَّرٌ — وحكمانِ على موضوعٍ واحدٍ يُتيحانِ اختيارَ الأنفعِ منهما.`,
        { subject },
      );
    }
    seen.add(subject);
    if (typeof source !== 'string' || !ATTESTATION_VALUE_SOURCES.includes(source)) {
      throw new RoyalDecisionError(
        ROYAL_DECISION_ERRORS.SELF_APPROVAL,
        `مصدرُ القيمِ «${String(source)}» غيرُ معروفٍ للموضوعِ «${subject}» — والمصدرُ المجهولُ يُرَدُّ لا يُقبَلُ.`,
        { subject, source },
      );
    }
    if (typeof value !== 'string' || value === '') {
      throw new RoyalDecisionError(
        ROYAL_DECISION_ERRORS.SELF_APPROVAL,
        `الحكمُ على «${subject}» بلا قيمةٍ مكتوبةٍ — وقيمةٌ فارغةٌ ليست حكماً صالحاً.`,
        { subject },
      );
    }
    const set = allowed.get(source) ?? new Set();
    if (!set.has(value)) {
      throw new RoyalDecisionError(
        ROYAL_DECISION_ERRORS.SELF_APPROVAL,
        `القيمةُ «${value}» ليست عضواً في مجموعةِ «${source}» المقروءةِ من مصدرِها — والمطابقةُ تامّةٌ لا جزئيّةٌ ولا مُشذَّبةٌ.`,
        { subject, source, value, allowed: [...set] },
      );
    }
    const actual = resolveActualAttestationValue(subject, context);
    if (actual !== value) {
      throw new RoyalDecisionError(
        ROYAL_DECISION_ERRORS.SELF_APPROVAL,
        `الحكمُ على «${subject}» مكتوبٌ «${value}» ومصدرُ الحقيقةِ يقولُ «${actual}» — ولا يُكتَبُ اعتمادٌ لا يُثبِتُه مصدرُه.`,
        { subject, value, actual },
      );
    }
    verified.push({ subject, value });
  }
  return verified;
}

/**
 * يستخرجُ رموزَ الادّعاءِ من نصٍّ: رمزُ حالةٍ، أو نسبةٌ مئويّةٌ، أو كلمةٌ لاتينيّةٌ
 * كبيرةٌ. والاستخراجُ **شكليٌّ لا معجميٌّ**: لا قائمةَ ألفاظٍ ممنوعةٍ فيه.
 * @param {string} text
 * @param {Set<string>} glyphs
 * @returns {string[]}
 */
export function collectClaimTokens(text, glyphs) {
  /** @type {string[]} */
  const tokens = [];
  const latin = new RegExp(`[A-Z][A-Z0-9_-]{${String(CLAIM_TOKEN_MIN_LENGTH - 1)},}`, 'g');
  for (const match of text.matchAll(latin)) tokens.push(match[0]);
  for (const match of text.matchAll(/[0-9]{1,3}\s?%/g)) tokens.push(match[0]);
  for (const glyph of glyphs) {
    if (text.includes(glyph)) tokens.push(glyph);
  }
  return tokens;
}

/**
 * مجموعةُ رموزِ الادّعاءِ **المسموحةِ**: مستخرجةٌ من الحقولِ المُعرِّفةِ في العقدِ،
 * ومن مُعرِّفاتِ لوحةِ الطريقِ، ومن اسمِ مسارِ التكاملِ، ومن الأحكامِ المُثبَتةِ.
 * وما ليسَ فيها يُرَدُّ.
 * @param {Record<string, unknown>} packet
 * @param {{ root: string, glyphs: Set<string>, verified: { subject: string, value: string }[] }} context
 * @returns {Set<string>}
 */
export function resolvePermittedClaimTokens(packet, context) {
  /** @type {string[]} */
  const identifierText = [];
  const push = (/** @type {unknown} */ value) => {
    if (typeof value === 'string') identifierText.push(value);
  };
  for (const key of ['decisionId', 'step', 'declaredIn', 'version', 'authority']) push(packet[key]);
  for (const item of asArray(packet.preconditions)) {
    push(item.id);
    push(item.statusSource);
  }
  for (const item of asArray(packet.options)) push(item.id);
  for (const item of asArray(packet.verdicts)) push(item.id);
  for (const item of asArray(packet.guarantees)) push(item.id);
  for (const item of asArray(packet.attestations)) {
    push(item.subject);
    push(item.valueSource);
    push(item.value);
  }
  for (const code of Array.isArray(packet.refusalCodes) ? packet.refusalCodes : []) push(code);
  const signature = /** @type {Record<string, unknown>} */ (packet.signatureRequirement ?? {});
  for (const key of [
    'algorithm',
    'encoding',
    'signedPayload',
    'action',
    'target',
    'verifiedBy',
    'verifierEntry',
  ]) {
    push(signature[key]);
  }
  for (const field of Array.isArray(signature.envelopeFields) ? signature.envelopeFields : []) {
    push(field);
  }
  const audit = /** @type {Record<string, unknown>} */ (packet.auditRecord ?? {});
  push(audit.eventSource);
  push(audit.ledger);
  for (const type of Array.isArray(audit.requiredEventTypes) ? audit.requiredEventTypes : []) {
    push(type);
  }
  const rollout = /** @type {Record<string, unknown>} */ (packet.rolloutPlan ?? {});
  for (const phase of asArray(rollout.phases)) push(phase.id);

  // مُعرِّفاتُ الخطواتِ والبواباتِ **مقروءةٌ من لوحةِ الطريقِ**: ذكرُ مُعرِّفٍ ليس
  // حكماً على حالتِه، والحكمُ لا يُقالُ إلا في `attestations`.
  const roadmap = readOrThrow(path.join(context.root, 'docs', 'roadmap', '03-roadmap-to-100.md'));
  for (const match of roadmap.matchAll(/\b(?:M\d{1,2}(?:\.\d{2})?|G\d{1,2})\b/g)) {
    identifierText.push(match[0]);
  }
  // اسمُ مسارِ التكاملِ مقروءٌ من المسارِ نفسِه لا مكتوبٌ هنا.
  const workflow = readOrThrow(path.join(context.root, '.github', 'workflows', 'ci.yml'));
  for (const line of workflow.split('\n')) {
    const named = /^name:\s*(.+)$/.exec(line.trim());
    if (named?.[1] !== undefined) identifierText.push(named[1].trim());
  }

  /** @type {Set<string>} */
  const permitted = new Set();
  for (const value of identifierText) {
    for (const token of collectClaimTokens(value, context.glyphs)) permitted.add(token);
  }
  for (const attestation of context.verified) {
    for (const token of collectClaimTokens(attestation.value, context.glyphs)) permitted.add(token);
  }
  return permitted;
}

/**
 * يرفضُ أيَّ رمزِ ادّعاءٍ في نصٍّ حرٍّ ليسَ عضواً في المجموعةِ المسموحةِ —
 * **بلا استثناءٍ بأداةِ نفيٍ**.
 * @param {{ relative: string, text: string }[]} files
 * @param {{ permitted: Set<string>, glyphs: Set<string> }} context
 * @returns {{ relative: string, line: number, token: string }[]}
 */
export function findUnpermittedClaims(files, context) {
  /** @type {{ relative: string, line: number, token: string }[]} */
  const found = [];
  for (const file of files) {
    for (const [index, line] of file.text.split('\n').entries()) {
      for (const token of new Set(collectClaimTokens(line, context.glyphs))) {
        if (context.permitted.has(token)) continue;
        found.push({ relative: file.relative, line: index + 1, token });
      }
    }
  }
  return found;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>[]}
 */
function asArray(value) {
  return Array.isArray(value) ? /** @type {Record<string, unknown>[]} */ (value) : [];
}

/**
 * @param {string} file
 * @returns {string}
 */
function readOrThrow(file) {
  if (!fs.existsSync(file)) {
    throw new RoyalDecisionError(
      ROYAL_DECISION_ERRORS.CONFIG_INVALID,
      `مصدرُ القيمِ المسموحةِ غائبٌ: ${file} — والفشلُ مغلقٌ عندَ غيابِ المصدرِ.`,
      { file },
    );
  }
  return fs.readFileSync(file, 'utf8');
}
