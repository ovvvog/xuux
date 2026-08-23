// عقدة تنفيذ حقيقية في **عملية مستقلة**، تُستخدم في إثبات معيار M2.08:
// «تشغيل عدة عمليات، إصدار إيقاف، إثبات صفر تنفيذ بعده، ثم استئناف سليم».
//
// لماذا عملية منفصلة لا كائن آخر في نفس العملية: الإيقاف الذي يُختبر هو الذي
// يعبر حدود العمليات. ولو كانت العقد كائنات في اختبار واحد لكان الإثبات وهماً:
// كلها ستقرأ نفس الذاكرة. فهذه العقدة تحمل **تاجها ونواتها ومفتاح تحققها**
// وحدها، ولا تشترك مع أمّها إلا في ملف التوجيه على القرص.
//
// وهي تحمل **المفتاح العام وحده** — أقل امتياز: تقرأ التوجيه وتُقرّ بالتوقف،
// ولا تستطيع إيقافاً ولا استئنافاً.
//
// المخرَج: ملف JSONL خاص بها (لا تشاركه فتُلغى المزاحمة على الكتابة)، كل سطر:
//   { type: 'exec' | 'ack' | 'error', epoch, seq, at }
// و`seq` عدّاد تصاعدي خاص بالعقدة، وهو ما يسمح للأم أن تُثبت أن العقدة لم
// تُنفّذ فعلاً **بعد** لحظة إقرارها بالتوقف.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import {
  CertificateAuthority,
  EventLog,
  CrownGateway,
  HaltSwitch,
  KingIdentity,
  createRoyalCommand,
  royalVerifierFromPublicKey,
} from '../../src/root-of-trust/index.mjs';
import { ExecutionKernel } from '../../src/core/execution-kernel.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const haltFile = args.get('--file');
const publicKeyPath = args.get('--pubkey');
const nodeId = args.get('--node');
const outFile = args.get('--out');
const stopFile = args.get('--stop');
if (!haltFile || !publicKeyPath || !nodeId || !outFile || !stopFile) {
  process.stderr.write('HALT_WORKER_ARGS_MISSING\n');
  process.exit(2);
}

const verifier = royalVerifierFromPublicKey(readFileSync(publicKeyPath, 'utf8'));
const halt = new HaltSwitch(haltFile, verifier, { fsync: false });
halt.registerNode(nodeId);

// تاجٌ ونواةٌ محليّان لهذه العقدة، موصولان بمفتاح الإيقاف المشترك.
const localKing = new KingIdentity();
const crown = new CrownGateway(localKing, new CertificateAuthority(localKing), new EventLog(), {
  haltSwitch: halt,
});
const kernel = new ExecutionKernel({ crown, log: new EventLog(), haltSwitch: halt });

let seq = 0;
const ackedEpochs = new Set();

/**
 * يُسجّل واقعة في ملف العقدة.
 * @param {string} type - نوع الواقعة
 * @param {number} epoch - العهد الذي رأته العقدة
 * @returns {void}
 */
function record(type, epoch) {
  seq += 1;
  appendFileSync(outFile, JSON.stringify({ type, epoch, seq, at: Date.now() }) + '\n');
}

/**
 * محاولة فعل واحد: أمر ملكي محلي يمرّ بالتاج ثم النواة.
 * @returns {void}
 */
function attempt() {
  const epochBefore = halt.read().epoch;
  const command = createRoyalCommand('worker.tick', nodeId, { seq });
  try {
    kernel.submit(command, localKing.sign(command), () => 'ok');
    record('exec', epochBefore);
  } catch (error) {
    if (error instanceof Error && error.message === 'SOVEREIGN_HALT') {
      const reading = halt.read();
      if (!ackedEpochs.has(reading.epoch)) {
        halt.confirmHalt(nodeId, `توقفت عند الفعل ${seq + 1}`);
        ackedEpochs.add(reading.epoch);
        record('ack', reading.epoch);
      }
      return;
    }
    record('error', epochBefore);
  }
}

/**
 * دورة العقدة: تحاول فعلاً كل فترة قصيرة حتى يطلب منها التوقف. التتالي
 * بـ`setTimeout` لا بموقّت دوري كي لا تتداخل محاولتان إن طالت واحدة.
 * @returns {void}
 */
function loop() {
  if (existsSync(stopFile)) return;
  attempt();
  setTimeout(loop, 12);
}

loop();
