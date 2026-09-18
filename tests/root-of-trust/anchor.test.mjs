// اختبار التثبيت الدوري الموقَّع — الخطوة M2.06.
//
// معيار القبول: «تعديل حدث قديم يُكتشف عند مطابقة أقرب تثبيت». والاختبار الأول
// هنا هو ذلك بنصّه، والثاني أهم منه: يُعيد بناء السجل **والرأس** معاً بناءً
// متسقاً تماماً — وهو الهجوم الذي أُعلن في `WL-009` أنه يجتاز كل تحقق محلي —
// فيُثبت أن التثبيت الموقَّع يكشفه. أي أن هذا الملف يُغلق حداً أُعلن سابقاً،
// ويُبقي معلناً ما لم يُغلق (حذف التثبيتات من الطرف مع السجل).
//
// وقاعدة الاختبار هنا: كل عبثٍ يُختبر **متسقاً** — يعيد العابث حساب كل تجزئة
// وكل توقيع يستطيعه — لأن عبثاً غير متسق تكشفه سلسلةُ M2.05 ولا يقيس هذه الخطوة.

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import {
  AnchorError,
  AnchorErrorCodes,
  AnchorProblems,
  CoexistingKingIdentity,
  EventLog,
  FileAnchorStore,
  GENESIS_ANCHOR_HASH,
  KingIdentity,
  LogAnchorer,
  LOG_HEAD_SUFFIX,
  LOG_LOCK_SUFFIX,
  PersistentEventLog,
  createAnchor,
  hashAnchorBody,
  hashEventBody,
  inspectEventLog,
  nearestAnchorFor,
  verifyAnchorChain,
  verifyAnchoredLog,
  verifyEventChain,
} from '../../src/root-of-trust/index.mjs';

/** @type {string[]} */
const directories = [];

/**
 * يهيّئ مجلداً معزولاً لكل اختبار ويُنظّفه بعده.
 * @param {import('node:test').TestContext} t - سياق الاختبار
 * @returns {string} مسار المجلد
 */
function workDir(t) {
  const directory = registerTmpRoot(mkdtempSync(join(tmpdir(), 'anchor-')));
  directories.push(directory);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/**
 * يبني سجلاً في الذاكرة بعدد أحداث معلوم.
 * @param {number} count - عدد الأحداث
 * @returns {EventLog} السجل
 */
function memoryLog(count) {
  const log = new EventLog();
  for (let index = 1; index <= count; index += 1) log.append('حدث', 'نظام', { index });
  return log;
}

/**
 * يُعيد بناء سلسلة أحداث بناءً متسقاً بعد تعديل حدث — أي يفعل ما يفعله عابثٌ
 * ذكي: يعيد حساب تجزئة كل ما بعد المعدَّل، فتخرج سلسلة صحيحة تماماً.
 * @param {readonly import('../../src/root-of-trust/event-log.mjs').EventRecord[]} events - الأحداث
 * @param {number} seq - ترقيم الحدث المراد تعديله
 * @param {Record<string, unknown>} data - المحتوى البديل
 * @returns {import('../../src/root-of-trust/event-log.mjs').EventRecord[]} تاريخ مزيَّف متسق
 */
function rewriteHistory(events, seq, data) {
  /** @type {import('../../src/root-of-trust/event-log.mjs').EventRecord[]} */
  const forged = [];
  let previousHash = 'GENESIS';
  for (const event of events) {
    const body = {
      id: event.id,
      seq: event.seq,
      type: event.type,
      actor: event.actor,
      data: event.seq === seq ? data : event.data,
      previousHash,
      at: event.at,
    };
    const hash = hashEventBody(body);
    forged.push({ ...body, hash });
    previousHash = hash;
  }
  return forged;
}

/**
 * يُمسك الخطأ المرفوع ويرجعه، لأن `assert.throws` لا ترجع الخطأ فتُقرأ حقوله.
 * @param {() => unknown} action - الفعل المتوقَّع فشله
 * @returns {any} الخطأ المرفوع
 */
function capture(action) {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('كان يجب أن يفشل ولم يفشل');
}

/**
 * يوقّع مادة تثبيت مُصاغة يدوياً — لصناعة تثبيتات «صحيحة التوقيع» لكن كاذبة
 * في مضمونها، وهي وحدها ما يقيس الفحوص التي لا يكفيها التوقيع.
 * @param {import('../../src/root-of-trust/anchor.mjs').AnchorBody} body - المادة
 * @param {KingIdentity} king - الموقّع
 * @returns {import('../../src/root-of-trust/anchor.mjs').AnchorRecord} تثبيت موقَّع
 */
function signBody(body, king) {
  return { ...body, hash: hashAnchorBody(body), signature: king.sign(body) };
}

test.after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

test('معيار M2.06: تعديل حدث قديم يُكتشف عند مطابقة أقرب تثبيت', () => {
  const king = new KingIdentity();
  const log = memoryLog(6);
  const chainAtFour = verifyEventChain(log.events.slice(0, 4));
  const anchor = createAnchor({ count: 4, lastHash: chainAtFour.lastHash }, null, king);

  // العابث يعدّل الحدث الثاني ثم يعيد بناء كل ما بعده، فسلسلته صحيحة تماماً.
  const forged = rewriteHistory(log.events, 2, { index: 'مزيَّف' });
  assert.equal(
    verifyEventChain(forged).ok,
    true,
    'التاريخ المزيَّف يجب أن يكون متسقاً وإلا لم نقس شيئاً',
  );

  const clean = verifyAnchoredLog({ events: log.events, anchors: [anchor], king });
  assert.equal(clean.ok, true);
  assert.equal(clean.provenEvents, 4);
  assert.equal(clean.unanchoredEvents, 2, 'حدثان بعد التثبيت: نافذة غير مثبَّتة تُعلَن');

  const tampered = verifyAnchoredLog({ events: forged, anchors: [anchor], king });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.problem, 'LOG_DIVERGES_FROM_ANCHOR');
  assert.equal(tampered.problemAt, 1, 'التثبيت الأول هو الذي كذّب التاريخ');

  // «أقرب تثبيت» ليس اصطلاحاً: أول تثبيت يشهد للحدث المشكوك فيه.
  assert.equal(nearestAnchorFor([anchor], 2)?.seq, 1);
  assert.equal(nearestAnchorFor([anchor], 6), null, 'حدثٌ بعد كل التثبيتات لا يشهد له تثبيت');
});

