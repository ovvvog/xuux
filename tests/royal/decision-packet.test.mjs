// حزمةُ القرارِ الملكيِّ — إنفاذُ أنها **مُدخلٌ لقرارٍ لم يصدرْ** (تجهيزُ `M11.09`).
//
// المشكلةُ التي يحلُّها هذا الاختبارُ: حزمةٌ يُجهِّزُها المنفِّذُ لقرارٍ سياديٍّ هي
// أقربُ ملفٍّ في المستودعِ إلى انتحالِ سلطةٍ؛ يكفي حرفٌ في `decision` أو سطرٌ يقول
// «مُعتمَدٌ» حتى تُقرأَ الوثيقةُ قراراً لم يصدرْ، فتُغلَقَ خطوةٌ لم تُنجَزْ. فالمنعُ
// هنا **شيءٌ يفشلُ** لا نيّةٌ حسنةٌ.
//
// وما لا يفعلُه: لا يحكمُ على صوابِ القرارِ ولا على كفايةِ أدلّتِه — ذاك للمالكِ.
//
// التشغيل: node --test tests/royal/decision-packet.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadRoyalDecisionPacket,
  assertUnsigned,
  assertStepOpen,
  OWNER_ONLY_FIELDS,
  PREPARED_VERDICT,
} from '../../src/royal-decision/contract.mjs';
import { ROYAL_DECISION_ERRORS, RoyalDecisionError } from '../../src/royal-decision/errors.mjs';
import { renderRoyalDecisionPacket } from '../../src/royal-decision/render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GENERATOR = 'scripts/royal-decision-packet.mjs';
const DOC = 'docs/ROYAL_DECISION_PACKET.md';

/**
 * ينسخُ ما يكفي لتشغيلِ المولِّدِ في جذرٍ مؤقّتٍ، كي تُقاسَ الحالاتُ المرفوضةُ بلا
 * تعديلِ المستودعِ نفسِه.
 * @returns {string}
 */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'royal-decision-'));
  for (const entry of ['config', 'docs', 'scripts', 'src', 'package.json']) {
    cpSync(join(ROOT, entry), join(root, entry), { recursive: true });
  }
  // التبعيّاتُ تُوصَل وصلاً لا نسخاً: نسخُ `node_modules` يجعل الاختبارَ ثقيلاً بلا فائدةٍ.
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'), 'dir');
  return root;
}

/**
 * @param {string} root
 * @param {string[]} args
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runGenerator(root, args = []) {
  const result = spawnSync(process.execPath, [join(root, GENERATOR), '--root', root, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test('الأمرُ الواحدُ يُجهِّزُ الحزمةَ ويخرجُ صفراً بحكمِ «مُجهَّزةٌ» وحدَه', () => {
  const result = runGenerator(ROOT, ['--json']);
  assert.equal(result.status, 0);
  const verdict = /** @type {{ verdict: string, drift: boolean }} */ (JSON.parse(result.stdout));
  assert.equal(verdict.verdict, PREPARED_VERDICT);
  assert.equal(verdict.drift, false, 'الوثيقةُ المُقيَّدةُ منزاحةٌ عن العقدِ');
});

test('قرارٌ مكتوبٌ في حزمةِ تجهيزٍ يُرَدُّ برمزِ انتحالٍ (85) لا بنجاحٍ', () => {
  const root = sandbox();
  const file = join(root, 'config/royal-decision.yaml');
  writeFileSync(file, readFileSync(file, 'utf8').replace('decision: null', 'decision: approve'));
  const result = runGenerator(root);
  assert.equal(result.status, 85);
  assert.match(result.stderr, /ROYAL_DECISION_SELF_SIGNED/);
});

test('توقيعٌ موضوعٌ نيابةً عن المالكِ يُرَدُّ — والحقولُ الخمسةُ كلُّها محروسةٌ', () => {
  for (const field of OWNER_ONLY_FIELDS) {
    assert.throws(
      () =>
        assertUnsigned({
          ...Object.fromEntries(OWNER_ONLY_FIELDS.map((f) => [f, null])),
          [field]: 'x',
        }),
      (error) =>
        error instanceof RoyalDecisionError && error.code === ROYAL_DECISION_ERRORS.SELF_SIGNED,
      `الحقلُ «${field}» غيرُ محروسٍ`,
    );
  }
});

test('تجهيزُ الحزمةِ لا يُغلِقُ الخطوةَ: صفُّ `M11.09` يجبُ أن يبقى ⬜', () => {
  assertStepOpen({ root: ROOT });
  const root = sandbox();
  const roadmapFile = join(root, 'docs/roadmap/03-roadmap-to-100.md');
  const roadmap = readFileSync(roadmapFile, 'utf8');
  const row = roadmap.split('\n').find((line) => line.includes('| M11.09 |'));
  assert.ok(row !== undefined);
  writeFileSync(roadmapFile, roadmap.replace(row, row.replace(/⬜ \|$/, '✅ |')));
  const result = runGenerator(root);
  assert.equal(result.status, 85);
  assert.match(result.stderr, /ROYAL_DECISION_STEP_CLOSED/);
});

test('شرطٌ سابقٌ غيرُ معلَنٍ مؤجَّلاً يُرَدُّ — فلا يُقرأُ استيفاءً ضمنياً', () => {
  const root = sandbox();
  const file = join(root, 'config/readiness-deferrals.yaml');
  writeFileSync(file, readFileSync(file, 'utf8').replace('  - id: M11.05', '  - id: M11.55'));
  const result = runGenerator(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ROYAL_DECISION_PRECONDITION_UNDECLARED|READINESS_/);
});

test('الوثيقةُ مولَّدةٌ من العقدِ: انزياحُها يُرَدُّ نقصاً (84) لا يُقرأُ نجاحاً', () => {
  const root = sandbox();
  const file = join(root, DOC);
  writeFileSync(file, `${readFileSync(file, 'utf8')}\nسطرٌ مُدسوسٌ\n`);
  const result = runGenerator(root);
  assert.equal(result.status, 84);
  assert.match(result.stderr, /ROYAL_DECISION_PACKET_DRIFT|royal-decision:incomplete/);
});

test('وسيطٌ غيرُ معروفٍ يُرَدُّ ولا تُنفَّذُ نيّةٌ مظنونةٌ', () => {
  const result = runGenerator(ROOT, ['--force-pass']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ROYAL_DECISION_ARGUMENT_UNKNOWN/);
});

test('الوثيقةُ تُصرِّحُ بما لا تقولُه، وتذكرُ الخياراتِ الثلاثةَ ومعاييرَ التراجعِ', () => {
  const doc = readFileSync(join(ROOT, DOC), 'utf8');
  for (const needle of [
    'ما لا تقولُه هذه الوثيقةُ',
    'معاييرُ التراجعِ',
    '`approve`',
    '`defer`',
    '`reject`',
    'ed25519',
    'crown.command.accepted',
  ]) {
    assert.ok(doc.includes(needle), `الوثيقةُ لا تذكرُ «${needle}»`);
  }
  const packet = loadRoyalDecisionPacket();
  assert.equal(`${renderRoyalDecisionPacket(packet)}`, doc);
});
