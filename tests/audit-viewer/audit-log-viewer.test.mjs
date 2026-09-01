/**
 * اختبارُ عارضِ سجلِّ التدقيق — الخطوة `M9.07`.
 *
 * القياسُ كلُّه على **سجلٍّ دائمٍ حقيقيٍّ على القرص** (`PersistentEventLog`) لا
 * على مزدوجٍ في الذاكرة: معيارُ قبولِ الخطوةِ «عبثٌ مُصطنعٌ يظهر كتحذيرِ سلامةٍ
 * في الواجهة»، والعبثُ لا يكون عبثاً إلا ببايتٍ يُبدَّل بعد كتابتِه.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  AUDIT_VIEWER_ERRORS,
  AUDIT_VIEWER_FACES,
  AuditLogViewer,
  AuditViewerError,
  loadAuditViewerPolicy,
} from '../../src/audit-viewer/index.mjs';
import { PersistentEventLog } from '../../src/root-of-trust/index.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG_DIR = path.join(REPO_ROOT, 'config');
const GUARD = path.join(REPO_ROOT, 'scripts', 'guard-audit-viewer.mjs');

/** @type {string[]} */
const tempDirs = [];

/** @returns {string} */
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-viewer-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * سجلٌّ دائمٌ على القرصِ مملوءٌ بأحداثٍ حقيقيّةٍ متسلسلةِ التجزئة.
 * @param {number} count
 * @returns {{ log: InstanceType<typeof PersistentEventLog>, file: string }}
 */
function seededLog(count) {
  const file = path.join(tempDir(), 'events.jsonl');
  const log = new PersistentEventLog(file, { fsync: false });
  for (let index = 0; index < count; index += 1) {
    log.append(index % 2 === 0 ? 'api.call' : 'monitor.read', `agent:${index}`, { index });
  }
  return { log, file };
}

/**
 * ساعةٌ مُمرَّرةٌ تتقدّم بخطوةٍ ثابتة — فلا حكمَ يُختم بساعةِ نظامٍ حرّة.
 * @param {number} [start]
 * @returns {() => number}
 */
function tickingClock(start = 1_700_000_000_000) {
  let now = start;
  return () => {
    now += 1000;
    return now;
  };
}

/**
 * عبثٌ مُصطنعٌ ببايتٍ حقيقيٍّ بعد الكتابة: يُبدَّل حقلٌ في قيدٍ مكتوبٍ دون
 * إعادةِ حسابِ تجزئتِه، فتنكسر السلسلةُ كما تنكسر بيدِ عابثٍ حقيقيّ.
 * @param {string} file
 * @param {number} index
 * @param {(entry: Record<string, unknown>) => void} mutate
 * @returns {void}
 */
