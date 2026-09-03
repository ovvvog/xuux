/**
 * جامعُ وقائعِ الفوضى وحاقنُ عطبِها — الخطوة `M10.09`.
 *
 * **هذا هو الموضعُ الوحيدُ الذي يلمس عمليّةً وقرصاً وساعةً** في مسارِ الفوضى
 * كلِّه؛ ووحداتُ `src/chaos/` نقيّةٌ لا تستورد `node:fs` ولا
 * `node:child_process` أصلاً فلا تستطيع أن تفعل (‏`G-CHAOS-PURE-JUDGEMENT`).
 *
 * والضمانُ الأوّلُ المُنفَّذُ هنا `G-CHAOS-REAL-FAULTS`: العطبُ **يقع**. تُقتل
 * عمليّةٌ ابنٌ حقيقيّةٌ بـ`SIGKILL`، ويُقاس تأخّرٌ حقيقيٌّ على ساعةٍ، ويُوجَّه
 * الدفترُ إلى جهازٍ يردُّ الكتابةَ بـ`ENOSPC` من النواةِ، ويُدَسُّ سطرٌ فاسدٌ
 * في دفترٍ قائمٍ، ويُكتب سجلٌّ تاريخُه في المستقبل. **ولا علَمَ مُحاكاةٍ
 * يُمرَّر:** لأنّ فوضى تُحاكى بعلَمٍ هي في الحقيقةِ اختبارُ العلَمِ لا اختبارُ
 * النظام، وأوّلُ ما يُكتشَف في يومٍ ضيّقٍ أنّ العلَمَ كان مرفوعاً والعطبُ لم
 * يقع أصلاً.
 *
 * والضمانُ الثاني `G-CHAOS-INJECTED-CLOCK`: كلُّ زمنٍ يُكتب في الدفترِ أو
 * يُحسَب به قياسٌ يصل **مُعامِلاً** `at` ويُرَدُّ إن لم يكن عدداً صحيحاً
 * منتهياً. والاستثناءُ الوحيدُ المعلَنُ قياسُ **مدّةِ** التأخّرِ الحقيقيِّ في
 * تجربةِ `chaos:network-delay`: فمدّةٌ حقيقيّةٌ لا تُقاس بساعةٍ مُمرَّرةٍ من
 * الاختبارِ — لو قِيست بها لصار العطبُ رقماً يُكتَب لا تأخّراً يقع — فتُقاس
 * بساعةٍ **تُمرَّر دالّةً** `monotonic` يُحدِّدها المنفِّذُ، فتبقى قابلةً
 * للتثبيتِ في اختبارٍ ولا تُقرأ من متنِ منطقٍ.
 *
 * والضمانُ الثالث `G-CHAOS-LEDGER-APPEND-ONLY`: كلُّ واقعةٍ إضافةٌ سطريّةٌ،
 * ولا تُعدَّل سطورٌ سابقةٌ ولا تُحذَف.
 *
 * والضمانُ الرابع `G-CHAOS-SCOPED-BLAST-RADIUS`: كلُّ مسارٍ يُلمَس يُرَدُّ إن
 * وقع خارجَ جذرِ التجاربِ المعلَنِ، ولا تُقتل إلا عمليّةٌ **أنشأها هذا الملفُّ
 * نفسُه** ويُحمَل مُعرِّفُها في ذاكرتِه — فلا `pkill` بالاسمِ ولا قتلَ عمليّةٍ
 * لا نعرف من أطلقها.
 *
 * @module scripts/lib/chaos-facts
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHAOS_ERRORS, ChaosError } from '../../src/chaos/errors.mjs';
import { loadRegionsContract } from '../../src/regions/contract.mjs';
import { judgeRegion } from '../../src/regions/health.mjs';
import { loadRecoveryContract } from '../../src/recovery/contract.mjs';
import { evaluateDrillDueness } from '../../src/recovery/schedule.mjs';

import {
  appendLedger as appendRegionLedger,
  observeRegions,
  readLedger as readRegionLedger,
  readWriterPointer,
  regionPaths,
  replicate,
  seedRegions,
  writeToWriter,
} from './region-facts.mjs';
import { recoveryPaths } from './recovery-facts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مسارُ عمليّةِ الضحيّةِ التي تُقتَل — عمليّةٌ يُنشئها هذا الملفُّ وحدَه. */
const VICTIM_SCRIPT = path.resolve(HERE, 'chaos-victim.mjs');

