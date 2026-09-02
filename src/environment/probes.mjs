/**
 * تقييمُ مجساتِ البيئةِ وحكمُ صحّتِها — **نقيٌّ بلا أثرٍ ولا قرصٍ ولا أمرٍ
 * يُشغَّل** (الخطوة `M10.05`).
 *
 * **الضمانُ `G-ENV-VERIFY-READ-ONLY` يُنفَّذ هنا بالبنيةِ لا بالنيّة:** هذه
 * الوحدةُ لا تستورد `node:fs` ولا `node:child_process` أصلاً، فلا تستطيع أن
 * تقرأ قرصاً ولا أن تُشغِّل أمراً ولا أن تُصلِح شيئاً. الوقائعُ **تُمرَّر**
 * إليها من `scripts/lib/environment-facts.mjs` — وفحصٌ يُصلِح ما يفحصه لا يُخبر
 * عن حالِ البيئةِ بل عن حالِ ما تركه هو.
 *
 * والضمانان الآخران هنا:
 *
 * `G-ENV-SEVERITY-DECIDES`: الحكمُ من **درجاتِ** الساقطِ لا من عدَدِه. فمجسٌّ
 * `critical` واحدٌ ساقطٌ ⇒ `unfit` ولو نجح تسعةٌ غيرُه؛ ولو كان الحكمُ نسبةً
 * لصار «تسعةٌ من عشرةٍ» يُقرأ نجاحاً والعاشرُ هو نُسخةُ Node.
 *
 * `G-ENV-NO-SILENT-PASS`: مجسٌّ لازمٌ **غائبٌ من النتيجةِ** يُوقف الحكمَ
 * بالرمزِ `ENV_PROBE_MISSING` — ولا يُقرأ غيابُه نجاحاً. فأخطرُ ما في فحصِ
 * الصحّةِ ليس المجسَّ الساقطَ بل المجسَّ الذي لم يُشغَّل ثم قُرئ الحكمُ كاملاً.
 *
 * @module environment/probes
 */

import { ENV_ERRORS, EnvironmentError } from './errors.mjs';

/**
 * @typedef {import('./contract.mjs').EnvironmentContract} EnvironmentContract
 * @typedef {import('./contract.mjs').EnvironmentProbe} EnvironmentProbe
 */

/**
 * واقعةُ مجسٍّ **مُمرَّرةٌ** من جامعِ الوقائع: هل تحقّق الشرطُ، وما التفصيلُ
 * الذي يُقرأ عند سقوطِه. و`observed` نصٌّ للقراءةِ لا للحكم.
 *
 * @typedef {object} ProbeObservation
 * @property {string} probe
 * @property {boolean} satisfied
 * @property {string} detail
 * @property {string} [observed]
 */

/**
 * @typedef {object} ProbeResult
 * @property {string} probe
 * @property {'tool' | 'variable' | 'directory' | 'file'} kind
 * @property {string} target
 * @property {'info' | 'warning' | 'critical'} severity
 * @property {boolean} satisfied
 * @property {string} detail
 * @property {string | null} observed
 */

/**
 * @typedef {object} HealthReport
 * @property {string} verdict
 * @property {number} exitCode
 * @property {ProbeResult[]} results
 * @property {ProbeResult[]} failed
 * @property {number} criticalFailures
 * @property {number} warningFailures
 * @property {string} statement
 */

/** الدرجاتُ المقبولةُ — **من وثيقةِ مركزِ العملياتِ** لا من قائمةٍ ثانيةٍ تُصان هنا. */
const PROBE_SEVERITIES = Object.freeze(['info', 'warning', 'critical']);

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 * @returns {never}
 */
function refuse(code, message, detail = {}) {
  throw new EnvironmentError(code, message, detail);
}

