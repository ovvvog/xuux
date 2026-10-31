/**
 * مِحكُّ دوامِ الاسمِ عندَ علاماتِ مزامنةِ المجلّدِ — `WL-505` (‏`LIVE-39` ع١).
 *
 * **ما يقيسُه:** يقرأُ سجلَّ حائلِ `scripts/lib/live-39-dirsync-marks.c` (‏حالُ كلِّ اسمٍ مَسَّتهُ
 * `rename`/`link`/`unlink` كما كانت حيّةً لحظةَ العلامةِ `dirsync-<n>`)، ويقارنُها اسماً اسماً بصورةِ
 * القرصِ بعدَ إعادةِ سجلِّ `dm-log-writes` حتّى تلكَ العلامةِ — **بقراءةِ نظامِ الملفّاتِ وحدَها**، بلا
 * إقلاعِ الجذرِ ولا حكمِ البروتوكول. فالنتيجةُ هنا «الاسمُ دائمٌ في نظامِ الملفّات» لا «الاستعادةُ
 * نجحت»؛ والبروتوكولُ يُقاسُ عندَ العلامةِ نفسِها **منفصلاً** في سطرِ `PROTO` بالسكربت.
 *
 * **حكمُ الاسم:** `present` ⇐ موجودٌ في الصورة؛ `absent` ⇐ غائب. **والمحتوى يُقارَنُ للأوّليِّ وحدَه**
 * (‏بايتاً ببايتٍ بنسخةِ اللحظة) لأنّ ملفَّه المؤقّتَ زُومِنَ قبلَ إظهارِه فالمقارنةُ تُثبِتُ أنّه **الملفُّ
 * نفسُه** لا اسمٌ قديم؛ أمّا الثانويُّ (‏أقفالٌ تُكتَبُ بلا `fsync` قصداً) فمزامنةُ المجلّدِ تَعِدُ باسمِه
 * لا بمحتواه — ومقارنةُ محتواه كانت ستُسقِطُ الشاهدَ بما لا يَعِدُ به الكودُ أصلاً.
 * **حكمُ العلامة:** `DURABLE` إن طابقَت كلُّ الأسماء، وإلّا `LOST:<سبب>:<مسار>` لأوّلِ مخالفٍ —
 * و`primaryResult` للاسمِ الأوّليِّ وحدَه (‏ما أُظهِرَ أخيراً قبلَ المزامنة: الاسمُ الذي وُجِدَت لأجلِه).
 *
 * **المواضعُ (‏تحليلُ `WL-503` §2):** تُصنَّفُ العلامةُ بنافذتِها (‏آخرُ `STAGE` قبلَها) واسمِها الأوّليّ:
 *   M1 سجلُّ التراجعِ في نافذةِ `TXN` · M2 ختمُ `staged` للبيانِ في `TXN` · M3 المطالبةُ في
 *   `commands.ledger.claims` في نافذةِ `S2` · M4 ترقيةُ البيانِ في نافذةِ `S4` · BOOT مزامناتُ الإقلاع.
 *   **والمطلوبُ كشفُه تحتَ الطفرةِ بحكمِ التصميمِ المعتمَد:** M2 وM4 — وغيرُهما يُقاسُ ويُعلَنُ.
 *
 * @module lib/live-39-dirsync-check
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

/** الاسمُ الأساسيُّ لملفِّ البيانِ (‏`STATE_MANIFEST_FILE`). */
const MANIFEST = 'root-of-trust.manifest.json';
/** الاسمُ الأساسيُّ لسجلِّ التراجع. */
const UNDO = 'root-of-trust.undo.jsonl';
/** مجلّدُ المطالبات. */
const CLAIMS_DIR = 'commands.ledger.claims';

/** المواضعُ التي يُوجِبُ التصميمُ كشفَها تحتَ الطفرة (‏§4.1: «م٢ وم٤ على الأقلّ»). */
export const REQUIRED_SITES = Object.freeze(['M2', 'M4']);

/**
 * يحلّلُ سطرَ `KEY|k=v|…`.
 * @param {string} line
 * @returns {{kind: string, fields: Record<string, string>}}
 */