/**
 * @typedef {import('../../src/chaos/contract.mjs').ChaosContract} ChaosContract
 * @typedef {import('../../src/chaos/experiment-plan.mjs').ExperimentResult} ExperimentResult
 */

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 * @returns {never}
 */
function refuse(code, message, detail = {}) {
  throw new ChaosError(code, message, detail);
}

/**
 * @param {number} at
 * @returns {void}
 */
function assertClock(at) {
  if (typeof at !== 'number' || !Number.isSafeInteger(at)) {
    refuse(
      CHAOS_ERRORS.CLOCK_INVALID,
      'الساعةُ المُمرَّرةُ لا تُصدر عدداً صحيحاً منتهياً — ولا يُختم بها سطرُ دفترٍ ولا يُقاس بها عطب.',
      { at },
    );
  }
}

/**
 * جذرُ الفوضى مُطلَقاً من جذرٍ مُمرَّرٍ — ولا جذرَ مكتوبٌ في المتنِ، فالاختبارُ
 * يُنشِئ جذرَه المؤقّتَ ويُمرِّره.
 *
 * @param {ChaosContract} contract
 * @param {string} root
 * @returns {{ chaosRoot: string, ledger: string }}
 */
export function chaosPaths(contract, root) {
  return {
    chaosRoot: path.resolve(root, contract.source.root),
    ledger: path.resolve(root, contract.ledger.path),
  };
}

/**
 * حصرُ نصفِ قطرِ الانفجار: كلُّ مسارٍ يُلمَس **لا بدَّ** أن يقع داخلَ جذرِ
 * التجاربِ المعلَن — الضمان `G-CHAOS-SCOPED-BLAST-RADIUS`.
 *
 * @param {ChaosContract} contract
 * @param {string} root
 * @param {string} target
 * @returns {string}
 */
export function assertInsideBlastRadius(contract, root, target) {
  const { chaosRoot } = chaosPaths(contract, root);
  const resolved = path.resolve(root, target);
  const relative = path.relative(chaosRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    refuse(
      CHAOS_ERRORS.BLAST_RADIUS_ESCAPE,
      `المسار «${target}» يقع خارجَ جذرِ التجاربِ «${contract.source.root}» — وتجربةُ فوضى بلا نصفِ قطرٍ معلَنٍ عطبٌ لا تجربة.`,
      { target, chaosRoot },
    );
  }
  return resolved;
}

/**
 * إضافةُ واقعةٍ إلى دفترِ الفوضى سطراً واحداً — الضمان
 * `G-CHAOS-LEDGER-APPEND-ONLY`.
 *
 * @param {object} input
 * @param {ChaosContract} input.contract
 * @param {string} input.root
 * @param {{ type: string } & Record<string, unknown>} input.entry
 * @param {number} input.at
 * @returns {Record<string, unknown>}
 */
export function appendChaosLedger({ contract, root, entry, at }) {
  assertClock(at);
  if (!contract.events.includes(entry.type)) {
    refuse(
      CHAOS_ERRORS.LEDGER_INVALID,
      `واقعةٌ من نوع «${entry.type}» تُكتب في دفترِ الفوضى ولا إعلانَ لها في events — وحدثٌ لا يجده قارئُ الوثيقة.`,
      { type: entry.type },
    );
  }
  const { ledger } = chaosPaths(contract, root);
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  // والتاريخُ يُكتب **مقروءاً** مع رقمِه: فدليلٌ لا يُقرأ تاريخُه دليلٌ
  // يُحتَجُّ به ولا يُراجَع — والساعةُ مُمرَّرةٌ لا مقروءةٌ من الجهاز.
  const written = { ...entry, at, isoDate: new Date(at).toISOString() };
  try {
    fs.appendFileSync(ledger, `${JSON.stringify(written)}\n`, 'utf8');
  } catch (error) {
    refuse(
      CHAOS_ERRORS.LEDGER_UNWRITABLE,
      `تعذّرت الإضافةُ السطريّةُ إلى دفترِ الفوضى: ${error instanceof Error ? error.message : String(error)}`,
      { ledger },
    );
  }
  return written;
}

/**
 * قراءةُ دفترِ الفوضى سطراً سطراً — ودفترٌ ليس ملفَّ نصٍّ عاديّاً يُرَدُّ قبل
 * أن يُقرأ منه بايت.
 *
 * @param {ChaosContract} contract
 * @param {string} root
 * @returns {Array<Record<string, unknown>>}
 */
