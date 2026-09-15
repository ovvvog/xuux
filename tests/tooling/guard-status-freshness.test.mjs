// اختبار حاجز حداثة لوحة الحالة — أُضيف في `WL-171` مع الحاجزِ نفسِه.
//
// **العيبُ الذي يُغلقه:** كانت `PROJECT_STATUS.md` متجمِّدةً على `WL-092` والسجلُّ
// عند `WL-169`. فالحاجزُ يمنعُ عودةَ الانحرافِ، وهذا الاختبارُ يمنعُ أن يكونَ
// الحاجزُ طباعةً بلا حكمٍ.
//
// **قرارٌ مقصود:** يُشغَّلُ الحاجزُ **فعلاً** على جذورٍ مؤقّتةٍ مصنوعةٍ، ويُقاسُ
// **خروجُه** لا نصُّه: حاجزٌ يُقاسُ بقراءةِ سطورِه قد يكون كلَّه رسائلَ.
//
// **حدودٌ معلَنة:** يُقاسُ التطابقُ الأربعُ حالاتٍ (مُطابِقٌ · معرِّفٌ متأخّرٌ ·
// تاريخٌ مختلفٌ · لوحةٌ بلا معرِّفٍ) ولا يُقاسُ صدقُ وصفِ اللوحةِ — وذاك ليس ممّا
// يقيسه الحاجزُ أصلاً، وقد أُعلِنَ حدُّه في رأسِه.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const guard = path.join(repoRoot, 'scripts', 'guard-status-freshness.mjs');

/**
 * يبني جذراً مؤقّتاً بأقلِّ ما يحتاجه الحاجزُ: سجلٌّ ولوحةٌ.
 *
 * @param {{ logText: string, statusText: string }} files نصّا الملفَّين.
 * @returns {string} مسارُ الجذرِ المؤقَّت.
 */
function makeRoot(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'status-freshness-'));
  mkdirSync(path.join(root, 'docs', 'roadmap'), { recursive: true });
  writeFileSync(path.join(root, 'docs', 'roadmap', '05-work-log.md'), files.logText);
  writeFileSync(path.join(root, 'PROJECT_STATUS.md'), files.statusText);
  return root;
}

/**
 * يُشغِّلُ الحاجزَ على جذرٍ ويُرجعُ خروجَه ومخرَجَه.
 *
 * @param {string} root جذرُ المستودعِ المؤقَّت.
 * @returns {{ status: number, output: string }} الخروجُ والمخرَجُ مجموعَين.
 */
function runGuard(root) {
  const result = spawnSync(process.execPath, [guard, '--root', root], { encoding: 'utf8' });
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

const LOG_TWO_ENTRIES = [
  '# سجل الأعمال',
  '',
  '---',
  '',
  '### [2026-09-15] — WL-171 — مُدخلةٌ أحدثُ',
  '',
  '- **المنفّذ:** اختبارٌ',
  '',
  '---',
  '',
  '### [2026-09-14] — WL-170 — مُدخلةٌ أقدمُ',
  '',
  '- **المنفّذ:** اختبارٌ',
  '',
  '---',
  '',
].join('\n');

/**
 * يبني نصَّ لوحةٍ بسطرِ «آخر تحديث» معلومٍ.
 *
 * @param {string} header نصُّ سطرِ «آخر تحديث» كاملاً.
 * @returns {string} نصُّ اللوحةِ.
 */
function statusWith(header) {
  return ['# حالة المشروع', '', header, '', '## الحالة الحالية', '', 'نصٌّ.', ''].join('\n');
}

test('يُمرِّر لوحةً تُشير إلى أحدثِ مُدخلةٍ بتاريخِها', () => {
  const root = makeRoot({
    logText: LOG_TWO_ENTRIES,
    statusText: statusWith('آخر تحديث: **2026-09-15** — عملٌ ما (‏`WL-171`)'),
  });
  try {
    const { status, output } = runGuard(root);
    assert.equal(status, 0, output);
    assert.match(output, /حداثةٌ مقيسةٌ/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('يرفض لوحةً متجمِّدةً على مُدخلةٍ أقدمَ — R4', () => {
  const root = makeRoot({
    logText: LOG_TWO_ENTRIES,
    statusText: statusWith('آخر تحديث: **2026-09-14** — عملٌ ما (‏`WL-170`)'),
  });
  try {
    const { status, output } = runGuard(root);
    assert.equal(status, 1, output);
    assert.match(output, /R4/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('يرفض تاريخاً يخالف تاريخَ أحدثِ مُدخلةٍ — R5', () => {
  const root = makeRoot({
    logText: LOG_TWO_ENTRIES,
    statusText: statusWith('آخر تحديث: **2026-09-01** — عملٌ ما (‏`WL-171`)'),
  });
  try {
    const { status, output } = runGuard(root);
    assert.equal(status, 1, output);
    assert.match(output, /R5/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('يرفض لوحةً لا تُسمّي مُدخلةَ عملٍ أصلاً — R3', () => {
  const root = makeRoot({
    logText: LOG_TWO_ENTRIES,
    statusText: statusWith('آخر تحديث: **2026-09-15** — عملٌ بلا قيدٍ يُنسَبُ إليه'),
  });
  try {
    const { status, output } = runGuard(root);
    assert.equal(status, 1, output);
    assert.match(output, /R3/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('يقيس الأكبرَ رقماً لا الأولَ موضعاً في السجلِّ', () => {
  const reordered = [
    '# سجل الأعمال',
    '',
    '---',
    '',
    '### [2026-09-14] — WL-170 — مُدخلةٌ أقدمُ في الأعلى',
    '',
    '---',
    '',
    '### [2026-09-15] — WL-171 — مُدخلةٌ أحدثُ في الأسفل',
    '',
    '---',
    '',
  ].join('\n');
  const root = makeRoot({
    logText: reordered,
    statusText: statusWith('آخر تحديث: **2026-09-15** — عملٌ ما (‏`WL-171`)'),
  });
  try {
    const { status, output } = runGuard(root);
    assert.equal(status, 0, output);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('يرفض غيابَ سجلِّ الأعمالِ بخطأٍ مُسمّىً لا بانفجارٍ', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'status-freshness-empty-'));
  try {
    const { status, output } = runGuard(root);
    assert.equal(status, 1, output);
    assert.match(output, /05-work-log\.md/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
