// اختبارُ حاجزِ المشهدِ المُعمَّمِ — سدادُ الدَينِ `D-10`.
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const GUARD = path.join(ROOT, 'scripts/guard-state-scene.mjs');

/**
 * @param {string} guardPath
 * @param {string | undefined} [root]
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runGuard(guardPath, root = undefined) {
  const args = root !== undefined ? [guardPath, '--root', root] : [guardPath];
  const outcome = spawnSync(process.execPath, args, { encoding: 'utf8', shell: false });
  return {
    status: outcome.status,
    stdout: String(outcome.stdout ?? ''),
    stderr: String(outcome.stderr ?? ''),
  };
}

/**
 * نسخةٌ مؤقّتةٌ من الملفّاتِ التي يقرؤها الحاجزُ — يُخَلُّ فيها بشيءٍ واحدٌ ثم
 * يُقاس رفضُه، ولا تُمَسُّ الشجرةُ الحقيقيّة.
 *
 * @returns {string}
 */
function cloneTree() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-state-scene-'));

  // الملفّاتُ التي يقرؤها الحاجزُ مباشرةً.
  const files = [
    'scripts/guard-state-scene.mjs',
    'src/persistence/composition.mjs',
    'src/transport/server.mjs',
    'scripts/serve-state.mjs',
    'tests/tooling/guard-state-scene.test.mjs',
  ];

  // وكلُّ ملفّاتِ أسطحِ القرّاءِ.
  for (const dir of [
    'src/api',
    'src/transport',
    'src/operations',
    'src/console',
    'src/crisis',
    'src/audit-viewer',
  ]) {
    const fullDir = path.join(ROOT, dir);
    if (fs.existsSync(fullDir)) {
      for (const f of fs.readdirSync(fullDir)) {
        if (f.endsWith('.mjs') && !f.endsWith('.test.mjs')) {
          files.push(path.join(dir, f));
        }
      }
    }
  }

  for (const relative of files) {
    const from = path.join(ROOT, relative);
    const to = path.join(target, relative);
    if (fs.existsSync(from)) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }

  return target;
}

test('الحاجزُ يُصدِّق الحالةَ القائمةَ', () => {
  const outcome = runGuard(GUARD);
  assert.equal(outcome.status, 0, `الحاجزُ رفض الحالةَ القائمةَ: ${outcome.stderr}`);
  assert.match(outcome.stdout, /حاجز المشهد المعمم/u);
});

test('R1: قارئٌ يستوردُ مصانعَ المستودعاتِ يُرَدُّ', () => {
  const tree = cloneTree();
  // نَحقِنُ ملفّاً في سطحِ قراءةٍ يَستوردُ مصنعاً.
  const bypass = path.join(tree, 'src/transport', 'bypass.mjs');
  fs.writeFileSync(
    bypass,
    `import { createMemoryRepositories } from '../persistence/index.mjs';\nexport const x = createMemoryRepositories;\n`,
    'utf8',
  );
  const outcome = runGuard(path.join(tree, 'scripts/guard-state-scene.mjs'));
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /R1/u);
});

test('R1: قارئٌ يستوردُ MonitorAgent يُرَدُّ', () => {
  const tree = cloneTree();
  const bypass = path.join(tree, 'src/operations', 'bypass.mjs');
  fs.writeFileSync(
    bypass,
    `import { MonitorAgent } from '../observability/index.mjs';\nexport const x = MonitorAgent;\n`,
    'utf8',
  );
  const outcome = runGuard(path.join(tree, 'scripts/guard-state-scene.mjs'));
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /R1/u);
});

test('R2: بوابةٌ بلا مشهدٍ في جذرِ التركيبِ تُرَدُّ', () => {
  const tree = cloneTree();
  const comp = path.join(tree, 'src/persistence/composition.mjs');
  fs.writeFileSync(
    comp,
    fs.readFileSync(comp, 'utf8').replace(/monitor\s*,/, 'removedScene,'),
    'utf8',
  );
  const outcome = runGuard(path.join(tree, 'scripts/guard-state-scene.mjs'), tree);
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /R2/u);
});

test('R3: مركزُ عملياتٍ بلا بوابةٍ في جذرِ التركيبِ يُرَدُّ', () => {
  const tree = cloneTree();
  const comp = path.join(tree, 'src/persistence/composition.mjs');
  fs.writeFileSync(
    comp,
    fs.readFileSync(comp, 'utf8').replace(/gateway:\s*api/, 'gateway: removedGateway'),
    'utf8',
  );
  const outcome = runGuard(path.join(tree, 'scripts/guard-state-scene.mjs'), tree);
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /R3/u);
});
