// اختبارُ قبولِ `M10.06` بحرفِ معيارِه: «اختبار: نشر إصدار معيوب ⇒ تراجع
// تلقائي بلا تدخل».
//
// **ولا يُقاس هذا بنداءِ دالّةٍ في العمليّةِ نفسِها:** المنفِّذُ يُنادى
// **عمليّةً ابنةً حقيقيّةً** (‏`node scripts/deploy.mjs`)، ويُقرأ **رمزُ
// خروجِه** كما يقرؤه المسارُ الآليُّ، ثم يُقرأ **دفترُ النشرِ ومؤشِّرُه من
// القرصِ** لإثباتِ أنّ الإصدارَ السليمَ أُعيد فعلاً — فرمزُ خروجٍ وحدَه يُثبت
// أنّ النشرَ رُفض ولا يُثبت أنّ التراجعَ وقع.
//
// **وبلا تدخّلٍ** حرفاً: لا عَلَمَ يُمرَّر للتراجع، ولا نداءَ ثانٍ، ولا مُدخلَ
// على المدخلِ القياسيّ — نداءٌ واحدٌ فقط، وما بعده يقع من تلقائه.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadDeploymentContract } from '../../src/deployment/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DEPLOY_SCRIPT = path.join(ROOT, 'scripts/deploy.mjs');

const contract = loadDeploymentContract();

/**
 * مجسُّ إصدارٍ: يطبع مشاهداتِ كلِّ هدفٍ مُعلَنٍ في بواباتِ العقد.
 *
 * @param {{ total: number, bad: number }} reading
 * @returns {string}
 */
function probeSource(reading) {
  const objectives = [...new Set(contract.waves.flatMap((wave) => wave.objectives))];
  const payload = Object.fromEntries(objectives.map((id) => [id, reading]));
  return `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(payload))});\n`;
}

/**
 * مصدرُ إصدارٍ على القرصِ بمجسِّه.
 *
 * @param {string} root
 * @param {string} name
 * @param {{ total: number, bad: number }} reading
 * @returns {string}
 */
function makeSource(root, name, reading) {
  const dir = path.join(root, 'sources', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, contract.release.probeFile), probeSource(reading), 'utf8');
  fs.writeFileSync(path.join(dir, 'app.txt'), `محتوى الإصدار ${name}\n`, 'utf8');
  return dir;
}

/**
 * نداءُ المنفِّذِ عمليّةً ابنةً — نداءٌ واحدٌ بلا تدخّلٍ بعده.
 *
 * @param {string[]} args
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runDeploy(args) {
  const outcome = spawnSync(process.execPath, [DEPLOY_SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 120000,
    shell: false,
  });
  return {
    status: outcome.status,
    stdout: String(outcome.stdout ?? ''),
    stderr: String(outcome.stderr ?? ''),
  };
}

/**
 * @param {string} root
 * @returns {Record<string, unknown>[]}
 */
function readLedgerFile(root) {
  const file = path.resolve(root, contract.ledger.path);
  if (!fs.existsSync(file)) return [];
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
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** @returns {string} */
function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-acceptance-'));
}

/**
 * @param {string} verdictId
 * @returns {number}
 */
function exitCodeOf(verdictId) {
  const verdict = contract.verdicts.find((entry) => entry.id === verdictId);
  assert.ok(verdict !== undefined, `الحكم ${verdictId} غيرُ معلَنٍ في العقد`);
  return verdict.exitCode;
}

