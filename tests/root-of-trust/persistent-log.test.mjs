// M2.05 — السجل الدائم: ترقيم متسلسل، وسلسلة تجزئة، وكتابة ذرية مُزامَنة،
// ومقاومة انقطاع. ومعيار القبول يُختبر هنا حرفياً: **قتل العملية أثناء الكتابة
// بإشارة SIGKILL حقيقية** لا محاكاةً، ثم إعادة التحميل والتحقق؛ وعبثٌ يدوي على
// الملف بأشكاله الخمسة يجب أن يُكشف موضعه وسببه.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  PersistentEventLog,
  PersistentLogError,
  PersistentLogErrorCodes,
  inspectEventLog,
  verifyEventChain,
  hashEventBody,
  GENESIS_HASH,
  LOG_HEAD_SUFFIX,
  LOG_LOCK_SUFFIX,
  EventLog,
  KingIdentity,
  CertificateAuthority,
  CrownGateway,
} from '../../src/root-of-trust/index.mjs';

/** @typedef {import('../../src/root-of-trust/event-log.mjs').EventRecord} EventRecord */

const ROOT = resolve(import.meta.dirname, '../..');
const MODULE = join(ROOT, 'src/root-of-trust/index.mjs');

/**
 * مجلد مؤقت يُحذف مع نهاية الاختبار.
 * @param {import('node:test').TestContext} t - سياق الاختبار
 * @returns {string} مسار ملف السجل
 */
