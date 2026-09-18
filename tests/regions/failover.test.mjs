// اختبارُ قبولِ `M10.07` بحرفِ معيارِه: «اختبار: إسقاط إقليم كامل ⇒ استمرار
// الخدمة بأثر معلَن ومقبول».
//
// **ولا يُقاس هذا بنداءِ دالّةٍ في العمليّةِ نفسِها:** المنفِّذُ يُنادى
// **عمليّةً ابنةً حقيقيّةً** (‏`node scripts/region-drill.mjs`)، ويُقرأ **رمزُ
// خروجِه** كما يقرؤه المسارُ الآليُّ، ثم يُقرأ **دفترُ الأقاليمِ ومؤشِّرُ كاتبِه
// من القرصِ** لإثباتِ أنّ كاتباً جديداً نُصِّب فعلاً وقُبِلت فيه كتابة — فرمزُ
// خروجٍ وحدَه يُثبت أنّ التمرينَ لم يُرفَض ولا يُثبت أنّ الخدمةَ استمرّت.
//
// **وبلا تدخّلٍ** حرفاً: لا عَلَمَ يُمرَّر للتنصيب، ولا نداءَ ثانٍ، ولا مُدخلَ
// على المدخلِ القياسيّ — نداءٌ واحدٌ فقط، وما بعده يقع من تلقائه.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import { loadRegionsContract } from '../../src/regions/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DRILL_SCRIPT = path.join(ROOT, 'scripts/region-drill.mjs');

const contract = loadRegionsContract();
const WRITER = contract.regions.find((region) => region.role === 'writer');
assert.ok(WRITER !== undefined, 'العقدُ بلا كاتبٍ معلَنٍ فلا يُقاس عليه تمرين');

/** @returns {string} */
function makeRoot() {
  return registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'region-drill-')));
}

/**
 * نداءُ منفِّذِ التمرينِ عمليّةً ابنةً حقيقيّةً وقراءةُ رمزِ خروجِه ومخرَجِه.
 *
 * @param {string[]} args
 * @returns {{ status: number | null, report: Record<string, unknown>, stderr: string }}
 */
function runDrill(args) {
  const outcome = spawnSync(process.execPath, [DRILL_SCRIPT, '--json', ...args], {
    encoding: 'utf8',
    shell: false,
  });
  /** @type {Record<string, unknown>} */
  let report;
  try {
    report = JSON.parse(String(outcome.stdout ?? ''));
  } catch {
    report = {};
  }
  return { status: outcome.status, report, stderr: String(outcome.stderr ?? '') };
}

/**
 * @param {string} root
 * @returns {Array<Record<string, unknown>>}
 */
