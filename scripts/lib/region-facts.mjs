/**
 * جامعُ وقائعِ الأقاليمِ وكاتبُ دفترِها — الخطوة `M10.07`.
 *
 * **هذا هو الموضعُ الوحيدُ الذي يلمس القرصَ** في مسارِ الأقاليمِ كلِّه؛ ووحداتُ
 * `src/regions/` نقيّةٌ لا تستورد `node:fs` أصلاً فلا تستطيع أن تفعل
 * (‏`G-REGION-PURE-JUDGEMENT`). وفصلُ الوقائعِ عن الحكمِ هو ما يجعل حكمَ سقوطِ
 * إقليمٍ قابلاً للاختبارِ بلا شبكةٍ ولا مزوِّدِ سحابةٍ ولا انتظارِ خمسَ عشرةَ ثانية.
 *
 * والضمانُ المُنفَّذُ هنا `G-REGION-INJECTED-CLOCK`: كلُّ زمنٍ يُكتب في الدفترِ
 * أو يُحسَب به تأخّرُ نسخٍ يصل **مُعامِلاً** `at` — لا `Date.now()` في متنِ منطقٍ
 * ولا مؤقِّتٌ يعمل بنفسِه — فمدّةُ الانقطاعِ ونافذةُ الفقدِ تُثبَّتان في الاختبارِ
 * ولا تُقرآن من ساعةِ الجهازِ ولا من صبرِ منفِّذٍ.
 *
 * @module scripts/lib/region-facts
 */

import fs from 'node:fs';
import path from 'node:path';

import { REGION_ERRORS, RegionError } from '../../src/regions/errors.mjs';

/**
 * @typedef {import('../../src/regions/contract.mjs').RegionsContract} RegionsContract
 * @typedef {import('../../src/regions/health.mjs').RegionObservation} RegionObservation
 */

/** ملفُّ حالةِ النسخةِ داخلَ جذرِ كلِّ إقليم. */
export const REPLICA_FILE = 'replica.json';

/**
 * @param {number} at
 * @returns {void}
 */
function assertClock(at) {
  if (typeof at !== 'number' || !Number.isFinite(at)) {
    throw new RegionError(
      REGION_ERRORS.CLOCK_INVALID,
      'الساعةُ المُمرَّرةُ لا تُصدر عدداً منتهياً — ولا تُقاس بها نافذةُ فقدٍ ولا يُختم بها سطرُ دفتر.',
      { at },
    );
  }
}

/**
 * مواضعُ الأقاليمِ مُطلَقةً من جذرٍ مُمرَّر — ولا جذرَ مكتوبٌ هنا، فالاختبارُ
 * يُنشِئ جذرَه المؤقّتَ ويُمرِّره.
 *
 * @param {RegionsContract} contract
 * @param {string} root
 * @returns {{ ledger: string, pointer: string, regions: Record<string, string> }}
 */
export function regionPaths(contract, root) {
  /** @type {Record<string, string>} */
  const regions = {};
  for (const region of contract.regions) {
    regions[region.id] = path.resolve(root, region.statePath);
  }
  return {
    ledger: path.resolve(root, contract.ledger.path),
    pointer: path.resolve(root, contract.ledger.pointerPath),
    regions,
  };
}

/**
 * جذرُ حالةِ إقليمٍ معلَنٍ مُطلَقاً — ويُرَدُّ ما ليس معلَناً بالرمزِ لا بقيمةٍ خاوية.
 *
 * @param {RegionsContract} contract
 * @param {string} root
 * @param {string} regionId
 * @returns {string}
 */
export function regionDir(contract, root, regionId) {
  const dir = regionPaths(contract, root).regions[regionId];
  if (dir === undefined) {
    throw new RegionError(
      REGION_ERRORS.UNDECLARED,
      `الإقليم «${regionId}» لا إعلانَ له في العقد — ولا يُقرأ ولا يُكتَب ولا يُسقَط ما ليس معلَناً.`,
      { region: regionId },
    );
  }
  return dir;
}

