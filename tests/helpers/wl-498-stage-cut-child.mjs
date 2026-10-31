// @ts-nocheck
// tests/helpers/wl-498-stage-cut-child.mjs
//
// `WL-498` (‏`LIVE-39`) — عمليّةٌ فرعيّةٌ لقطعِ الطاقةِ عندَ **كلِّ** مرحلةٍ من مراحلِ حاجزِ
// الالتزامِ (‏S2 · S3 · S4 · S5 · ACK) لا عندَ `ACK` وحدَها كما في `WL-360`، ولحقنِ أخطاءِ
// الكتابةِ (‏`dm-flakey` بـ`error_writes`) داخلَ المعاملةِ.
//
// لا مسَّ بشفرةِ الإنتاجِ: الجذرُ الإنتاجيُّ الحقيقيُّ عبرَ عونِ `WL-326` (‏مرجعُ حداثةٍ
// `testFixture` على ملفٍّ خارجَ القرصِ المُختبرِ — يرفضُهُ المدخلُ الإنتاجيّ).
//
// **العلامةُ ولقطةُ المرجعِ معاً:** عندَ كلِّ مرحلةٍ تُوضَعُ علامةٌ غيرُ مُزمِّنةٍ في سجلِّ
// `dm-log-writes` (‏`<prefix>-<stage>`) وتُنسَخُ حالُ المرجعِ الخارجيِّ في اللحظةِ نفسِها
// (‏`<snapshots>/<stage>.json`). فإعادةُ التشغيلِ حتّى العلامةِ مع لقطتِها = حالُ الجهازِ
// كلِّهِ (‏القرصُ والمرجعُ) لو انقطعتِ الطاقةُ هناك. والمرجعُ يتقدّمُ بينَ S3 وS4 (‏`#advance`)
// بلا كتابةٍ على القرصِ بينهما — فصورةُ S3 تُقاسُ مع لقطةِ S3 (‏قبلَ التقدّمِ) **ومع** لقطةِ
// S4 (‏بعدَه): كلا الحالَين ممكنٌ فيزيائيّاً.
//
// الحكمُ في `verify` لا يُقرَّرُ هنا: الرفضُ المسمّى يُطبَعُ `BOOT_REFUSED:<code>` والسكربتُ
// يحكمُ عليه (‏`scripts/live-39-stage-cuts.sh`).
import { appendFileSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { FileStateBoundSocket, bootRoot } from './wl-326-root.mjs';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const op = config.ops[process.argv[3]];

/**
 * أمرُ `sudo` يجبُ أن ينجحَ — فشلُهُ فشلٌ للقياسِ لا شيءٌ يُتَسامَحُ معهُ.
 * @param {string[]} args
 */
function mustSudo(args) {
  const result = spawnSync('sudo', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`HARNESS_COMMAND_FAILED: ${args.join(' ')}: ${result.stderr}`);
  }
}

/**
 * يقلبُ جهازَ `dm-flakey` إلى رفضِ كلِّ كتابةٍ (‏`EIO`) والقراءةُ سليمةٌ.
 * @param {{name: string, dev: string, sectors: string}} flakey
 */
function failWrites(flakey) {
  mustSudo(['dmsetup', 'suspend', flakey.name]);
  mustSudo([
    'dmsetup',
    'load',
    flakey.name,
    '--table',
    `0 ${flakey.sectors} flakey ${flakey.dev} 0 0 180 1 error_writes`,
  ]);
  mustSudo(['dmsetup', 'resume', flakey.name]);
}

/** @param {unknown} error */
const codeOf = (error) =>
  (error && typeof error === 'object' && (error.code || error.name)) || 'UNNAMED';

// `WL-505` (‏`LIVE-39` ع١): سيناريو علاماتِ مزامنةِ المجلّدِ يطلبُ نوافذَ المراحلِ في سجلِّ الحائلِ
// (‏`STAGE|<s>`) ليُنسَبَ كلُّ `dirsync-<n>` إلى موضعِه. غيابُ `dirsyncLog` ⇐ لا أثرَ لهذا إطلاقاً.
const stageLine = op.dirsyncLog
  ? (/** @type {string} */ stage) => appendFileSync(op.dirsyncLog, `STAGE|${stage}\n`)
  : () => {};

if (op.mode === 'transact-staged') {
  const socket = new FileStateBoundSocket(op.socketFile);
  stageLine('BOOT');
  const runtime = await bootRoot(op.root, config.keys, socket, { fsync: op.fsync });
  stageLine('TXN');
  runtime.commitBarrier.onStage = (stage) => {
    stageLine(stage);
    if (op.prefix) {
      mustSudo(['dmsetup', 'message', op.dm, '0', 'mark', `${op.prefix}-${stage}`]);
      if (existsSync(op.socketFile)) {
        copyFileSync(op.socketFile, join(op.snapshots, `${stage}.json`));
      }
    }
    if (op.failWritesAt === stage) failWrites(op.flakey);
  };
  const command = { id: op.id };
  try {
    await runtime.ledger.transactAsync('crown.command', async () => {
      runtime.ledger.begin(command);
      await runtime.ledger.commitSigned(command);
    });
    process.stdout.write('ACK\n');
  } catch (error) {
    // لا إقرارَ: الرمزُ يُطبَعُ ليُقاسَ (‏`NO_ACK` مع خطأِ كتابةٍ هو الضمانُ المطلوبُ).
    process.stdout.write(`NO_ACK:${codeOf(error)}\n`);
  }
  try {
    await runtime.close();
  } catch {
    // الإغلاقُ بعدَ فشلِ الكتابةِ قد يفشلُ هو الآخرُ؛ الحكمُ على السطرِ أعلاه.
  }
  process.exit(0);
}

if (op.mode === 'verify') {
  const socket = new FileStateBoundSocket(op.socketFile);
  let runtime;
  try {
    runtime = await bootRoot(op.root, config.keys, socket, { fsync: true });
  } catch (error) {
    process.stdout.write(`BOOT_REFUSED:${codeOf(error)}\n`);
    process.exit(0);
  }
  process.stdout.write('BOOT_OK\n');
  for (const id of op.ids) {
    process.stdout.write(`STATE:${id}=${runtime.ledger.state(id)}\n`);
  }
  await runtime.close();
  process.exit(0);
}

throw new Error(`UNKNOWN_MODE: ${op.mode}`);
