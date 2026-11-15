// اختبارُ حاجزِ تقريرِ الجاهزيّةِ — البوابةُ السادسةُ والأربعون (`M11.08`).
//
// **الحاجزُ يُنادى عمليّةً ابنةً كما يُناديه المسارُ الآليُّ**، ويُقاس فيه ما يُقاس
// في كلِّ حاجزٍ: أنّه يُصدِّق الحالةَ القائمةَ، وأنّه **يرفض فعلاً** عند إخلالٍ
// مُصطنَعٍ في نسخةٍ مؤقّتةٍ من الشجرةِ — فحاجزٌ لم يُرَ رافضاً مرّةً واحدةً حاجزٌ لا
// يُعرَف أيرفض أصلاً.
//
// دُمِجَ هنا (‏WL-544، حدُّ G1): ما كان tests/tooling/guard-status-freshness.test.mjs —
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

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs, { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const GUARD = path.join(ROOT, 'scripts/guard-readiness.mjs');

const TREE = [
  'config/readiness-report.yaml',
  'config/readiness-deferrals.yaml',
  'config/schemas/readiness-report.schema.json',
  'config/schemas/readiness-deferrals.schema.json',
  'src/readiness/errors.mjs',
  'src/readiness/items.mjs',
  'src/readiness/evidence.mjs',
  'src/readiness/deferrals.mjs',
  'src/readiness/judgement.mjs',
  'src/readiness/render.mjs',
  'src/readiness/contract.mjs',
  'src/readiness/index.mjs',
  'scripts/guard-readiness.mjs',
  'scripts/readiness-report.mjs',
  'scripts/lib/readiness-facts.mjs',
  'docs/READINESS.md',
  'docs/READINESS_REPORT.md',
  'docs/roadmap/03-roadmap-to-100.md',
  'docs/roadmap/05-work-log.md',
  'tests/readiness/report.test.mjs',
  'PROJECT_STATUS.md',
  'version.json',
  'package.json',
  '.github/workflows/ci.yml',
];

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

/** @returns {string} */
function cloneTree() {
  const target = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-readiness-')));
  for (const relative of TREE) {
    const from = path.join(ROOT, relative);
    const to = path.join(target, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  // الوحداتُ تستورد `ajv` و`yaml`، فتُربَط حزمُ الشجرةِ الحقيقيّةِ بلا نسخِها.
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(target, 'node_modules'), 'dir');
  return target;
}

/**
 * @param {string} tree
 * @param {string} relative
 * @param {(text: string) => string} mutate
 * @returns {void}
 */
function edit(tree, relative, mutate) {
  const file = path.join(tree, relative);
  fs.writeFileSync(file, mutate(fs.readFileSync(file, 'utf8')), 'utf8');
}

test('الحاجزُ يُصدِّق الحالةَ القائمةَ ويُعلن ما قاسه بالأرقامِ', () => {
  const outcome = runGuard(GUARD);
  assert.equal(outcome.status, 0, `الحاجزُ رفض الحالةَ القائمةَ: ${outcome.stderr}`);
  assert.match(outcome.stdout, /حاجز تقرير الجاهزية بتأجيلات صريحة/u);
  assert.match(outcome.stdout, /بلا دليلٍ ولا تأجيلٍ/u);
});

test('R1: حكمٌ غيرُ موثَّقٍ بالاسمِ في الوثيقةِ يُرَدُّ — ولا عملَ بلا توثيقٍ', () => {
  const tree = cloneTree();
  edit(tree, 'docs/READINESS.md', (text) =>
    text.replaceAll('readiness:unmeasured', 'حكمُ انعدامِ القياسِ'),
  );
  const outcome = runGuard(path.join(tree, 'scripts/guard-readiness.mjs'));
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /R1/u);
});

test('R2: رمزُ رفضٍ في العقدِ بلا نظيرٍ في الكودِ يُرَدُّ', () => {
  const tree = cloneTree();
  edit(tree, 'config/readiness-report.yaml', (text) =>
    text.replace('  - READINESS_EVIDENCE_MISSING', '  - READINESS_SOMETHING_ELSE'),
  );
  const outcome = runGuard(path.join(tree, 'scripts/guard-readiness.mjs'));
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /R2/u);
});