test('الحدّ المُعلن في WL-009 يُغلق: إعادة بناء السجل والرأس معاً تجتاز الفحص المحلي ويكشفها التثبيت', (t) => {
  const directory = workDir(t);
  const file = join(directory, 'events.jsonl');
  const king = new KingIdentity();
  const store = new FileAnchorStore(join(directory, 'anchors', 'anchors.jsonl'));
  const anchorer = new LogAnchorer(store, king);

  const log = new PersistentEventLog(file);
  for (let index = 1; index <= 5; index += 1) log.append('حدث', 'نظام', { index });
  anchorer.anchor(log);
  log.close();

  // عبثٌ كامل متسق: تاريخ مزيَّف + رأس مُعاد بناؤه على مقاسه.
  const forged = rewriteHistory(inspectEventLog(file).events, 2, { index: 'مزيَّف' });
  writeFileSync(file, forged.map((event) => JSON.stringify(event)).join('\n') + '\n');
  const forgedChain = verifyEventChain(forged);
  writeFileSync(
    file + LOG_HEAD_SUFFIX,
    JSON.stringify({
      version: 1,
      count: forgedChain.count,
      lastHash: forgedChain.lastHash,
      updatedAt: new Date().toISOString(),
    }),
  );

  // الفحص المحلي يقول «سليم» — وهذا بعينه ما أُعلن حداً في M2.05.
  const inspection = inspectEventLog(file);
  assert.equal(inspection.chainOk, true);
  assert.equal(inspection.headAgrees, true);
  assert.equal(inspection.problem, undefined);

  // والتثبيت الموقَّع يكشفه، لأن العابث لا يملك مفتاح الملك.
  const result = anchorer.verify({ events: inspection.events, file });
  assert.equal(result.ok, false);
  assert.equal(result.problem, 'LOG_DIVERGES_FROM_ANCHOR');
  assert.equal(result.problemAt, 1);
});

test('حذف أحداث من الطرف تحت التثبيت يُكشف ولو أُعيد بناء الرأس', (t) => {
  const directory = workDir(t);
  const king = new KingIdentity();
  const log = memoryLog(9);
  const anchor = createAnchor(
    { count: 9, lastHash: verifyEventChain(log.events).lastHash },
    null,
    king,
  );
  const store = new FileAnchorStore(join(directory, 'anchors.jsonl'));
  store.append(anchor);

  const truncated = log.events.slice(0, 5);
  const result = verifyAnchoredLog({ events: truncated, anchors: store.read(), king });
  assert.equal(result.ok, false);
  assert.equal(result.problem, 'LOG_TRUNCATED_BELOW_ANCHOR');
  assert.match(String(result.detail), /9/);
});