/**
 * تقييمُ وقائعِ المجساتِ على العقدِ: كلُّ واقعةٍ تُنسَب إلى مجسٍّ مُعلَنٍ، ولا
 * واقعتانِ لمجسٍّ واحد، ولا مجسَّ لازمٍ غائباً.
 *
 * @param {EnvironmentContract} contract
 * @param {ProbeObservation[]} observations
 * @returns {ProbeResult[]}
 */
export function evaluateProbes(contract, observations) {
  if (!Array.isArray(observations)) {
    refuse(
      ENV_ERRORS.PROBE_MISSING,
      'وقائعُ المجساتِ ليست قائمةً؛ ولا حكمَ يُصدَر على نقصٍ لا شكلَ له.',
    );
  }
  /** @type {Map<string, EnvironmentProbe>} */
  const declared = new Map(contract.probes.map((probe) => [probe.id, probe]));
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {ProbeResult[]} */
  const results = [];
  for (const observation of observations) {
    const probe = declared.get(observation.probe);
    if (probe === undefined) {
      refuse(
        ENV_ERRORS.PROBE_UNDECLARED,
        `واقعةٌ لمجسٍّ غيرِ مُعلَنٍ «${observation.probe}»؛ ومجسٌّ يُقيَّم ولم يُعلَن يُدخل في الحكمِ ما لم يُوافَق عليه.`,
        { probe: observation.probe },
      );
    }
    if (seen.has(observation.probe)) {
      refuse(
        ENV_ERRORS.PROBE_DUPLICATE,
        `نتيجتانِ للمجسِّ «${observation.probe}» في فحصٍ واحدٍ؛ فأيُّهما الحكمُ؟ ودفترٌ يقبل حكمين على شيءٍ واحدٍ دفترٌ لا يُقرأ.`,
        { probe: observation.probe },
      );
    }
    if (!PROBE_SEVERITIES.includes(probe.severity)) {
      refuse(
        ENV_ERRORS.SEVERITY_UNDECLARED,
        `درجةُ المجسِّ «${probe.id}» غيرُ مُعلَنةٍ «${probe.severity}».`,
        { probe: probe.id, severity: probe.severity },
      );
    }
    seen.add(observation.probe);
    results.push({
      probe: probe.id,
      kind: probe.kind,
      target: probe.target,
      severity: probe.severity,
      satisfied: observation.satisfied === true,
      detail: observation.detail,
      observed: observation.observed ?? null,
    });
  }
  for (const required of contract.healthCheck.requiredProbes) {
    if (!seen.has(required)) {
      refuse(
        ENV_ERRORS.PROBE_MISSING,
        `المجسُّ اللازمُ «${required}» غائبٌ من نتيجةِ الفحصِ؛ ومجسٌّ مُعلَنٌ لم يُشغَّل ثم قُرئ الحكمُ «صحيحاً» صمتٌ يُقرأ نجاحاً — وهو أخطرُ من مجسٍّ ساقط.`,
        { probe: required, required: contract.healthCheck.requiredProbes.length },
      );
    }
  }
  return results;
}

/**
 * حكمُ الصحّةِ من نتائجِ المجسات — **بالدرجاتِ لا بالعدَد**.
 *
 * @param {EnvironmentContract} contract
 * @param {ProbeResult[]} results
 * @returns {HealthReport}
 */
export function healthVerdict(contract, results) {
  const failed = results.filter((result) => !result.satisfied);
  const criticalFailures = failed.filter((result) => result.severity === 'critical').length;
  const warningFailures = failed.filter((result) => result.severity === 'warning').length;
  const verdict = criticalFailures > 0 ? 'unfit' : failed.length > 0 ? 'degraded' : 'healthy';
  const spec = contract.healthCheck.verdicts.find((entry) => entry.id === verdict);
  if (spec === undefined) {
    refuse(ENV_ERRORS.VERDICT_UNDECLARED, `حكمٌ غيرُ مُعلَنٍ «${verdict}».`, { verdict });
  }
  return {
    verdict,
    exitCode: spec.exitCode,
    results,
    failed,
    criticalFailures,
    warningFailures,
    statement: spec.statement,
  };
}
