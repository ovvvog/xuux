// @ts-nocheck
// tests/tooling/log-writes-replay.test.mjs
//
// `WL-360` — اختباراتُ كاتبِ إعادةِ التشغيلِ لسجلِّ `dm-log-writes` (‏`LIVE-39`).
// الوحدةُ نقيّةٌ: تُبنى سجلاتٌ اصطناعيّةٌ في الذاكرةِ بلا نواةٍ ولا عتادٍ، ويُقارَنُ
// رمزُ الخطأِ المُسمّى لا نصُّه. صحةُ الصيغةِ نفسِها تُقاسُ على سجلِّ نواةٍ حقيقيٍّ في
// خطوةِ CI المخصّصةِ (‏تجربةُ التحقّقِ) — هذه الاختباراتُ تقيسُ منطقَ الوحدةِ.
//
// الصيغةُ من مصدرِ النواةِ (drivers/md/dm-log-writes.c): سوبربلوكٌ ثمّ مداخلُ
// `[قطاعُ بياناتٍ وصفيةٍ][حمولةٌ]`؛ العلامةُ اسمُها داخلَ قطاعِ البياناتِ الوصفيةِ ولا
// حمولةَ بعدَها، و`DISCARD` بلا حمولةٍ، و`FLUSH` الخاليُ بلا حمولةٍ.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  LogWritesReplayError,
  replayLogWrites,
  main,
} from '../../scripts/lib/log-writes-replay.mjs';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

const MAGIC = 0x6a736677736872n;
const FLAG_FLUSH = 1n;
const FLAG_DISCARD = 4n;
const FLAG_MARK = 8n;
const SECTOR = 512;

