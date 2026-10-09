/**
 * كاتبُ إعادةِ التشغيلِ لسجلِّ `dm-log-writes` — وحدةُ `LIVE-39` (‏شطرُ الأداةِ).
 *
 * **الغرضُ:** محاكاةُ فقدِ الطاقةِ في CI لا في العتادِ: نواةُ لينكس تُسجِّلُ على جهازِ
 * السجلِّ كلَّ ما نجا من ذاكرةِ الجهازِ عندَ `FLUSH` (‏«أسوأُ حالةٍ ممكنةٍ تجاهَ فقدِ
 * الطاقةِ» بحرفِ توثيقِ النواةِ نفسِهِ)، و`FUA` يُسجَّلُ فورَ إتمامِهِ. فإعادةُ تشغيلِ
 * السجلِّ **حتّى علامةٍ مسمّاةٍ** (‏`dmsetup message … mark`) تُنتِجُ صورةَ القرصِ كما
 * كانت عندَ تلكَ العلامةِ: كلُّ كتابةٍ لم تصلْ ذاكرةَ الجهازِ **تسقُطُ** — وهذا عينُ ما
 * لا يقيسُهُ `SIGKILL` (‏يُبقي ذاكرةَ الصفحاتِ).
 *
 * **الصيغةُ على القرصِ** (‏`drivers/md/dm-log-writes.c` من شجرةِ لينكس، قُرِئَت من
 * المصدرِ لا من استنباطٍ):
 *   - قطاعٌ سوبربلوكٍ في البدايةِ: `{le64 magic, le64 version, le64 nr_entries, le32
 *     sectorsize}`؛ `magic = 0x6a736677736872` و`version = 1`. و`nr_entries` يُحدَّثُ
 *     دوريّاً (‏عندَ `FUA`/`mark`) **فلا يُعتمَدُ عليه** للعدِّ — العدُّ بالتحليلِ حتّى
 *     نهايةِ السجلِّ أو العلامةِ.
 *   - ثمّ مداخلُ: `[قطاعُ بياناتٍ وصفيةٍ][بياناتُ الكتابةِ]` — البياناتُ الوصفيةُ قطاعٌ
 *     كاملٌ (‏`sectorsize`) يحملُ `{le64 sector, le64 nr_sectors, le64 flags, le64 data_len}`
 *     صفراً بعدَ البنيةِ، واسمُ العلامةِ **داخلَ القطاعِ** بعدَ البنيةِ (`data_len` =
 *     طولُ الاسمِ، بلا `NUL`).
 *   - الأعلامُ: `FLUSH=1` · `FUA=2` · `DISCARD=4` · `MARK=8` · `METADATA=16`.
 *   - حمولةُ الكتابةِ (‏`nr_sectors × sectorsize`) تتبعُ البياناتِ الوصفيةَ **إلّا** في
 *     `MARK` (‏لا حمولةَ) و`DISCARD` (‏لا حمولةَ — والإسقاطُ تصفيرٌ)؛ و`FLUSH` بلا بياناتٍ
 *     لا حمولةَ له.
 *   - `sectorsize` هو حجمُ الكتلةِ المنطقيّةُ **للجهازِ الهدفِ** (‏لا لجهازِ السجلِّ).
 *
 * **حدودٌ معلَنة:**
 *   1. علمٌ خارجَ الأعلامِ الخمسةِ ⇐ رفضٌ (`LOG_WRITES_UNKNOWN_FLAG`) لا تجاهلٌ — التشغيلُ
 *      الغامضُ يُنتِجُ صورةً خادعةً.
 *   2. العلامةُ المطلوبةُ غائبةٌ ⇐ فشلٌ لا نجاحٌ فارغٌ (`LOG_WRITES_MARK_NOT_FOUND`).
 *   3. مدخلٌ يتجاوزُ حدودَ الصورةِ أو سجلًّا مبتوراً ⇐ فشلٌ مُسمّىً.
 *   4. قطاعُ بياناتٍ وصفيةٍ كلّهُ أصفارٌ = نهايةُ السجلِّ (‏الحشوُ صفرٌ بحكمِ البنيةِ).
 *
 * @module lib/log-writes-replay
 */

import { openSync, readSync, writeSync, ftruncateSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** سحرُ السوبربلوك — `WRITE_LOG_MAGIC` من مصدرِ النواةِ. */
const WRITE_LOG_MAGIC = 0x6a736677736872n;
/** إصدارُ الصيغةِ — `WRITE_LOG_VERSION`. */
const WRITE_LOG_VERSION = 1n;
/** الأعلامُ الخمسةُ المعروفةُ — أيُّ بتٍّ خارجَها رفضٌ. */
const KNOWN_FLAGS = (1n << 0n) | (1n << 1n) | (1n << 2n) | (1n << 3n) | (1n << 4n);
const FLAG_DISCARD = 1n << 2n;
const FLAG_MARK = 1n << 3n;

/** حجمُ بنيةِ المدخلِ على القرصِ (‏`struct log_write_entry`). */
const ENTRY_STRUCT_SIZE = 32;
/** حجمُ بنيةِ السوبربلوكِ قبلَ `sectorsize` (‏`struct log_write_super`). */
const SUPER_STRUCT_SIZE = 28;

/**
 * خطأٌ مُسمّى برمزِهِ — يُقارَنِ الرمزُ في الاختباراتِ ولا يُفحَصِ النصُّ.
 */
export class LogWritesReplayError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'LogWritesReplayError';
    this.code = code;
  }
}