test('R3: ضمانٌ لا يُشار إليه نصّاً في ملفِّ إنفاذِه يُرَدُّ', () => {
  const tree = cloneTree();
  edit(tree, 'src/readiness/deferrals.mjs', (text) =>
    text.replaceAll('G-READINESS-DEFERRAL-DECLARED-NOT-IMPLIED', 'ضمانُ التأجيلِ المُصرَّحِ'),
  );
  const outcome = runGuard(path.join(tree, 'scripts/guard-readiness.mjs'));
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /R3/u);
});

test('R4: بندٌ بلا دليلٍ ولا تأجيلٍ يُرَدُّ — وهو معيارُ القبولِ نفسُه', () => {
  const tree = cloneTree();
  edit(tree, 'config/readiness-deferrals.yaml', (text) =>
    text.replace('id: M11.05', 'id: M11.055'),
  );
  const outcome = runGuard(path.join(tree, 'scripts/guard-readiness.mjs'));
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /READINESS_ITEM_UNCOVERED/u);
});

test('R5: تأجيلٌ يُعلَن في مُدخلةٍ لا وجودَ لها يُرَدُّ', () => {
  const tree = cloneTree();
  edit(tree, 'config/readiness-deferrals.yaml', (text) => text.replace('WL-065', 'WL-999'));
  const outcome = runGuard(path.join(tree, 'scripts/guard-readiness.mjs'));
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /READINESS_DEFERRAL_UNDECLARED/u);
});

test('R6: حكمُ نقصٍ يخرج صفراً يُرَدُّ — والمسارُ الآليُّ يقرأ الصفرَ نجاحاً', () => {
  const tree = cloneTree();
  edit(tree, 'config/readiness-report.yaml', (text) => text.replace('exitCode: 82', 'exitCode: 0'));
  const outcome = runGuard(path.join(tree, 'scripts/guard-readiness.mjs'));
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /R0|R6/u);
});

test('R7: تقريرٌ مُحرَّرٌ بيدٍ يُرَدُّ بالمقارنةِ بايتاً ببايتٍ', () => {
  const tree = cloneTree();
  edit(tree, 'docs/READINESS_REPORT.md', (text) => text.replace('| الحكم |', '| الحكمُ |'));
  const outcome = runGuard(path.join(tree, 'scripts/guard-readiness.mjs'));
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /READINESS_REPORT_DRIFT/u);
});

test('R8: لفظُ اعتمادٍ ذاتيٍّ في التقريرِ يُرَدُّ — ولا يُنتحَل حكمُ جهةٍ مستقلّةٍ', () => {
  const tree = cloneTree();
  edit(tree, 'docs/READINESS_REPORT.md', (text) => `${text}\nالنتيجة: APPROVED\n`);
  const outcome = runGuard(path.join(tree, 'scripts/guard-readiness.mjs'));
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /READINESS_SELF_APPROVAL|READINESS_REPORT_DRIFT/u);
});

test('R9: وحدةُ حكمٍ تستورد القرصَ تُرَدُّ — والنقاءُ بنيةٌ لا نيّةٌ', () => {
  const tree = cloneTree();
  edit(tree, 'src/readiness/judgement.mjs', (text) => `import fs from 'node:fs';\n${text}`);
  const outcome = runGuard(path.join(tree, 'scripts/guard-readiness.mjs'));
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /R9/u);
});

test('R9: فكُّ ربطِ الحاجزِ عن CI يُرَدُّ — والأخضرُ المحليُّ ليس حكماً', () => {
  const tree = cloneTree();
  edit(tree, '.github/workflows/ci.yml', (text) =>
    text.replace('npm run guard:readiness', 'npm run guard:emergency'),
  );
  const outcome = runGuard(path.join(tree, 'scripts/guard-readiness.mjs'));
  assert.equal(outcome.status, 1);
  assert.match(outcome.stderr, /R9/u);
});

// ── دُمِجَ هنا (‏WL-544، حدُّ G1): ما كان tests/tooling/guard-status-freshness.test.mjs — (‏كتلةٌ مستقلّةُ النطاق: أسماءٌ مشتركة) ──
{
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
}
