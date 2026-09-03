#!/usr/bin/env node
/**
 * تمرينُ إسقاطِ إقليمٍ كاملٍ وقياسُ أثرِه — الخطوة `M10.07`.
 *
 * **معيارُ القبولِ بحرفِه:** «اختبار: إسقاط إقليم كامل ⇒ استمرار الخدمة بأثر
 * معلَن ومقبول». فهذا المنفِّذُ **يُسقِط إقليماً إسقاطاً حقيقيّاً** (يُزال جذرُ
 * حالتِه من القرصِ فلا يُقرأ ولا يُكتَب فيه)، ثم **يُنصِّب كاتباً بديلاً من تلقائِه**:
 * لا علمَ يُمرَّر لتعطيلِ التنصيب، ولا سؤالَ يُطرَح على مُشغِّلٍ، ولا انتظارَ إقرارٍ —
 * الضمانُ `G-REGION-FAILOVER-AUTOMATIC` منفَّذٌ في هذا الملفِّ بعينِه. ثم يُثبت
 * استمرارَ الخدمةِ بكتابةٍ فعليّةٍ مقبولةٍ في الكاتبِ الجديد، ويقيس الأثرَ ويحاسبه
 * على العهدِ المعلَن.
 *
 * والاستعمال:
 *
 * ```
 * node scripts/region-drill.mjs --drop region:primary [--root .] [--lag 0] [--no-seed] [--json]
 * ```
 *
 * و`--no-seed` يُجري التمرينَ على حالةٍ **مُهيَّأةٍ سابقاً** في الجذرِ المُمرَّرِ بدل
 * أن يُهيِّئها؛ فحالةٌ يُنشِئها المنفِّذُ نفسَه لا تُثبت أنه يقرأ حالةَ غيرِه، ولا
 * يُقاس بها رفضُ نسخةٍ لا تُقرأ أو دفترٍ لا يُفهَم.
 *
 * ورموزُ الخروجِ مقروءةٌ من العقدِ لا مكتوبةٌ هنا: `health:up` ⇒ 0، و`health:down`
 * ⇒ 72 عند فقدِ النصابِ أو غيابِ مرشَّحٍ أو تجاوزِ الأثرِ عهدَه، و`health:unmeasured`
 * ⇒ 73 عند غيابِ قياسٍ صالحٍ — فمن لم يُقَس لا يُقال إنه سليم.
 *
 * **حدٌّ معلَن:** الأقاليمُ في هذا التمرينِ **جذورُ حالةٍ على قرصٍ واحدٍ**، والنسخُ
 * **نسخُ ملفٍّ بتأخّرٍ مُمرَّرٍ صريحاً**، لا نسخٌ متدفِّقٌ بين مناطقِ مزوِّدٍ. وهو
 * مسجَّلٌ ديناً معلَناً في `docs/REMAINING_WORK.md` لا سهواً يُكتشَف.
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  assertQuorum,
  exitCodeFor,
  judgeAllRegions,
  judgeFailoverDuration,
  loadRegionsContract,
  measureImpact,
  planFailover,
  REGION_ERRORS,
  RegionError,
  requireRegion,
} from '../src/regions/index.mjs';
import {
  appendLedger,
  dropRegion,
  observeRegions,
  readWriterPointer,
  replicate,
  seedRegions,
  writeToWriter,
  writeWriterPointer,
} from './lib/region-facts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/**
 * @param {string[]} argv
 * @returns {{ drop: string | null, root: string, lagMs: number, seed: boolean, json: boolean }}
 */
function parseArguments(argv) {
  /** @type {{ drop: string | null, root: string, lagMs: number, seed: boolean, json: boolean }} */
  const options = { drop: null, root: ROOT, lagMs: 0, seed: true, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--drop') {
      options.drop = argv[index + 1] ?? null;
      index += 1;
    } else if (flag === '--root') {
      options.root = path.resolve(argv[index + 1] ?? '.');
      index += 1;
    } else if (flag === '--lag') {
      options.lagMs = Number(argv[index + 1] ?? '0');
      index += 1;
    } else if (flag === '--no-seed') {
      options.seed = false;
    } else if (flag === '--json') {
      options.json = true;
    } else {
      throw new RegionError(REGION_ERRORS.CONFIG_INVALID, `وسيطٌ غيرُ معروف: «${flag}».`);
    }
  }
  return options;
}

