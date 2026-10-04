// @ts-nocheck
// tests/helpers/wl-326-crash-child.mjs
//
// `WL-326` — عمليّةٌ فرعيّةٌ تُقلِعُ الجذرَ الإنتاجيَّ الحقيقيَّ وتُنفِّذُ معاملةً واحدةً ثمَّ
// تُقتَلُ بـ`SIGKILL` في نقطةٍ بعينِها من `C0`…`C12` (‏§8.1 من تصميمِ الخيار ب). لا مسَّ بشفرةِ
// الإنتاج: النقاطُ خطّافُ `onStage` في الحاجز، وأعطالُ المرجعِ المحقونة، ولفُّ `renameSync`.
//
// الوسيط: مسارُ ملفِّ JSON: { root, keys, socketFile, op, id, kill }
//   kill.stage    'S2' | 'S3' | 'S4' | 'S5' | 'ACK' | 'AFTER_ACK' | 'BEFORE_TXN'
//   kill.inFn     قتلٌ داخلَ المعاملةِ بعدَ الكتابةِ الأولى (‏كتابةٌ ممزّقة C3)
//   kill.socket   عطلٌ يُحقَنُ في المرجع (‏'kill-before-apply' | 'kill-after-apply')
//   kill.renameAfterStage + kill.renameMatch  قتلٌ بعدَ إعادةِ تسميةٍ تطابقُ النصَّ بعدَ المرحلة
//   kill.armAtStart + kill.renameMatch        قتلٌ بعدَ أوّلِ إعادةِ تسميةٍ مطابقةٍ في المعاملة (‏C1)
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const kill = config.kill ?? {};
let armedRename = false;
const die = () => process.kill(process.pid, 'SIGKILL');

if (kill.renameMatch) {
  const original = fs.renameSync;
  fs.renameSync = function (from, to) {
    const out = original.call(fs, from, to);
    if (armedRename && String(to).includes(kill.renameMatch)) die();
    return out;
  };
  syncBuiltinESMExports();
}

const { FileStateBoundSocket, bootRoot } = await import('./wl-326-root.mjs');
const socket = new FileStateBoundSocket(config.socketFile);
if (kill.socket && config.op === 'provision') socket.faults.push(kill.socket);
const runtime = await bootRoot(config.root, config.keys, socket);
if (config.op === 'provision') {
  process.stdout.write('BOOTED\n');
  await runtime.close();
  process.exit(0);
}
if (kill.socket) socket.faults.push(kill.socket);
runtime.commitBarrier.onStage = (stage) => {
  if (kill.renameAfterStage === stage) armedRename = true;
  if (kill.stage === stage) die();
};
if (kill.stage === 'BEFORE_TXN') die();
// C1: أوّلُ إعادةِ تسميةٍ للبيانِ بعدَ هذه النقطةِ هي ختمُ S2 نفسُه.
if (kill.armAtStart) armedRename = true;
const command = { id: config.id };
await runtime.ledger.transactAsync('crown.command', async () => {
  runtime.ledger.begin(command);
  if (kill.inFn) die();
  await runtime.ledger.commitSigned(command);
});
process.stdout.write('ACK\n');
if (kill.stage === 'AFTER_ACK') die();
await runtime.close();
process.exit(0);
