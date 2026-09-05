/**
 * جامعُ وقائعِ تقريرِ الجاهزيّةِ — **الملفُّ الوحيدُ** في هذه الخطوةِ الذي يلمس
 * القرصَ (الخطوة `M11.08`).
 *
 * والفصلُ مقصودٌ وليس ترتيباً: وحداتُ `src/readiness/` تحكم على وقائعَ تُمرَّر
 * إليها، وهذا الملفُّ يقرأ الملفَّاتَ ويحوِّلها وقائعَ. فحكمٌ يقرأ القرصَ بنفسِه
 * يستحيل اختبارُه بلا مستودعٍ كاملٍ، وحكمٌ يُمرَّر إليه نصٌّ يُختبَر بنصٍّ.
 *
 * **والدليلُ موضعٌ لا ادّعاءٌ** (الضمان `G-READINESS-EVIDENCE-POINTS-TO-DISK`): كلُّ
 * دليلٍ يخرج من هنا يحمل ملفَّه ومُدخلتَه؛ فما لا موضعَ له لا يُعَدُّ دليلاً.
 *
 * @module scripts/lib/readiness-facts
 */

import fs from 'node:fs';
import path from 'node:path';

import { auditDeferrals } from '../../src/readiness/deferrals.mjs';
import { READINESS_ERRORS, ReadinessError } from '../../src/readiness/errors.mjs';
import {
  evidenceFor,
  readRoadmapEvidenceRows,
  readWorkLogEntries,
} from '../../src/readiness/evidence.mjs';
import { readGates, readSteps } from '../../src/readiness/items.mjs';
import { judgeReadiness } from '../../src/readiness/judgement.mjs';

/**
 * @param {string} root
 * @param {string} relative
 * @returns {string}
 */
function readSource(root, relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    throw new ReadinessError(READINESS_ERRORS.SOURCE_MISSING, `مصدرٌ غائبٌ: ${relative}`, {
      relative,
    });
  }
  return fs.readFileSync(file, 'utf8');
}

/**
 * يقرأ أرقامَ الحقيقةِ الواحدةِ من `version.json` — لا من ذاكرةِ الكاتبِ.
 *
 * @param {string} root
 * @returns {{ version: string, percent: number, lastEntry: string }}
 */
function readProjectNumbers(root) {
  const parsed = JSON.parse(readSource(root, 'version.json'));
  const completion = /** @type {Record<string, unknown>} */ (parsed.completion ?? {});
  return {
    version: String(parsed.version ?? ''),
    percent: Number(completion.percent ?? 0),
    lastEntry: String(completion.last_entry ?? ''),
  };
}

/**
 * @param {{ root: string, contract: Record<string, unknown>, deferrals: import('../../src/readiness/deferrals.mjs').DeferralRecord[] }} input
 * @returns {{ items: import('../../src/readiness/judgement.mjs').CoveredItem[], judgement: import('../../src/readiness/judgement.mjs').ReadinessJudgement, project: { version: string, percent: number, counter: string, lastEntry: string } }}
 */
export function collectReadinessFacts(input) {
  const { root, contract, deferrals } = input;
  const sources = /** @type {Record<string, string>} */ (contract.sources);
  const roadmapText = readSource(root, sources.roadmap ?? '');
  const workLogText = readSource(root, sources.workLog ?? '');
  readSource(root, sources.status ?? '');

  const steps = readSteps(roadmapText);
  const gates = readGates(roadmapText);
  const entries = readWorkLogEntries(workLogText);
  const roadmapRows = readRoadmapEvidenceRows(roadmapText);
  const deferralById = new Map(deferrals.map((deferral) => [deferral.id, deferral]));

  /** @type {{ code: string, id: string, evidence: string }[]} */
  const countFaults = [];
  const itemSources = /** @type {{ id: string, expected: number }[]} */ (contract.itemSources);
  const measured = new Map([
    ['item:step', steps.length],
    ['item:gate', gates.length],
  ]);
  for (const source of itemSources) {
    const actual = measured.get(source.id);
    if (actual !== source.expected) {
      countFaults.push({
        code: READINESS_ERRORS.ITEM_COUNT_MISMATCH,
        id: source.id,
        evidence: `العقدُ يُعلن ${String(source.expected)} والقرصُ فيه ${String(actual)} — فمَن غيَّرَ جدولاً وسكتَ عن التقريرِ يُكشَف بالعدِّ.`,
      });
    }
  }

  /** @type {import('../../src/readiness/judgement.mjs').CoveredItem[]} */
  const items = [];
  for (const step of steps) {
    const deferral = deferralById.get(step.id) ?? null;
    const evidence = evidenceFor(step.id, {
      entries,
      roadmapRows,
      workLogPath: sources.workLog ?? '',
      roadmapPath: sources.roadmap ?? '',
    });
    /** @type {'evidenced' | 'deferred' | 'uncovered'} */
    let coverage = 'uncovered';
    if (deferral !== null) coverage = 'deferred';
    else if (step.statusMark === '✅' && evidence.length > 0) coverage = 'evidenced';
    items.push({
      id: step.id,
      kind: 'step',
      title: step.title,
      statusMark: step.statusMark,
      coverage,
      evidence,
      deferral,
    });
  }
  for (const gate of gates) {
    const deferral = deferralById.get(gate.id) ?? null;
    const evidence = evidenceFor(gate.id, {
      entries,
      roadmapRows,
      workLogPath: sources.workLog ?? '',
      roadmapPath: sources.roadmap ?? '',
    });
    items.push({
      id: gate.id,
      kind: 'gate',
      title: gate.statement,
      statusMark: deferral !== null ? '⬜' : '✅',
      coverage: deferral !== null ? 'deferred' : evidence.length > 0 ? 'evidenced' : 'uncovered',
      evidence,
      deferral,
    });
  }

  const completedIds = new Set(
    items.filter((item) => item.statusMark === '✅' && item.kind === 'step').map((item) => item.id),
  );
  const deferralFaults = auditDeferrals(deferrals, {
    knownIds: new Set(items.map((item) => item.id)),
    completedIds,
    workLogIds: new Set(entries.map((entry) => entry.id)),
  });

  const judgement = judgeReadiness({ items, deferralFaults, countFaults });
  const numbers = readProjectNumbers(root);
  const done = steps.filter((step) => step.statusMark === '✅').length;
  return {
    items,
    judgement,
    project: {
      version: numbers.version,
      percent: numbers.percent,
      counter: `${String(done)}/${String(steps.length)}`,
      lastEntry: numbers.lastEntry,
    },
  };
}