export function readChaosLedger(contract, root) {
  const { ledger } = chaosPaths(contract, root);
  if (!fs.existsSync(ledger)) {
    return [];
  }
  if (!fs.statSync(ledger).isFile()) {
    refuse(CHAOS_ERRORS.LEDGER_INVALID, 'دفترُ الفوضى ليس ملفَّ نصٍّ عاديّاً.', { ledger });
  }
  /** @type {Array<Record<string, unknown>>} */
  const entries = [];
  for (const line of fs.readFileSync(ledger, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      refuse(CHAOS_ERRORS.LEDGER_INVALID, `سطرٌ في دفترِ الفوضى لا يُقرأ: ${trimmed}`, { ledger });
    }
  }
  return entries;
}

/**
 * تهيئةُ جذرِ تجربةٍ داخلَ نصفِ القطرِ المعلَن.
 *
 * @param {ChaosContract} contract
 * @param {string} root
 * @param {string} experimentTarget
 * @returns {string}
 */
function prepareTarget(contract, root, experimentTarget) {
  const dir = assertInsideBlastRadius(contract, root, experimentTarget);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * ١ — `chaos:node-drop`: قتلُ عمليّةٍ ابنٍ حقيقيّةٍ بـ`SIGKILL` بعد أن تُثبِّت
 * سطورَها، ثم قراءةُ ما بقي على القرص.
 *
 * @param {object} input
 * @param {ChaosContract} input.contract
 * @param {string} input.root
 * @param {number} input.at
 * @returns {Promise<ExperimentResult>}
 */
export async function injectNodeDrop({ contract, root, at }) {
  assertClock(at);
  const experiment = 'chaos:node-drop';
  const target = prepareTarget(contract, root, '.state/chaos/node-drop');
  const lines = 5;
  if (!fs.existsSync(VICTIM_SCRIPT)) {
    return Object.freeze({
      experiment,
      injected: false,
      upheld: false,
      evidence: 'ملفُّ الضحيّةِ غيرُ موجودٍ فلا عمليّةَ تُقتَل.',
      unavailable: CHAOS_ERRORS.INJECTION_UNAVAILABLE,
    });
  }
  const child = spawn(
    process.execPath,
    [VICTIM_SCRIPT, '--root', target, '--lines', String(lines), '--at', String(at)],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  /** @type {string} */
  let out = '';
  /** @type {string} */
  let err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    err += String(chunk);
  });
  const committed = await new Promise((resolve) => {
    const settled = /** @type {{ done: boolean }} */ ({ done: false });
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
      if (!settled.done && out.includes('COMMITTED')) {
        settled.done = true;
        resolve(true);
      }
    });
    child.on('exit', () => {
      if (!settled.done) {
        settled.done = true;
        resolve(false);
      }
    });
  });
  // القتلُ يقع على **مُعرِّفِ العمليّةِ التي أنشأها هذا الملفُّ** وحدَها.
  const killed = child.kill('SIGKILL');
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(undefined);
      return;
    }
    child.on('exit', () => resolve(undefined));
  });
  if (!committed || !killed) {
    return Object.freeze({
      experiment,
      injected: false,
      upheld: false,
      evidence: `الضحيّةُ لم تُثبِّت سطورَها قبل القتلِ: ${err.trim() || out.trim() || 'بلا مُخرَج'}`,
      unavailable: CHAOS_ERRORS.INJECTION_UNAVAILABLE,
    });
  }
  const regions = loadRegionsContract();
  const surviving = readRegionLedger(regions, target);
  const replicated = surviving.filter((entry) => entry.type === 'region.replicated');
  /** @type {boolean} */
  let pointerReadable = true;
  try {
    readWriterPointer(regions, target);
  } catch {
    pointerReadable = false;
  }
  const upheld = replicated.length === lines && pointerReadable;
  return Object.freeze({
    experiment,
    injected: true,
    upheld,
    evidence: `قُتِلت العمليّةُ ${String(child.pid ?? 0)} بإشارةِ ${String(child.signalCode ?? 'SIGKILL')}؛ سطورُ الدفترِ المُثبَتةُ المقروءةُ ${String(replicated.length)}/${String(lines)}، ومؤشِّرُ الكاتبِ ${pointerReadable ? 'يُقرأ' : 'لا يُقرأ'}.`,
  });
}

