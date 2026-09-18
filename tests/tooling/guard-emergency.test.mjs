// اختبارُ حاجزِ عقدِ تمرينِ الطوارئ — البوابةُ الخامسةُ والأربعون (`M11.07`).
//
// **الحاجزُ يُنادى عمليّةً ابنةً كما يُناديه المسارُ الآليُّ**، ويُقاس فيه ما
// يُقاس في كلِّ حاجزٍ: أنّه يُصدِّق الحالةَ القائمةَ، وأنّه **يرفض فعلاً** عند
// إخلالٍ مُصطنَعٍ في نسخةٍ مؤقّتةٍ من الشجرةِ — فحاجزٌ لم يُرَ رافضاً مرّةً واحدةً
// حاجزٌ لا يُعرَف أيرفض أصلاً.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const GUARD = path.join(ROOT, 'scripts/guard-emergency.mjs');

/**
 * @param {string} guardPath
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runGuard(guardPath) {
  const outcome = spawnSync(process.execPath, [guardPath], { encoding: 'utf8', shell: false });
  return {
    status: outcome.status,
    stdout: String(outcome.stdout ?? ''),
    stderr: String(outcome.stderr ?? ''),
  };
}

/**
 * نسخةٌ مؤقّتةٌ من الملفّاتِ التي يقرؤها الحاجزُ — يُخَلُّ فيها بشيءٍ واحدٍ ثم
 * يُقاس رفضُه، ولا تُمَسُّ الشجرةُ الحقيقيّة.
 *
 * @returns {string}
 */
function cloneTree() {
  const target = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-emergency-')));
  for (const relative of [
    'config/emergency-drill.yaml',
    'config/schemas/emergency-drill.schema.json',
    'src/emergency/errors.mjs',
    'src/emergency/contract.mjs',
    'src/emergency/phase-plan.mjs',
    'src/emergency/judgement.mjs',
    'src/emergency/index.mjs',
    'scripts/guard-emergency.mjs',
    'scripts/emergency-drill.mjs',
    'scripts/lib/emergency-facts.mjs',
    'docs/EMERGENCY_DRILL.md',
    'tests/emergency/drill.test.mjs',
    'package.json',
    '.github/workflows/ci.yml',
  ]) {
    const from = path.join(ROOT, relative);
    const to = path.join(target, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  // الوحداتُ تستورد `ajv` و`yaml`، فتُربَط حزمُ الشجرةِ الحقيقيّةِ بلا نسخِها.
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(target, 'node_modules'), 'dir');
  return target;
}

test('الحاجزُ يُصدِّق الحالةَ القائمةَ ويُعلن ما قاسه بالأرقام', () => {
  const outcome = runGuard(GUARD);
  assert.equal(outcome.status, 0, `الحاجزُ رفض الحالةَ القائمةَ: ${outcome.stderr}`);
  assert.match(outcome.stdout, /حاجز عقد تمرين الطوارئ الكامل/u);
  assert.match(outcome.stdout, /180000/u);
});

test('R1: طورٌ غيرُ موثَّقٍ بالاسمِ في الوثيقةِ يُرَدُّ — ولا عملَ بلا توثيقٍ', () => {
  const tree = cloneTree();
  const doc = path.join(tree, 'docs/EMERGENCY_DRILL.md');
  fs.writeFileSync(
    doc,
    fs.readFileSync(doc, 'utf8').replaceAll('phase:quarantine', 'طورُ الحجْرِ'),
    'utf8',
  );
  const outcome = runGuard(path.join(tree, 'scripts/guard-emergency.mjs'));
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /R1/u);
});

test('R3: ضمانٌ لا يُشار إليه نصّاً في ملفِّ إنفاذِه يُرَدُّ', () => {
  const tree = cloneTree();
  const enforcing = path.join(tree, 'src/emergency/phase-plan.mjs');
  fs.writeFileSync(
    enforcing,
    fs
      .readFileSync(enforcing, 'utf8')
      .replaceAll('G-EMERGENCY-PHASES-ORDERED', 'ضمانُ ترتيبِ الأطوارِ'),
    'utf8',
  );
  const outcome = runGuard(path.join(tree, 'scripts/guard-emergency.mjs'));
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /R3/u);
});

test('R4: عهدُ زمنٍ غيرُ مكتوبٍ بالرقمِ في الوثيقةِ يُرَدُّ', () => {
  const tree = cloneTree();
  const doc = path.join(tree, 'docs/EMERGENCY_DRILL.md');
  fs.writeFileSync(doc, fs.readFileSync(doc, 'utf8').replaceAll('180000', 'ثلاثُ دقائقَ'), 'utf8');
  const outcome = runGuard(path.join(tree, 'scripts/guard-emergency.mjs'));
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /R4/u);
});

test('R7: وحدةُ حكمٍ تستورد القرصَ يُرَدُّ نقاؤها — والفصلُ بنيةٌ لا نيّة', () => {
  const tree = cloneTree();
  const judgement = path.join(tree, 'src/emergency/judgement.mjs');
  fs.writeFileSync(
    judgement,
    `import fs from 'node:fs';\n${fs.readFileSync(judgement, 'utf8')}`,
    'utf8',
  );
  const outcome = runGuard(path.join(tree, 'scripts/guard-emergency.mjs'));
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /R7/u);
});

test('R9: عَلَمُ تخطٍّ في المنفِّذِ يُرَدُّ — وصفرُ خطوةٍ يدويّةٍ لا يُنقَض بعلَم', () => {
  const tree = cloneTree();
  const drill = path.join(tree, 'scripts/emergency-drill.mjs');
  fs.writeFileSync(
    drill,
    `${fs.readFileSync(drill, 'utf8')}\n// افتراضٌ مُصطنَعٌ للاختبار: force-pass\n`,
    'utf8',
  );
  const outcome = runGuard(path.join(tree, 'scripts/guard-emergency.mjs'));
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /R9/u);
});

test('R8: حاجزٌ غيرُ مربوطٍ في مسارِ CI يُرَدُّ — والأخضرُ المحليُّ ليس حكماً', () => {
  const tree = cloneTree();
  const workflow = path.join(tree, '.github/workflows/ci.yml');
  fs.writeFileSync(
    workflow,
    fs.readFileSync(workflow, 'utf8').replaceAll('npm run guard:emergency', 'npm run noop'),
    'utf8',
  );
  const outcome = runGuard(path.join(tree, 'scripts/guard-emergency.mjs'));
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /R8/u);
});
