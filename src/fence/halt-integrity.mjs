/**
 * طبقةُ السلامةِ الصارمةِ لمفتاحِ الإيقاف — `D-14` (‏`WL-532`).
 *
 * **لماذا طبقةٌ لا تعديلٌ في `HaltSwitch`:** قواعدُ التحقّقِ في `read()`/`history()`/
 * `verifyHistory()` محميّةٌ بقرارِ المالكِ (`LIVE-40`، 2026-11-10)، واختباراتُ
 * التوصيفِ `LIVE-67..74` تُثبِتُ سلوكَها الحاليَّ عمداً. تغييرُها يحتاجُ تفويضاً مستقلّاً
 * لا يحملُه هذا التكليف. فهذه الوحدةُ **قارئٌ ثانٍ صارمٌ** فوقَ الملفّاتِ نفسِها،
 * يُستعملُ في كلِّ مسارٍ يبني عليه السياجُ قراراً (تجديدُ الإيجار، الاستئناف، حارسُ
 * العاملِ في وضعِ السياج)، ولا يُخفّفُ شيئاً مما يرفضُه القارئُ الأصليّ.
 *
 * الفروقُ عن القارئِ الأصليّ — كلُّها نحوَ الإغلاق، وكلُّها إلى `RECOVERY_REQUIRED`
 * (فقدانُ حالةِ الثقةِ غيرُ المتوقَّعِ لا يُقرأُ `halted` عاديّاً ولا `running` أبداً):
 *
 * 1. **غيابُ التوجيهِ كلِّه ≠ RUNNING.** القارئُ الأصليُّ يقرأُ «لا توجيه ولا عهد ولا
 *    تاريخ» دولةً لم تُوقَف يوماً. هنا: النظامُ المُزوَّدُ لا بدَّ له من توجيهٍ أوّل؛
 *    غيابُ الثلاثيّةِ = محوٌ ⇒ `RECOVERY_REQUIRED` (‏`TRUST_STATE_MISSING`).
 * 2. **الحدُّ الخارجيُّ (`epochFloor`) إلزاميّ.** بلا حدٍّ ⇒ `EPOCH_FLOOR_REQUIRED`.
 *    وحدٌّ أعلى من آخرِ التاريخِ ⇒ استرجاعٌ لحالةٍ أقدم ⇒ `EPOCH_FLOOR_AHEAD`.
 * 3. **سطرُ تاريخٍ تالفٌ لا يُتجاوَز** — أوّلُه أو وسطُه أو ذيلُه المقطوع
 *    (‏`HISTORY_LINE_CORRUPT`/`HISTORY_TAIL_TRUNCATED`).
 * 4. **التاريخُ كلُّه يُتحقَّقُ منه** (هاشٌ، ربطٌ، عهودٌ متّصلةٌ بلا تكرار، توقيع)، لا
 *    آخرُ هاشٍ وحده. وتوجيهٌ صحيحُ التوقيعِ على محتوىً قديمٍ ⇒ `DIRECTIVE_NOT_LAST`.
 * 5. **ملفُّ العهدِ يطابقُ التاريخ.** أعلى منه ⇒ انقطاعٌ بين رفعِ العهدِ ونشرِ
 *    التوجيه (‏`EPOCH_AHEAD_OF_HISTORY`)، وأدنى ⇒ `EPOCH_BEHIND_HISTORY`.
 * 6. **سجلُّ عقدةٍ تالفٌ لا يُتجاهَل** (‏`NODE_RECORD_CORRUPT`).
 * 7. **العمليةُ الميتةُ ليست إقراراً موقَّعاً**: `strictFullyConfirmed` لا يعدُّ إلا
 *    إقراراً موقَّعاً للعهدِ والتوجيهِ الجاريين، ويعدُّ كلَّ عمليةٍ حيّةٍ في نطاقِ
 *    الإقلاعِ بلا سجلِّ عقدةٍ عقدةً غيرَ مُقِرّة.
 *
 * @module fence/halt-integrity
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  GENESIS_DIRECTIVE_HASH,
  haltAckPayload,
  hashHaltBody,
  verifyHaltAckProof,
} from '../root-of-trust/halt-switch.mjs';

/** الحالاتُ الثلاث التي تُرجِعُها القراءةُ الصارمة. */
export const STRICT_STATES = Object.freeze(['RUNNING', 'HALTED', 'RECOVERY_REQUIRED']);