/**
 * تهيئةُ أقاليمِ العقدِ على القرص: جذرٌ لكلِّ إقليمٍ وملفُّ نسخةٍ فيه، ومؤشِّرُ
 * كاتبٍ يشير إلى الكاتبِ المعلَنِ في العقد.
 *
 * @param {object} input
 * @param {RegionsContract} input.contract
 * @param {string} input.root
 * @param {number} input.at
 * @returns {{ writer: string, regions: string[] }}
 */
export function seedRegions({ contract, root, at }) {
  assertClock(at);
  const writer = contract.regions.find((region) => region.role === 'writer');
  if (writer === undefined) {
    throw new RegionError(
      REGION_ERRORS.WRITER_MISSING,
      'لا كاتبَ معلَنٌ في العقد — ولا تُهيَّأ دولةٌ لا يُعرَف من يكتب فيها.',
    );
  }
  for (const region of contract.regions) {
    const dir = regionDir(contract, root, region.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, REPLICA_FILE),
      `${JSON.stringify({ region: region.id, lastReplicatedAt: at, records: [] }, null, 2)}\n`,
      'utf8',
    );
  }
  writeWriterPointer({ contract, root, writer: writer.id, at, automatic: false });
  return { writer: writer.id, regions: contract.regions.map((region) => region.id) };
}

/**
 * قراءةُ ملفِّ نسخةِ إقليمٍ، أو `null` إن كان الإقليمُ غيرَ قائمٍ على القرص.
 *
 * @param {RegionsContract} contract
 * @param {string} root
 * @param {string} regionId
 * @returns {{ region: string, lastReplicatedAt: number, records: unknown[] } | null}
 */
export function readReplica(contract, root, regionId) {
  const file = path.join(regionDir(contract, root, regionId), REPLICA_FILE);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new RegionError(
      REGION_ERRORS.OBSERVATION_INVALID,
      `ملفُّ نسخةِ «${regionId}» لا يُقرأ: ${error instanceof Error ? error.message : String(error)}`,
      { region: regionId },
    );
  }
}

/**
 * كتابةُ سطرٍ في الكاتبِ القائمِ — تُرَدُّ إن كان المؤشِّرُ يشير إلى إقليمٍ ساقطٍ.
 *
 * @param {object} input
 * @param {RegionsContract} input.contract
 * @param {string} input.root
 * @param {string} input.record
 * @param {number} input.at
 * @returns {{ writer: string, count: number }}
 */
export function writeToWriter({ contract, root, record, at }) {
  assertClock(at);
  const pointer = readWriterPointer(contract, root);
  if (pointer === null) {
    throw new RegionError(
      REGION_ERRORS.WRITER_MISSING,
      'لا مؤشِّرَ كاتبٍ على القرص — ودولةٌ لا يُعرَف كاتبُها لا تقبل كتابةً.',
    );
  }
  const replica = readReplica(contract, root, pointer.writer);
  if (replica === null) {
    throw new RegionError(
      REGION_ERRORS.WRITER_MISSING,
      `المؤشِّرُ يشير إلى «${pointer.writer}» وهو غيرُ قائمٍ — ولا تُقبَل كتابةٌ في إقليمٍ ساقط.`,
      { region: pointer.writer },
    );
  }
  replica.records = [...replica.records, { record, at }];
  replica.lastReplicatedAt = at;
  const dir = regionDir(contract, root, pointer.writer);
  fs.writeFileSync(path.join(dir, REPLICA_FILE), `${JSON.stringify(replica, null, 2)}\n`, 'utf8');
  return { writer: pointer.writer, count: replica.records.length };
}

/**
 * نسخُ سطورِ الكاتبِ إلى القارئينَ القائمينَ بتأخّرٍ مُمرَّرٍ صريحاً.
 *
 * والتأخّرُ **مُعامِلٌ** لا انتظارٌ حقيقيٌّ: فاختبارٌ ينتظر خمسَ ثوانٍ ليُثبت
 * تأخّراً اختبارٌ يُعطَّل يوماً لأنه بطيء، ثم يُفقَد الضمانُ الذي كان يحرسه.
 *
 * @param {object} input
 * @param {RegionsContract} input.contract
 * @param {string} input.root
 * @param {number} input.at
 * @param {number} [input.lagMs]
 * @returns {ReadonlyArray<{ region: string, records: number, lastReplicatedAt: number }>}
 */
