// اختبارات الإيقاف الشامل القابل للتحقق (M2.08).
//
// أثقل ما فيها هو الأخير: عدة **عمليات** حقيقية تُنفّذ في حلقة، ثم إيقاف واحد،
// ثم إثبات صفر تنفيذ بعده من سجلات العمليات نفسها، ثم استئناف سليم. وما قبله
// يثبت الفشل المغلق: كل عبثٍ بالتوجيه يُقرأ «موقوفاً» لا «يعمل».

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CertificateAuthority,
  CrownGateway,
  EventLog,
  GENESIS_DIRECTIVE_HASH,
  HALT_EPOCH_SUFFIX,
  HALT_HISTORY_SUFFIX,
  HaltError,
  HaltSwitch,
  KingIdentity,
  createRoyalCommand,
  hashHaltBody,
  royalVerifierFromPublicKey,
} from '../../src/root-of-trust/index.mjs';
import { ExecutionKernel } from '../../src/core/execution-kernel.mjs';

const WORKER = new URL('../helpers/halt-worker.mjs', import.meta.url).pathname;

/**
 * يهيئ مجلداً مؤقتاً وملكاً ومفتاح إيقاف عليه.
 * @returns {{ dir: string, file: string, king: KingIdentity, halt: HaltSwitch }} بيئة الاختبار
 */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'halt-switch-'));
  const file = join(dir, 'state', 'halt.json');
  const king = new KingIdentity();
  return { dir, file, king, halt: new HaltSwitch(file, king, { fsync: false }) };
}

/**
 * يمسك خطأ نداء ويُرجعه، لأن `assert.throws` لا تُرجع الخطأ فلا يُفحص رمزه.
 * @param {() => unknown} fn - النداء المتوقع فشله
 * @returns {unknown} الخطأ الملقى
 */
function capture(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

/**
 * يكتب توجيهاً مصنوعاً يدوياً في موضع التوجيه الحالي.
 * @param {string} file - مسار التوجيه
 * @param {object} directive - التوجيه المصنوع
 * @returns {void}
 */
function writeDirective(file, directive) {
  writeFileSync(file, JSON.stringify(directive) + '\n');
}

/**
 * يبني مادة توجيه من توجيه قائم مع تبديل حقول — بلا `delete` على حقول إلزامية.
 * @param {import('../../src/root-of-trust/halt-switch.mjs').HaltDirective} directive - الأصل
 * @param {Partial<import('../../src/root-of-trust/halt-switch.mjs').HaltDirectiveBody>} changes - ما يُبدَّل
 * @returns {import('../../src/root-of-trust/halt-switch.mjs').HaltDirectiveBody} المادة المصنوعة
 */
function bodyFrom(directive, changes) {
  return {
    version: 1,
    epoch: changes.epoch ?? directive.epoch,
    state: changes.state ?? directive.state,
    reason: changes.reason ?? directive.reason,
    at: changes.at ?? directive.at,
    kingId: changes.kingId ?? directive.kingId,
    keyVersion: changes.keyVersion ?? directive.keyVersion,
    previousDirectiveHash: changes.previousDirectiveHash ?? directive.previousDirectiveHash,
  };
}

/**
 * رقم عملية ميتة مؤكدة: عملية شُغّلت وانتهت.
 * @returns {number} رقم العملية الميتة
 */
function deadPid() {
  const done = spawnSync(process.execPath, ['-e', '0']);
  return done.pid ?? 999999;
}

/**
 * ينتظر حتى يصدق شرط، أو يفشل بمهلة.
 * @param {() => boolean} condition - الشرط
 * @param {string} what - وصف ما كان يُنتظر
 * @param {number} timeoutMs - المهلة
 * @returns {Promise<void>} انتهاء الانتظار
 */
async function until(condition, what, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`انتهت المهلة بانتظار: ${what}`);
}

test('دولة لم تُوقف يوماً تعمل، وغياب التوجيه ليس عبثاً', (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const reading = halt.read();
  assert.equal(reading.state, 'running');
  assert.equal(reading.epoch, 0);
  assert.equal(reading.problem, undefined);
  assert.equal(halt.isHalted(), false);
  assert.doesNotThrow(() => halt.assertOperational());
});