function readLedgerFile(root) {
  const file = path.resolve(root, contract.ledger.path);
  if (!fs.existsSync(file)) {
    return [];
  }
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

/**
 * @param {string} root
 * @returns {Record<string, unknown> | null}
 */
function readPointerFile(root) {
  const file = path.resolve(root, contract.ledger.pointerPath);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

test('إسقاطُ إقليمِ الكاتبِ كاملاً ⇒ استمرارُ الخدمةِ بأثرٍ معلَنٍ ومقبولٍ بلا تدخّل', () => {
  const root = makeRoot();
  const { status, report } = runDrill(['--drop', WRITER.id, '--root', root]);

  assert.equal(status, 0, 'رمزُ خروجِ التمرينِ ليس صفراً — والمسارُ الآليُّ يقرأ الرمز');
  assert.equal(report.verdict, 'health:up');

  // ‏(1) الكاتبُ الجديدُ نُصِّب آلياً — لا بعَلَمٍ ولا بنداءٍ ثانٍ.
  const failover = /** @type {Record<string, unknown>} */ (report.failover);
  assert.equal(failover.from, WRITER.id);
  assert.notEqual(failover.to, WRITER.id);
  assert.equal(failover.automatic, true);

  // ‏(2) الخدمةُ استمرّت فعلاً: كتابةٌ قُبِلت في الكاتبِ الجديدِ بعد السقوط.
  assert.ok(Number(failover.records) >= 1);
  const pointer = readPointerFile(root);
  assert.ok(pointer !== null);
  assert.equal(pointer.writer, failover.to);
  assert.equal(pointer.automatic, true);
  const promoted = /** @type {string} */ (failover.to);
  const replica = path.resolve(
    root,
    /** @type {string} */ (
      contract.regions.find((region) => region.id === promoted)?.statePath ?? ''
    ),
    'replica.json',
  );
  assert.ok(fs.existsSync(replica), 'الكاتبُ الجديدُ بلا نسخةٍ على القرص');
  assert.ok(
    JSON.parse(fs.readFileSync(replica, 'utf8')).records.some(
      (/** @type {{ record: string }} */ entry) => entry.record === 'post-failover',
    ),
    'لا كتابةَ مقبولةً بعد التنصيب — ورمزُ خروجٍ وحدَه لا يُثبت استمراريّة',
  );

  // ‏(3) الإقليمُ المُسقَطُ سقط سقوطاً حقيقيّاً لا معلَناً في تقرير.
  const droppedPath = path.resolve(root, WRITER.statePath);
  assert.equal(fs.existsSync(droppedPath), false, 'جذرُ حالةِ الإقليمِ المُسقَطِ ما زال قائماً');

  // ‏(4) الأثرُ مقيسٌ بالرقمِ ومحاسَبٌ على عهدٍ معلَنٍ في العقد.
  const impact = /** @type {Record<string, unknown>} */ (report.impact);
  assert.equal(impact.withinBudget, true);
  assert.equal(impact.breach, null);
  assert.equal(impact.maxUnavailableMs, contract.impact.maxUnavailableMs);
  assert.equal(impact.maxDataLossMs, contract.consistency.maxReplicationLagMs);
  assert.ok(Number(impact.unavailableMs) <= contract.impact.maxUnavailableMs);
  assert.ok(Number(impact.dataLossWindowMs) <= contract.consistency.maxReplicationLagMs);

  // ‏(5) الدفترُ يحمل واقعةَ التنصيبِ الآليِّ وواقعةَ إتمامِ التمرين.
  const ledger = readLedgerFile(root);
  const performed = ledger.find((entry) => entry.type === 'region.failover.performed');
  assert.ok(performed !== undefined, 'لا واقعةَ region.failover.performed في الدفتر');
  assert.equal(performed.automatic, true);
  assert.equal(performed.from, WRITER.id);
  assert.equal(performed.to, failover.to);
  assert.ok(ledger.some((entry) => entry.type === 'region.dropped'));
  assert.ok(ledger.some((entry) => entry.type === 'region.drill.completed'));
  assert.equal(
    ledger.some((entry) => entry.type === 'region.failover.refused'),
    false,
  );
});

test('إسقاطُ قارئٍ لا يُنصِّب كاتباً ولا يقطع الكتابة', () => {
  const root = makeRoot();
  const reader = contract.regions.find((region) => region.role === 'reader');
  assert.ok(reader !== undefined);
  const { status, report } = runDrill(['--drop', reader.id, '--root', root]);
  assert.equal(status, 0);
  assert.equal(report.reason, 'reader-dropped');
  assert.equal(report.failover, null);
  assert.equal(readPointerFile(root)?.writer, WRITER.id);
  assert.equal(
    readLedgerFile(root).some((entry) => entry.type === 'region.failover.performed'),
    false,
  );
});

test('تأخّرُ نسخٍ يتجاوز عهدَ الاتساقِ ⇒ رفضٌ برمزِ health:down لا تنصيبُ نسخةٍ بائتة', () => {
  const root = makeRoot();
  const { status, report } = runDrill([
    '--drop',
    WRITER.id,
    '--root',
    root,
    '--lag',
    String(contract.consistency.maxReplicationLagMs + 1_000),
  ]);
  const downCode = contract.health.find((verdict) => verdict.id === 'health:down')?.exitCode;
  assert.equal(status, downCode);
  assert.equal(report.verdict, 'health:down');
  assert.equal(report.reason, 'REGION_QUORUM_LOST');
  assert.equal(
    readLedgerFile(root).some((entry) => entry.type === 'region.failover.performed'),
    false,
  );
});

test('إقليمٌ لا يُقرأ قياسُه ⇒ رمزُ health:unmeasured — فمن لم يُقَس لا يُقال إنه سليم', () => {
  const root = makeRoot();
  const seeded = runDrill(['--drop', WRITER.id, '--root', root]);
  assert.equal(seeded.status, 0);
  const promoted = /** @type {string} */ (
    /** @type {Record<string, unknown>} */ (seeded.report.failover).to
  );
  const replica = path.resolve(
    root,
    /** @type {string} */ (
      contract.regions.find((region) => region.id === promoted)?.statePath ?? ''
    ),
    'replica.json',
  );
  fs.writeFileSync(replica, 'ليست وثيقةً تُقرأ', 'utf8');
  const { status, report } = runDrill(['--drop', promoted, '--root', root, '--no-seed']);
  const unmeasuredCode = contract.health.find(
    (verdict) => verdict.id === 'health:unmeasured',
  )?.exitCode;
  assert.equal(status, unmeasuredCode);
  assert.equal(report.verdict, 'health:unmeasured');
  assert.equal(report.reason, 'REGION_OBSERVATION_INVALID');
});

test('إقليمٌ غيرُ معلَنٍ لا يُسقَط — ولا يُسقَط ما ليس في العقد', () => {
  const root = makeRoot();
  const { status, report } = runDrill(['--drop', 'region:nowhere', '--root', root]);
  const downCode = contract.health.find((verdict) => verdict.id === 'health:down')?.exitCode;
  assert.equal(status, downCode);
  assert.equal(report.reason, 'REGION_UNDECLARED');
});