/**
 * ٢ — `chaos:network-delay`: تأخّرٌ حقيقيٌّ مقيسٌ بين النسخِ والمشاهدة.
 *
 * @param {object} input
 * @param {ChaosContract} input.contract
 * @param {string} input.root
 * @param {number} input.at
 * @param {() => number} input.monotonic ساعةُ المدّةِ الحقيقيّةِ مُمرَّرةً دالّةً.
 * @returns {Promise<ExperimentResult>}
 */
export async function injectNetworkDelay({ contract, root, at, monotonic }) {
  assertClock(at);
  const experiment = 'chaos:network-delay';
  const declared = contract.experiments.find((entry) => entry.id === experiment);
  if (declared === undefined) {
    refuse(CHAOS_ERRORS.EXPERIMENT_UNDECLARED, `التجربة «${experiment}» غيرُ معلَنةٍ في العقد.`);
  }
  const delayMs = declared.fault.magnitude;
  const target = prepareTarget(contract, root, '.state/chaos/network-delay');
  const regions = loadRegionsContract();
  const seeded = seedRegions({ contract: regions, root: target, at });
  writeToWriter({ contract: regions, root: target, record: 'chaos-delay', at });
  replicate({ contract: regions, root: target, at, lagMs: 0 });
  const startedAt = monotonic();
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
  const elapsed = Math.round(monotonic() - startedAt);
  if (elapsed < delayMs) {
    return Object.freeze({
      experiment,
      injected: false,
      upheld: false,
      evidence: `المدّةُ المقيسةُ ${String(elapsed)} دونَ العطبِ المطلوبِ ${String(delayMs)} فلا تأخّرَ وقع.`,
      unavailable: CHAOS_ERRORS.INJECTION_UNAVAILABLE,
    });
  }
  const observed = observeRegions({ contract: regions, root: target, at: at + elapsed });
  const reader = regions.regions.find((region) => region.id !== seeded.writer);
  if (reader === undefined) {
    throw new ChaosError(
      CHAOS_ERRORS.INJECTION_UNAVAILABLE,
      'عقدُ الأقاليمِ بلا إقليمٍ قارئٍ غيرِ الكاتبِ فلا موضعَ يُقاس عليه التأخّر.',
    );
  }
  const judgement = judgeRegion({ contract: regions, region: reader.id, observations: observed });
  const lag = judgement.replicationLagMs ?? 0;
  const upheld = lag >= delayMs && judgement.verdict === 'health:up';
  return Object.freeze({
    experiment,
    injected: true,
    upheld,
    evidence: `تأخّرٌ حقيقيٌّ مقيسٌ ${String(elapsed)}ms ≥ ${String(delayMs)}ms؛ تأخّرُ الإقليم «${reader.id}» المقروءُ ${String(lag)}ms وحكمُه «${judgement.verdict}» دونَ نافذةِ الفقدِ ${String(regions.consistency.maxReplicationLagMs)}ms.`,
  });
}

/**
 * ٣ — `chaos:disk-full`: توجيهُ الدفترِ إلى `/dev/full` فتُردُّ الكتابةُ
 * بـ`ENOSPC` من النواة.
 *
 * @param {object} input
 * @param {ChaosContract} input.contract
 * @param {string} input.root
 * @param {number} input.at
 * @returns {ExperimentResult}
 */