function logFile(t) {
  const dir = mkdtempSync(join(tmpdir(), 'm205-log-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'events.jsonl');
}

/**
 * يقرأ أسطر ملف السجل كأحداث.
 * @param {string} file - مسار الملف
 * @returns {EventRecord[]} الأحداث
 */
function readEvents(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * يكتب أسطر أحداث خاماً (لمحاكاة عبث يدوي بالملف).
 * @param {string} file - مسار الملف
 * @param {EventRecord[]} events - الأحداث المراد كتابتها
 */
function writeEvents(file, events) {
  writeFileSync(file, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
}

/**
 * يُشغّل الفعل ويعيد خطأ السجل الذي رفعه. (`assert.throws` لا يعيد الخطأ، فلا
 * تُفحص حقوله بها — وهذا بعينه ما أوقعني في خطأ أول تشغيل.)
 * @param {() => unknown} action - الفعل المتوقَّع فشله
 * @returns {PersistentLogError} الخطأ المرفوع
 */
function capture(action) {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof PersistentLogError, 'الخطأ من نوع خطأ السجل');
    return error;
  }
  throw new assert.AssertionError({ message: 'كان يجب أن يفشل ولم يفشل' });
}

test('معيار القبول: قتل العملية أثناء الكتابة لا يفسد السلسلة', async (t) => {
  const file = logFile(t);
  const child = join(resolve(file, '..'), 'writer.mjs');
  // كاتبٌ حقيقي في عملية منفصلة يُلحق بلا توقف، كي تقع الإشارة داخل نافذة كتابة.
  writeFileSync(
    child,
    `import { PersistentEventLog } from ${JSON.stringify(MODULE)};
const log = new PersistentEventLog(${JSON.stringify(file)});
process.stdout.write('ready\\n');
for (let i = 0; ; i += 1) log.append('tick', 'writer', { i, filler: 'ح'.repeat(400) });
`,
  );

  let killedWithEvents = 0;
  for (let round = 0; round < 5; round += 1) {
    const proc = spawn(process.execPath, [child], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((done) => proc.stdout.once('data', done));
    await new Promise((done) => setTimeout(done, 60 + round * 25));
    proc.kill('SIGKILL');
    const code = await new Promise((done) => proc.once('exit', (_c, signal) => done(signal)));
    assert.equal(code, 'SIGKILL', 'العملية قُتلت فعلاً لا انتهت بسلام');

    // القفل بقي لعملية ميتة، والسطر الأخير قد يكون نصفه مكتوباً: كلاهما انقطاع.
    const before = inspectEventLog(file);
    const reopened = new PersistentEventLog(file);
    t.after(() => {
      if (existsSync(file)) rmSync(file + LOG_LOCK_SUFFIX, { force: true });
    });
    assert.equal(reopened.verify(), true, `السلسلة صحيحة بعد القتل (دورة ${round})`);
    assert.equal(reopened.recovery.stolenLockPid !== null, true, 'قفل العملية الميتة انتُزع');
    assert.equal(reopened.events.length, before.count, 'ما قُبل يساوي ما تحقّق منه الفحص');
    assert.ok(reopened.events.length > 0, 'كُتبت أحداث قبل القتل');
    if (reopened.recovery.droppedTailBytes > 0) killedWithEvents += 1;

    // والسجل المستردّ قابل للاستعمال فوراً لا للقراءة فقط.
    const next = reopened.append('after-recovery', 'test', {});
    assert.equal(next.seq, reopened.events.length);
    assert.equal(reopened.verify(), true);
    reopened.close();
    assert.equal(inspectEventLog(file).problem, undefined, 'الملف سليم تماماً بعد الاسترداد');
    rmSync(file);
    rmSync(file + LOG_HEAD_SUFFIX, { force: true });
  }
  // ليس شرط نجاح — بل معلومة: هل أُصيبت نافذة الكتابة المقطوعة فعلاً في هذه الجولة؟
  assert.ok(killedWithEvents >= 0);
});

test('قتل العملية داخل كتابة سجل ضخم: الذيل المقطوع يُقتطع والسلسلة تصمد', async (t) => {
  // القتل على سجلات صغيرة لا يُنتج ذيلاً مقطوعاً أصلاً: كتابة صغيرة بـO_APPEND
  // نداءٌ واحد ينهيه النواة أو لا يبدأه. فلبلوغ نافذة الكتابة الجزئية الحقيقية
  // يلزم سطرٌ يتجاوز ما تكتبه النواة دفعةً واحدة — وهنا ~4 ميغابايت.
  const observed = { torn: 0, rounds: 0 };
  for (let round = 0; round < 12 && observed.torn === 0; round += 1) {
    const file = logFile(t);
    const child = join(resolve(file, '..'), 'fat-writer.mjs');
    writeFileSync(
      child,
      `import { PersistentEventLog } from ${JSON.stringify(MODULE)};
const log = new PersistentEventLog(${JSON.stringify(file)});
process.stdout.write('ready\\n');
for (let i = 0; ; i += 1) log.append('fat', 'writer', { i, filler: 'ح'.repeat(2_000_000) });
`,
    );
    const proc = spawn(process.execPath, [child], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((done) => proc.stdout.once('data', done));
    await new Promise((done) => setTimeout(done, 15 + round * 10));
    proc.kill('SIGKILL');
    await new Promise((done) => proc.once('exit', done));
    observed.rounds += 1;

    const reopened = new PersistentEventLog(file);
    assert.equal(reopened.verify(), true, 'السلسلة صحيحة بعد القتل في كل جولة');
    if (reopened.recovery.droppedTailBytes > 0) {
      observed.torn += 1;
      assert.equal(reopened.recovery.stolenLockPid, proc.pid, 'قفل العملية المقتولة انتُزع');
      assert.equal(inspectEventLog(file).tailComplete, true, 'والذيل اقتُطع فعلاً من القرص');
      const next = reopened.append('بعد الاسترداد', 'test', {});
      assert.equal(next.seq, reopened.events.length);
      assert.equal(reopened.verify(), true);
    }
    reopened.close();
  }
  // لا يُشترط بلوغ النافذة في كل تشغيل — الكتابة الجزئية أمرُ نواةٍ لا أمرُ اختبار.
  // فإن لم تُبلَغ، يبقى الاسترداد مُبرهناً بالاختبار الحتمي للذيل المقطوع أعلاه.
  assert.ok(observed.rounds > 0);
});

test('الكتابة المقطوعة في الطرف تُقتطع بعددها، ولا يُقبل مثلها في الوسط', (t) => {
  const file = logFile(t);
  const first = new PersistentEventLog(file);
  first.append('a', 'test', {});
  first.append('b', 'test', {});
  first.close();

  const raw = readFileSync(file, 'utf8');
  const torn = raw + '{"id":"نصف حدث","seq":3,"type":"c"';
  writeFileSync(file, torn);
  const inspected = inspectEventLog(file);
  assert.equal(inspected.tailComplete, false, 'الفحص يرى ذيلاً غير مكتمل');
  assert.equal(inspected.count, 2, 'ولا يحتسب الذيل حدثاً');

  const recovered = new PersistentEventLog(file);
  assert.equal(recovered.events.length, 2);
  assert.equal(
    recovered.recovery.droppedTailBytes,
    Buffer.byteLength(torn) - Buffer.byteLength(raw),
  );
  assert.equal(readFileSync(file, 'utf8'), raw, 'الملف عاد إلى آخر سطر سليم بالبايت');
  assert.equal(recovered.verify(), true);
  recovered.close();

  // نفس التلف لكن في الوسط: عبثٌ لا انقطاع، فلا يُقتطع ولا يُصلَح تخميناً.
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  writeFileSync(file, `{"seq":1,"مقطوع"\n${lines[1]}\n`);
  const error = capture(() => new PersistentEventLog(file));
  assert.equal(error.code, 'CORRUPT_EVENT_LOG');
  assert.equal(error.brokenAt, 1);
});

test('حذف أحداث من طرف الملف يُكشف بالرأس — وهو ما لا تكشفه سلسلةٌ وحدها', (t) => {
  const file = logFile(t);
  const log = new PersistentEventLog(file);
  for (let i = 0; i < 5; i += 1) log.append('e', 'test', { i });
  log.close();

  const events = readEvents(file);
  writeEvents(file, events.slice(0, 3));
  // السلسلة نفسها لا ترى شيئاً: ثلاثة أحداث متصلة سلسلةٌ صحيحة تماماً.
  assert.equal(verifyEventChain(events.slice(0, 3)).ok, true, 'السلسلة وحدها عمياء عن الاقتطاع');

  const error = capture(() => new PersistentEventLog(file));
  assert.equal(error.code, 'TRUNCATED_EVENT_LOG');
  assert.equal(inspectEventLog(file).problem, 'TRUNCATED_EVENT_LOG');

  // وحذف الملف كله مع بقاء الرأس اقتطاعٌ أيضاً، لا سجلٌ جديد.
  rmSync(file);
  assert.equal(inspectEventLog(file).problem, 'TRUNCATED_EVENT_LOG');
  assert.throws(() => new PersistentEventLog(file), /TRUNCATED_EVENT_LOG/);
});

test('حذف حدث من الوسط أو تبديل موضعين يظهر فراغاً في الترقيم', (t) => {
  const file = logFile(t);
  const log = new PersistentEventLog(file);
  for (let i = 0; i < 4; i += 1) log.append('e', 'test', { i });
  log.close();
  const events = readEvents(file);

  const withoutMiddle = [events[0], events[1], events[3]];
  const gap = verifyEventChain(/** @type {EventRecord[]} */ (withoutMiddle));
  assert.equal(gap.ok, false);
  assert.equal(gap.brokenAt, 3);
  assert.equal(gap.reason, 'SEQUENCE_MISMATCH');

  const swapped = [events[0], events[2], events[1], events[3]];
  const swap = verifyEventChain(/** @type {EventRecord[]} */ (swapped));
  assert.equal(swap.ok, false);
  assert.equal(swap.brokenAt, 2);
  assert.equal(swap.reason, 'SEQUENCE_MISMATCH');

  writeEvents(file, /** @type {EventRecord[]} */ (withoutMiddle));
  const error = capture(() => new PersistentEventLog(file));
  assert.equal(error.code, 'CORRUPT_EVENT_LOG');
  assert.equal(error.reason, 'SEQUENCE_MISMATCH');
  assert.equal(error.brokenAt, 3);
});

test('تعديل محتوى حدث يُكشف بتجزئته، وإصلاح تجزئته يُكشف بالحدث الذي يليه', (t) => {
  const file = logFile(t);
  const log = new PersistentEventLog(file);
  log.append('grant', 'king', { role: 'observer' });
  log.append('grant', 'king', { role: 'observer' });
  log.append('grant', 'king', { role: 'observer' });
  log.close();

  const events = readEvents(file);
  const tampered = structuredClone(events);
  /** @type {{ data: { role: string } }} */ (tampered[1]).data.role = 'sovereign';
  const direct = verifyEventChain(tampered);
  assert.equal(direct.reason, 'HASH_MISMATCH');
  assert.equal(direct.brokenAt, 2);

  // العابث الذكي يعيد حساب التجزئة — فينكسر الرابط عند التالي لا عنده.
  const { hash: _dropped, ...body } = /** @type {EventRecord} */ (tampered[1]);
  tampered[1] = { ...body, hash: hashEventBody(body) };
  const chained = verifyEventChain(tampered);
  assert.equal(chained.reason, 'PREVIOUS_HASH_MISMATCH');
  assert.equal(chained.brokenAt, 3);

  writeEvents(file, tampered);
  assert.throws(() => new PersistentEventLog(file), /CORRUPT_EVENT_LOG/);
});

test('حدٌّ معلَن: إعادة بناء السجل والرأس معاً لا تُكشف — وهذا موضع M2.06', (t) => {
  const file = logFile(t);
  const log = new PersistentEventLog(file);
  log.append('حدث أصلي', 'king', { مهم: true });
  log.append('حدث أصلي', 'king', {});
  log.close();

  // عابثٌ يملك الكتابة على القرص يستطيع إعادة بناء تاريخ كامل متسق.
  const forged = new PersistentEventLog(file + '.forged', { acceptMissingHead: true });
  forged.append('تاريخ مُلفَّق', 'king', { مهم: false });
  forged.append('تاريخ مُلفَّق', 'king', {});
  forged.close();
  writeFileSync(file, readFileSync(forged.file));
  writeFileSync(file + LOG_HEAD_SUFFIX, readFileSync(forged.headFile));

  const reopened = new PersistentEventLog(file);
  assert.equal(reopened.verify(), true, 'التزييف المتسق يجتاز التحقق البنيوي');
  assert.equal(inspectEventLog(file).problem, undefined);
  assert.equal(reopened.events[0]?.type, 'تاريخ مُلفَّق', 'ولا شيء هنا يكشفه');
  reopened.close();
  // الكشف يحتاج تجزئةً موقَّعة محفوظة خارج القرص المُعبَث به: التثبيت في M2.06.
});

test('الرأس المفقود يُرفض افتراضاً، ويُقبل بإعلانٍ صريح يُسجَّل', (t) => {
  const file = logFile(t);
  const log = new PersistentEventLog(file);
  log.append('a', 'test', {});
  log.close();
  rmSync(file + LOG_HEAD_SUFFIX);

  const error = capture(() => new PersistentEventLog(file));
  assert.equal(error.code, 'HEAD_MISSING');

  const accepted = new PersistentEventLog(file, { acceptMissingHead: true });
  assert.equal(accepted.recovery.acceptedMissingHead, true, 'القبول مُسجَّل لا صامت');
  assert.equal(existsSync(file + LOG_HEAD_SUFFIX), true, 'والرأس أُعيد بناؤه');
  accepted.close();
  // وسجلٌ فارغ بلا رأس ليس نقصاً: لا شيء يمكن اقتطاعه منه.
  const fresh = new PersistentEventLog(logFile(t));
  assert.equal(fresh.recovery.acceptedMissingHead, false);
  fresh.close();
});

test('رأسٌ متأخر بحدث واحد أثر تعطُّل فيُصلَح، وما زاد على ذلك تناقضٌ يُرفض', (t) => {
  const file = logFile(t);
  const log = new PersistentEventLog(file);
  log.append('a', 'test', {});
  log.append('b', 'test', {});
  const headAfterTwo = readFileSync(file + LOG_HEAD_SUFFIX, 'utf8');
  log.append('c', 'test', {});
  log.close();

  // نافذة التعطُّل الوحيدة: الحدث مُزامَن والرأس لم يُحدَّث بعد.
  writeFileSync(file + LOG_HEAD_SUFFIX, headAfterTwo);
  const repaired = new PersistentEventLog(file);
  assert.equal(repaired.recovery.repairedHead, true);
  assert.equal(repaired.events.length, 3);
  assert.equal(JSON.parse(readFileSync(file + LOG_HEAD_SUFFIX, 'utf8')).count, 3);
  repaired.close();

  // رأسٌ متأخر بحدثين لا يُنتجه ترتيب الكتابة، فهو عبثٌ لا تعطُّل.
  writeFileSync(
    file + LOG_HEAD_SUFFIX,
    JSON.stringify({
      version: 1,
      count: 1,
      lastHash: readEvents(file)[0]?.hash ?? '',
      updatedAt: '',
    }),
  );
  const error = capture(() => new PersistentEventLog(file));
  assert.equal(error.code, 'HEAD_MISMATCH');

  // ورأسٌ بنفس العدد وتجزئة مخالفة تناقضٌ صريح.
  writeFileSync(
    file + LOG_HEAD_SUFFIX,
    JSON.stringify({ version: 1, count: 3, lastHash: 'ت'.repeat(64), updatedAt: '' }),
  );
  assert.throws(() => new PersistentEventLog(file), /HEAD_MISMATCH/);

  // ورأسٌ لا يُقرأ ليس رأساً مفقوداً.
  writeFileSync(file + LOG_HEAD_SUFFIX, 'ليس JSON');
  assert.throws(() => new PersistentEventLog(file), /HEAD_MISMATCH/);
});

test('كاتبٌ واحد: عملية حيّة تحتفظ بالقفل فيُرفض الثاني بلا هدم السلسلة', async (t) => {
  const file = logFile(t);
  const holder = join(resolve(file, '..'), 'holder.mjs');
  writeFileSync(
    holder,
    `import { PersistentEventLog } from ${JSON.stringify(MODULE)};
const log = new PersistentEventLog(${JSON.stringify(file)});
log.append('held', 'holder', {});
process.stdout.write('ready\\n');
setTimeout(() => {}, 60_000);
`,
  );
  const proc = spawn(process.execPath, [holder], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => proc.kill('SIGKILL'));
  await new Promise((done) => proc.stdout.once('data', done));

  const error = capture(() => new PersistentEventLog(file));
  assert.equal(error.code, 'LOG_ALREADY_LOCKED');
  assert.equal(error.detail?.includes(String(proc.pid)), true, 'الخطأ يقول من يملك القفل');
  // والقفل لم يُنتزع بالخطأ: العملية الحيّة ما زالت مالكة.
  assert.equal(existsSync(file + LOG_LOCK_SUFFIX), true);
  // والفحص القرائي لا يحتاج قفلاً أصلاً: التدقيق لا يوقف الكتابة.
  assert.equal(inspectEventLog(file).count, 1);
});

test('الفحص القرائي لا يكتب بايتاً واحداً ولو كان الملف تالفاً', (t) => {
  const file = logFile(t);
  const log = new PersistentEventLog(file);
  log.append('a', 'test', {});
  log.close();
  writeFileSync(file, readFileSync(file, 'utf8') + '{"seq":2,"مقطوع"');

  const before = statSync(file);
  const inspected = inspectEventLog(file);
  const after = statSync(file);
  assert.equal(after.size, before.size, 'الحجم لم يتغير');
  assert.equal(after.mtimeMs, before.mtimeMs, 'ووقت التعديل لم يتغير');
  assert.equal(inspected.tailComplete, false);
  assert.equal(existsSync(file + LOG_LOCK_SUFFIX), false, 'ولم يُنشئ قفلاً');

  // وملف غير موجود يُوصف ولا يُنشأ.
  const missing = join(resolve(file, '..'), 'لا-يوجد.jsonl');
  const description = inspectEventLog(missing);
  assert.equal(description.exists, false);
  assert.equal(description.count, 0);
  assert.equal(description.lastHash, GENESIS_HASH);
  assert.equal(existsSync(missing), false);
});

test('الصيغة القديمة بلا ترقيم تُرفض برمزها ولا يُتحقق منها بغموض', (t) => {
  const file = logFile(t);
  // بعينها صيغة M2.01: id, type, actor, data, previousHash, at, hash — بلا seq.
  const body = {
    id: 'قديم',
    type: 'boot',
    actor: 'system',
    data: {},
    previousHash: GENESIS_HASH,
    at: new Date().toISOString(),
  };
  // وتُجزَّأ بقاعدة الصيغة القديمة نفسها لا بدالة الصيغة الجديدة، كي يكون السطر
  // صحيحاً بمقاييس عصره فيثبت أن الرفض للصيغة لا لتجزئة خاطئة.
  const legacyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  writeFileSync(file, JSON.stringify({ ...body, hash: legacyHash }) + '\n');
  const error = capture(() => new PersistentEventLog(file));
  assert.equal(error.code, 'LEGACY_LOG_FORMAT');
  assert.equal(inspectEventLog(file).problem, 'LEGACY_LOG_FORMAT');
});

test('السجل الدائم يعيد التحميل ويستمر، والترقيم متصل عبر التشغيلات', (t) => {
  const file = logFile(t);
  const first = new PersistentEventLog(file);
  first.append('boot', 'system', {});
  first.append('boot', 'system', {});
  first.close();

  const second = new PersistentEventLog(file);
  assert.equal(second.events.length, 2);
  assert.equal(second.verify(), true);
  const third = second.append('resume', 'system', {});
  assert.equal(third.seq, 3, 'الترقيم لا يُصفَّر بإعادة التشغيل');
  assert.equal(third.previousHash, second.events[1]?.hash);
  assert.equal(second.recovery.droppedTailBytes, 0);
  assert.equal(second.recovery.repairedHead, false);
  second.close();

  assert.throws(() => second.append('بعد الإغلاق', 'system', {}), /LOG_CLOSED/);
  assert.equal(readEvents(file).length, 3, 'ولم يُكتب شيء بعد الإغلاق');
});

test('بوابة التاج تكتب في السجل الدائم وتُقرأ سجلاتها بعد إعادة التشغيل', (t) => {
  const file = logFile(t);
  const king = new KingIdentity();
  const ca = new CertificateAuthority(king);
  const log = new PersistentEventLog(file);
  const gateway = new CrownGateway(king, ca, log);
  const command = {
    id: 'أمر-1',
    action: 'inspect',
    target: 'root-of-trust',
    payload: {},
    issuedAt: new Date().toISOString(),
  };
  gateway.command(command, king.sign(command));
  log.close();

  const reopened = new PersistentEventLog(file);
  assert.ok(reopened.events.length > 0, 'البوابة سجّلت فعلاً');
  assert.equal(reopened.verify(), true);
  assert.equal(reopened.events.at(-1)?.seq, reopened.events.length);
  reopened.close();
});

test('السجل في الذاكرة يرقّم ويجمّد ويكشف موضع العبث', () => {
  const log = new EventLog();
  const first = log.append('a', 'test', {});
  const second = log.append('b', 'test', {});
  assert.equal(first.seq, 1);
  assert.equal(second.seq, 2);
  assert.equal(first.previousHash, GENESIS_HASH);
  assert.equal(Object.isFrozen(log.events[0]), true, 'الحدث المُلحق مجمَّد');
  assert.equal(log.verifyChain().ok, true);
  assert.equal(log.verifyChain().count, 2);
  assert.equal(log.verifyChain().lastHash, log.lastHash);

  // العبث على النسخة المُصدَّرة لا يمسّ السجل — والنسخة ليست الأصل.
  const copy = log.snapshot();
  /** @type {{ seq: number }} */ (copy[0]).seq = 99;
  assert.equal(log.verify(), true);
  assert.equal(verifyEventChain(copy).reason, 'SEQUENCE_MISMATCH');
});

test('رموز أخطاء السجل الدائم مثبَّتة نصاً، والرسالة هي الرمز', () => {
  assert.deepEqual(
    [...PersistentLogErrorCodes],
    [
      'CORRUPT_EVENT_LOG',
      'LEGACY_LOG_FORMAT',
      'TRUNCATED_EVENT_LOG',
      'HEAD_MISMATCH',
      'HEAD_MISSING',
      'LOG_ALREADY_LOCKED',
      'LOG_CLOSED',
      'PARTIAL_WRITE',
    ],
  );
  const error = new PersistentLogError('CORRUPT_EVENT_LOG', { brokenAt: 4 });
  assert.equal(error.message, 'CORRUPT_EVENT_LOG');
  assert.equal(error.name, 'PersistentLogError');
  assert.equal(error.brokenAt, 4);
  assert.equal(error.reason, undefined);
});

test('لا مادة قفل ولا رأس يُخلَّفان في المستودع: الملفات المؤقتة تُنظَّف', (t) => {
  const file = logFile(t);
  const log = new PersistentEventLog(file);
  log.append('a', 'test', {});
  log.close();
  const dir = resolve(file, '..');
  const left = spawnSync('ls', ['-a', dir], { encoding: 'utf8' }).stdout;
  assert.equal(left.includes('.tmp'), false, 'لا ملف مؤقت متروك بعد كتابة الرأس');
  assert.equal(existsSync(file + LOG_LOCK_SUFFIX), false, 'والقفل أُفلت بالإغلاق');
});