test('الإيقاف يُصدر توجيهاً موقَّعاً في العهد الأول مربوطاً بالنشأة', (t) => {
  const { dir, halt, king } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const directive = halt.halt('صيانة سيادية');
  assert.equal(directive.epoch, 1);
  assert.equal(directive.state, 'halted');
  assert.equal(directive.reason, 'صيانة سيادية');
  assert.equal(directive.kingId, king.id);
  assert.equal(directive.keyVersion, 1);
  assert.equal(directive.previousDirectiveHash, GENESIS_DIRECTIVE_HASH);
  assert.equal(directive.hash, hashHaltBody(directive));
  assert.equal(halt.isHalted(), true);
});

test('الإيقاف يرفع SOVEREIGN_HALT ومعه السبب والعهد', (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.halt('سببٌ معلَن');
  const error = capture(() => halt.assertOperational());
  assert.ok(error instanceof HaltError);
  assert.equal(error.code, 'SOVEREIGN_HALT');
  assert.equal(error.message, 'SOVEREIGN_HALT');
  assert.equal(error.reason, 'سببٌ معلَن');
  assert.equal(error.epoch, 1);
});

test('إيقاف على إيقاف يُرفض، ولا يُهدر عهداً', (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.halt();
  const error = capture(() => halt.halt());
  assert.equal(error instanceof HaltError ? error.code : null, 'HALT_ALREADY_HALTED');
  assert.equal(halt.read().epoch, 1);
});

test('الاستئناف بلا عقد مسجَّلة يفتح الدولة في عهدٍ جديد', (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.halt();
  const directive = halt.resume('انتهت الصيانة');
  assert.equal(directive.epoch, 2);
  assert.equal(directive.state, 'running');
  assert.equal(halt.isHalted(), false);
  assert.doesNotThrow(() => halt.assertOperational());
});

test('استئناف دولة تعمل يُرفض', (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const error = capture(() => halt.resume());
  assert.equal(error instanceof HaltError ? error.code : null, 'HALT_NOT_HALTED');
});

test('عقدة حيّة لم تُقرّ تمنع الاستئناف، والإقرار يفتحه', (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.registerNode('node-alive', process.pid);
  halt.halt('إيقاف متحقَّق منه');
  const rejected = capture(() => halt.resume());
  assert.equal(rejected instanceof HaltError ? rejected.code : null, 'HALT_NOT_CONFIRMED');
  assert.deepEqual(rejected instanceof HaltError ? rejected.pending : null, ['node-alive']);
  const confirmation = halt.confirmHalt('node-alive', 'رفضت فعلين');
  assert.equal(confirmation.epoch, 1);
  assert.equal(confirmation.detail, 'رفضت فعلين');
  assert.deepEqual(
    halt.confirmations(1).map((record) => record.nodeId),
    ['node-alive'],
  );
  assert.equal(halt.isFullyConfirmed(), true);
  assert.equal(halt.resume().epoch, 2);
});

test('عقدة ميتة لا تمنع الاستئناف — موتها إقرار بأنها لا تُنفّذ', (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.registerNode('node-dead', deadPid());
  halt.halt();
  const pending = halt.pendingConfirmations();
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.alive, false);
  assert.equal(halt.isFullyConfirmed(), true);
  assert.equal(halt.resume().state, 'running');
});

test('الإقرار ثابت: نداء ثانٍ لا يُبدّل وقت التوقف الأول', (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.registerNode('node-1', process.pid);
  halt.halt();
  const first = halt.confirmHalt('node-1');
  const second = halt.confirmHalt('node-1');
  assert.deepEqual(second, first);
  assert.equal(halt.confirmations(1).length, 1);
});

test('إقرار عقدة غير مسجَّلة يُرفض، وإقرار في دولة تعمل يُرفض', (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.halt();
  const unknown = capture(() => halt.confirmHalt('ghost'));
  assert.equal(unknown instanceof HaltError ? unknown.code : null, 'UNKNOWN_HALT_NODE');
  halt.resume();
  halt.registerNode('node-1', process.pid);
  const notHalted = capture(() => halt.confirmHalt('node-1'));
  assert.equal(notHalted instanceof HaltError ? notHalted.code : null, 'HALT_NOT_HALTED');
});

