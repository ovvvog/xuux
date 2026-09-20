// اختبارات الإيقاف الشامل القابل للتحقق (M2.08).
//
// أثقل ما فيها هو الأخير: عدة **عمليات** حقيقية تُنفّذ في حلقة، ثم إيقاف واحد،
// ثم إثبات صفر تنفيذ بعده من سجلات العمليات نفسها، ثم استئناف سليم. وما قبله
// يثبت الفشل المغلق: كل عبثٍ بالتوجيه يُقرأ «موقوفاً» لا «يعمل».

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync, createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import {
  CertificateAuthority,
  CrownGateway,
  EventLog,
  GENESIS_DIRECTIVE_HASH,
  HALT_ACKS_SUFFIX,
  HALT_EPOCH_SUFFIX,
  HALT_HISTORY_SUFFIX,
  HaltError,
  HaltSwitch,
  KingIdentity,
  createRoyalCommand,
  haltAckPayload,
  hashHaltBody,
  royalVerifierFromPublicKey,
  signHaltAck,
} from '../../src/root-of-trust/index.mjs';
import { ExecutionKernel } from '../../src/core/execution-kernel.mjs';

const WORKER = new URL('../helpers/halt-worker.mjs', import.meta.url).pathname;

/**
 * يولّد مفتاح عقدة (Ed25519) للاختبارات: خاصّ يُوقّع به، وعامّ يُسجَّل به. وهو
 * ما يُتيح إثبات أن إقرار العقدة لا يُنتحَل (GPT-F05).
 * @returns {{ publicKeyPem: string, privateKeyPem: string, sign: (payload: object) => string }} مفتاح العقدة
 */
function nodeKey() {
  const pair = generateKeyPairSync('ed25519');
  const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
  return {
    publicKeyPem: String(publicKeyPem),
    privateKeyPem: String(privateKeyPem),
    sign: (payload) => signHaltAck(String(privateKeyPem), payload),
  };
}

/**
 * يوقّع إقرار عقدة لمفتاح إيقافٍ وعقدةٍ بعينها — فوق (التجزئة، العهد، المعرّف).
 * @param {ReturnType<typeof nodeKey>} key - مفتاح العقدة
 * @param {import('../../src/root-of-trust/halt-switch.mjs').HaltReading} reading - قراءة التوجيه
 * @param {string} nodeId - العقدة
 * @returns {string} الإثبات بترميز base64url
 */
function ackProofFor(key, reading, nodeId) {
  const directiveHash = reading.directive?.hash ?? '';
  return signHaltAck(key.privateKeyPem, haltAckPayload(directiveHash, reading.epoch, nodeId));
}

/**
 * يهيئ مجلداً مؤقتاً وملكاً ومفتاح إيقاف عليه.
 * @returns {{ dir: string, file: string, king: KingIdentity, halt: HaltSwitch }} بيئة الاختبار
 */
function setup() {
  const dir = registerTmpRoot(mkdtempSync(join(tmpdir(), 'halt-switch-')));
  const file = join(dir, 'state', 'halt.json');
  const king = new KingIdentity();
  return {
    dir,
    file,
    king,
    halt: new HaltSwitch(file, king, { fsync: false, allowUnsignedTestHalt: true }),
  };
}

/**
 * كسابقتها لكن لوعدٍ مرفوض: لزمت مع تحويل `submit` إلى اللاتزامن (`M5.01`).
 * @param {() => Promise<unknown>} fn - النداء المتوقع رفضه
 * @returns {Promise<unknown>} الخطأ الملقى
 */