/**
 * @typedef {object} ReplayResult
 * @property {bigint} appliedEntries عددُ المداخلِ المُطبَّقةِ قبلَ العلامةِ.
 * @property {bigint} appliedSectors عددُ القطاعاتِ المكتوبةِ في الصورةِ.
 * @property {string} endMark العلامةُ التي توقّفَ عندها التشغيلُ.
 */

/**
 * يُعيدُ تشغيلَ سجلِّ `dm-log-writes` في صورةِ قرصٍ حتّى علامةٍ مسمّاةٍ.
 *
 * الصورةَ يفتحُها بـ`r+` ويصفّرُها أوّلاً (‏الصورةُ تُنشَأُ فارغةً بحجمِ الجهازِ الهدفِ)،
 * ثمّ يُطبّقُ المداخلَ بالترتيبِ. القراءةُ متزامنةٌ متسلسلةٌ — السجلُ خطّيٌّ بالتصميمِ.
 *
 * @param {object} options
 * @param {string} options.logPath مسارُ ملفِّ السجلِّ (‏جهازُ السجلِّ أو صورتُهُ).
 * @param {string} options.imagePath مسارُ ملفِّ الصورةِ الهدفِ (‏يُصفَّرُ أوّلاً).
 * @param {string} options.endMark اسمُ العلامةِ التي يُوقَفُ عندها (‏لا تُطبَّقُ هي وما بعدَها).
 * @param {number} options.sizeBytes حجمُ الصورةِ بالبايتاتِ — حجمُ الجهازِ الهدفِ نفسِهِ.
 * @returns {Promise<ReplayResult>}
 */
export async function replayLogWrites({ logPath, imagePath, endMark, sizeBytes }) {
  if (typeof endMark !== 'string' || endMark.length === 0) {
    throw new LogWritesReplayError('LOG_WRITES_MARK_REQUIRED', 'اسمُ العلامةِ مطلوبٌ');
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new LogWritesReplayError('LOG_WRITES_IMAGE_SIZE_INVALID', 'حجمُ الصورةِ غيرُ صالحٍ');
  }
  const log = openSync(logPath, 'r');
  const image = openSync(imagePath, 'r+');
  try {
    ftruncateSync(image, 0);
    ftruncateSync(image, sizeBytes);
    /** صفرٌ لكتابةِ التصفيرِ والإسقاطِ. */
    const zeros = Buffer.alloc(64 * 1024);
    /** @param {number} start @param {number} length */
    const zeroRange = (start, length) => {
      let done = 0;
      while (done < length) {
        const chunk = Math.min(zeros.length, length - done);
        writeSync(image, zeros, 0, chunk, start + done);
        done += chunk;
      }
    };

    // السوبربلوك: سحرٌ وإصدارٌ وحجمُ قطاعٍ — و`nr_entries` لا يُعتمَدُ عليهِ (‏يُحدَّثُ دوريّاً).
    const superBuf = readAt(log, 0, SUPER_STRUCT_SIZE + 4);
    const magic = superBuf.readBigUInt64LE(0);
    if (magic !== WRITE_LOG_MAGIC) {
      throw new LogWritesReplayError(
        'LOG_WRITES_BAD_MAGIC',
        'سحرُ السجلِّ لا يطابقُ dm-log-writes',
      );
    }
    const version = superBuf.readBigUInt64LE(8);
    if (version !== WRITE_LOG_VERSION) {
      throw new LogWritesReplayError(
        'LOG_WRITES_BAD_VERSION',
        `إصدارُ صيغةِ السجلِّ غيرُ مدعومٍ: ${version}`,
      );
    }
    const sectorsize = superBuf.readUInt32LE(SUPER_STRUCT_SIZE);
    if (sectorsize !== 512 && sectorsize !== 4096) {
      throw new LogWritesReplayError(
        'LOG_WRITES_BAD_SECTORSIZE',
        `حجمُ قطاعٍ غيرُ مدعومٍ: ${sectorsize}`,
      );
    }

    let offset = sectorsize;
    let appliedEntries = 0n;
    let appliedSectors = 0n;
    const markSector = Buffer.alloc(sectorsize);
    for (;;) {
      const read = readSync(log, markSector, 0, sectorsize, offset);
      if (read < sectorsize) {
        throw new LogWritesReplayError('LOG_WRITES_LOG_TRUNCATED', `السجلُ مبتورٌ عندَ ${offset}`);
      }
      if (markSector.every((b) => b === 0)) break; // نهايةُ السجلِّ — والحشوُ صفرٌ بحكمِ البنيةِ
      const sector = markSector.readBigUInt64LE(0);
      const nrSectors = markSector.readBigUInt64LE(8);
      const flags = markSector.readBigUInt64LE(16);
      const dataLen = markSector.readBigUInt64LE(24);
      if ((flags & ~KNOWN_FLAGS) !== 0n) {
        throw new LogWritesReplayError(
          'LOG_WRITES_UNKNOWN_FLAG',
          `علمٌ غيرُ معروفٍ: 0x${flags.toString(16)}`,
        );
      }
      if ((flags & FLAG_MARK) !== 0n) {
        if (dataLen > BigInt(sectorsize - ENTRY_STRUCT_SIZE)) {
          throw new LogWritesReplayError('LOG_WRITES_BAD_MARK', 'اسمُ علامةٍ أطولُ من القطاعِ');
        }
        const name = markSector
          .subarray(ENTRY_STRUCT_SIZE, ENTRY_STRUCT_SIZE + Number(dataLen))
          .toString('utf8');
        if (name === endMark) {
          return { appliedEntries, appliedSectors, endMark };
        }
        offset += sectorsize; // العلامةُ لا حمولةَ بعدَها
        continue;
      }
      const hasPayload = (flags & FLAG_DISCARD) === 0n && nrSectors > 0n;
      const payloadLen = hasPayload ? Number(nrSectors) * sectorsize : 0;
      if (hasPayload || (flags & FLAG_DISCARD) !== 0n) {
        const byteStart = sector * BigInt(sectorsize);
        const byteLen = (flags & FLAG_DISCARD) !== 0n ? Number(nrSectors) * sectorsize : payloadLen;
        if (byteStart + BigInt(byteLen) > BigInt(sizeBytes)) {
          throw new LogWritesReplayError(
            'LOG_WRITES_OUT_OF_BOUNDS',
            `كتابةٌ تتجاوزُ الصورةَ: ${sector}+${nrSectors}`,
          );
        }
        if ((flags & FLAG_DISCARD) !== 0n) {
          zeroRange(Number(byteStart), byteLen);
        } else {
          const payload = Buffer.alloc(payloadLen);
          const got = readSync(log, payload, 0, payloadLen, offset + sectorsize);
          if (got < payloadLen) {
            throw new LogWritesReplayError('LOG_WRITES_LOG_TRUNCATED', 'حمولةُ كتابةٍ مبتورةٌ');
          }
          writeSync(image, payload, 0, payload.length, Number(byteStart));
        }
        appliedSectors += nrSectors;
      }
      appliedEntries += 1n;
      offset += sectorsize + payloadLen;
    }
    throw new LogWritesReplayError(
      'LOG_WRITES_MARK_NOT_FOUND',
      `العلامةُ «${endMark}» غائبةٌ عن السجلِّ`,
    );
  } finally {
    closeSync(log);
    closeSync(image);
  }
}