test('معرّف عقدة فارغ يُرفض — عقدة بلا اسم تُسقط التحقق', (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const error = capture(() => halt.registerNode('   '));
  assert.equal(error instanceof HaltError ? error.code : null, 'INVALID_HALT_NODE');
});

test('شطب التسجيل يزيل العقدة من قائمة من يجب أن يُقرّ', (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.registerNode('node-1', process.pid);
  halt.registerNode('node-2', process.pid);
  assert.equal(halt.nodes().length, 2);
  halt.unregisterNode('node-1');
  assert.deepEqual(
    halt.nodes().map((node) => node.nodeId),
    ['node-2'],
  );
});

test('العقدة تحمل المفتاح العام وحده: تقرأ وتُقرّ ولا تُوقف ولا تستأنف', (t) => {
  const { dir, file, halt, king } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pem = king.publicKey.export({ type: 'spki', format: 'pem' });
  const verifier = royalVerifierFromPublicKey(String(pem));
  assert.equal(verifier.id, king.id);
  const nodeSwitch = new HaltSwitch(file, verifier, { fsync: false });
  const cannotHalt = capture(() => nodeSwitch.halt());
  assert.equal(cannotHalt instanceof HaltError ? cannotHalt.code : null, 'HALT_SIGNER_REQUIRED');
  halt.halt('إيقاف من الملك');
  assert.equal(nodeSwitch.isHalted(), true);
  const cannotResume = capture(() => nodeSwitch.resume());
  assert.equal(
    cannotResume instanceof HaltError ? cannotResume.code : null,
    'HALT_SIGNER_REQUIRED',
  );
  nodeSwitch.registerNode('node-public', process.pid);
  assert.equal(nodeSwitch.confirmHalt('node-public').epoch, 1);
});

