// @ts-nocheck
// tests/helpers/wl-360-crash-child.mjs
//
// `WL-360` (‏`LIVE-39`) — عمليّةٌ فرعيّةٌ للقياسِ أمامَ فقدِ الطاقةِ (‏dm-log-writes).
// لا مسَّ بشفرةِ الإنتاجِ: كلُّ شيءٍ عبرَ جذرِ الثقةِ الإنتاجيِّ الحقيقيِّ وعونِ `WL-326`
// (‏توكنٌ برمجيٌّ بعقدِ `HsmKeySource` ومرجعُ حداثةٍ `testFixture` خارجَ القرصِ المُختبرِ —
// يرفضُهُ المدخلُ الإنتاجيّ).
//
// **المهمُّ هنا موضعُ العلامةِ:** `commitBarrier.onStage('ACK')` يُطلَقُ **بعدَ اكتمالِ
// دوامِ المعاملةِ كلِّهِ** (‏S2 سجلُّ التراجعِ المُزامَنُ، S3 التنفيذُ، S4+S5 الختمُ والترقيةُ
// والرفعُ المعلَّقُ) **وقبلَ** عودةِ `transactAsync` للمُستدعي — أي بينَ الدوامِ التامِ
// والإقرارِ المرئيِّ للفاعلِ. فالعلامةُ غيرُ المُزمِّنةِ (`dmsetup message … mark`) تُوضَعُ
// هناكَ حصراً: قطعٌ بعدَ الدوامِ وقبلَ الإقرارِ — لا قطعٌ بعدَ إقرارٍ يتقدّمُهُ دوامٌ مجهول.
//
// الوسيط: مسارُ ملفِّ JSON + اسمُ العمليةِ. الملفُّ يُولّدُهُ `scripts/live-39-power-loss.sh`
// ويحملُ المفاتيحَ (‏عونُ `WL-326`) ومواضعَ الجذورِ وأسماءَ الأوامرِ والعلاماتِ.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { FileStateBoundSocket, bootRoot } from './wl-326-root.mjs';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const op = config.ops[process.argv[3]];

/**
 * علامةٌ غيرُ مُزمِّنةٍ في سجلِّ الجهازِ — تُوضَعُ داخلَ الحاجزِ عندَ مرحلةِ `ACK`.
 * فشلُها فشلٌ للقياسِ لا شيءٌ يُتَسامَحُ معهُ.
 */
function markNow() {
  const result = spawnSync('sudo', ['dmsetup', 'message', op.dm, '0', 'mark', op.mark], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`MARK_FAILED: ${result.stderr}`);
  }
}

const socket = new FileStateBoundSocket(op.socketFile);
const runtime = await bootRoot(op.root, config.keys, socket, { fsync: op.fsync });

if (op.mode === 'provision') {
  process.stdout.write('BOOTED\n');
  await runtime.close();
  process.exit(0);
}

if (op.mode === 'transact') {
  runtime.commitBarrier.onStage = (stage) => {
    // موضعُ القطعِ: بعدَ الدوامِ (‏S2–S5 اكتملت) وقبلَ عودةِ المعاملةِ للمُستدعي.
    if (stage === 'ACK') markNow();
  };
  const command = { id: op.id };
  await runtime.ledger.transactAsync('crown.command', async () => {
    runtime.ledger.begin(command);
    await runtime.ledger.commitSigned(command);
  });
  process.stdout.write('ACK\n');
  await runtime.close();
  process.exit(0);
}

if (op.mode === 'verify') {
  // الإقلاعُ نفسُهُ حكمٌ: رفضُ `STATE_MANIFEST_ROLLBACK_DETECTED` أو
  // `LEDGER_AHEAD_OF_WITNESS` سقوطٌ مقيسٌ لا نجاحٌ صامتٌ.
  process.stdout.write('BOOT_OK\n');
  const state = runtime.ledger.state(op.id);
  process.stdout.write(`STATE:${state}\n`);
  await runtime.close();
  process.exit(0);
}

throw new Error(`UNKNOWN_MODE: ${op.mode}`);