/** مساحةُ عملٍ معزولةٌ للسجلِّ والصورةِ. */
function workspace() {
  const base = registerTmpRoot(mkdtempSync(join(tmpdir(), 'lwr-')));
  return {
    log: join(base, 'log.dev'),
    image: join(base, 'image.dev'),
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

/**
 * بناءُ سجلٍّ اصطناعيٍّ وفقَ صيغةِ النواةِ.
 * @param {Array<{sector?: bigint, nrSectors?: bigint, flags?: bigint, data?: Buffer, mark?: string}>} entries
 * @returns {Buffer}
 */
function buildLog(entries) {
  const superBlock = Buffer.alloc(SECTOR);
  superBlock.writeBigUInt64LE(MAGIC, 0);
  superBlock.writeBigUInt64LE(1n, 8); // version
  superBlock.writeBigUInt64LE(0n, 16); // nr_entries — لا يُعتمَدُ عليه
  superBlock.writeUInt32LE(SECTOR, 28);
  const parts = [superBlock];
  for (const entry of entries) {
    const meta = Buffer.alloc(SECTOR);
    meta.writeBigUInt64LE(entry.sector ?? 0n, 0);
    meta.writeBigUInt64LE(entry.nrSectors ?? 0n, 8);
    meta.writeBigUInt64LE(entry.flags ?? 0n, 16);
    meta.writeBigUInt64LE(BigInt(entry.data?.length ?? entry.mark?.length ?? 0), 24);
    if (entry.mark !== undefined) {
      meta.writeBigUInt64LE(FLAG_MARK, 16); // علمُ العلامةِ كما تضعهُ النواةُ
      meta.write(entry.mark, 32, 'utf8');
    }
    // ترتيبُ النواةِ: قطاعُ البياناتِ الوصفيةِ أوّلاً ثمّ حمولةُ الكتابةِ بعدهُ.
    parts.push(meta);
    if (entry.mark === undefined && entry.data !== undefined) {
      const flags = entry.flags ?? 0n;
      if ((flags & FLAG_DISCARD) === 0n) parts.push(entry.data);
    }
  }
  // السجلُ الحقيقيُّ جهازٌ كاملٌ يلي آخرَ مُدخلٍ أصفارٌ — فالسجلُ الاصطناعيُّ كذلكَ،
  // وإلّا فقراءةُ ما بعدَ آخرِ مُدخلٍ «مبتورةٌ» ولو اكتملتِ المداخلُ.
  parts.push(Buffer.alloc(SECTOR));
  return Buffer.concat(parts);
}

/** يُمسكُ خطأً مُسمّى ويُعيدُ رمزَهُ. */
async function rejectionCode(fn) {
  try {
    await fn();
  } catch (error) {
    assert.ok(error instanceof LogWritesReplayError, `خطأٌ غيرُ مُسمّىً: ${error}`);
    return error.code;
  }
  return assert.fail('لم يُرفَعْ خطأ');
}

test('الكتابةُ تُطبَّقُ في موضعِها والعلامةُ تُنهي التشغيلَ دونَ ما بعدَها', async () => {
  const ws = workspace();
  try {
    const data = Buffer.alloc(SECTOR * 2, 0x41);
    const log = buildLog([
      { sector: 10n, nrSectors: 2n, data }, // كتابةٌ عاديةٌ
      { mark: 'cut' }, // علامةُ القطعِ
      { sector: 20n, nrSectors: 1n, data: Buffer.alloc(SECTOR, 0x42) }, // بعدَ القطعِ
    ]);
    writeFileSync(ws.log, log);
    writeFileSync(ws.image, Buffer.alloc(4096 * 16));
    const result = await replayLogWrites({
      logPath: ws.log,
      imagePath: ws.image,
      endMark: 'cut',
      sizeBytes: 4096 * 16,
    });
    assert.equal(result.appliedEntries, 1n);
    assert.equal(result.appliedSectors, 2n);
    const image = readFileSync(ws.image);
    assert.equal(
      image.subarray(10 * SECTOR, 10 * SECTOR + 2 * SECTOR).every((b) => b === 0x41),
      true,
    );
    assert.equal(
      image.subarray(20 * SECTOR, 20 * SECTOR + SECTOR).every((b) => b === 0),
      true,
      'ما بعدَ العلامةِ لم يُطبَّقْ',
    );
  } finally {
    ws.cleanup();
  }
});

test('العلامةُ الغائبةُ فشلٌ مُسمّى لا نجاحٌ فارغٌ', async () => {
  const ws = workspace();
  try {
    writeFileSync(ws.log, buildLog([{ sector: 1n, nrSectors: 1n, data: Buffer.alloc(SECTOR, 1) }]));
    writeFileSync(ws.image, Buffer.alloc(4096 * 4));
    assert.equal(
      await rejectionCode(() =>
        replayLogWrites({
          logPath: ws.log,
          imagePath: ws.image,
          endMark: 'cut',
          sizeBytes: 4096 * 4,
        }),
      ),
      'LOG_WRITES_MARK_NOT_FOUND',
    );
  } finally {
    ws.cleanup();
  }
});

test('السوبربلوكُ المعطوبُ مرفوضٌ: سحرٌ وإصدارٌ وحجمُ قطاعٍ', async () => {
  const ws = workspace();
  try {
    writeFileSync(ws.log, Buffer.alloc(SECTOR * 4));
    writeFileSync(ws.image, Buffer.alloc(4096 * 4));
    assert.equal(
      await rejectionCode(() =>
        replayLogWrites({
          logPath: ws.log,
          imagePath: ws.image,
          endMark: 'cut',
          sizeBytes: 4096 * 4,
        }),
      ),
      'LOG_WRITES_BAD_MAGIC',
    );

    const badVersion = Buffer.from(buildLog([{ mark: 'cut' }]));
    badVersion.writeBigUInt64LE(99n, 8);
    writeFileSync(ws.log, badVersion);
    assert.equal(
      await rejectionCode(() =>
        replayLogWrites({
          logPath: ws.log,
          imagePath: ws.image,
          endMark: 'cut',
          sizeBytes: 4096 * 4,
        }),
      ),
      'LOG_WRITES_BAD_VERSION',
    );

    const badSectorSize = Buffer.from(buildLog([{ mark: 'cut' }]));
    badSectorSize.writeUInt32LE(1024, 28);
    writeFileSync(ws.log, badSectorSize);
    assert.equal(
      await rejectionCode(() =>
        replayLogWrites({
          logPath: ws.log,
          imagePath: ws.image,
          endMark: 'cut',
          sizeBytes: 4096 * 4,
        }),
      ),
      'LOG_WRITES_BAD_SECTORSIZE',
    );
  } finally {
    ws.cleanup();
  }
});

test('العلمُ المجهولُ رفضٌ — لا تشغيلٌ غامضٌ يُنتِجُ صورةً خادعةً', async () => {
  const ws = workspace();
  try {
    writeFileSync(
      ws.log,
      buildLog([{ sector: 1n, nrSectors: 1n, flags: 1n << 7n, data: Buffer.alloc(SECTOR) }]),
    );
    writeFileSync(ws.image, Buffer.alloc(4096 * 4));
    assert.equal(
      await rejectionCode(() =>
        replayLogWrites({
          logPath: ws.log,
          imagePath: ws.image,
          endMark: 'cut',
          sizeBytes: 4096 * 4,
        }),
      ),
      'LOG_WRITES_UNKNOWN_FLAG',
    );
  } finally {
    ws.cleanup();
  }
});

test('DISCARD يُصفِّرُ ما كُتِبَ قبلَهُ — لا حمولةَ له', async () => {
  const ws = workspace();
  try {
    const log = buildLog([
      { sector: 4n, nrSectors: 2n, data: Buffer.alloc(SECTOR * 2, 0x77) },
      { sector: 4n, nrSectors: 2n, flags: FLAG_DISCARD },
      { mark: 'cut' },
    ]);
    writeFileSync(ws.log, log);
    writeFileSync(ws.image, Buffer.alloc(4096 * 16));
    await replayLogWrites({
      logPath: ws.log,
      imagePath: ws.image,
      endMark: 'cut',
      sizeBytes: 4096 * 16,
    });
    const image = readFileSync(ws.image);
    assert.equal(
      image.subarray(4 * SECTOR, 6 * SECTOR).every((b) => b === 0),
      true,
      'الإسقاطُ لم يُصفَّرِ',
    );
  } finally {
    ws.cleanup();
  }
});

test('FLUSH الخالي لا حمولةَ له ولا يُطبَّقُ شيئاً — ويتّصلُ تحليلُ ما بعدَهُ', async () => {
  const ws = workspace();
  try {
    const log = buildLog([
      { sector: 4n, nrSectors: 1n, data: Buffer.alloc(SECTOR, 0x33) },
      { flags: FLAG_FLUSH }, // سقوطُ الحاجزِ بلا بياناتٍ
      { mark: 'cut' },
    ]);
    writeFileSync(ws.log, log);
    writeFileSync(ws.image, Buffer.alloc(4096 * 8));
    const result = await replayLogWrites({
      logPath: ws.log,
      imagePath: ws.image,
      endMark: 'cut',
      sizeBytes: 4096 * 8,
    });
    assert.equal(result.appliedEntries, 2n);
    assert.equal(result.appliedSectors, 1n);
  } finally {
    ws.cleanup();
  }
});

test('الكتابةُ خارجَ حدودِ الصورةِ مرفوضةٌ', async () => {
  const ws = workspace();
  try {
    writeFileSync(
      ws.log,
      buildLog([
        { sector: 100n, nrSectors: 8n, data: Buffer.alloc(SECTOR * 8, 1) },
        { mark: 'cut' },
      ]),
    );
    writeFileSync(ws.image, Buffer.alloc(4096 * 4));
    assert.equal(
      await rejectionCode(() =>
        replayLogWrites({
          logPath: ws.log,
          imagePath: ws.image,
          endMark: 'cut',
          sizeBytes: 4096 * 4,
        }),
      ),
      'LOG_WRITES_OUT_OF_BOUNDS',
    );
  } finally {
    ws.cleanup();
  }
});

test('السجلُ المبتورُ — حمولةٌ مقطوعةٌ — فشلٌ لا صورةٌ ناقصةٌ', async () => {
  const ws = workspace();
  try {
    const full = buildLog([
      { sector: 1n, nrSectors: 2n, data: Buffer.alloc(SECTOR * 2, 5) },
      { mark: 'cut' },
    ]);
    writeFileSync(ws.log, full.subarray(0, full.length - 3 * SECTOR)); // قطعٌ داخلَ الحمولةِ قبلَ العلامةِ
    writeFileSync(ws.image, Buffer.alloc(4096 * 8));
    assert.equal(
      await rejectionCode(() =>
        replayLogWrites({
          logPath: ws.log,
          imagePath: ws.image,
          endMark: 'cut',
          sizeBytes: 4096 * 8,
        }),
      ),
      'LOG_WRITES_LOG_TRUNCATED',
    );
  } finally {
    ws.cleanup();
  }
});

test('واجهةُ السطرِ الأمريّ: خروجٌ صفريٌّ بالوسائطِ الكاملةِ واثنانِ بالناقصةِ', async () => {
  const ws = workspace();
  try {
    writeFileSync(ws.log, buildLog([{ mark: 'cut' }]));
    writeFileSync(ws.image, Buffer.alloc(4096 * 4));
    const ok = await main([
      '--log',
      ws.log,
      '--image',
      ws.image,
      '--end-mark',
      'cut',
      '--size',
      String(4096 * 4),
    ]);
    assert.equal(ok, 0);
    assert.equal(await main(['--log', ws.log]), 2);
  } finally {
    ws.cleanup();
  }
});