test('توجيه تالف يُقرأ موقوفاً لا عاملاً', (t) => {
  const { dir, file, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.halt();
  halt.resume();
  writeFileSync(file, 'ليس JSON');
  const reading = halt.read();
  assert.equal(reading.state, 'halted');
  assert.equal(reading.problem, 'CORRUPT_HALT_DIRECTIVE');
  assert.throws(() => halt.assertOperational(), /SOVEREIGN_HALT/);
});

test('حقول ناقصة في التوجيه تُقرأ موقوفاً', (t) => {
  const { dir, file, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.halt();
  writeDirective(file, { version: 1, epoch: 1, state: 'running' });
  assert.equal(halt.read().problem, 'CORRUPT_HALT_DIRECTIVE');
});

test('تبديل الحالة بلا إعادة حساب التجزئة يُكشف', (t) => {
  const { dir, file, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const directive = halt.halt();
  writeDirective(file, { ...directive, state: 'running' });
  const reading = halt.read();
  assert.equal(reading.state, 'halted');
  assert.equal(reading.problem, 'HALT_HASH_MISMATCH');
});

test('تبديل الحالة مع إعادة حساب التجزئة يسقط في التوقيع', (t) => {
  const { dir, file, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const directive = halt.halt();
  const body = bodyFrom(directive, { state: 'running' });
  writeDirective(file, { ...body, hash: hashHaltBody(body), signature: directive.signature });
  assert.equal(halt.read().problem, 'HALT_SIGNATURE_INVALID');
});

test('توقيع ملك آخر لا يُقبل — الإيقاف قرار سيادي لا كتابة على قرص', (t) => {
  const { dir, file, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const directive = halt.halt();
  const impostor = new KingIdentity();
  const body = bodyFrom(directive, { state: 'running' });
  writeDirective(file, { ...body, hash: hashHaltBody(body), signature: impostor.sign(body) });
  assert.equal(halt.read().problem, 'HALT_SIGNATURE_INVALID');
});

test('إصدار مفتاح مزعوم لا يطابق الإصدار الذي قَبِل التوقيع يُرفض', (t) => {
  const { dir, file, halt, king } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const directive = halt.halt();
  const body = bodyFrom(directive, { keyVersion: 7 });
  writeDirective(file, { ...body, hash: hashHaltBody(body), signature: king.sign(body) });
  assert.equal(halt.read().problem, 'HALT_KEY_VERSION_MISMATCH');
});

test('محو التوجيه بعد وجوده محوٌ لزرّ الإيقاف ⇒ موقوف', (t) => {
  const { dir, file, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.halt();
  halt.resume();
  rmSync(file);
  const reading = halt.read();
  assert.equal(reading.state, 'halted');
  assert.equal(reading.problem, 'HALT_DIRECTIVE_MISSING');
});

test('إعادة توجيه «تشغيل» قديم موقَّع تُرفض بتراجع العهد', (t) => {
  const { dir, file, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.halt();
  const running = halt.resume();
  halt.halt('إيقاف ثانٍ');
  writeDirective(file, running);
  const reading = halt.read();
  assert.equal(reading.state, 'halted');
  assert.equal(reading.problem, 'STALE_HALT_DIRECTIVE');
});

test('محو عدّاد العهد لا ينفع: التاريخ يحفظ أعلى ما بُلغ', (t) => {
  const { dir, file, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.halt();
  const running = halt.resume();
  halt.halt('إيقاف ثانٍ');
  rmSync(file + HALT_EPOCH_SUFFIX);
  writeDirective(file, running);
  assert.equal(halt.read().problem, 'STALE_HALT_DIRECTIVE');
});

test('توجيه حالي ليس آخرَ التاريخ يُقرأ موقوفاً', (t) => {
  const { dir, file, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const halted = halt.halt();
  halt.resume();
  writeFileSync(file + HALT_HISTORY_SUFFIX, JSON.stringify(halted) + '\n');
  const reading = halt.read();
  assert.equal(reading.state, 'halted');
  assert.equal(reading.problem, 'HALT_HISTORY_MISMATCH');
});

test('تحقق التاريخ يقبل سلسلة سليمة ويكشف انكسار الرابط', (t) => {
  const { dir, file, halt, king } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.halt();
  halt.resume();
  halt.halt('إيقاف ثانٍ');
  const sound = halt.verifyHistory();
  assert.equal(sound.ok, true);
  assert.equal(sound.directives, 3);
  const lines = halt.history();
  const [first, middle, last] = lines;
  assert.ok(first && middle && last);
  const broken = bodyFrom(middle, { previousDirectiveHash: 'a'.repeat(64) });
  const forged = { ...broken, hash: hashHaltBody(broken), signature: king.sign(broken) };
  writeFileSync(
    file + HALT_HISTORY_SUFFIX,
    [first, forged, last].map((entry) => JSON.stringify(entry)).join('\n') + '\n',
  );
  const result = halt.verifyHistory();
  assert.equal(result.ok, false);
  assert.equal(result.problem, 'HALT_LINK_MISMATCH');
  assert.equal(result.problemAt, 2);
});

test('ذيل تاريخ مقطوع يُتجاوز ولا يُسقط التحقق', (t) => {
  const { dir, file, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.halt();
  appendFileSync(file + HALT_HISTORY_SUFFIX, '{"version":1,"epoch"');
  assert.equal(halt.history().length, 1);
  assert.equal(halt.read().state, 'halted');
});

test('توجيه معطوب: الاستئناف يستعيد الدولة في عهد جديد بلا إقرارات عهدٍ مجهول', (t) => {
  const { dir, file, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.registerNode('node-alive', process.pid);
  halt.halt();
  writeFileSync(file, 'محتوى معطوب');
  assert.equal(halt.read().problem, 'CORRUPT_HALT_DIRECTIVE');
  const recovered = halt.resume('استعادة بعد عطب');
  assert.equal(recovered.state, 'running');
  assert.equal(recovered.epoch, 2);
  assert.equal(halt.isHalted(), false);
});

test('الوقائع تُثبت في سجل الأحداث: إصدار وإقرار واستئناف', (t) => {
  const { dir, file, king } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = new EventLog();
  const halt = new HaltSwitch(file, king, { fsync: false, log });
  halt.registerNode('node-1', process.pid);
  halt.halt('سبب مسجَّل');
  halt.confirmHalt('node-1');
  halt.resume('استئناف مسجَّل');
  const types = log.events.map((event) => event.type);
  assert.deepEqual(types, ['halt.issued', 'halt.confirmed', 'halt.resumed']);
});

test('الخلاصة تعرض الحالة والعقد والإقرارات والمعلَّقات', (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.registerNode('node-1', process.pid);
  halt.registerNode('node-2', process.pid);
  halt.halt('للخلاصة');
  halt.confirmHalt('node-1');
  const description = halt.describe();
  assert.equal(description.state, 'halted');
  assert.equal(description.epoch, 1);
  assert.equal(description.reason, 'للخلاصة');
  assert.deepEqual(description.confirmed, ['node-1']);
  assert.deepEqual(
    description.pending.map((node) => node.nodeId),
    ['node-2'],
  );
  assert.equal(description.fullyConfirmed, false);
  assert.equal(description.nodes.length, 2);
});

test('كائن آخر على نفس الملف يرى الإيقاف فوراً — القراءة من القرص لا الذاكرة', (t) => {
  const { dir, file, halt, king } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const other = new HaltSwitch(file, king, { fsync: false });
  assert.equal(other.isHalted(), false);
  halt.halt();
  assert.equal(other.isHalted(), true);
  halt.resume();
  assert.equal(other.isHalted(), false);
});

test('بوابة التاج ترفض الأمر عند الإيقاف ولا تستهلك معرّفه', (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const king = new KingIdentity();
  const crown = new CrownGateway(king, new CertificateAuthority(king), new EventLog(), {
    haltSwitch: halt,
  });
  const command = createRoyalCommand('act', 'target', {});
  const signature = king.sign(command);
  halt.halt('إيقاف قبل الأمر');
  const rejected = capture(() => crown.command(command, signature));
  assert.equal(rejected instanceof HaltError ? rejected.code : null, 'SOVEREIGN_HALT');
  assert.throws(() => crown.heartbeat(), /SOVEREIGN_HALT/);
  halt.resume();
  // نفس الأمر يُقبل بعد الاستئناف: أي أن الرفض وقع **قبل** منع الإعادة.
  assert.equal(crown.command(command, signature).id, command.id);
});

test('نواة التنفيذ لا تُشغّل المُعالِج عند الإيقاف', (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const king = new KingIdentity();
  const crown = new CrownGateway(king, new CertificateAuthority(king), new EventLog(), {
    haltSwitch: halt,
  });
  const kernel = new ExecutionKernel({ crown, log: new EventLog(), haltSwitch: halt });
  let runs = 0;
  const first = createRoyalCommand('act', 'target', {});
  kernel.submit(first, king.sign(first), () => {
    runs += 1;
  });
  assert.equal(runs, 1);
  halt.halt('إيقاف أثناء التشغيل');
  const second = createRoyalCommand('act', 'target', {});
  const rejected = capture(() =>
    kernel.submit(second, king.sign(second), () => {
      runs += 1;
    }),
  );
  assert.equal(rejected instanceof HaltError ? rejected.code : null, 'SOVEREIGN_HALT');
  assert.equal(runs, 1);
  halt.resume();
  kernel.submit(second, king.sign(second), () => {
    runs += 1;
  });
  assert.equal(runs, 2);
});

test(
  'المعيار: عدة عمليات، إيقاف واحد، صفر تنفيذ بعده، ثم استئناف سليم',
  { timeout: 90000 },
  async (t) => {
    const { dir, file, king, halt } = setup();
    const stopFile = join(dir, 'stop');
    const pemPath = join(dir, 'king.pub.pem');
    writeFileSync(pemPath, String(king.publicKey.export({ type: 'spki', format: 'pem' })));

    const nodeIds = ['node-a', 'node-b', 'node-c'];
    const outFiles = new Map(nodeIds.map((id) => [id, join(dir, `${id}.jsonl`)]));
    for (const path of outFiles.values()) writeFileSync(path, '');

    const children = nodeIds.map((id) =>
      spawn(
        process.execPath,
        [
          WORKER,
          '--file',
          file,
          '--pubkey',
          pemPath,
          '--node',
          id,
          '--out',
          String(outFiles.get(id)),
          '--stop',
          stopFile,
        ],
        { stdio: ['ignore', 'ignore', 'inherit'] },
      ),
    );

    t.after(async () => {
      writeFileSync(stopFile, '');
      for (const child of children) child.kill('SIGKILL');
      rmSync(dir, { recursive: true, force: true });
    });

    /**
     * يقرأ سجلات عقدة.
     * @param {string} nodeId - العقدة
     * @returns {{ type: string, epoch: number, seq: number }[]} وقائعها
     */
    const records = (nodeId) =>
      readFileSync(String(outFiles.get(nodeId)), 'utf8')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));

    /**
     * كل الوقائع من كل العقد.
     * @returns {{ node: string, type: string, epoch: number, seq: number }[]} الوقائع
     */
    const allRecords = () =>
      nodeIds.flatMap((id) => records(id).map((entry) => ({ ...entry, node: id })));

    // 1) العمليات الثلاث تعمل فعلاً قبل الإيقاف.
    await until(() => halt.nodes().length === 3, 'تسجيل العقد الثلاث');
    await until(
      () => nodeIds.every((id) => records(id).some((entry) => entry.type === 'exec')),
      'تنفيذ فعلي من كل عقدة قبل الإيقاف',
    );
    assert.ok(allRecords().filter((entry) => entry.type === 'exec').length >= 3);

    // 2) إيقاف واحد من الملك.
    const directive = halt.halt('إيقاف المعيار');
    assert.equal(directive.epoch, 1);

    // 3) كل عقدة تُقرّ بالتوقف — الإيقاف متحقَّق منه لا مظنون.
    await until(() => halt.confirmations(1).length === 3, 'إقرار العقد الثلاث بالتوقف');
    assert.equal(halt.isFullyConfirmed(), true);

    // 4) صفر تنفيذ بعد الإيقاف: لا واقعة تنفيذ في عهد الإيقاف، ولا واقعة تنفيذ
    //    في أي عقدة بعد ترتيب إقرارها، والعدد مُجمَّد ما دام الإيقاف قائماً.
    const frozen = allRecords().filter((entry) => entry.type === 'exec').length;
    await new Promise((resolve) => setTimeout(resolve, 750));
    const after = allRecords();
    assert.equal(
      after.filter((entry) => entry.type === 'exec' && entry.epoch === 1).length,
      0,
      'لا يجوز تنفيذ واحد في عهد الإيقاف',
    );
    assert.equal(
      after.filter((entry) => entry.type === 'exec').length,
      frozen,
      'عدد التنفيذات مُجمَّد أثناء الإيقاف',
    );
    for (const id of nodeIds) {
      const own = records(id);
      const ack = own.find((entry) => entry.type === 'ack');
      assert.ok(ack, `العقدة ${id} لم تُقرّ`);
      const executedAfterAck = own.filter(
        (entry) => entry.type === 'exec' && entry.seq > ack.seq,
      ).length;
      assert.equal(executedAfterAck, 0, `العقدة ${id} نفّذت بعد إقرارها بالتوقف`);
    }

    // 5) استئناف سليم: العهد يزيد، والعقد تعود إلى العمل من تلقائها.
    const resumed = halt.resume('استئناف المعيار');
    assert.equal(resumed.epoch, 2);
    assert.equal(resumed.state, 'running');
    await until(
      () =>
        nodeIds.every((id) =>
          records(id).some((entry) => entry.type === 'exec' && entry.epoch === 2),
        ),
      'عودة التنفيذ في العهد الجديد لكل عقدة',
    );
    assert.equal(halt.verifyHistory().ok, true);
    assert.equal(
      allRecords().some((entry) => entry.type === 'error'),
      false,
      'لا أخطاء غير متوقعة',
    );
  },
);