/**
 * قراءةٌ متزامنةٌ كاملةٌ من موضعٍ — لا تُقبَلُ قراءةٌ ناقصةٌ.
 * @param {number} fd
 * @param {number} position
 * @param {number} length
 * @returns {Buffer}
 */
function readAt(fd, position, length) {
  const buf = Buffer.alloc(length);
  const got = readSync(fd, buf, 0, length, position);
  if (got < length) {
    throw new LogWritesReplayError('LOG_WRITES_LOG_TRUNCATED', `السجلُ مبتورٌ عندَ ${position}`);
  }
  return buf;
}

/**
 * واجهةُ السطرِ الأمريِّ — تُستعمَلُ من `scripts/live-39-power-loss.sh` في CI.
 *
 * @param {string[]} argv
 * @returns {Promise<number>} رمزُ الخروجِ
 */
export async function main(argv = process.argv.slice(2)) {
  /** @type {Record<string, string>} */
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    args[argv[i]?.replace(/^--/, '') ?? ''] = argv[i + 1] ?? '';
  }
  const required = ['log', 'image', 'end-mark', 'size'];
  for (const key of required) {
    if (!args[key]) {
      process.stderr.write(`وسيطٌ ناقصٌ: --${key}\n`);
      return 2;
    }
  }
  try {
    const endMark = args['end-mark'] ?? '';
    const result = await replayLogWrites({
      logPath: args['log'] ?? '',
      imagePath: args['image'] ?? '',
      endMark,
      sizeBytes: Number(args['size']),
    });
    process.stdout.write(
      `أُعيدَ التشغيلُ حتّى «${result.endMark}»: ${result.appliedEntries} مُدخلاً و${result.appliedSectors} قطاعاً\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof LogWritesReplayError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

// تشغيلٌ مباشرٌ كسطرٍ أمريٍّ: node scripts/lib/log-writes-replay.mjs --log … --image …
// في أسفلِ الملفِ قُصداً: الاستدعاءُ المتزامنُ في الأعلى كانَ يسبقُ تهيئةَ الثوابتِ
// (‏منطقةُ الرفضِ الزمنيِّ) فيسقُطُ بالمرجعِ قبلَ أن يعملَ شيءٌ.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