/** رموزُ المشكلاتِ — مثبَّتةٌ نصّاً لأنّ الاختباراتِ والسياجَ يفرّقان بها. */
export const STRICT_PROBLEMS = Object.freeze({
  TRUST_STATE_MISSING: 'TRUST_STATE_MISSING',
  EPOCH_FLOOR_REQUIRED: 'EPOCH_FLOOR_REQUIRED',
  EPOCH_FLOOR_AHEAD: 'EPOCH_FLOOR_AHEAD',
  DIRECTIVE_MISSING: 'DIRECTIVE_MISSING',
  DIRECTIVE_CORRUPT: 'DIRECTIVE_CORRUPT',
  DIRECTIVE_NOT_LAST: 'DIRECTIVE_NOT_LAST',
  HISTORY_MISSING: 'HISTORY_MISSING',
  HISTORY_LINE_CORRUPT: 'HISTORY_LINE_CORRUPT',
  HISTORY_TAIL_TRUNCATED: 'HISTORY_TAIL_TRUNCATED',
  HISTORY_HASH_MISMATCH: 'HISTORY_HASH_MISMATCH',
  HISTORY_LINK_MISMATCH: 'HISTORY_LINK_MISMATCH',
  HISTORY_EPOCH_GAP: 'HISTORY_EPOCH_GAP',
  HISTORY_SIGNATURE_INVALID: 'HISTORY_SIGNATURE_INVALID',
  EPOCH_FILE_CORRUPT: 'EPOCH_FILE_CORRUPT',
  EPOCH_FILE_MISSING: 'EPOCH_FILE_MISSING',
  EPOCH_AHEAD_OF_HISTORY: 'EPOCH_AHEAD_OF_HISTORY',
  EPOCH_BEHIND_HISTORY: 'EPOCH_BEHIND_HISTORY',
  NODE_RECORD_CORRUPT: 'NODE_RECORD_CORRUPT',
  ACK_RECORD_CORRUPT: 'ACK_RECORD_CORRUPT',
});

/** خطأُ الحارسِ الصارم. */
export class StrictHaltError extends Error {
  /**
   * @param {string} code
   * @param {StrictReading} reading
   */
  constructor(code, reading) {
    super(
      `${code}: الحالةُ الصارمة ${reading.state} (عهد ${reading.epoch})${
        reading.problems.length > 0 ? ' — ' + reading.problems.map((p) => p.code).join(', ') : ''
      }`,
    );
    this.name = 'StrictHaltError';
    this.code = code;
    this.reading = reading;
  }
}

/**
 * @typedef {{ code: string, at?: number, detail?: string }} StrictProblem
 * @typedef {{
 *   state: 'RUNNING' | 'HALTED' | 'RECOVERY_REQUIRED',
 *   epoch: number,
 *   directiveHash: string | null,
 *   problems: StrictProblem[],
 *   historyLength: number,
 * }} StrictReading
 */

/** @type {ReadonlyArray<readonly [string, string]>} */
const DIRECTIVE_FIELDS = Object.freeze([
  ['version', 'number'],
  ['epoch', 'number'],
  ['state', 'string'],
  ['reason', 'string'],
  ['at', 'string'],
  ['kingId', 'string'],
  ['keyVersion', 'number'],
  ['previousDirectiveHash', 'string'],
  ['hash', 'string'],
  ['signature', 'string'],
]);

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function asDirective(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = /** @type {Record<string, unknown>} */ (value);
  for (const [field, type] of DIRECTIVE_FIELDS) {
    if (typeof record[field] !== type) return null;
  }
  if (record['version'] !== 1) return null;
  if (!Number.isInteger(record['epoch']) || /** @type {number} */ (record['epoch']) < 1)
    return null;
  if (record['state'] !== 'running' && record['state'] !== 'halted') return null;
  return record;
}

/**
 * @param {Record<string, unknown>} directive
 * @returns {object}
 */
function bodyOf(directive) {
  return {
    version: directive['version'],
    epoch: directive['epoch'],
    state: directive['state'],
    reason: directive['reason'],
    at: directive['at'],
    kingId: directive['kingId'],
    keyVersion: directive['keyVersion'],
    previousDirectiveHash: directive['previousDirectiveHash'],
  };
}