export function injectDiskFull({ contract, root, at }) {
  assertClock(at);
  const experiment = 'chaos:disk-full';
  const target = prepareTarget(contract, root, '.state/chaos/disk-full');
  if (!fs.existsSync('/dev/full')) {
    return Object.freeze({
      experiment,
      injected: false,
      upheld: false,
      evidence: 'الجهاز `/dev/full` غيرُ موجودٍ في هذه البيئةِ فلا امتلاءَ حقيقيّاً يُحقَن.',
      unavailable: CHAOS_ERRORS.INJECTION_UNAVAILABLE,
    });
  }
  const regions = loadRegionsContract();
  seedRegions({ contract: regions, root: target, at });
  const ledger = regionPaths(regions, target).ledger;
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  appendRegionLedger({
    contract: regions,
    root: target,
    at,
    entry: { type: 'region.replicated', from: 'chaos', to: [], records: 1, lagMs: 0 },
  });
  const before = readRegionLedger(regions, target).length;
  const preserved = fs.readFileSync(ledger, 'utf8');
  // العطبُ يقع بتبديلِ الدفترِ بوصلةٍ إلى جهازٍ لا يقبل بايتاً — لا بعلَمٍ
  // يُمرَّر إلى دالّةِ الكتابةِ فتتظاهر بالفشل.
  fs.rmSync(ledger);
  fs.symlinkSync('/dev/full', ledger);
  /** @type {string | null} */
  let writeError = null;
  try {
    appendRegionLedger({
      contract: regions,
      root: target,
      at: at + 1,
      entry: { type: 'region.replicated', from: 'chaos', to: [], records: 2, lagMs: 0 },
    });
  } catch (error) {
    writeError = error instanceof Error ? error.message : String(error);
  }
  /** @type {string | null} */
  let readCode = null;
  try {
    readRegionLedger(regions, target);
  } catch (error) {
    readCode =
      error instanceof ChaosError
        ? error.code
        : error !== null &&
            typeof error === 'object' &&
            'code' in error &&
            typeof error.code === 'string'
          ? error.code
          : null;
  }
  // إعادةُ الدفترِ ملفَّ نصٍّ عاديّاً بمحتواه المُثبَتِ قبل العطب.
  fs.rmSync(ledger);
  fs.writeFileSync(ledger, preserved, 'utf8');
  const after = readRegionLedger(regions, target).length;
  const upheld = writeError !== null && readCode === 'REGION_CONFIG_INVALID' && after === before;
  return Object.freeze({
    experiment,
    injected: true,
    upheld,
    evidence: `الكتابةُ رُدَّت بخطأٍ حقيقيٍّ (${writeError ?? 'لم تُرَدّ'})، وقراءةُ دفترٍ صار ملفَّ جهازٍ رُدَّت برمزِ «${readCode ?? 'بلا رمز'}»، وسطورُ الدفترِ بعد التبديلِ ${String(after)}/${String(before)} بلا سطرٍ نصفَ مكتوب.`,
  });
}

/**
 * ٤ — `chaos:message-poison`: دسُّ سطرٍ فاسدٍ واحدٍ في دفترٍ حقيقيّ.
 *
 * @param {object} input
 * @param {ChaosContract} input.contract
 * @param {string} input.root
 * @param {number} input.at
 * @returns {ExperimentResult}
 */
export function injectMessagePoison({ contract, root, at }) {
  assertClock(at);
  const experiment = 'chaos:message-poison';
  const declared = contract.experiments.find((entry) => entry.id === experiment);
  const poisonLines = declared?.fault.magnitude ?? 1;
  const target = prepareTarget(contract, root, '.state/chaos/message-poison');
  const regions = loadRegionsContract();
  seedRegions({ contract: regions, root: target, at });
  appendRegionLedger({
    contract: regions,
    root: target,
    at,
    entry: { type: 'region.replicated', from: 'chaos', to: [], records: 1, lagMs: 0 },
  });
  const ledger = regionPaths(regions, target).ledger;
  for (let index = 0; index < poisonLines; index += 1) {
    fs.appendFileSync(ledger, '{"type":"region.replicated","records":\n', 'utf8');
  }
  /** @type {string | null} */
  let code = null;
  /** @type {string} */
  let message = '';
  try {
    readRegionLedger(regions, target);
  } catch (error) {
    code = /** @type {any} */ (error).code ?? null;
    message = error instanceof Error ? error.message : String(error);
  }
  const upheld = code === 'REGION_CONFIG_INVALID' || code === 'REGION_LEDGER_INVALID';
  return Object.freeze({
    experiment,
    injected: true,
    upheld,
    evidence: `دُسَّ ${String(poisonLines)} سطرٌ فاسدٌ فرُدَّت القراءةُ برمزِ «${code ?? 'بلا رمز'}»: ${message.slice(0, 120)}`,
  });
}

/**
 * ٥ — `chaos:clock-skew`: سجلُّ آخرِ تجربةِ تعافٍ يُكتب بتاريخٍ في المستقبل.
 *
 * @param {object} input
 * @param {ChaosContract} input.contract
 * @param {string} input.root
 * @param {number} input.at
 * @returns {ExperimentResult}
 */