async function captureAsync(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('لم يُرفض النداء وكان يجب أن يُرفض.');
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
// المهلة ٤٥ ثانية لا ١٥: في M2.09 أُضيفت اختبارات تشغّل خوادم HTTP وتتعمّد
// تعليق طلبات، فصار المعيار متعدد العمليات يُزاحم عليها على معالجَين فتنتهي
// مهلته وهو سليم. والمهلة هنا حرسٌ ضد التعليق الأبدي لا قياسٌ للأداء، فرفعها
// لا يُضعف ما يُثبته الاختبار.
async function until(condition, what, timeoutMs = 45000) {
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
  const key = nodeKey();
  halt.registerNode('node-alive', { pid: process.pid, nodeKey: key });
  halt.halt('إيقاف متحقَّق منه');
  const rejected = capture(() => halt.resume());
  assert.equal(rejected instanceof HaltError ? rejected.code : null, 'HALT_NOT_CONFIRMED');
  assert.deepEqual(rejected instanceof HaltError ? rejected.pending : null, ['node-alive']);
  const confirmation = halt.confirmHalt(
    'node-alive',
    ackProofFor(key, halt.read(), 'node-alive'),
    'رفضت فعلين',
  );
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
  halt.registerNode('node-dead', { pid: deadPid() });
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
  const key = nodeKey();
  halt.registerNode('node-1', { pid: process.pid, nodeKey: key });
  halt.halt();
  const proof = ackProofFor(key, halt.read(), 'node-1');
  const first = halt.confirmHalt('node-1', proof);
  const second = halt.confirmHalt('node-1', proof);
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
  halt.registerNode('node-1', { pid: process.pid });
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
  halt.registerNode('node-1', { pid: process.pid });
  halt.registerNode('node-2', { pid: process.pid });
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
  const nodeSwitch = new HaltSwitch(file, verifier, { fsync: false, allowUnsignedTestHalt: true });
  const cannotHalt = capture(() => nodeSwitch.halt());
  assert.equal(cannotHalt instanceof HaltError ? cannotHalt.code : null, 'HALT_SIGNER_REQUIRED');
  halt.halt('إيقاف من الملك');
  assert.equal(nodeSwitch.isHalted(), true);
  const cannotResume = capture(() => nodeSwitch.resume());
  assert.equal(
    cannotResume instanceof HaltError ? cannotResume.code : null,
    'HALT_SIGNER_REQUIRED',
  );
  const nodeKeyPair = nodeKey();
  nodeSwitch.registerNode('node-public', { pid: process.pid, nodeKey: nodeKeyPair });
  const nodeKeyRecord = nodeSwitch.nodes().find((n) => n.nodeId === 'node-public');
  assert.ok(nodeKeyRecord && nodeKeyRecord.nodeKeyPem, 'سُجّل مفتاح العقدة العام');
  // العقدة تحمل المفتاح العام وحده فلا توقّع بنفسها؛ تُوقّع في الاختبار بمفتاحها.
  const proof = signHaltAck(
    nodeKeyPair.privateKeyPem,
    haltAckPayload(halt.read().directive?.hash ?? '', nodeSwitch.read().epoch, 'node-public'),
  );
  assert.equal(nodeSwitch.confirmHalt('node-public', proof).epoch, 1);
});

// ─── GPT-F05: اختبارات الخصم — منع انتحال العقدة ونسخ الإقرار ───────────────
// شرط الإغلاق الذي طلبه المجلس: «عمليتان حقيقيتان بمفتاحي عقدة مختلفين؛ تحاول A
// تأكيد B، وتحاول إعادة إقرار من epoch سابق، وتبديل directiveHash، ونسخ ملف
// إقرار. يجب أن يبقى B في pending في كل حالة». كلٌّ من هذه يُثبت أن الإقرار
// لا يُقبل إلا من العقدة التي تملك مفتاحها فوق (التجزئة، العهد، المعرّف).

/**
 * يبني مسار ملف إقرار عقدة في عهد — مطابقاً لما يستخدمه HaltSwitch داخلياً.
 * @param {string} file - ملف التوجيه
 * @param {string} nodeId - العقدة
 * @param {number} epoch - العهد
 * @returns {string} مسار ملف الإقرار
 */
function ackPathFor(file, nodeId, epoch) {
  const dir = file + HALT_ACKS_SUFFIX;
  const key = createHash('sha256').update(nodeId).digest('hex').slice(0, 32);
  return join(dir, `${key}-${epoch}.json`);
}

test('GPT-F05: عقدة بلا مفتاح لا يُقبل إقرارها — تبقى معلَّقة', (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.registerNode('node-bare', { pid: process.pid });
  halt.halt('إيقاف بلا مفتاح');
  // بلا مفتاح مسجَّل: لا إثبات يُغني — الفشل مغلق، العقدة تبقى معلَّقة.
  const noProof = capture(() => halt.confirmHalt('node-bare'));
  assert.equal(noProof instanceof HaltError ? noProof.code : null, 'HALT_NODE_KEY_REQUIRED');
  const withBogus = capture(() => halt.confirmHalt('node-bare', 'إثباتٌ مزيف'));
  assert.equal(withBogus instanceof HaltError ? withBogus.code : null, 'HALT_NODE_KEY_REQUIRED');
  assert.equal(halt.isFullyConfirmed(), false);
  assert.deepEqual(
    halt.pendingConfirmations().map((n) => n.nodeId),
    ['node-bare'],
  );
});