/** @returns {number} */
function now() {
  return Date.now();
}

const options = parseArguments(process.argv.slice(2));
const contract = loadRegionsContract();

/**
 * رمزُ الخروجِ المقروءُ من العقدِ لخطأِ مسارِ الأقاليم.
 *
 * @param {RegionError} error
 * @returns {number}
 */
function exitCodeForError(error) {
  /** @type {Set<string>} */
  const unmeasured = new Set([
    REGION_ERRORS.OBSERVATION_MISSING,
    REGION_ERRORS.OBSERVATION_INVALID,
    REGION_ERRORS.CLOCK_INVALID,
  ]);
  if (unmeasured.has(error.code)) {
    return exitCodeFor(contract, 'health:unmeasured');
  }
  return exitCodeFor(contract, 'health:down');
}

/** @type {Record<string, unknown>} */
const report = {
  drop: options.drop,
  consistencyModel: contract.consistency.model,
  maxReplicationLagMs: contract.consistency.maxReplicationLagMs,
  failover: null,
  impact: null,
  verdict: 'health:up',
  reason: null,
};

try {
  if (options.drop === null) {
    throw new RegionError(
      REGION_ERRORS.UNDECLARED,
      'لم يُحدَّد إقليمٌ لإسقاطِه (‏--drop) — وتمرينٌ لا يُسقِط شيئاً لا يُثبت استمراريّةً.',
    );
  }
  const dropped = requireRegion(contract, options.drop);

  // تهيئةٌ ثم كتابةٌ ثم نسخٌ بتأخّرٍ مُعلَنٍ: حالةُ ما قبل السقوطِ مبنيّةٌ لا مُفترَضة.
  if (options.seed) {
    seedRegions({ contract, root: options.root, at: now() });
    writeToWriter({ contract, root: options.root, record: 'pre-drop', at: now() });
    replicate({ contract, root: options.root, at: now(), lagMs: options.lagMs });
  }

  const pointerBefore = readWriterPointer(contract, options.root);
  if (pointerBefore === null) {
    throw new RegionError(REGION_ERRORS.WRITER_MISSING, 'لا مؤشِّرَ كاتبٍ بعد التهيئة.');
  }
  const lagBefore = judgeAllRegions({
    contract,
    observations: observeRegions({ contract, root: options.root, at: now() }),
  });
  const candidateLagAtDrop =
    lagBefore.find((judgement) => judgement.region !== pointerBefore.writer)?.replicationLagMs ?? 0;

  const droppedAt = now();
  dropRegion({ contract, root: options.root, region: dropped.id, at: droppedAt });

  const judgements = judgeAllRegions({
    contract,
    observations: observeRegions({ contract, root: options.root, at: now() }),
  });
  assertQuorum({ contract, judgements });

  if (dropped.id !== pointerBefore.writer) {
    // سقط قارئٌ لا كاتبٌ: الخدمةُ مستمرّةٌ بلا تنصيبٍ، ويُثبت ذلك بكتابةٍ مقبولةٍ.
    writeToWriter({ contract, root: options.root, record: 'post-drop', at: now() });
    report.reason = 'reader-dropped';
    emit(report, exitCodeFor(contract, 'health:up'));
  }

  const plan = planFailover({ contract, currentWriter: pointerBefore.writer, judgements });
  writeWriterPointer({
    contract,
    root: options.root,
    writer: plan.to,
    at: now(),
    automatic: true,
  });
  const accepted = writeToWriter({
    contract,
    root: options.root,
    record: 'post-failover',
    at: now(),
  });
  const writeAcceptedAt = now();
  const duration = judgeFailoverDuration({ contract, durationMs: writeAcceptedAt - droppedAt });
  const impact = measureImpact({
    contract,
    droppedAt,
    writeAcceptedAt,
    lagAtDropMs: candidateLagAtDrop,
  });

  report.failover = {
    from: plan.from,
    to: plan.to,
    reason: plan.reason,
    automatic: true,
    skipped: plan.skipped,
    durationMs: duration.durationMs,
    limitMs: duration.limitMs,
    withinLimit: duration.withinLimit,
    records: accepted.count,
  };
  report.impact = impact;

  if (!duration.withinLimit) {
    appendLedger({
      contract,
      root: options.root,
      at: now(),
      entry: {
        type: 'region.failover.refused',
        from: plan.from,
        to: plan.to,
        code: REGION_ERRORS.FAILOVER_TIMEOUT_EXCEEDED,
        durationMs: duration.durationMs,
      },
    });
    report.verdict = 'health:down';
    report.reason = REGION_ERRORS.FAILOVER_TIMEOUT_EXCEEDED;
    emit(report, exitCodeFor(contract, 'health:down'));
  }
  if (!impact.withinBudget) {
    appendLedger({
      contract,
      root: options.root,
      at: now(),
      entry: {
        type: 'region.failover.refused',
        from: plan.from,
        to: plan.to,
        code: impact.breach,
        unavailableMs: impact.unavailableMs,
      },
    });
    report.verdict = 'health:down';
    report.reason = impact.breach;
    emit(report, exitCodeFor(contract, 'health:down'));
  }

  appendLedger({
    contract,
    root: options.root,
    at: now(),
    entry: {
      type: 'region.failover.performed',
      from: plan.from,
      to: plan.to,
      reason: plan.reason,
      automatic: true,
      durationMs: duration.durationMs,
      unavailableMs: impact.unavailableMs,
      dataLossWindowMs: impact.dataLossWindowMs,
    },
  });
  appendLedger({
    contract,
    root: options.root,
    at: now(),
    entry: {
      type: 'region.drill.completed',
      dropped: dropped.id,
      writer: plan.to,
      unavailableMs: impact.unavailableMs,
      withinBudget: impact.withinBudget,
    },
  });
  emit(report, exitCodeFor(contract, 'health:up'));
} catch (error) {
  if (error instanceof RegionError) {
    report.verdict =
      exitCodeForError(error) === exitCodeFor(contract, 'health:unmeasured')
        ? 'health:unmeasured'
        : 'health:down';
    report.reason = error.code;
    report.message = error.message;
    emit(report, exitCodeForError(error));
  }
  throw error;
}