export function injectClockSkew({ contract, root, at }) {
  assertClock(at);
  const experiment = 'chaos:clock-skew';
  const declared = contract.experiments.find((entry) => entry.id === experiment);
  const skewMs = declared?.fault.magnitude ?? 2_592_000_000;
  const target = prepareTarget(contract, root, '.state/chaos/clock-skew');
  const recovery = loadRecoveryContract();
  const paths = recoveryPaths(recovery, target);
  fs.mkdirSync(path.dirname(paths.lastDrill), { recursive: true });
  const future = at + skewMs;
  fs.writeFileSync(paths.lastDrill, `${JSON.stringify({ at: future }, null, 2)}\n`, 'utf8');
  const written = JSON.parse(fs.readFileSync(paths.lastDrill, 'utf8'));
  /** @type {string | null} */
  let code = null;
  /** @type {unknown} */
  let silent = null;
  try {
    silent = evaluateDrillDueness(recovery, { lastDrillAt: written.at, now: at });
  } catch (error) {
    code = /** @type {any} */ (error).code ?? null;
  }
  const upheld = code === 'RECOVERY_LEDGER_INVALID';
  return Object.freeze({
    experiment,
    injected: true,
    upheld,
    evidence: `سجلٌّ حقيقيٌّ بتاريخٍ ${String(written.at)} يسبق الآنَ ${String(at)} بـ${String(skewMs)}ms فرُدَّ برمزِ «${code ?? `بلا رمز، وقُرِئ حكماً: ${JSON.stringify(silent)}`}».`,
  });
}

/**
 * تشغيلُ التجاربِ الخمسِ بترتيبِ العقدِ مع كتابةِ وقائعِ كلِّ تجربةٍ في
 * الدفتر — والمُنفِّذُ لا يعرف تجربةً ليست في العقد.
 *
 * @param {object} input
 * @param {ChaosContract} input.contract
 * @param {string} input.root
 * @param {number} input.at
 * @param {() => number} [input.monotonic]
 * @returns {Promise<ReadonlyArray<ExperimentResult>>}
 */
export async function runExperiments({ contract, root, at, monotonic }) {
  assertClock(at);
  const clock = monotonic ?? (() => Number(process.hrtime.bigint() / 1_000_000n));
  /** @type {Record<string, (offset: number) => Promise<ExperimentResult> | ExperimentResult>} */
  const injectors = {
    'chaos:node-drop': (offset) => injectNodeDrop({ contract, root, at: at + offset }),
    'chaos:network-delay': (offset) =>
      injectNetworkDelay({ contract, root, at: at + offset, monotonic: clock }),
    'chaos:disk-full': (offset) => injectDiskFull({ contract, root, at: at + offset }),
    'chaos:message-poison': (offset) => injectMessagePoison({ contract, root, at: at + offset }),
    'chaos:clock-skew': (offset) => injectClockSkew({ contract, root, at: at + offset }),
  };
  /** @type {ExperimentResult[]} */
  const results = [];
  const ordered = [...contract.experiments].sort((left, right) => left.order - right.order);
  for (const experiment of ordered) {
    const injector = injectors[experiment.id];
    if (injector === undefined) {
      refuse(
        CHAOS_ERRORS.FAULT_INVALID,
        `التجربة «${experiment.id}» معلَنةٌ في العقدِ ولا مُنفِّذَ لعطبِها — ووعدُ فوضى لا تقع.`,
        { experiment: experiment.id },
      );
    }
    const startedAt = at + experiment.order * 1000;
    appendChaosLedger({
      contract,
      root,
      at: startedAt,
      entry: {
        type: 'chaos.experiment.started',
        experiment: experiment.id,
        fault: experiment.fault.kind,
        magnitude: experiment.fault.magnitude,
      },
    });
    const result = await injector(experiment.order * 1000);
    results.push(result);
    if (result.injected) {
      appendChaosLedger({
        contract,
        root,
        at: startedAt + 1,
        entry: {
          type: 'chaos.fault.injected',
          experiment: experiment.id,
          magnitude: experiment.fault.magnitude,
          unit: experiment.fault.unit,
        },
      });
    }
    if (result.upheld && result.injected) {
      appendChaosLedger({
        contract,
        root,
        at: startedAt + 2,
        entry: {
          type: 'chaos.hypothesis.upheld',
          experiment: experiment.id,
          evidence: result.evidence,
        },
      });
    } else {
      appendChaosLedger({
        contract,
        root,
        at: startedAt + 2,
        entry: {
          type: 'chaos.deviation.recorded',
          experiment: experiment.id,
          deviation: experiment.deviationCode,
          evidence: result.evidence,
        },
      });
    }
  }
  return Object.freeze(results);
}