test('تثبيت ملفَّق بمفتاح آخر يُرفض ولو كان بنيانه سليماً', () => {
  const king = new KingIdentity();
  const impostor = new KingIdentity();
  const log = memoryLog(3);
  const state = { count: 3, lastHash: verifyEventChain(log.events).lastHash };
  const forged = createAnchor(state, null, impostor);
  const result = verifyAnchoredLog({ events: log.events, anchors: [forged], king });
  assert.equal(result.ok, false);
  assert.equal(result.problem, 'ANCHOR_SIGNATURE_INVALID');
  assert.equal(result.problemAt, 1);
});

test('تعديل حقل في تثبيت محفوظ يُكشف بتجزئته، وإعادة حسابها تُكشف بتوقيعه', () => {
  const king = new KingIdentity();
  const log = memoryLog(4);
  const anchor = createAnchor(
    { count: 4, lastHash: verifyEventChain(log.events).lastHash },
    null,
    king,
  );

  const editedOnly = { ...anchor, count: 2 };
  assert.equal(verifyAnchorChain([editedOnly], king).problem, 'ANCHOR_HASH_MISMATCH');

  const rehashed = { ...editedOnly, hash: hashAnchorBody({ ...anchor, count: 2 }) };
  assert.equal(
    verifyAnchorChain([rehashed], king).problem,
    'ANCHOR_SIGNATURE_INVALID',
    'التوقيع على المادة لا على التجزئة، فإعادة حسابها لا تنفع العابث',
  );
});

test('حذف تثبيت من الوسط يظهر فراغاً في الترقيم، وتبديل موضعين يكسر الترابط', () => {
  const king = new KingIdentity();
  const log = memoryLog(6);
  /** @type {import('../../src/root-of-trust/anchor.mjs').AnchorRecord[]} */
  const anchors = [];
  for (const count of [2, 4, 6]) {
    anchors.push(
      createAnchor(
        { count, lastHash: verifyEventChain(log.events.slice(0, count)).lastHash },
        anchors[anchors.length - 1] ?? null,
        king,
      ),
    );
  }
  assert.equal(verifyAnchoredLog({ events: log.events, anchors, king }).ok, true);

  const middleGone = [anchors[0], anchors[2]];
  const gap = verifyAnchorChain(/** @type {any} */ (middleGone), king);
  assert.equal(gap.problem, 'ANCHOR_SEQUENCE_MISMATCH');
  assert.equal(gap.problemAt, 2);

  const swapped = [anchors[1], anchors[0], anchors[2]];
  assert.equal(verifyAnchorChain(/** @type {any} */ (swapped), king).ok, false);
});

test('تثبيت من فرع آخر يُدسّ بترقيم صحيح وتوقيع صحيح فيكشفه الترابط وحده', () => {
  // كشف قياسُ الطفرات أن فحص الترابط (`previousAnchorHash`) لم يكن مقيساً وحده:
  // اختباراتُ الحذف والتبديل يسبقها فحصُ الترقيم فيكشفها قبله. وهذه الحالة لا
  // يكشفها إلا الترابط: تثبيتٌ ترقيمه صحيح وتوقيعه صحيح وعدده غير متراجع، لكنه
  // يشير إلى سابقٍ غير الذي في المخزن — أي مخزنٌ لُفّق من فرعين.
  const king = new KingIdentity();
  const log = memoryLog(6);
  const first = createAnchor(
    { count: 2, lastHash: verifyEventChain(log.events.slice(0, 2)).lastHash },
    null,
    king,
  );
  const spliced = signBody(
    {
      version: 1,
      seq: 2,
      count: 4,
      lastHash: verifyEventChain(log.events.slice(0, 4)).lastHash,
      previousAnchorHash: GENESIS_ANCHOR_HASH,
      at: new Date().toISOString(),
      kingId: king.id,
      keyVersion: 1,
    },
    king,
  );
  const result = verifyAnchorChain([first, spliced], king);
  assert.equal(result.problem, 'ANCHOR_LINK_MISMATCH');
  assert.equal(result.problemAt, 2);
});

