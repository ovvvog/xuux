// اختبارُ قبولِ `M11.08` بحرفِ معيارِه: «صفرُ بندٍ بلا دليلٍ أو بلا تأجيلٍ معلَنٍ».
//
// **ولا يُقاس هذا بنداءِ دالّةٍ في العمليّةِ نفسِها:** المولِّدُ يُنادى **عمليّةً
// ابنةً حقيقيّةً** (‏`node scripts/readiness-report.mjs`) بلا مَدخلٍ قياسيٍّ مفتوحٍ،
// ويُقرأ **رمزُ خروجِه** كما يقرؤه المسارُ الآليُّ، ثم يُقرأ التقريرُ من القرصِ.
//
// ويُقاس الرفضُ **بإخلالٍ مُصطنَعٍ في نسخةٍ مؤقّتةٍ**: بندٌ يُقلَب غيرَ منجَزٍ بلا
// تأجيلٍ، وتأجيلٌ يُنقَص حقلاً، وتأجيلٌ يُعلَن في مُدخلةٍ لا وجودَ لها، وجدولٌ
// يُنقَص صفّاً فيخالف العددَ المُعلَنَ — فمولِّدٌ لم يُرَ رافضاً مرّةً واحدةً مولِّدٌ
// لا يُعرَف أيرفض أصلاً.

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
const GENERATOR = path.join(ROOT, 'scripts/readiness-report.mjs');

const SOURCES = [
  'config/readiness-report.yaml',
  'config/readiness-deferrals.yaml',
  'config/schemas/readiness-report.schema.json',
  'config/schemas/readiness-deferrals.schema.json',
  'docs/roadmap/03-roadmap-to-100.md',
  'docs/roadmap/05-work-log.md',
  'docs/READINESS_REPORT.md',
  'PROJECT_STATUS.md',
  'version.json',
];

/**
 * @param {string[]} args
 * @returns {{ status: number | null, stdout: string, stderr: string, json: Record<string, unknown> }}
 */
