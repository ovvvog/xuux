#!/usr/bin/env node
/**
 * الضحيّةُ: عمليّةُ حالةٍ حقيقيّةٌ تُقتَل — الخطوة `M10.09`.
 *
 * **لماذا عمليّةٌ منفصلةٌ؟** لأنّ تجربةَ `chaos:node-drop` تدّعي أنّ إسقاطَ
 * عقدةٍ إسقاطاً قاسياً لا يُفقِد سطراً مُثبَتاً ولا يُخلِّف دفتراً لا يُقرأ.
 * ودعوى كهذه لا تُقاس بنداءِ دالّةٍ في العمليّةِ نفسِها: العمليّةُ التي تحكم
 * لا تستطيع أن تُقتل بـ`SIGKILL` ثم تكتب النتيجة. فهذه العمليّةُ تكتب حالةَ
 * أقاليمَ حقيقيّةً في جذرٍ مُمرَّرٍ، تُعلِن `COMMITTED <n>` على `stdout` حين
 * تُثبِّت سطورَها، ثم **تتجمَّد تجمُّداً حقيقيّاً** بانتظارٍ لا مؤقِّتَ فيه
 * (‏`Atomics.wait`) حتى تصلَها الإشارةُ القاتلة — فلا خاتمةَ خروجٍ تُنفَّذ ولا
 * إغلاقَ ملفّاتٍ مُهذَّباً يُجمِّل النتيجة.
 *
 * وهي أداةُ تجربةٍ لا مسارَ إنتاجٍ: تعمل في جذرٍ مؤقّتٍ يُمرَّر إليها، ولا
 * تعرف مساراً مكتوباً في متنِها.
 *
 * الاستعمال: `node scripts/lib/chaos-victim.mjs --root <dir> --lines <n> --at <ms>`
 */

import path from 'node:path';
import process from 'node:process';

import { loadRegionsContract } from '../../src/regions/contract.mjs';

import { appendLedger, seedRegions, writeToWriter, writeWriterPointer } from './region-facts.mjs';

/** @param {string} flag @param {number} fallback @returns {number} */
function numberFlag(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return fallback;
  }
  const raw = Number(process.argv[index + 1]);
  return Number.isSafeInteger(raw) ? raw : fallback;
}

const rootIndex = process.argv.indexOf('--root');
if (rootIndex === -1 || process.argv[rootIndex + 1] === undefined) {
  process.stderr.write('الضحيّةُ بلا جذرٍ مُمرَّرٍ — ولا تُكتب حالةٌ في مسارٍ مجهول.\n');
  process.exit(2);
}
const root = path.resolve(String(process.argv[rootIndex + 1]));
const lines = numberFlag('--lines', 5);
const at = numberFlag('--at', 1_700_000_000_000);

const contract = loadRegionsContract();
const seeded = seedRegions({ contract, root, at });
for (let index = 0; index < lines; index += 1) {
  writeToWriter({ contract, root, record: `chaos-line-${String(index)}`, at: at + index });
  appendLedger({
    contract,
    root,
    at: at + index,
    entry: { type: 'region.replicated', from: seeded.writer, to: [], records: index + 1, lagMs: 0 },
  });
}
// مؤشِّرُ الكاتبِ يُعاد تثبيتُه آخرَ شيءٍ: فالسؤالُ في هذه التجربةِ عن حالةِ
// القرصِ **لحظةَ القتلِ**، والمؤشِّرُ آخرُ ما يُكتَب فهو أرجى ما يُقطَع.
writeWriterPointer({ contract, root, writer: seeded.writer, at: at + lines, automatic: false });

process.stdout.write(`COMMITTED ${String(lines)}\n`);

// تجمُّدٌ حقيقيٌّ بلا مؤقِّتٍ ولا حلقةِ انتظارٍ تستهلك المعالجَ: تنتظر هذه
// العمليّةُ إشارةً لا تأتي، فلا تخرج إلا مقتولةً — وهو نصُّ التجربة.
const block = new Int32Array(new SharedArrayBuffer(4));
Atomics.wait(block, 0, 0);
