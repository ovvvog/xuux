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
 *
 * صارت غير متزامنة مع تحويل `submit` إلى اللاتزامن (`M5.01`)، **وهذا يهمّ هذا
 * المساعد بعينه**: لو لم تُنتظر لكانت العقدة تُسجّل «نُفِّذ» قبل أن يعمل المُعالِج،
 * فيصير دليل «صفر تنفيذ بعد الإيقاف» دليلاً على إقلاعٍ لا على تنفيذ.
 * @returns {Promise<void>}
 */
async function attempt() {
  /** @type {number} */
  let epochBefore;
  try {
    epochBefore = halt.read().epoch;
  } catch {
    // قراءةُ التوجيهِ من القرصِ قد تُصادف لحظةَ كتابةِ الأمِّ له. وهذا ليس عبثاً
    // ولا خطأَ تنفيذٍ، فلا يُسجَّل واقعةً؛ والدورةُ التالية تقرأ الملفَّ تامّاً.
    return;
  }
  const command = createRoyalCommand('worker.tick', nodeId, { seq });
  try {
    await kernel.submit(command, localKing.sign(command), () => 'ok');
    record('exec', epochBefore);
  } catch (error) {
    if (error instanceof Error && error.message === 'SOVEREIGN_HALT') {
      acknowledge();
      return;
    }
    record('error', epochBefore);
  }
}

/**
 * إقرارٌ بالتوقفِ لعهدِ الإيقافِ **القائمِ وقتَ القراءة** لا لعهدٍ انقضى.
 *
 * السببُ الجذريُّ الذي أسقط هذا المساعدَ في التشغيلةِ 165: النواةُ ترفع
 * `SOVEREIGN_HALT` ثم تُقرأ الحالةُ من جديدٍ، **وبين اللحظتين قد تكون الأمُّ قد
 * استأنفت**، فيصير الإقرارُ إقراراً بتوقفٍ لم يعد قائماً فترفعه `HaltSwitch`
 * بـ`HALT_NOT_HALTED`، ويخرج الخطأُ من دورةٍ لا تُمسِكه **فتموت العمليةُ**
 * فلا تعود العقدةُ إلى العملِ في العهدِ الجديدِ أبداً. فالشرطُ أن تُقرأ الحالةُ
 * ولا يُقَرَّ إلا وهي `halted`، وأن يُبتلَع سباقُ اللحظةِ الأخيرةِ إن وقع.
 *
 * **ولا يُضعِف هذا ما يُثبته المعيار:** الأمُّ لا تستأنف إلا بعد أن تعدَّ إقراراتِ
 * العقدِ الثلاثِ كلِّها، فكلُّ إقرارٍ لازمٍ يقع والإيقافُ قائمٌ؛ وما يُبتلَع هنا
 * إقرارٌ لا محلَّ له بعد انقضاءِ عهدِه. ولا تُسجَّل واقعةُ تنفيذٍ في الحالين.
 * @returns {void}
 */
function acknowledge() {
  const reading = halt.read();
  if (reading.state !== 'halted' || ackedEpochs.has(reading.epoch)) return;
  try {
    halt.confirmHalt(nodeId, `توقفت عند الفعل ${seq + 1}`);
  } catch (error) {
    if (/** @type {{ code?: string }} */ (error)?.code === 'HALT_NOT_HALTED') return;
    throw error;
  }
  ackedEpochs.add(reading.epoch);
  record('ack', reading.epoch);
}

/**
 * دورة العقدة: تحاول فعلاً كل فترة قصيرة حتى يطلب منها التوقف. التتالي
 * بـ`setTimeout` **بعد** انتهاء المحاولة لا بموقّت دوري، كي لا تتداخل محاولتان
 * إن طالت واحدة.
 * @returns {Promise<void>}
 */
async function loop() {
  if (existsSync(stopFile)) return;
  try {
    await attempt();
  } catch (error) {
    // حارسٌ أخيرٌ: عطبٌ غيرُ متوقَّعٍ يُسجَّل واقعةَ خطأٍ تراها الأمُّ فتُخفِق به
    // صراحةً، **ولا يُسقِط العمليةَ صامتاً** فيصير العطبُ «مهلةً انتهت» لا سبباً
    // مقروءاً. والاختبارُ يشترط ألّا تقع واقعةُ خطأٍ واحدة.
    process.stderr.write(`HALT_WORKER_UNEXPECTED ${String(error)}\n`);
    try {
      record('error', -1);
    } catch {
      /* لا يُخفى العطبُ الأولُ بعطبِ تسجيلِه */
    }
  }
  setTimeout(() => void loop(), 12);
}

void loop();