test('GPT-F05: عقدة بمفتاح تُرفض إن لم تُقدّم إثباتاً صحيحاً', (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const key = nodeKey();
  halt.registerNode('node-keyed', { pid: process.pid, nodeKey: key });
  halt.halt('إيقاف لاختبار الإثبات');
  const missing = capture(() => halt.confirmHalt('node-keyed'));
  assert.equal(missing instanceof HaltError ? missing.code : null, 'HALT_NODE_PROOF_REQUIRED');
  const bogus = capture(() => halt.confirmHalt('node-keyed', 'إثباتٌ لا يطابق'));
  assert.equal(bogus instanceof HaltError ? bogus.code : null, 'HALT_NODE_PROOF_INVALID');
  assert.deepEqual(
    halt.pendingConfirmations().map((n) => n.nodeId),
    ['node-keyed'],
  );
});

test('GPT-F05: A لا يستطيع أن يُقرّ باسم B — التواقيع لا تتطابق', (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const keyA = nodeKey();
  const keyB = nodeKey();
  halt.registerNode('node-a', { pid: process.pid, nodeKey: keyA });
  halt.registerNode('node-b', { pid: process.pid, nodeKey: keyB });
  halt.halt('إيقاف لمنع الانتحال');
  // A يوقّع إقرار B بمفتاح A لا بمفتاح B — فيجب أن يُرفض.
  const forgedProof = ackProofFor(keyA, halt.read(), 'node-b');
  const forged = capture(() => halt.confirmHalt('node-b', forgedProof));
  assert.equal(forged instanceof HaltError ? forged.code : null, 'HALT_NODE_PROOF_INVALID');
  assert.deepEqual(
    halt.confirmations(1).map((r) => r.nodeId),
    [],
  );
  assert.deepEqual(
    halt.pendingConfirmations().map((n) => n.nodeId),
    ['node-a', 'node-b'],
  );
  // ثم يُقرّ B بمفتاحه فيُقبل — ليثبت أن الرفض كان للانتحال لا لخطأٍ آخر.
  const valid = halt.confirmHalt('node-b', ackProofFor(keyB, halt.read(), 'node-b'));
  assert.equal(valid.nodeId, 'node-b');
  assert.deepEqual(
    halt.confirmations(1).map((r) => r.nodeId),
    ['node-b'],
  );
});

test('GPT-F05: إقرارٌ من عهدٍ منقضٍ لا يُعاد استخدامه في عهدٍ جديد', (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const key = nodeKey();
  halt.registerNode('node-1', { pid: process.pid, nodeKey: key });
  halt.halt('الإيقاف الأول');
  const proofEpoch1 = ackProofFor(key, halt.read(), 'node-1');
  halt.confirmHalt('node-1', proofEpoch1);
  assert.equal(halt.isFullyConfirmed(), true);
  // استئناف ثم إيقاف ثانٍ — عهدٌ جديد وتوجيهٌ جديد بتجزئةٍ مختلفة.
  halt.resume('استئناف');
  halt.halt('الإيقاف الثاني');
  assert.equal(halt.read().epoch, 3);
  // إثبات العهد المنقضى فوق المادة الجديدة لا يطابق — تجزئة التوجيه وعهده مختلفان.
  const stale = capture(() => halt.confirmHalt('node-1', proofEpoch1));
  assert.equal(stale instanceof HaltError ? stale.code : null, 'HALT_NODE_PROOF_INVALID');
  assert.equal(halt.isFullyConfirmed(), false);
  assert.deepEqual(
    halt.pendingConfirmations().map((n) => n.nodeId),
    ['node-1'],
  );
});