test('حدٌّ معلَن: حذف التثبيتات المتأخرة مع السجل لا يُكشف من المخزن وحده', () => {
  const king = new KingIdentity();
  const log = memoryLog(6);
  /** @type {import('../../src/root-of-trust/anchor.mjs').AnchorRecord[]} */
  const anchors = [];
  for (const count of [2, 4]) {
    anchors.push(
      createAnchor(
        { count, lastHash: verifyEventChain(log.events.slice(0, count)).lastHash },
        anchors[anchors.length - 1] ?? null,
        king,
      ),
    );
  }
  // العابث يقتطع السجل إلى حدثين ويحذف التثبيت الثاني: الباقي متسق تماماً.
  const kept = [anchors[0]];
  const result = verifyAnchoredLog({
    events: log.events.slice(0, 2),
    anchors: /** @type {any} */ (kept),
    king,
  });
  assert.equal(result.ok, true, 'يُقبل — وهذا حدٌّ لا يُغلق بمخزنٍ يعيش عند العابث');
  assert.equal(result.provenEvents, 2);
  // ما يُغلقه: شاهدٌ خارجي أو وسط منفصل (M5)، أو مقارنة العدد بمرجع مستقل.
});

test('تراجع العدد بين تثبيتين مرفوض ولو صحّ التوقيع', () => {
  const king = new KingIdentity();
  const log = memoryLog(6);
  const first = createAnchor(
    { count: 5, lastHash: verifyEventChain(log.events.slice(0, 5)).lastHash },
    null,
    king,
  );
  const back = signBody(
    {
      version: 1,
      seq: 2,
      count: 3,
      lastHash: verifyEventChain(log.events.slice(0, 3)).lastHash,
      previousAnchorHash: first.hash,
      at: new Date().toISOString(),
      kingId: king.id,
      keyVersion: 1,
    },
    king,
  );
  const result = verifyAnchorChain([first, back], king);
  assert.equal(result.problem, 'ANCHOR_COUNT_REGRESSION');
  assert.equal(result.problemAt, 2);
});

test('التثبيت يزعم إصدار مفتاح غير الذي قَبِله فيُرفض', () => {
  const first = new KingIdentity();
  const second = new KingIdentity();
  const coexisting = new CoexistingKingIdentity({ version: 2, identity: second }, [
    { version: 1, identity: first },
  ]);
  const log = memoryLog(3);
  const lying = signBody(
    {
      version: 1,
      seq: 1,
      count: 3,
      lastHash: verifyEventChain(log.events).lastHash,
      previousAnchorHash: GENESIS_ANCHOR_HASH,
      at: new Date().toISOString(),
      kingId: first.id,
      keyVersion: 2,
    },
    first,
  );
  const result = verifyAnchorChain([lying], coexisting);
  assert.equal(result.problem, 'ANCHOR_KEY_VERSION_MISMATCH');
  assert.match(String(result.detail), /2/);
});

test('تثبيت صدر قبل التدوير يبقى مقبولاً في التعايش ويُرفض بعد الإبطال', () => {
  const first = new KingIdentity();
  const second = new KingIdentity();
  const log = memoryLog(4);
  const state = { count: 4, lastHash: verifyEventChain(log.events).lastHash };
  const oldAnchor = createAnchor(state, null, first);
  assert.equal(oldAnchor.keyVersion, 1, 'هويةٌ بلا تدوير إصدارها 1 حكماً');

  const coexisting = new CoexistingKingIdentity({ version: 2, identity: second }, [
    { version: 1, identity: first },
  ]);
  const during = verifyAnchoredLog({ events: log.events, anchors: [oldAnchor], king: coexisting });
  assert.equal(during.ok, true);
  assert.deepEqual(during.keyVersions, [1], 'التدقيق يعرف بأي إصدار قُبل لا يقبل بغموض');

  const afterRevocation = new CoexistingKingIdentity({ version: 2, identity: second });
  const after = verifyAnchoredLog({
    events: log.events,
    anchors: [oldAnchor],
    king: afterRevocation,
  });
  assert.equal(after.problem, 'ANCHOR_SIGNATURE_INVALID');
});

test('المخزن يجب أن يكون منفصلاً عن السجل ورأسه وقفله', (t) => {
  const directory = workDir(t);
  const file = join(directory, 'events.jsonl');
  for (const candidate of [file, file + LOG_HEAD_SUFFIX, file + LOG_LOCK_SUFFIX]) {
    const store = new FileAnchorStore(candidate);
    const error = capture(() => store.assertSeparateFrom(file));
    assert.ok(error instanceof AnchorError);
    assert.equal(error.code, 'ANCHOR_STORE_NOT_SEPARATE');
  }
  const separate = new FileAnchorStore(join(directory, 'anchors.jsonl'));
  separate.assertSeparateFrom(file);
});