test('معيارُ القبول: نشرُ إصدارٍ معيوبٍ ⇒ تراجعٌ تلقائيٌّ بلا تدخّل', () => {
  const root = makeRoot();
  try {
    // ١ — إصدارٌ سليمٌ يُنشَر على الموجاتِ كلِّها ويصير هو الإصدارَ النشط.
    const healthy = runDeploy([
      '--release',
      '1.0.0',
      '--source',
      makeSource(root, 'healthy', { total: 500, bad: 0 }),
      '--root',
      root,
      '--json',
    ]);
    assert.equal(healthy.status, exitCodeOf('verdict:healthy'), healthy.stderr);
    assert.equal(readPointerFile(root)?.release, '1.0.0');
    assert.ok(
      readLedgerFile(root).some((entry) => entry.type === 'deploy.release.activated'),
      'الإصدارُ السليمُ لم يُسجَّل نشطاً في الدفتر',
    );

    // ٢ — إصدارٌ معيوبٌ: نداءٌ **واحدٌ** ولا شيءَ بعده.
    const faulty = runDeploy([
      '--release',
      '1.1.0',
      '--source',
      makeSource(root, 'faulty', { total: 500, bad: 250 }),
      '--root',
      root,
      '--json',
    ]);

    // ٣ — رمزُ الخروجِ حكمُ العطبِ المُعلَنُ في العقد، لا صفرٌ ولا رمزٌ عامّ.
    assert.equal(faulty.status, exitCodeOf('verdict:broken'), faulty.stdout + faulty.stderr);

    // ٤ — والتراجعُ وقع فعلاً: الواقعةُ مكتوبةٌ في الدفترِ بمدّةٍ مقيسة.
    const ledger = readLedgerFile(root);
    const rollback = ledger.find((entry) => entry.type === 'deploy.rollback.performed');
    assert.ok(rollback !== undefined, 'لا واقعةَ تراجعٍ في الدفتر — والرمزُ وحدَه لا يُثبت الفعل');
    assert.equal(rollback.release, '1.0.0');
    assert.equal(rollback.from, '1.1.0');
    assert.equal(rollback.automatic, true);
    assert.equal(typeof rollback.durationMs, 'number');
    assert.equal(rollback.withinLimit, true);

    // ٥ — والمؤشِّرُ عاد إلى الإصدارِ السليمِ السابقِ على الحِمل كلِّه.
    const pointer = readPointerFile(root);
    assert.equal(pointer?.release, '1.0.0');
    assert.equal(pointer?.sharePercent, 100);

    // ٦ — ولم يُنشَّط الإصدارُ المعيوبُ في أيِّ لحظةٍ على الحِمل كلِّه.
    assert.ok(
      !ledger.some(
        (entry) => entry.type === 'deploy.release.activated' && entry.release === '1.1.0',
      ),
      'الإصدارُ المعيوبُ سُجِّل نشطاً — والبوابةُ لم تمنع اتّساعَ النصيب',
    );

    // ٧ — والموجةُ الأولى هي التي رُدَّت: لا تتّسع الموجاتُ على عطبٍ مقيس.
    const refused = ledger.find((entry) => entry.type === 'deploy.wave.refused');
    assert.ok(refused !== undefined);
    assert.equal(refused.wave, contract.waves[0]?.id);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('موجةٌ بلا قياسٍ كافٍ تُردّ بحكمِها المستقلِّ ويقع التراجعُ كذلك', () => {
  const root = makeRoot();
  try {
    const healthy = runDeploy([
      '--release',
      '2.0.0',
      '--source',
      makeSource(root, 'healthy', { total: 500, bad: 0 }),
      '--root',
      root,
      '--json',
    ]);
    assert.equal(healthy.status, 0, healthy.stderr);

    const silent = runDeploy([
      '--release',
      '2.1.0',
      '--source',
      makeSource(root, 'silent', { total: 1, bad: 0 }),
      '--root',
      root,
      '--json',
    ]);
    assert.equal(silent.status, exitCodeOf('verdict:unmeasured'), silent.stdout + silent.stderr);
    assert.equal(readPointerFile(root)?.release, '2.0.0');
    assert.ok(readLedgerFile(root).some((entry) => entry.type === 'deploy.rollback.performed'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('نشرٌ أوّلُ بلا سابقٍ سليمٍ يُردّ ولا يُنشِّط ما يُظَنّ سليماً', () => {
  const root = makeRoot();
  try {
    const faulty = runDeploy([
      '--release',
      '3.0.0',
      '--source',
      makeSource(root, 'faulty', { total: 500, bad: 250 }),
      '--root',
      root,
      '--json',
    ]);
    assert.notEqual(faulty.status, 0);
    assert.ok(
      faulty.stderr.includes('DEPLOY_ROLLBACK_TARGET_MISSING') ||
        faulty.stderr.includes('لا إصدارَ سابقٌ'),
      `الردُّ لم يُسمِّ سببَه: ${faulty.stderr.slice(0, 400)}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('‏--dry-run يُعلن الموجاتِ وبواباتِها ولا يكتب سطراً في دفتر', () => {
  const root = makeRoot();
  try {
    const dry = runDeploy(['--dry-run', '--json', '--root', root]);
    assert.equal(dry.status, 0, dry.stderr);
    const report = JSON.parse(dry.stdout);
    assert.equal(report.dryRun, true);
    assert.equal(report.waves.length, contract.waves.length);
    assert.equal(readLedgerFile(root).length, 0);
    assert.equal(readPointerFile(root), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