function tamper(file, index, mutate) {
  const lines = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
  const entry = JSON.parse(/** @type {string} */ (lines[index]));
  mutate(entry);
  lines[index] = JSON.stringify(entry);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

/**
 * @param {string} file
 * @returns {Record<string, unknown>[]}
 */
function readEntries(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

test.after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// الوثيقة
// ═══════════════════════════════════════════════════════════════════════════

test('الوثيقةُ تُحمَّل بمخطَّطِها وتُعلن الأوجهَ الثلاثةَ وجهاً بمشهدٍ واحد', () => {
  const policy = loadAuditViewerPolicy({ dir: CONFIG_DIR });
  assert.equal(policy.views.length, 3);
  for (const face of AUDIT_VIEWER_FACES) {
    assert.equal(
      policy.views.filter((view) => view.face === face).length,
      1,
      `الوجه ${face} يجب أن يكون بمشهدٍ واحدٍ لا أكثر ولا أقل`,
    );
  }
  for (const view of policy.views) assert.equal(view.source, 'log:events');
  assert.ok(policy.search.fields.includes('seq'));
  assert.ok(policy.search.fields.includes('at'));
});

test('رموزُ الرفضِ متقابلةٌ في الاتجاهين بين الكودِ والوثيقة', () => {
  const policy = loadAuditViewerPolicy({ dir: CONFIG_DIR });
  const declared = [...policy.refusalCodes].sort();
  const raised = Object.values(AUDIT_VIEWER_ERRORS).sort();
  assert.deepEqual(declared, raised);
});

test('وثيقةٌ تُخالف مخطَّطَها تُرَدُّ بـ CONFIG_INVALID لا تُقرأ على علّاتِها', () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, 'schemas'), { recursive: true });
  fs.copyFileSync(
    path.join(CONFIG_DIR, 'schemas', 'audit-log-viewer.schema.json'),
    path.join(dir, 'schemas', 'audit-log-viewer.schema.json'),
  );
  const text = fs.readFileSync(path.join(CONFIG_DIR, 'audit-log-viewer.yaml'), 'utf8');
  // حذفُ مشهدِ التسلسلِ الزمنيِّ — عارضٌ ناقصُ وجهٍ أعمى عن سؤالٍ سمّتْه الخطوة.
  const broken = text.replace(/\n {2}- id: view:timeline[\s\S]*?\n\n/, '\n');
  assert.notEqual(broken, text, 'يجب أن يُحذف مشهدُ التسلسلِ فعلاً');
  fs.writeFileSync(path.join(dir, 'audit-log-viewer.yaml'), broken);
  assert.throws(
    () => loadAuditViewerPolicy({ dir }),
    (error) =>
      error instanceof AuditViewerError && error.code === AUDIT_VIEWER_ERRORS.CONFIG_INVALID,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// المشاهد الثلاثة
// ═══════════════════════════════════════════════════════════════════════════

test('البحثُ يُعيد الصفوفَ المطابقةَ ومعها حكمُ السلامةِ في الردِّ الواحد', () => {
  const { log, file } = seededLog(6);
  const viewer = new AuditLogViewer({ log, nowMs: tickingClock() });
  const shot = viewer.search({ field: 'type', term: 'api.call', actor: 'king' });
  assert.equal(shot.face, 'search');
  assert.equal(shot.source, 'log:events');
  assert.equal(shot.rows.length, 3);
  assert.equal(shot.integrity.ok, true);
  assert.equal(shot.integrity.warned, false);
  assert.equal(typeof shot.integrity.checkedAtMs, 'number');
  assert.ok(shot.rows.every((row) => String(row['type']) === 'api.call'));
  log.close();
  assert.ok(readEntries(file).length > 6);
});

test('التسلسلُ الزمنيُّ مرتَّبٌ صعوداً ويحترم مدى الحدَّين', () => {
  const { log } = seededLog(5);
  const viewer = new AuditLogViewer({ log, nowMs: tickingClock() });
  const all = viewer.timeline();
  const seqs = all.rows.map((row) => Number(row['seq']));
  assert.deepEqual(
    seqs,
    [...seqs].sort((left, right) => left - right),
  );
  const narrowed = viewer.timeline({ from: '2999-01-01T00:00:00.000Z' });
  assert.equal(narrowed.rows.length, 0);
  assert.equal(narrowed.integrity.warned, false);
  log.close();
});

test('وجهُ السلامةِ يُعيد حكماً واحداً مفصَّلاً بأسبابِ الانكسارِ المُعلَنة', () => {
  const { log } = seededLog(3);
  const viewer = new AuditLogViewer({ log, nowMs: tickingClock() });
  const shot = viewer.integrity({ actor: 'auditor' });
  assert.equal(shot.face, 'integrity');
  assert.equal(shot.rows.length, 1);
  const row = /** @type {Record<string, unknown>} */ (shot.rows[0]);
  assert.equal(row['chainOk'], true);
  assert.deepEqual(row['declaredBreakReasons'], [
    'SEQUENCE_MISMATCH',
    'PREVIOUS_HASH_MISMATCH',
    'HASH_MISMATCH',
  ]);
  log.close();
});

test('صفوفُ المشهدِ مُجمَّدةٌ تجميداً عميقاً فلا تُعدَّل من عارضِها', () => {
  const { log } = seededLog(2);
  const viewer = new AuditLogViewer({ log, nowMs: tickingClock() });
  const shot = viewer.timeline();
  assert.ok(Object.isFrozen(shot));
  assert.ok(Object.isFrozen(shot.rows));
  assert.ok(Object.isFrozen(shot.rows[0]));
  assert.ok(Object.isFrozen(shot.integrity));
  log.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// معيار القبول: عبثٌ مُصطنعٌ يظهر تحذيرَ سلامةٍ في الواجهة
// ═══════════════════════════════════════════════════════════════════════════

test('معيارُ القبول: بايتٌ مُبدَّلٌ بعد الكتابةِ يظهر تحذيرَ سلامةٍ في نفسِ ردِّ البحث', () => {
  const { log, file } = seededLog(6);
  const viewer = new AuditLogViewer({ log, nowMs: tickingClock() });
  const before = viewer.search({ field: 'type', term: 'api.call' });
  assert.equal(before.integrity.warned, false);
  log.close();

  tamper(file, 2, (entry) => {
    entry['actor'] = 'agent:intruder';
  });

  // سجلُّ العارضِ الخاصُّ سليمٌ، والمفحوصُ هو الملفُّ المُعبَثُ به: فلو أخفى
  // العارضُ التحذيرَ لَرأى قارئُه صفوفاً نظيفةً من سلسلةٍ مكسورة.
  const witness = seededLog(1);
  const after = new AuditLogViewer({
    log: witness.log,
    logFile: file,
    nowMs: tickingClock(),
  }).search({ field: 'type', term: 'api.call' });
  assert.equal(after.integrity.warned, true, 'العبثُ يجب أن يظهر تحذيراً');
  assert.equal(after.integrity.ok, false);
  assert.equal(after.integrity.reason, 'HASH_MISMATCH');
  assert.equal(typeof after.integrity.brokenAt, 'number');
  assert.equal(after.integrity.severity, 'critical');
  // والصفوفُ تبقى مقروءةً موسومةً بتحذيرِها لا محجوبةً بصمت.
  assert.ok(after.rows.length > 0);
  witness.log.close();
});

test('التحذيرُ يُكتب في السجلِّ حدثاً باسمِه لا رسالةً تُقرأ نصّاً', () => {
  const subject = seededLog(4);
  subject.log.close();
  tamper(subject.file, 1, (entry) => {
    entry['data'] = { tampered: true };
  });

  const witness = seededLog(1);
  const viewer = new AuditLogViewer({
    log: witness.log,
    logFile: subject.file,
    nowMs: tickingClock(),
  });
  viewer.integrity({ actor: 'auditor' });
  witness.log.close();
  const types = readEntries(witness.file).map((entry) => String(entry['type']));
  assert.ok(types.includes('audit.view.read'), 'قيدُ القراءةِ يُكتب');
  assert.ok(types.includes('audit.integrity.warned'), 'التحذيرُ حدثٌ باسمِه');
  assert.ok(!types.includes('audit.integrity.verified'));
});

test('assertIntact يرمي INTEGRITY_BROKEN عند التحذيرِ ويمرّ عند السلامة', () => {
  const clean = seededLog(3);
  const viewer = new AuditLogViewer({ log: clean.log, nowMs: tickingClock() });
  const verdict = viewer.assertIntact({ actor: 'king' });
  assert.equal(verdict.warned, false);
  clean.log.close();

  const dirty = seededLog(4);
  dirty.log.close();
  const lines = fs
    .readFileSync(dirty.file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
  lines.splice(1, 1);
  fs.writeFileSync(dirty.file, `${lines.join('\n')}\n`);
  const witness = seededLog(1);
  const strict = new AuditLogViewer({
    log: witness.log,
    logFile: dirty.file,
    nowMs: tickingClock(),
  });
  assert.throws(
    () => strict.assertIntact({ actor: 'king' }),
    (error) =>
      error instanceof AuditViewerError && error.code === AUDIT_VIEWER_ERRORS.INTEGRITY_BROKEN,
  );
  witness.log.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// الرفض المُسمّى
// ═══════════════════════════════════════════════════════════════════════════

test('مشهدٌ غيرُ معلَنٍ يُرَدُّ بـ VIEW_UNDECLARED ويُكتب الرفضُ في السجل', () => {
  const { log, file } = seededLog(2);
  const viewer = new AuditLogViewer({ log, nowMs: tickingClock() });
  assert.throws(
    () => viewer.view({ view: 'view:invented', actor: 'intruder' }),
    (error) =>
      error instanceof AuditViewerError && error.code === AUDIT_VIEWER_ERRORS.VIEW_UNDECLARED,
  );
  log.close();
  const refusals = readEntries(file).filter(
    (entry) => String(entry['type']) === 'audit.view.read.refused',
  );
  assert.equal(refusals.length, 1);
});

test('بلا سجلٍّ دائمٍ لا مشهدَ: AUDIT_REQUIRED', () => {
  const viewer = new AuditLogViewer({ nowMs: tickingClock() });
  assert.throws(
    () => viewer.integrity(),
    (error) =>
      error instanceof AuditViewerError && error.code === AUDIT_VIEWER_ERRORS.AUDIT_REQUIRED,
  );
});

test('سجلٌّ بلا مسارِ ملفٍّ معروفٍ يُرَدُّ بـ SOURCE_MISSING لا بصفوفٍ فارغة', () => {
  /** @type {{ append: () => void }} */
  const blindLog = { append: () => {} };
  const viewer = new AuditLogViewer({ log: blindLog, nowMs: tickingClock() });
  assert.throws(
    () => viewer.integrity(),
    (error) =>
      error instanceof AuditViewerError && error.code === AUDIT_VIEWER_ERRORS.SOURCE_MISSING,
  );
});

test('ملفُّ سجلٍّ غائبٌ يُرَدُّ بـ LOG_UNREADABLE لا يُقرأ سلامةً بالسكوت', () => {
  const missing = path.join(tempDir(), 'absent.jsonl');
  const viewer = new AuditLogViewer({
    log: { append: () => {} },
    logFile: missing,
    nowMs: tickingClock(),
  });
  assert.throws(
    () => viewer.integrity(),
    (error) =>
      error instanceof AuditViewerError && error.code === AUDIT_VIEWER_ERRORS.LOG_UNREADABLE,
  );
});

test('حقلُ بحثٍ غيرُ معلَنٍ ومصطلحٌ فارغٌ: FIELD_UNDECLARED و TERM_INVALID', () => {
  const { log } = seededLog(2);
  const viewer = new AuditLogViewer({ log, nowMs: tickingClock() });
  assert.throws(
    () => viewer.search({ field: 'data', term: 'x' }),
    (error) =>
      error instanceof AuditViewerError && error.code === AUDIT_VIEWER_ERRORS.FIELD_UNDECLARED,
  );
  assert.throws(
    () => viewer.search({ field: 'type', term: '   ' }),
    (error) => error instanceof AuditViewerError && error.code === AUDIT_VIEWER_ERRORS.TERM_INVALID,
  );
  assert.throws(
    () => viewer.search({ field: 'type', term: 'x'.repeat(500) }),
    (error) => error instanceof AuditViewerError && error.code === AUDIT_VIEWER_ERRORS.TERM_INVALID,
  );
  log.close();
});

test('مدًى غيرُ مقروءٍ أو مقلوبٌ يُرَدُّ بـ RANGE_INVALID', () => {
  const { log } = seededLog(2);
  const viewer = new AuditLogViewer({ log, nowMs: tickingClock() });
  assert.throws(
    () => viewer.timeline({ from: 'ليس زمناً' }),
    (error) =>
      error instanceof AuditViewerError && error.code === AUDIT_VIEWER_ERRORS.RANGE_INVALID,
  );
  assert.throws(
    () => viewer.timeline({ from: '2024-05-01T00:00:00.000Z', to: '2024-01-01T00:00:00.000Z' }),
    (error) =>
      error instanceof AuditViewerError && error.code === AUDIT_VIEWER_ERRORS.RANGE_INVALID,
  );
  log.close();
});

test('فوق حدِّ الصفوفِ رفضٌ مُسمّىً لا اقتطاعٌ صامت: ROWS_EXCEEDED', () => {
  const { log } = seededLog(4);
  const viewer = new AuditLogViewer({ log, nowMs: tickingClock() });
  assert.equal(viewer.maxRows, 500);
  const dense = new AuditLogViewer({ log, nowMs: tickingClock() });
  // حدٌّ مُصغَّرٌ يُقاس بلا كتابةِ خمسمئةِ حدثٍ على القرص: الوثيقةُ هي مالكةُ الحدّ.
  const shrunk = loadAuditViewerPolicy({ dir: CONFIG_DIR });
  assert.equal(shrunk.search.maxRows, 500);
  assert.equal(dense.maxRows, 500);
  const tight = new AuditLogViewer({
    log,
    nowMs: tickingClock(),
    policy: { ...shrunk, search: { ...shrunk.search, maxRows: 1 } },
  });
  assert.throws(
    () => tight.timeline(),
    (error) =>
      error instanceof AuditViewerError && error.code === AUDIT_VIEWER_ERRORS.ROWS_EXCEEDED,
  );
  log.close();
});

test('ساعةٌ تُعطي غيرَ عددٍ منتهٍ تُرَدُّ بـ CLOCK_INVALID', () => {
  const { log } = seededLog(2);
  const viewer = new AuditLogViewer({ log, nowMs: () => Number.NaN });
  assert.throws(
    () => viewer.integrity(),
    (error) =>
      error instanceof AuditViewerError && error.code === AUDIT_VIEWER_ERRORS.CLOCK_INVALID,
  );
  log.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// الحاجز
// ═══════════════════════════════════════════════════════════════════════════

test('الحاجزُ يقبل جذرَ المستودعِ الحقيقيَّ ويرفض جذراً ناقصَ وجه', () => {
  const pass = spawnSync(process.execPath, [GUARD], { encoding: 'utf8' });
  assert.equal(pass.status, 0, `الحاجز رفض الجذر الحقيقي:\n${pass.stderr}`);
  assert.ok(pass.stdout.includes('✅'));

  const fake = tempDir();
  fs.mkdirSync(path.join(fake, 'config', 'schemas'), { recursive: true });
  fs.copyFileSync(
    path.join(CONFIG_DIR, 'schemas', 'audit-log-viewer.schema.json'),
    path.join(fake, 'config', 'schemas', 'audit-log-viewer.schema.json'),
  );
  fs.writeFileSync(path.join(fake, 'config', 'audit-log-viewer.yaml'), 'version: 1\n');
  const fail = spawnSync(process.execPath, [GUARD, '--root', fake], { encoding: 'utf8' });
  assert.equal(fail.status, 1);
  assert.ok(fail.stderr.includes('⛔'));
  assert.ok(fail.stderr.includes('R0'));
});