test('سجل بلا تثبيت لا يُقال عنه صحيح: لا تثبيت ⇒ لا إثبات', () => {
  const king = new KingIdentity();
  const result = verifyAnchoredLog({ events: memoryLog(3).events, anchors: [], king });
  assert.equal(result.ok, false);
  assert.equal(result.problem, 'ANCHOR_STORE_EMPTY');
  assert.equal(result.provenEvents, 0);
});

test('التثبيت دوري: لا يقع قبل انقضاء الفترة، ويقع بعدها، والفترة تُحسب من المخزن لا من العملية', (t) => {
  const directory = workDir(t);
  const king = new KingIdentity();
  const storePath = join(directory, 'anchors.jsonl');
  const anchorer = new LogAnchorer(new FileAnchorStore(storePath), king, { intervalMs: 60_000 });
  const log = memoryLog(2);
  const start = new Date('2026-08-23T10:00:00.000Z');

  assert.equal(anchorer.maybeAnchor(log, start)?.seq, 1, 'أول تثبيت يقع فوراً');
  log.append('حدث', 'نظام', { index: 3 });
  assert.equal(
    anchorer.maybeAnchor(log, new Date(start.getTime() + 30_000)),
    null,
    'نصف الفترة: لا تثبيت',
  );

  // عملية جديدة على المخزن نفسه: العدّ لا يبدأ من الصفر عند إعادة التشغيل.
  const restarted = new LogAnchorer(new FileAnchorStore(storePath), king, { intervalMs: 60_000 });
  assert.equal(restarted.maybeAnchor(log, new Date(start.getTime() + 45_000)), null);
  const later = restarted.maybeAnchor(log, new Date(start.getTime() + 61_000));
  assert.equal(later?.seq, 2);
  assert.equal(later?.count, 3);
  assert.equal(restarted.verify(log).ok, true);
});

test('لا تثبيت بلا جديد، ولا توقيع لسجل مكسورة سلسلته', (t) => {
  const directory = workDir(t);
  const king = new KingIdentity();
  const anchorer = new LogAnchorer(new FileAnchorStore(join(directory, 'anchors.jsonl')), king);
  const log = memoryLog(3);
  anchorer.anchor(log);
  const idle = capture(() => anchorer.anchor(log));
  assert.equal(idle.code, 'NOTHING_TO_ANCHOR');

  // السجل في الذاكرة مُجمَّد (M2.05)، فالعبث يُصنع على نسخةٍ كما يفعل من يقرأ
  // ملفاً عُبث به ثم يطلب تثبيته.
  const broken = memoryLog(3).events.map((event) => ({ ...event }));
  const target = broken[1];
  if (target) target.hash = createHash('sha256').update('مكسور').digest('hex');
  const unsignable = capture(() =>
    new LogAnchorer(new FileAnchorStore(join(directory, 'other.jsonl')), king).anchor({
      events: broken,
    }),
  );
  assert.equal(unsignable.code, 'UNSIGNABLE_LOG', 'التوقيع يُلزِم ولا يصحّح، فلا يُوقَّع معطوب');
});

test('سطر تالف في مخزن التثبيتات يُرفض بموضعه ولا يُتجاوز بصمت', (t) => {
  const directory = workDir(t);
  const king = new KingIdentity();
  const path = join(directory, 'anchors.jsonl');
  const store = new FileAnchorStore(path);
  store.append(
    createAnchor(
      { count: 1, lastHash: verifyEventChain(memoryLog(1).events).lastHash },
      null,
      king,
    ),
  );
  writeFileSync(path, readFileSync(path, 'utf8') + '{ليس JSON}\n');
  const error = capture(() => store.read());
  assert.equal(error.code, 'CORRUPT_ANCHOR_STORE');
  assert.equal(error.detail, 'السطر 2');
});