/**
 * إصدارُ التقريرِ ثم الخروجُ برمزِ الحكمِ — والمسارُ الآليُّ يقرأ الرمزَ.
 *
 * @param {Record<string, unknown>} payload
 * @param {number} code
 * @returns {never}
 */
function emit(payload, code) {
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('═══ تمرين إسقاط إقليم ═══');
    console.log(`   المُسقَط: ${String(payload.drop)}`);
    console.log(`   نموذج الاتساق: ${String(payload.consistencyModel)}`);
    const failover = /** @type {Record<string, unknown> | null} */ (payload.failover);
    if (failover !== null) {
      console.log(
        `   • تنصيبٌ آليٌّ بلا تدخّل: «${String(failover.to)}» بدل «${String(failover.from)}» في ${String(failover.durationMs)} ملّي ثانية.`,
      );
    }
    const impact = /** @type {Record<string, unknown> | null} */ (payload.impact);
    if (impact !== null) {
      console.log(
        `   • أثرٌ مقيس: انقطاعُ كتابةٍ ${String(impact.unavailableMs)}/${String(impact.maxUnavailableMs)} ملّي ثانية، ونافذةُ فقدٍ ${String(impact.dataLossWindowMs)}/${String(impact.maxDataLossMs)} ملّي ثانية.`,
      );
    }
    if (payload.verdict === 'health:up') {
      console.log(
        `✅ الخدمةُ استمرّت بعد إسقاط إقليمٍ كاملٍ: الكتابةُ قُبِلت في كاتبٍ نُصِّب آلياً، والأثرُ مقيسٌ بالرقمِ لا مقولٌ بالعبارة، ومحاسَبٌ على عهدٍ معلَنٍ في العقدِ لا على تقديرٍ لاحقٍ.`,
      );
    } else {
      console.log(`⛔ ${String(payload.verdict)}: ${String(payload.reason)}`);
    }
  }
  process.exit(code);
}