/**
 * @param {import('../root-of-trust/halt-switch.mjs').HaltVerifier} king
 * @param {object} body
 * @param {string} signature
 * @returns {boolean}
 */
function signatureValid(king, body, signature) {
  try {
    if (typeof king.verifyingVersion === 'function')
      return king.verifyingVersion(body, signature) !== null;
    return king.verify(body, signature) === true;
  } catch {
    return false;
  }
}

/**
 * القراءةُ الصارمة. لا تكتبُ شيئاً (لا ترفعُ عهداً ولا تُصلِحُ ملفّاً).
 * @param {{ file: string, epochFile: string, historyFile: string, nodesDir: string, acksDir: string,
 *           king: import('../root-of-trust/halt-switch.mjs').HaltVerifier }} halt - مفتاحُ الإيقاف (مسارُه ومُحقِّقُه)
 * @param {{ epochFloor?: { read(): number } | null }} options
 * @returns {StrictReading}
 */
export function strictHaltReading(halt, options = {}) {
  /** @type {StrictProblem[]} */
  const problems = [];
  const floor = options.epochFloor ?? null;
  let floorValue = null;
  if (floor === null) {
    problems.push({ code: STRICT_PROBLEMS.EPOCH_FLOOR_REQUIRED });
  } else {
    try {
      floorValue = Number(floor.read());
      if (!Number.isInteger(floorValue) || floorValue < 0) throw new Error('floor');
    } catch {
      problems.push({ code: STRICT_PROBLEMS.EPOCH_FLOOR_REQUIRED, detail: 'الحدُّ لا يُقرأ' });
      floorValue = null;
    }
  }
  const hasDirective = existsSync(halt.file);
  const hasHistory = existsSync(halt.historyFile);
  const hasEpoch = existsSync(halt.epochFile);
  if (!hasDirective && !hasHistory && !hasEpoch) {
    problems.push({ code: STRICT_PROBLEMS.TRUST_STATE_MISSING });
    return closed(problems, floorValue ?? 0, null, 0);
  }

  // ── التاريخ: كلُّ سطر، بلا تجاوز ──
  /** @type {Record<string, unknown>[]} */
  const history = [];
  if (!hasHistory) {
    problems.push({ code: STRICT_PROBLEMS.HISTORY_MISSING });
  } else {
    const text = readFileSync(halt.historyFile, 'utf8');
    const parts = text.split('\n');
    const tail = parts.pop();
    if (tail !== undefined && tail.length > 0) {
      problems.push({ code: STRICT_PROBLEMS.HISTORY_TAIL_TRUNCATED, at: parts.length + 1 });
    }
    let previousHash = GENESIS_DIRECTIVE_HASH;
    let previousEpoch = 0;
    for (const [index, line] of parts.entries()) {
      const at = index + 1;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        problems.push({ code: STRICT_PROBLEMS.HISTORY_LINE_CORRUPT, at });
        continue;
      }
      const directive = asDirective(parsed);
      if (directive === null) {
        problems.push({ code: STRICT_PROBLEMS.HISTORY_LINE_CORRUPT, at });
        continue;
      }
      const body = bodyOf(directive);
      if (directive['hash'] !== hashHaltBody(/** @type {never} */ (body))) {
        problems.push({ code: STRICT_PROBLEMS.HISTORY_HASH_MISMATCH, at });
      }
      if (directive['previousDirectiveHash'] !== previousHash) {
        problems.push({ code: STRICT_PROBLEMS.HISTORY_LINK_MISMATCH, at });
      }
      if (directive['epoch'] !== previousEpoch + 1) {
        problems.push({
          code: STRICT_PROBLEMS.HISTORY_EPOCH_GAP,
          at,
          detail: `${previousEpoch} → ${String(directive['epoch'])}`,
        });
      }
      if (!signatureValid(halt.king, body, /** @type {string} */ (directive['signature']))) {
        problems.push({ code: STRICT_PROBLEMS.HISTORY_SIGNATURE_INVALID, at });
      }
      previousHash = /** @type {string} */ (directive['hash']);
      previousEpoch = /** @type {number} */ (directive['epoch']);
      history.push(directive);
    }
  }
  const last = history[history.length - 1] ?? null;
  const historyEpoch = last === null ? 0 : /** @type {number} */ (last['epoch']);

  // ── ملفُّ العهد ──
  if (!hasEpoch) {
    problems.push({ code: STRICT_PROBLEMS.EPOCH_FILE_MISSING });
  } else {
    const raw = readFileSync(halt.epochFile, 'utf8').trim();
    const epoch = /^[0-9]+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
    if (!Number.isInteger(epoch) || epoch < 1) {
      problems.push({ code: STRICT_PROBLEMS.EPOCH_FILE_CORRUPT });
    } else if (epoch > historyEpoch) {
      problems.push({
        code: STRICT_PROBLEMS.EPOCH_AHEAD_OF_HISTORY,
        detail: `${epoch} > ${historyEpoch}`,
      });
    } else if (epoch < historyEpoch) {
      problems.push({
        code: STRICT_PROBLEMS.EPOCH_BEHIND_HISTORY,
        detail: `${epoch} < ${historyEpoch}`,
      });
    }
  }
  if (floorValue !== null && floorValue > historyEpoch) {
    problems.push({
      code: STRICT_PROBLEMS.EPOCH_FLOOR_AHEAD,
      detail: `${floorValue} > ${historyEpoch}`,
    });
  }

  // ── التوجيه: هو آخرُ التاريخ حرفاً ──
  /** @type {Record<string, unknown> | null} */
  let directive = null;
  if (!hasDirective) {
    problems.push({ code: STRICT_PROBLEMS.DIRECTIVE_MISSING });
  } else {
    try {
      directive = asDirective(JSON.parse(readFileSync(halt.file, 'utf8')));
    } catch {
      directive = null;
    }
    if (directive === null) {
      problems.push({ code: STRICT_PROBLEMS.DIRECTIVE_CORRUPT });
    } else {
      const body = bodyOf(directive);
      if (
        directive['hash'] !== hashHaltBody(/** @type {never} */ (body)) ||
        !signatureValid(halt.king, body, /** @type {string} */ (directive['signature']))
      ) {
        problems.push({ code: STRICT_PROBLEMS.DIRECTIVE_CORRUPT, detail: 'هاشٌ أو توقيع' });
      } else if (last === null || directive['hash'] !== last['hash']) {
        problems.push({ code: STRICT_PROBLEMS.DIRECTIVE_NOT_LAST });
      }
    }
  }

  // ── سجلّاتُ العقدِ والإقرارات: لا يُتجاهَلُ تالف ──
  for (const [dir, code] of /** @type {const} */ ([
    [halt.nodesDir, STRICT_PROBLEMS.NODE_RECORD_CORRUPT],
    [halt.acksDir, STRICT_PROBLEMS.ACK_RECORD_CORRUPT],
  ])) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const record = readJson(join(dir, name));
      const valid =
        record !== null &&
        typeof record['nodeId'] === 'string' &&
        Number.isInteger(record['pid']) &&
        (code === STRICT_PROBLEMS.NODE_RECORD_CORRUPT
          ? typeof record['nodeKeyPem'] === 'string' && record['nodeKeyPem'] !== ''
          : typeof record['proof'] === 'string' && Number.isInteger(record['epoch']));
      if (!valid) problems.push({ code, detail: name });
    }
  }

  if (problems.length > 0)
    return closed(problems, Math.max(historyEpoch, floorValue ?? 0), last, history.length);
  const state =
    /** @type {Record<string, unknown>} */ (directive)['state'] === 'running'
      ? 'RUNNING'
      : 'HALTED';
  return {
    state,
    epoch: historyEpoch,
    directiveHash: /** @type {string} */ (
      /** @type {Record<string, unknown>} */ (directive)['hash']
    ),
    problems,
    historyLength: history.length,
  };
}