test('GPT-F05: تبديل directiveHash في ملف الإقرار يُسقطه — لا يُحسب', (t) => {
  const { dir, file, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const key = nodeKey();
  halt.registerNode('node-1', { pid: process.pid, nodeKey: key });
  halt.halt('إيقاف قبل العبث');
  halt.confirmHalt('node-1', ackProofFor(key, halt.read(), 'node-1'));
  assert.equal(halt.isFullyConfirmed(), true);
  // عبث: تُبدَّل تجزئة التوجيه في ملف الإقرار. التواقيع لم تَعُد تتطابق.
  const path = ackPathFor(file, 'node-1', 1);
  const tampered = JSON.parse(readFileSync(path, 'utf8'));
  tampered.directiveHash = 'تجزئةٌ مزيفة';
  writeFileSync(path, JSON.stringify(tampered) + '\n');
  assert.equal(halt.confirmations(1).length, 0);
  assert.equal(halt.isFullyConfirmed(), false);
  assert.deepEqual(
    halt.pendingConfirmations().map((n) => n.nodeId),
    ['node-1'],
  );
});

test('GPT-F05: نسخ ملف إقرار A إلى مسار B لا يُنسبه إلى B', (t) => {
  const { dir, file, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const keyA = nodeKey();
  const keyB = nodeKey();
  halt.registerNode('node-a', { pid: process.pid, nodeKey: keyA });
  halt.registerNode('node-b', { pid: process.pid, nodeKey: keyB });
  halt.halt('إيقاف لاختبار النسخ');
  // يُقرّ A بمفتاحه فيُقبل.
  halt.confirmHalt('node-a', ackProofFor(keyA, halt.read(), 'node-a'));
  assert.deepEqual(
    halt.confirmations(1).map((r) => r.nodeId),
    ['node-a'],
  );
  // نسخ: يُوضع ملف إقرار A في مسار B. محتواه يُنسب إلى A (معرّفه داخله)،
  // فلا يُنسب الإقرار إلى B — تبقى B معلَّقة لا يُعفيها ملفٌ لا توقيع فيه لها.
  const src = ackPathFor(file, 'node-a', 1);
  const dst = ackPathFor(file, 'node-b', 1);
  copyFileSync(src, dst);
  assert.deepEqual(
    halt.confirmations(1).map((r) => r.nodeId),
    ['node-a', 'node-a'],
    'الملف المنسوخ يُنسب إلى صاحب التوقيع لا إلى المسار',
  );
  assert.deepEqual(
    halt.pendingConfirmations().map((n) => n.nodeId),
    ['node-b'],
    'B تبقى معلَّقة رغم الملف المنسوخ',
  );
  // ولا يُقبل إقرار B لاحقاً إلا بمفتاح B — لا بالملف المنسوخ.
  const valid = halt.confirmHalt('node-b', ackProofFor(keyB, halt.read(), 'node-b'));
  assert.equal(valid.nodeId, 'node-b');
  assert.equal(halt.isFullyConfirmed(), true);
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
  halt.registerNode('node-alive', { pid: process.pid, nodeKey: nodeKey() });
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
  const halt = new HaltSwitch(file, king, { fsync: false, allowUnsignedTestHalt: true, log });
  const key = nodeKey();
  halt.registerNode('node-1', { pid: process.pid, nodeKey: key });
  halt.halt('سبب مسجَّل');
  halt.confirmHalt('node-1', ackProofFor(key, halt.read(), 'node-1'));
  halt.resume('استئناف مسجَّل');
  const types = log.events.map((event) => event.type);
  assert.deepEqual(types, ['halt.issued', 'halt.confirmed', 'halt.resumed']);
});

test('الخلاصة تعرض الحالة والعقد والإقرارات والمعلَّقات', (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const key = nodeKey();
  halt.registerNode('node-1', { pid: process.pid, nodeKey: key });
  halt.registerNode('node-2', { pid: process.pid, nodeKey: nodeKey() });
  halt.halt('للخلاصة');
  halt.confirmHalt('node-1', ackProofFor(key, halt.read(), 'node-1'));
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
  const other = new HaltSwitch(file, king, { fsync: false, allowUnsignedTestHalt: true });
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

test('نواة التنفيذ لا تُشغّل المُعالِج عند الإيقاف', async (t) => {
  const { dir, halt } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const king = new KingIdentity();
  const crown = new CrownGateway(king, new CertificateAuthority(king), new EventLog(), {
    haltSwitch: halt,
  });
  const kernel = new ExecutionKernel({ crown, log: new EventLog(), haltSwitch: halt });
  let runs = 0;
  const first = createRoyalCommand('act', 'target', {});
  await kernel.submit(first, king.sign(first), () => {
    runs += 1;
  });
  assert.equal(runs, 1);
  halt.halt('إيقاف أثناء التشغيل');
  const second = createRoyalCommand('act', 'target', {});
  // صار `submit` غير متزامن (`M5.01`)، فالرفض يأتي وعداً مرفوضاً لا رميةً
  // متزامنة؛ والفحص هنا على **رمز** الخطأ لا على رسالته.
  const rejected = await captureAsync(() =>
    kernel.submit(second, king.sign(second), () => {
      runs += 1;
    }),
  );
  assert.equal(rejected instanceof HaltError ? rejected.code : null, 'SOVEREIGN_HALT');
  assert.equal(runs, 1);
  halt.resume();
  await kernel.submit(second, king.sign(second), () => {
    runs += 1;
  });
  assert.equal(runs, 2);
});

// السببُ الجذريُّ لإخفاقِ التشغيلةِ 165 على `main`: العقدةُ تُمسِك `SOVEREIGN_HALT`
// ثم تقرأ الحالةَ لتُقِرَّ بالتوقف، **وبين اللحظتين قد تكون الأمُّ استأنفت**، فيُرفَع
// `HALT_NOT_HALTED` من دورةٍ لا تُمسِكه فتموت العمليةُ ولا تعود إلى العملِ أبداً،
// فيُقرأ العطبُ «مهلةً انتهت» لا سبباً. وهذا الاختبارُ يقصد ذلك السباقَ بعينِه:
// استئنافٌ عاجلٌ لا ينتظر إقراراً، ثم يُشترط أن **تعود العقدُ الثلاثُ كلُّها** إلى
// التنفيذِ في العهدِ الجديد — وهو ما كان يستحيل قبل الإصلاحِ إن ماتت واحدة.
test(
  'استئنافٌ عاجلٌ بُعيدَ الإيقافِ لا يقتل عقدةً، والثلاثُ تعود إلى العمل',
  { timeout: 90000 },
  async (t) => {
    const { dir, file, king, halt } = setup();
    const stopFile = join(dir, 'stop');
    const pemPath = join(dir, 'king.pub.pem');
    writeFileSync(pemPath, String(king.publicKey.export({ type: 'spki', format: 'pem' })));

    const nodeIds = ['race-a', 'race-b', 'race-c'];
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

    await until(() => halt.nodes().length === 3, 'تسجيل العقد الثلاث');
    await until(
      () => nodeIds.every((id) => records(id).some((entry) => entry.type === 'exec')),
      'تنفيذ فعلي من كل عقدة قبل الإيقاف',
    );

    // إيقافٌ، ثم استئنافٌ **في اللحظةِ التي يكتمل فيها آخرُ إقرارٍ** بلا مهلةِ
    // تهدئةٍ بعده: وهذه هي نافذةُ السباقِ بعينِها، إذ قد تكون عقدةٌ أخرى ما زالت
    // تُمسِك `SOVEREIGN_HALT` من العهدِ المنقضي فتقرأ العهدَ الجديدَ عند إقرارها.
    // (والاستئنافُ قبل اكتمالِ الإقراراتِ مرفوضٌ بـ`HALT_NOT_CONFIRMED`، وهو قيدٌ
    //  سياديٌّ لا يُلتَفّ عليه في اختبار.)
    assert.equal(halt.halt('إيقاف السباق').epoch, 1);
    await until(() => halt.confirmations(1).length === 3, 'إقرار العقد الثلاث بالتوقف');
    const resumed = halt.resume('استئناف عاجل');
    assert.equal(resumed.epoch, 2);
    assert.equal(resumed.state, 'running');

    await until(
      () =>
        nodeIds.every((id) =>
          records(id).some((entry) => entry.type === 'exec' && entry.epoch === 2),
        ),
      'عودة العقد الثلاث إلى التنفيذ بعد الاستئناف العاجل',
    );
    for (const child of children) assert.equal(child.exitCode, null, 'عقدةٌ ماتت في السباق');
    assert.equal(
      nodeIds.flatMap((id) => records(id)).some((entry) => entry.type === 'error'),
      false,
      'لا أخطاء غير متوقعة',
    );
    assert.equal(halt.verifyHistory().ok, true);
  },
);

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