export function parseLine(line) {
  const [kind, ...rest] = line.split('|');
  /** @type {Record<string, string>} */
  const fields = {};
  for (const part of rest) {
    const at = part.indexOf('=');
    if (at > 0) fields[part.slice(0, at)] = part.slice(at + 1);
    else fields[part] = '';
  }
  return { kind, fields };
}

/**
 * يقرأُ السجلَّ إلى علاماتٍ مرتّبةٍ بـ`n` معَ نافذتِها وأسمائِها وتسلسلِ أحداثِها.
 * @param {string} text - نصُّ السجلّ
 * @returns {Array<{n: number, mode: string, dir: string, primary: string, op: string,
 *   window: string, names: Array<{path: string, state: string, snap: string, primary: boolean}>,
 *   events: string[]}>}
 */
export function parseLog(text) {
  /** @type {Map<number, any>} */
  const marks = new Map();
  let window = 'NONE';
  /** @type {Array<{kind: string, n: number}>} */
  const sequence = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const { kind, fields } = parseLine(line);
    if (kind === 'STAGE') {
      window = rawField(line);
      continue;
    }
    if (kind === 'MARK_ACK') {
      const n = Number(/^dirsync-(\d+)$/u.exec(rawField(line))?.[1]);
      if (Number.isInteger(n)) sequence.push({ kind, n });
      continue;
    }
    const n = Number(fields.n);
    if (!Number.isInteger(n)) continue;
    if (kind === 'DIRSYNC') {
      marks.set(n, {
        n,
        mode: fields.mode,
        dir: fields.dir,
        primary: fields.primary,
        op: fields.op,
        window,
        names: [],
        events: [],
      });
    } else if (kind === 'NAME') {
      marks.get(n)?.names.push({
        path: fields.path,
        state: fields.state,
        snap: fields.snap,
        primary: fields.primary === '1',
      });
    }
    if (['FSYNC_REAL', 'FSYNC_SKIPPED', 'MARK_REQ', 'DIRSYNC'].includes(kind)) {
      sequence.push({ kind, n });
    }
  }
  for (const { kind, n } of sequence) marks.get(n)?.events.push(kind);
  return [...marks.values()].sort((a, b) => a.n - b.n);
}

/** @param {string} line */
function rawField(line) {
  return line.slice(line.indexOf('|') + 1);
}

/**
 * يُصنِّفُ العلامةَ إلى موضعِها في التصميم.
 * @param {{window: string, primary: string, dir: string}} mark
 * @returns {string}
 */
export function classifySite(mark) {
  const name = mark.primary === '-' ? '' : basename(mark.primary);
  if (mark.window === 'BOOT') return 'BOOT';
  if (mark.window === 'TXN' && name === UNDO) return 'M1';
  if (mark.window === 'TXN' && name === MANIFEST) return 'M2';
  if (mark.window === 'S2' && basename(mark.dir) === CLAIMS_DIR) return 'M3';
  if (mark.window === 'S4' && name === MANIFEST) return 'M4';
  return 'OTHER';
}

/**
 * التسلسلُ المطلوبُ لكلِّ وضعٍ بين المزامنةِ والعلامة — يُثبِتُ موضعَ العلامةِ من النداءِ في
 * العمليّةِ نفسِها (‏`MARK_ACK` يكتبُه المُعلِّمُ بعدَ عودةِ `dmsetup`).
 * @param {string} mode
 * @param {string[]} events
 * @returns {boolean}
 */
export function orderHolds(mode, events) {
  const ack = events.indexOf('MARK_ACK');
  const real = events.indexOf('FSYNC_REAL');
  const skipped = events.indexOf('FSYNC_SKIPPED');
  if (ack < 0 || events.lastIndexOf('MARK_ACK') !== ack) return false;
  if (mode === 'witness') return real >= 0 && skipped < 0 && real < ack;
  if (mode === 'mutate') return skipped >= 0 && real < 0 && skipped < ack;
  if (mode === 'early') return real >= 0 && skipped < 0 && ack < real;
  return false;
}