/**
 * @param {StrictProblem[]} problems
 * @param {number} epoch
 * @param {Record<string, unknown> | null} last
 * @param {number} historyLength
 * @returns {StrictReading}
 */
function closed(problems, epoch, last, historyLength) {
  return {
    state: 'RECOVERY_REQUIRED',
    epoch,
    directiveHash: last === null ? null : /** @type {string} */ (last['hash']),
    problems,
    historyLength,
  };
}

/**
 * @param {string} path
 * @returns {Record<string, unknown> | null}
 */
function readJson(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * تمامُ الإقرارِ الصارم: كلُّ عقدةٍ مسجَّلةٍ لها إقرارٌ موقَّعٌ بمفتاحِها للعهدِ والتوجيهِ
 * الجاريين — **والموتُ ليس إقراراً**. وكلُّ عمليةٍ حيّةٍ في نطاقِ الإقلاع (`livePids`،
 * من `cgroup.procs`) بلا سجلِّ عقدةٍ تُعدُّ غيرَ مُقِرّة.
 * @param {Parameters<typeof strictHaltReading>[0]} halt
 * @param {{ epochFloor?: { read(): number } | null, livePids?: number[] }} options
 * @returns {{ ok: boolean, reading: StrictReading, unconfirmed: string[], unregisteredLivePids: number[] }}
 */
export function strictFullyConfirmed(halt, options = {}) {
  const reading = strictHaltReading(halt, options);
  /** @type {string[]} */
  const unconfirmed = [];
  /** @type {number[]} */
  const unregisteredLivePids = [];
  if (reading.state !== 'HALTED') {
    return { ok: false, reading, unconfirmed, unregisteredLivePids };
  }
  const registeredPids = new Set();
  if (existsSync(halt.nodesDir)) {
    for (const name of readdirSync(halt.nodesDir)) {
      if (name.startsWith('.')) continue;
      const node = readJson(join(halt.nodesDir, name));
      if (node === null) continue;
      registeredPids.add(node['pid']);
      const nodeId = /** @type {string} */ (node['nodeId']);
      const key = /** @type {string} */ (node['nodeKeyPem']);
      const acked =
        existsSync(halt.acksDir) &&
        readdirSync(halt.acksDir).some((ackName) => {
          const ack = readJson(join(halt.acksDir, ackName));
          if (ack === null || ack['nodeId'] !== nodeId || ack['epoch'] !== reading.epoch)
            return false;
          if (ack['directiveHash'] !== reading.directiveHash) return false;
          try {
            return verifyHaltAckProof(
              key,
              haltAckPayload(String(ack['directiveHash']), reading.epoch, nodeId),
              String(ack['proof']),
            );
          } catch {
            return false;
          }
        });
      if (!acked) unconfirmed.push(nodeId);
    }
  }
  for (const pid of options.livePids ?? []) {
    if (!registeredPids.has(pid)) unregisteredLivePids.push(pid);
  }
  return {
    ok: unconfirmed.length === 0 && unregisteredLivePids.length === 0,
    reading,
    unconfirmed: unconfirmed.sort(),
    unregisteredLivePids,
  };
}

/**
 * حارسٌ متزامنٌ بواجهةِ `HaltGuard` (‏`assertOperational`) يقرأُ القراءةَ الصارمةَ في كلِّ
 * نداء. يُركَّبُ في العاملِ تحتَ وضعِ السياجِ بدلَ القارئِ الأصليِّ لا فوقَه.
 * @param {Parameters<typeof strictHaltReading>[0]} halt
 * @param {{ epochFloor?: { read(): number } | null }} options
 * @returns {{ assertOperational(): void, read(): StrictReading }}
 */
export function createStrictHaltGuard(halt, options = {}) {
  return {
    read: () => strictHaltReading(halt, options),
    assertOperational() {
      const reading = strictHaltReading(halt, options);
      if (reading.state !== 'RUNNING') {
        throw new StrictHaltError(
          reading.state === 'HALTED' ? 'SOVEREIGN_HALT' : 'RECOVERY_REQUIRED',
          reading,
        );
      }
    },
  };
}

/**
 * حدٌّ خارجيٌّ للعهدِ في ملفٍّ مستقلٍّ عن الثلاثيّة (للمختبرِ وللعاملِ القارئ). غيابُه أو
 * تلفُه يرمي — فلا يُقرأُ صفراً صامتاً.
 * @param {string} path
 * @returns {{ read(): number }}
 */
export function fileEpochFloor(path) {
  return {
    read() {
      const raw = readFileSync(path, 'utf8').trim();
      if (!/^[0-9]+$/.test(raw)) throw new Error(`EPOCH_FLOOR_CORRUPT: ${path}`);
      return Number.parseInt(raw, 10);
    },
  };
}