function runGenerator(args) {
  const outcome = spawnSync(process.execPath, [GENERATOR, ...args], {
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  /** @type {Record<string, unknown>} */
  let json;
  try {
    json = JSON.parse(String(outcome.stdout ?? ''));
  } catch {
    json = {};
  }
  return {
    status: outcome.status,
    stdout: String(outcome.stdout ?? ''),
    stderr: String(outcome.stderr ?? ''),
    json,
  };
}

/** @returns {string} */
function cloneSources() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-'));
  for (const relative of SOURCES) {
    const from = path.join(ROOT, relative);
    if (!fs.existsSync(from)) continue;
    const to = path.join(target, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  return target;
}

/**
 * @param {string} root
 * @param {string} relative
 * @param {(text: string) => string} mutate
 * @returns {void}
 */
function edit(root, relative, mutate) {
  const file = path.join(root, relative);
  fs.writeFileSync(file, mutate(fs.readFileSync(file, 'utf8')), 'utf8');
}

test('الحالةُ القائمةُ: كلُّ بندٍ بدليلٍ أو بتأجيلٍ مُصرَّحٍ، والتقريرُ غيرُ منزاحٍ', () => {
  const outcome = runGenerator(['--json']);
  assert.equal(
    outcome.status,
    0,
    `المولِّدُ رفض الحالةَ القائمةَ: ${outcome.stdout}${outcome.stderr}`,
  );
  assert.equal(outcome.json.verdict, 'readiness:reported');
  assert.equal(outcome.json.drift, false, 'التقريرُ المُقيَّدُ منزاحٌ عن الحقيقةِ الراهنةِ');
  const coverage = /** @type {Record<string, number>} */ (outcome.json.coverage);
  assert.equal(coverage.uncovered, 0, 'بندٌ بلا دليلٍ ولا تأجيلٍ في الحالةِ القائمةِ');
  assert.ok(Number(coverage.total) > 100, 'عددُ البنودِ المقروءِ أقلُّ من أن يكون لوحةَ الخطواتِ');
  assert.ok(Number(coverage.deferred) > 0, 'تقريرُ جاهزيّةٍ بلا تأجيلٍ واحدٍ يُقرأ اكتمالاً');
});

test('التقريرُ يُصرِّح بما لا يقولُه: لا اعتمادَ ولا مراجعةً مستقلّةً ولا إطلاقاً', () => {
  const report = fs.readFileSync(path.join(ROOT, 'docs/READINESS_REPORT.md'), 'utf8');
  for (const needle of ['لا يُعلِنُ اعتماداً أمنياً', 'ولا يُقرأ مراجعةً مستقلّةً']) {
    assert.ok(report.includes(needle), `التقريرُ لا يُصرِّح بحدِّه: «${needle}»`);
  }
  assert.ok(!/\bVERIFIED\b/u.test(report), 'التقريرُ يحمل لفظَ اعتمادٍ ذاتيٍّ');
  assert.ok(!/\bAPPROVED\b/u.test(report), 'التقريرُ يحمل لفظَ موافقةٍ لم تصدرْ');
});

test('بندٌ غيرُ منجَزٍ بلا تأجيلٍ مُصرَّحٍ يُوقِف الحكمَ — لا يمرُّ بصمتٍ', () => {
  const root = cloneSources();
  edit(root, 'docs/roadmap/03-roadmap-to-100.md', (text) =>
    text
      .replace('| M1.01 |', '| M1.01 |')
      .replace(/\| M1\.01 \|(.*)\| ✅ \|/u, '| M1.01 |$1| ⬜ |'),
  );
  const outcome = runGenerator(['--json', '--root', root]);
  assert.equal(outcome.status, 82, `الحكمُ لم يُوقَف: ${outcome.stdout}${outcome.stderr}`);
  assert.equal(outcome.json.verdict, 'readiness:incomplete');
  const faults = /** @type {{ code: string, id: string }[]} */ (outcome.json.faults);
  assert.ok(
    faults.some((fault) => fault.code === 'READINESS_ITEM_UNCOVERED' && fault.id === 'M1.01'),
    'البندُ المقلوبُ لم يُذكَر بمعرِّفِه في الإخلالاتِ',
  );
});

test('تأجيلٌ ناقصُ حقلٍ يُرَدُّ — والتأجيلُ الناقصُ عذرٌ لا إعلانٌ', () => {
  const root = cloneSources();
  edit(root, 'config/readiness-deferrals.yaml', (text) =>
    text.replace(/^\s+unblockCondition: >-\n(\s+.*\n)+?(?=\s+authority:)/mu, ''),
  );
  const outcome = runGenerator(['--json', '--root', root]);
  assert.notEqual(outcome.status, 0, 'تأجيلٌ ناقصُ حقلٍ مرَّ');
  assert.ok(
    ['readiness:incomplete', 'readiness:unmeasured'].includes(String(outcome.json.verdict ?? '')) ||
      outcome.stderr.includes('READINESS_DEFERRALS_INVALID'),
    `الحكمُ غيرُ متوقَّعٍ: ${outcome.stdout}${outcome.stderr}`,
  );
});

test('تأجيلٌ يُعلَن في مُدخلةٍ لا وجودَ لها يُرَدُّ — والإعلانُ يُشار إلى موضعِه', () => {
  const root = cloneSources();
  edit(root, 'config/readiness-deferrals.yaml', (text) => text.replace('WL-065', 'WL-999'));
  const outcome = runGenerator(['--json', '--root', root]);
  assert.equal(outcome.status, 82, `الإعلانُ الوهميُّ مرَّ: ${outcome.stdout}${outcome.stderr}`);
  const faults = /** @type {{ code: string }[]} */ (outcome.json.faults);
  assert.ok(
    faults.some((fault) => fault.code === 'READINESS_DEFERRAL_UNDECLARED'),
    'مُدخلةُ إعلانٍ لا وجودَ لها لم تُرصَد',
  );
});

test('تأجيلٌ لبندٍ مُعلَنٍ مُنجَزاً يُرَدُّ — أحدُ الإعلانَينِ كاذبٌ', () => {
  const root = cloneSources();
  edit(root, 'config/readiness-deferrals.yaml', (text) => text.replace('id: M11.04', 'id: M1.01'));
  const outcome = runGenerator(['--json', '--root', root]);
  assert.equal(outcome.status, 82, `التأجيلُ المتناقضُ مرَّ: ${outcome.stdout}${outcome.stderr}`);
  const faults = /** @type {{ code: string }[]} */ (outcome.json.faults);
  assert.ok(
    faults.some((fault) => fault.code === 'READINESS_DEFERRAL_ORPHAN'),
    'تأجيلٌ لبندٍ مُنجَزٍ لم يُرصَد',
  );
});

test('عددُ بنودٍ يخالف المُعلَنَ ⇒ readiness:unmeasured — والصمتُ لا يُقرأ نجاحاً', () => {
  const root = cloneSources();
  edit(root, 'config/readiness-report.yaml', (text) =>
    text.replace('expected: 105', 'expected: 104'),
  );
  const outcome = runGenerator(['--json', '--root', root]);
  assert.equal(outcome.status, 83, `العددُ المخالفُ مرَّ: ${outcome.stdout}${outcome.stderr}`);
  assert.equal(outcome.json.verdict, 'readiness:unmeasured');
});

test('مصدرٌ غائبٌ ⇒ readiness:unmeasured لا readiness:reported', () => {
  const root = cloneSources();
  fs.rmSync(path.join(root, 'docs/roadmap/05-work-log.md'));
  const outcome = runGenerator(['--json', '--root', root]);
  assert.equal(outcome.status, 83, `مصدرٌ غائبٌ مرَّ: ${outcome.stdout}${outcome.stderr}`);
  assert.match(outcome.stderr, /READINESS_SOURCE_MISSING/u);
});

test('انزياحُ التقريرِ المُقيَّدِ يُرصَد بايتاً ببايتٍ', () => {
  const root = cloneSources();
  edit(root, 'docs/READINESS_REPORT.md', (text) => `${text}\nسطرٌ أُضيف بيدٍ.\n`);
  const outcome = runGenerator(['--json', '--root', root]);
  assert.equal(outcome.status, 82, `الانزياحُ لم يُرصَد: ${outcome.stdout}${outcome.stderr}`);
  assert.equal(outcome.json.drift, true);
});

test('وسيطٌ غيرُ معروفٍ يُرَدُّ ولا تُنفَّذ نيّةٌ مظنونةٌ', () => {
  const outcome = runGenerator(['--pass']);
  assert.equal(outcome.status, 83, 'وسيطٌ مجهولٌ لم يُرَدَّ');
  assert.match(outcome.stderr, /READINESS_ARGUMENT_UNKNOWN/u);
});

test('المولِّدُ بلا كتابةٍ لا يمسُّ التقريرَ — القياسُ لا يُغيِّر المقيسَ', () => {
  const file = path.join(ROOT, 'docs/READINESS_REPORT.md');
  const before = fs.readFileSync(file, 'utf8');
  runGenerator([]);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'تشغيلٌ بلا `--write` كتبَ على التقريرِ');
});
