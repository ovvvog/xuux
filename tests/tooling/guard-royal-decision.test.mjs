// حاجزُ حزمةِ القرارِ الملكيِّ — اختبارُ أنَّ الحاجزَ **يرفضُ فعلاً** لا أنه موجودٌ.
//
// المشكلةُ التي يحلُّها: حاجزٌ يمرُّ دائماً حاجزٌ اسمُه فقط. فهنا تُصنَع حالاتُ
// خرقٍ في جذرٍ مؤقّتٍ — قرارٌ موقَّعٌ، خيارٌ محذوفٌ، مرحلةٌ بلا معيارِ تراجعٍ،
// وثيقةٌ منزاحةٌ — ويُقاس رمزُ خروجِ الحاجزِ عليها.
//
// وما لا يفعلُه: لا يحكمُ على صوابِ القرارِ — الحاجزُ نفسُه لا يحكمُ فيه.
//
// التشغيل: node --test tests/tooling/guard-royal-decision.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GUARD = 'scripts/guard-royal-decision.mjs';

/**
 * @returns {string}
 */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'guard-royal-'));
  for (const entry of ['config', 'docs', 'scripts', 'src', 'tests', 'package.json']) {
    cpSync(join(ROOT, entry), join(root, entry), { recursive: true });
  }
  cpSync(join(ROOT, '.github'), join(root, '.github'), { recursive: true });
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'), 'dir');
  return root;
}

/**
 * @param {string} root
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runGuard(root) {
  const result = spawnSync(process.execPath, [join(root, GUARD)], { cwd: root, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test('الحاجزُ يمرُّ على المستودعِ كما هو — ويُصرِّحُ أنَّ مرورَه ليس قراراً', () => {
  const result = runGuard(ROOT);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ليس قراراً/);
  assert.match(result.stdout, /M11\.09` تبقى ⬜/);
});

test('توقيعٌ موضوعٌ في الحزمةِ يُسقِطُ الحاجزَ (R1)', () => {
  const root = sandbox();
  const file = join(root, 'config/royal-decision.yaml');
  writeFileSync(file, readFileSync(file, 'utf8').replace('signature: null', 'signature: AAAA'));
  const result = runGuard(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /R0|SELF_SIGNED|CONFIG_INVALID/);
});

test('حذفُ خيارِ الرفضِ يُسقِطُ الحاجزَ — فحزمةٌ بخيارَينِ تُرجِّحُ ثالثاً بصمتِها (R4)', () => {
  const root = sandbox();
  const file = join(root, 'config/royal-decision.yaml');
  const text = readFileSync(file, 'utf8');
  const cut = text.indexOf('  - id: reject');
  const end = text.indexOf('signatureRequirement:');
  writeFileSync(file, `${text.slice(0, cut)}${text.slice(end)}`);
  const result = runGuard(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /R0|OPTION_INCOMPLETE|CONFIG_INVALID/);
});

test('مرحلةٌ بلا معيارِ تراجعٍ تُسقِطُ الحاجزَ (R5)', () => {
  const root = sandbox();
  const file = join(root, 'config/royal-decision.yaml');
  const text = readFileSync(file, 'utf8').replace(
    / {6}rollbackCriteria:\n {8}- حادثٌ واحدٌ من الدرجةِ الأولى\.\n/,
    '      rollbackCriteria: []\n',
  );
  writeFileSync(file, text);
  const result = runGuard(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /R0|R5|CONFIG_INVALID/);
});

test('لفظُ اعتمادٍ في الوثيقةِ يُسقِطُ الحاجزَ (R6)', () => {
  const root = sandbox();
  const file = join(root, 'docs/ROYAL_DECISION_PACKET.md');
  writeFileSync(file, `${readFileSync(file, 'utf8')}\nAPPROVED\n`);
  const result = runGuard(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /R6|R7/);
});

test('فكُّ ربطِ الحاجزِ من سلسلةِ التحقّقِ يُسقِطُه (R7)', () => {
  const root = sandbox();
  const file = join(root, 'package.json');
  writeFileSync(file, readFileSync(file, 'utf8').replace(' && npm run guard:royal-decision', ''));
  const result = runGuard(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /R7/);
});