test('التدقيق يجري على سجل حيّ يكتب فيه غيرُنا: بلا قفل وبلا كتابة بايت', (t) => {
  const directory = workDir(t);
  const file = join(directory, 'events.jsonl');
  const king = new KingIdentity();
  const anchorer = new LogAnchorer(new FileAnchorStore(join(directory, 'anchors.jsonl')), king);

  const service = new PersistentEventLog(file);
  service.append('boot', 'نظام', {});
  service.append('boot', 'نظام', {});
  anchorer.anchor(service);

  // السجل ما زال مفتوحاً وقفله بيد الخدمة، والتدقيق يقرأ ولا يكتب.
  const before = statSync(file);
  const inspection = inspectEventLog(file);
  const audit = anchorer.verify({ events: inspection.events, file });
  const after = statSync(file);
  assert.equal(audit.ok, true);
  assert.equal(audit.provenEvents, 2);
  assert.equal(before.size, after.size);
  assert.equal(before.mtimeMs, after.mtimeMs);

  // ثم تُكمل الخدمة الكتابة، فتظهر النافذة غير المثبَّتة بلا عطب.
  service.append('حدث', 'نظام', {});
  const later = anchorer.verify({ events: inspectEventLog(file).events, file });
  assert.equal(later.ok, true);
  assert.equal(later.unanchoredEvents, 1);
  service.close();
});

test('التثبيت يصمد لإعادة تشغيل السجل وإغلاقه', (t) => {
  const directory = workDir(t);
  const file = join(directory, 'events.jsonl');
  const king = new KingIdentity();
  const store = new FileAnchorStore(join(directory, 'anchors.jsonl'));
  const anchorer = new LogAnchorer(store, king);

  const first = new PersistentEventLog(file);
  first.append('حدث', 'نظام', { round: 1 });
  anchorer.anchor(first);
  first.close();

  const second = new PersistentEventLog(file);
  second.append('حدث', 'نظام', { round: 2 });
  anchorer.anchor(second);
  const result = anchorer.verify(second);
  second.close();

  assert.equal(result.ok, true);
  assert.equal(result.anchors, 2);
  assert.equal(result.provenEvents, 2);
  assert.deepEqual(result.keyVersions, [1, 1]);
});

test('رموز الأعطاب والأخطاء مثبَّتة نصاً كي تُختبر ولا تُخمَّن', () => {
  assert.deepEqual(
    [...AnchorProblems],
    [
      'ANCHOR_STORE_EMPTY',
      'ANCHOR_SEQUENCE_MISMATCH',
      'ANCHOR_HASH_MISMATCH',
      'ANCHOR_LINK_MISMATCH',
      'ANCHOR_SIGNATURE_INVALID',
      'ANCHOR_KEY_VERSION_MISMATCH',
      'ANCHOR_COUNT_REGRESSION',
      'LOG_TRUNCATED_BELOW_ANCHOR',
      'LOG_DIVERGES_FROM_ANCHOR',
      'EVENT_CHAIN_BROKEN',
    ],
  );
  assert.deepEqual(
    [...AnchorErrorCodes],
    [
      'ANCHOR_STORE_NOT_SEPARATE',
      'CORRUPT_ANCHOR_STORE',
      'NOTHING_TO_ANCHOR',
      'ANCHOR_BEHIND_STORE',
      'UNSIGNABLE_LOG',
    ],
  );
});

test('عبثٌ غير متسق في السجل يُنسب إلى السلسلة لا إلى التثبيت', () => {
  const king = new KingIdentity();
  const log = memoryLog(4);
  const anchor = createAnchor(
    { count: 4, lastHash: verifyEventChain(log.events).lastHash },
    null,
    king,
  );
  const events = log.events.map((event) => ({ ...event }));
  const second = events[1];
  if (second) second.data = { index: 'مزيَّف' };
  const result = verifyAnchoredLog({ events, anchors: [anchor], king });
  assert.equal(result.ok, false);
  assert.equal(result.problem, 'EVENT_CHAIN_BROKEN');
  assert.equal(result.detail, 'HASH_MISMATCH');
  assert.equal(result.problemAt, 2, 'الموضع من السلسلة، فالرسالة تقول أين لا «تالف»');
});

test('المفتاح غير المتناظر لا يُستنسخ: مفتاح آخر بنفس المادة العامة يقبل، وبغيرها يرفض', () => {
  const king = new KingIdentity();
  const clone = new KingIdentity(generateKeyPairSync('ed25519'));
  const log = memoryLog(2);
  const anchor = createAnchor(
    { count: 2, lastHash: verifyEventChain(log.events).lastHash },
    null,
    king,
  );
  assert.equal(verifyAnchoredLog({ events: log.events, anchors: [anchor], king }).ok, true);
  assert.equal(
    verifyAnchoredLog({ events: log.events, anchors: [anchor], king: clone }).problem,
    'ANCHOR_SIGNATURE_INVALID',
  );
  assert.notEqual(king.id, clone.id);
});