/**
 * حكمُ اسمٍ واحدٍ على الصورةِ المحمَّلة.
 * @param {{path: string, state: string, snap: string, primary: boolean}} name
 * @param {{exists: (p: string) => boolean, read: (p: string) => Buffer, isFile: (p: string) => boolean}} fs
 * @returns {string} `OK` أو سببُ المخالفة
 */
export function judgeName(name, fs) {
  const present = fs.exists(name.path);
  if (name.state === 'absent') return present ? 'PRESENT' : 'OK';
  if (!present) return 'MISSING';
  if (!name.primary || name.snap === '-') return 'OK';
  if (!fs.isFile(name.path)) return 'NOT_FILE';
  return fs.read(name.path).equals(fs.read(name.snap)) ? 'OK' : 'CONTENT';
}

/**
 * حكمُ علامةٍ كاملة.
 * @param {ReturnType<typeof parseLog>[number]} mark
 * @param {Parameters<typeof judgeName>[1]} fs
 * @returns {{result: string, primaryResult: string, lines: string[]}}
 */
export function judgeMark(mark, fs) {
  const lines = [];
  let result = 'DURABLE';
  let primaryResult = 'NONE';
  for (const name of mark.names) {
    const verdict = judgeName(name, fs);
    lines.push(
      `NAME_RESULT|n=${mark.n}|path=${name.path}|expected=${name.state}|result=${verdict}|primary=${name.primary ? 1 : 0}`,
    );
    if (verdict !== 'OK' && result === 'DURABLE') result = `LOST:${verdict}:${name.path}`;
    if (name.primary) primaryResult = verdict === 'OK' ? 'DURABLE' : `LOST:${verdict}:${name.path}`;
  }
  if (mark.names.length === 0) result = 'EMPTY';
  return { result, primaryResult, lines };
}

/** نظامُ الملفّاتِ الحقيقيُّ للمِحكّ. */
const realFs = {
  /** @param {string} p */
  exists: (p) => {
    try {
      lstatSync(p);
      return true;
    } catch {
      return false;
    }
  },
  /** @param {string} p */
  read: (p) => readFileSync(p),
  /** @param {string} p */
  isFile: (p) => lstatSync(p).isFile(),
};

/**
 * الواجهة: `list --log <f>` يطبعُ `MARKREC|n|mode|site|window|primary|order` لكلِّ علامة؛
 * `check --log <f> --n <n>` يطبعُ أسطرَ `NAME_RESULT` ثمّ `DIRSYNC_RESULT|n|site|all=…|primary=…`.
 * @param {string[]} argv
 * @returns {number} رمزُ الخروج
 */
export function main(argv) {
  const [command, ...rest] = argv;
  /** @type {Record<string, string>} */
  const options = {};
  for (let i = 0; i < rest.length; i += 2) options[rest[i].replace(/^--/u, '')] = rest[i + 1];
  if (!options.log || !existsSync(options.log)) {
    process.stderr.write(`DIRSYNC_CHECK_NO_LOG ${options.log}\n`);
    return 2;
  }
  const marks = parseLog(readFileSync(options.log, 'utf8'));
  if (command === 'list') {
    for (const mark of marks) {
      const order = orderHolds(mark.mode, mark.events) ? 'ok' : 'broken';
      process.stdout.write(
        `MARKREC|${mark.n}|${mark.mode}|${classifySite(mark)}|${mark.window}|${mark.primary}|${order}\n`,
      );
    }
    return 0;
  }
  if (command === 'check') {
    const mark = marks.find((m) => m.n === Number(options.n));
    if (!mark) {
      process.stderr.write(`DIRSYNC_CHECK_NO_MARK ${options.n}\n`);
      return 2;
    }
    const { result, primaryResult, lines } = judgeMark(mark, realFs);
    for (const line of lines) process.stdout.write(`${line}\n`);
    process.stdout.write(
      `DIRSYNC_RESULT|n=${mark.n}|site=${classifySite(mark)}|dir=${mark.dir}|all=${result}|primary=${primaryResult}\n`,
    );
    return 0;
  }
  process.stderr.write(`DIRSYNC_CHECK_UNKNOWN_COMMAND ${command}\n`);
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