export function replicate({ contract, root, at, lagMs = 0 }) {
  assertClock(at);
  if (lagMs < 0 || !Number.isFinite(lagMs)) {
    throw new RegionError(REGION_ERRORS.LAG_INVALID, 'تأخّرُ النسخِ المُمرَّرُ غيرُ صالح.', {
      lagMs,
    });
  }
  const pointer = readWriterPointer(contract, root);
  if (pointer === null) {
    throw new RegionError(REGION_ERRORS.WRITER_MISSING, 'لا مؤشِّرَ كاتبٍ — ولا يُنسَخ من مجهول.');
  }
  const source = readReplica(contract, root, pointer.writer);
  if (source === null) {
    throw new RegionError(
      REGION_ERRORS.WRITER_MISSING,
      `الكاتب «${pointer.writer}» غيرُ قائمٍ — ولا يُنسَخ من إقليمٍ ساقط.`,
      { region: pointer.writer },
    );
  }
  /** @type {{ region: string, records: number, lastReplicatedAt: number }[]} */
  const applied = [];
  for (const region of contract.regions) {
    if (region.id === pointer.writer) {
      continue;
    }
    const dir = regionDir(contract, root, region.id);
    if (!fs.existsSync(path.join(dir, REPLICA_FILE))) {
      continue;
    }
    const lastReplicatedAt = at - lagMs;
    fs.writeFileSync(
      path.join(dir, REPLICA_FILE),
      `${JSON.stringify({ region: region.id, lastReplicatedAt, records: source.records }, null, 2)}\n`,
      'utf8',
    );
    applied.push({ region: region.id, records: source.records.length, lastReplicatedAt });
  }
  appendLedger({
    contract,
    root,
    at,
    entry: {
      type: 'region.replicated',
      from: pointer.writer,
      to: applied.map((entry) => entry.region),
      records: source.records.length,
      lagMs,
    },
  });
  return Object.freeze(applied);
}

/**
 * مشاهدةُ كلِّ إقليمٍ معلَنٍ من القرصِ بساعةٍ مُمرَّرة.
 *
 * @param {object} input
 * @param {RegionsContract} input.contract
 * @param {string} input.root
 * @param {number} input.at
 * @returns {ReadonlyArray<RegionObservation>}
 */
export function observeRegions({ contract, root, at }) {
  assertClock(at);
  /** @type {RegionObservation[]} */
  const observations = [];
  for (const region of contract.regions) {
    const replica = readReplica(contract, root, region.id);
    if (replica === null) {
      observations.push({ region: region.id, reachable: false, replicationLagMs: 0, at });
      continue;
    }
    const lag = Math.max(0, at - replica.lastReplicatedAt);
    observations.push({ region: region.id, reachable: true, replicationLagMs: lag, at });
  }
  return Object.freeze(observations);
}

/**
 * إسقاطُ إقليمٍ إسقاطاً حقيقيّاً: يُزال جذرُ حالتِه فلا يُقرأ ولا يُكتَب فيه.
 *
 * @param {object} input
 * @param {RegionsContract} input.contract
 * @param {string} input.root
 * @param {string} input.region
 * @param {number} input.at
 * @returns {{ region: string, removed: boolean }}
 */
export function dropRegion({ contract, root, region, at }) {
  assertClock(at);
  const dir = regionDir(contract, root, region);
  const existed = fs.existsSync(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  appendLedger({ contract, root, at, entry: { type: 'region.dropped', region, existed } });
  return { region, removed: existed };
}

/**
 * قراءةُ وقائعِ دفترِ الأقاليم.
 *
 * @param {RegionsContract} contract
 * @param {string} root
 * @returns {Array<Record<string, unknown>>}
 */
export function readLedger(contract, root) {
  const file = regionPaths(contract, root).ledger;
  if (!fs.existsSync(file)) {
    return [];
  }
  // ── إصلاحُ الانحراف `DEV-CHAOS-DISK-FULL` (‏`M10.09`، مُغلَقٌ في `WL-062`) ──
  // كشفت تجربةُ `chaos:disk-full` أنّ **الكتابةَ** إلى قرصٍ ممتلئٍ تُرمى خطأً
  // فلا تكتب نصفَ سطرٍ — وذاك المطلوب — أمّا **القراءةُ** فكانت تفتح الملفَّ
  // كما هو أيّاً كان نوعُه: فإن صار مسارُ الدفترِ ملفَّ جهازٍ لا نهايةَ له
  // (‏`/dev/full` مثلاً) استنزفت `readFileSync` الذاكرةَ حتى تُقتل العمليّةُ
  // بـ`std::bad_alloc` بلا رمزِ رفضٍ ولا رسالةٍ تُقرأ. والسببُ الجذريُّ غيابُ
  // التحقّقِ من **نوعِ** الملفِّ قبل قراءتِه، فصار الدفترُ الذي ليس ملفَّ نصٍّ
  // عاديّاً مردوداً بـ`REGION_CONFIG_INVALID` قبل أن تُقرأ منه بايتٌ واحد.
  if (!fs.statSync(file).isFile()) {
    throw new RegionError(
      REGION_ERRORS.CONFIG_INVALID,
      'مسارُ دفترِ الأقاليمِ ليس ملفَّ نصٍّ عاديّاً — ودفترٌ صار ملفَّ جهازٍ لا يُقرأ سطراً سطراً بل يستنزف الذاكرةَ حتى تُقتل العمليّة.',
      { file },
    );
  }
  /** @type {Array<Record<string, unknown>>} */
  const entries = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      throw new RegionError(
        REGION_ERRORS.CONFIG_INVALID,
        'سطرٌ في دفترِ الأقاليمِ لا يُقرأ — ودفترٌ لا يُقرأ سطرُه لا يُشتقّ منه مرشَّحُ تنصيب.',
        { file },
      );
    }
  }
  return entries;
}

/**
 * كتابةُ واقعةٍ في الدفترِ بإضافةٍ سطريّةٍ — لا تعديلَ لسطرٍ سابقٍ أبداً.
 *
 * @param {object} input
 * @param {RegionsContract} input.contract
 * @param {string} input.root
 * @param {{ type: string } & Record<string, unknown>} input.entry
 * @param {number} input.at
 * @returns {Record<string, unknown>}
 */
export function appendLedger({ contract, root, entry, at }) {
  assertClock(at);
  const declared = new Set(contract.audit.events.map((event) => event.type));
  if (!declared.has(entry.type)) {
    throw new RegionError(
      REGION_ERRORS.CONFIG_INVALID,
      `واقعةٌ من نوع «${entry.type}» تُكتب في الدفترِ ولا إعلانَ لها في audit.events — وحدثٌ لا يجده قارئُ الوثيقة.`,
      { type: entry.type },
    );
  }
  const file = regionPaths(contract, root).ledger;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const written = { ...entry, at };
  fs.appendFileSync(file, `${JSON.stringify(written)}\n`, 'utf8');
  return written;
}

/**
 * قراءةُ مؤشِّرِ الكاتبِ القائم.
 *
 * @param {RegionsContract} contract
 * @param {string} root
 * @returns {{ writer: string, at: number, automatic: boolean } | null}
 */
export function readWriterPointer(contract, root) {
  const file = regionPaths(contract, root).pointer;
  if (!fs.existsSync(file)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * كتابةُ مؤشِّرِ الكاتبِ — كاتبٌ واحدٌ في الملفِّ، لا قائمةٌ يُختار منها.
 *
 * @param {object} input
 * @param {RegionsContract} input.contract
 * @param {string} input.root
 * @param {string} input.writer
 * @param {number} input.at
 * @param {boolean} input.automatic
 * @returns {void}
 */
export function writeWriterPointer({ contract, root, writer, at, automatic }) {
  assertClock(at);
  const paths = regionPaths(contract, root);
  regionDir(contract, root, writer);
  fs.mkdirSync(path.dirname(paths.pointer), { recursive: true });
  fs.writeFileSync(
    paths.pointer,
    `${JSON.stringify({ writer, at, automatic }, null, 2)}\n`,
    'utf8',
  );
}
