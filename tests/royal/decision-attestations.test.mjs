// قاعدةُ الاعتمادِ في حزمةِ القرارِ الملكيِّ — إنفاذُ أنها **مغلقةٌ على الفشلِ**.
//
// المشكلةُ التي يحلُّها هذا الاختبارُ: كانَ الاعتمادُ يُقاسُ بقائمةِ ألفاظٍ ممنوعةٍ،
// فأيُّ صياغةِ اعتمادٍ لم تُعَدَّ فيها تمرُّ، وسطرٌ فيه أداةُ نفيٍ كانَ يُتجاوَزُ
// بأكملِه فيمرُّ الاعتمادُ راكباً على النفيِ. فهنا يُقاسُ العكسُ: **لا يمرُّ إلا
// المسموحُ صريحاً**، والقيمةُ تُقابَلُ بمصدرِها في المستودعِ لا بمجموعتِها وحدَها.
//
// وما لا يفعلُه: لا يحكمُ على صوابِ القرارِ ولا على كفايةِ أدلّتِه — ذاك للمالكِ،
// ومرورُ هذه الاختباراتِ ليس قراراً ولا توقيعاً ولا جاهزيّةً ولا إطلاقاً.
//
// التشغيل: node --test tests/royal/decision-attestations.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ATTESTATION_VALUE_SOURCES,
  assertAttestations,
  collectClaimTokens,
  readDeferralBlockerKinds,
  readRoadmapStatusGlyphs,
} from '../../src/royal-decision/attestations.mjs';
import { loadRoyalDecisionPacket } from '../../src/royal-decision/contract.mjs';
import { ROYAL_DECISION_ERRORS, RoyalDecisionError } from '../../src/royal-decision/errors.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GUARD = 'scripts/guard-royal-decision.mjs';
const GENERATOR = 'scripts/royal-decision-packet.mjs';
const CONFIG = 'config/royal-decision.yaml';
const DOC = 'docs/ROYAL_DECISION_PACKET.md';
const ROADMAP = 'docs/roadmap/03-roadmap-to-100.md';

/**
 * الجذورُ المؤقّتةُ التي أنشأتها هذه الحزمةُ. كلُّ ملفِّ اختبارٍ يُشغَّلُ في عمليّةٍ
 * مستقلّةٍ تحتَ `node --test`، فيُمحى ما أنشأَه عندَ خروجِها. وبلا هذا المحوِ تَبقى
 * نُسَخُ الشجرةِ في `/tmp` وتَتراكمُ على عدّاءٍ مقيمٍ حتّى تَستنفِدَ المساحةَ.
 * @type {string[]}
 */
const SANDBOX_ROOTS = [];

process.on('exit', () => {
  for (const root of SANDBOX_ROOTS) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * جذرٌ مؤقّتٌ يكفي لتشغيلِ الحاجزِ والمولِّدِ، كي تُقاسَ حالاتُ الرفضِ بلا تعديلِ
 * المستودعِ. والتبعيّاتُ تُوصَل وصلاً لا نسخاً.
 * @returns {string}
 */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'royal-attest-'));
  SANDBOX_ROOTS.push(root);
  for (const entry of ['config', 'docs', 'scripts', 'src', 'package.json']) {
    cpSync(join(ROOT, entry), join(root, entry), { recursive: true });
  }
  cpSync(join(ROOT, '.github'), join(root, '.github'), { recursive: true });
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'), 'dir');
  return root;
}

/**
 * الحاجزُ يُشغَّلُ **عمليّةً منفصلةً** ويُقاسُ رمزُ خروجِه: لا يكفي أن يرمي دالّةٌ.
 * @param {string} root
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runGuard(root) {
  const result = spawnSync(process.execPath, [join(root, GUARD)], { cwd: root, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * @param {string} root
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runGenerator(root) {
  const result = spawnSync(process.execPath, [join(root, GENERATOR), '--root', root], {
    cwd: root,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * @param {string} root
 * @param {string} relative
 * @param {string} from
 * @param {string} to
 * @returns {void}
 */
function patch(root, relative, from, to) {
  const file = join(root, relative);
  const text = readFileSync(file, 'utf8');
  assert.ok(text.includes(from), `النصُّ المُستهدَفُ غائبٌ عن «${relative}»: ${from}`);
  writeFileSync(file, text.replace(from, to));
}

/**
 * @param {string} root
 * @param {string} relative
 * @param {string} suffix
 * @returns {void}
 */
function append(root, relative, suffix) {
  const file = join(root, relative);
  writeFileSync(file, `${readFileSync(file, 'utf8')}\n${suffix}\n`);
}

// ————— أولاً: المسموحُ يمرُّ، وكلُّ قيمةٍ مُثبَتةٍ عضوٌ في مجموعتِها ومطابقةٌ لمصدرِها.

test('المستودعُ كما هو: كلُّ حكمٍ مُعلَنٍ قيمةٌ مسموحةٌ ومطابقةٌ لمصدرِها', () => {
  const packet = loadRoyalDecisionPacket();
  const verified = assertAttestations(/** @type {Record<string, unknown>} */ (packet), {
    root: ROOT,
    configDir: join(ROOT, 'config'),
  });
  assert.ok(verified.length >= 1);
  const glyphs = readRoadmapStatusGlyphs(ROOT);
  const { kinds } = readDeferralBlockerKinds(join(ROOT, 'config'));
  for (const attestation of packet.attestations) {
    assert.ok(ATTESTATION_VALUE_SOURCES.includes(attestation.valueSource));
    if (attestation.valueSource === 'roadmap-step-status') assert.ok(glyphs.has(attestation.value));
    if (attestation.valueSource === 'readiness-deferral-blocker-kind') {
      assert.ok(kinds.has(attestation.value));
    }
  }
});

test('مجموعاتُ القيمِ مقروءةٌ من مصادرِها لا مكتوبةٌ في الحاجزِ', () => {
  assert.ok(readRoadmapStatusGlyphs(ROOT).has('⬜'));
  const { kinds, byId } = readDeferralBlockerKinds(join(ROOT, 'config'));
  assert.ok(kinds.has('external-party') && kinds.has('sovereign-decision'));
  assert.equal(byId.get('M11.09'), 'sovereign-decision');
});

test('غيابُ مصدرِ القيمِ يُوقِفُ الحاجزَ ولا يُوسِّعُه (فشلٌ مغلقٌ)', () => {
  const root = sandbox();
  patch(root, ROADMAP, '- رموز الحالة:', '- رموزُ حالةٍ محذوفةٌ:');
  const guard = runGuard(root);
  assert.equal(guard.status, 1);
  assert.match(guard.stderr, /R6|CONFIG_INVALID/);
});

// ————— ثانياً: قيمةٌ مسموحةٌ مع زيادةٍ، وقيمةٌ غيرُ مُدرَجةٍ تحملُ لفظاً مُدرَجاً.

for (const [name, from, to] of /** @type {[string, string, string][]} */ ([
  ['نصٌّ إضافيٌّ غيرُ مُصرَّحٍ بعدَ قيمةٍ صحيحةٍ', "value: '⬜'", "value: '⬜ — مُعتمَدٌ'"],
  [
    'قيمةٌ غيرُ مُدرَجةٍ تحتوي قيمةً مُدرَجةً',
    'value: external-party',
    'value: external-party-approved',
  ],
  ['مُرادفٌ قريبٌ غيرُ مسجَّلٍ', 'value: sovereign-decision', 'value: sovereign_decision'],
  ['حالةُ حرفٍ مخالفةٌ', 'value: external-party', 'value: EXTERNAL-PARTY'],
  ['فراغٌ زائدٌ', 'value: external-party', "value: ' external-party'"],
  ['حكمانِ في حقلٍ واحدٍ', 'value: external-party', "value: 'external-party, sovereign-decision'"],
  ['قيمةٌ فارغةٌ', "value: '⬜'", "value: ''"],
  ['مصدرُ قيمٍ غيرُ معروفٍ', 'valueSource: roadmap-step-status', 'valueSource: executor-judgement'],
  ['موضوعٌ غيرُ معروفٍ', "subject: 'packet:self'", "subject: 'launch:readiness'"],
])) {
  test(`${name} ⇒ يُرَدُّ`, () => {
    const root = sandbox();
    patch(root, CONFIG, from, to);
    const guard = runGuard(root);
    assert.equal(guard.status, 1, guard.stdout);
    assert.match(guard.stderr, /R0|R6|SELF_APPROVAL|CONFIG_INVALID/);
    const generator = runGenerator(root);
    assert.notEqual(generator.status, 0);
    assert.ok(
      generator.status === 84 || generator.status === 85,
      `رمزُ الخروجِ ${String(generator.status)} خارجَ المعنى المعلَنِ`,
    );
  });
}

test('موضوعٌ مُكرَّرٌ بحكمَينِ ⇒ يُرَدُّ — فلا يُختارُ الأنفعُ منهما', () => {
  const root = sandbox();
  patch(
    root,
    CONFIG,
    "  - subject: 'packet:self'",
    "  - subject: 'deferral:M11.09'\n    valueSource: readiness-deferral-blocker-kind\n    value: external-party\n  - subject: 'packet:self'",
  );
  const guard = runGuard(root);
  assert.equal(guard.status, 1);
  assert.match(guard.stderr, /R0|R6|SELF_APPROVAL/);
});

test('غيابُ قناةِ الحكمِ كلِّها ⇒ يُرَدُّ ولا يُقرأُ صمتُها إذناً', () => {
  const root = sandbox();
  const file = join(root, CONFIG);
  const text = readFileSync(file, 'utf8');
  const cut = text.indexOf('attestations:');
  const end = text.indexOf('verdicts:');
  writeFileSync(file, `${text.slice(0, cut)}${text.slice(end)}`);
  const guard = runGuard(root);
  assert.equal(guard.status, 1);
  assert.match(guard.stderr, /R0|R6|CONFIG_INVALID/);
});

// ————— ثالثاً: القيمةُ تُقابَلُ بالواقعِ: مسموحةٌ في المجموعةِ لكنها تخالفُ مصدرَها.

test('قيمةٌ مسموحةٌ في المجموعةِ تخالفُ مصدرَ الحقيقةِ ⇒ يُرَدُّ', () => {
  const root = sandbox();
  patch(root, CONFIG, "value: '⬜'", "value: '✅'");
  const guard = runGuard(root);
  assert.equal(guard.status, 1);
  assert.match(guard.stderr, /R0|R6|SELF_APPROVAL/);
});

test('إغلاقُ صفِّ الخطوةِ في اللوحةِ يُسقِطُ الحاجزَ — لا يُصحِّحُ الحكمَ', () => {
  const root = sandbox();
  const file = join(root, ROADMAP);
  const text = readFileSync(file, 'utf8');
  const rows = text.split('\n');
  const index = rows.findIndex((line) => line.includes('| M11.09 |'));
  assert.notEqual(index, -1);
  const row = rows[index] ?? '';
  rows[index] = `${row.slice(0, row.lastIndexOf('⬜'))}✅ |`;
  writeFileSync(file, rows.join('\n'));
  const guard = runGuard(root);
  assert.equal(guard.status, 1);
  assert.match(guard.stderr, /R1|R2|R6|SELF_APPROVAL|STEP_CLOSED/);
});

// ————— رابعاً: النصُّ الحرُّ لا يحملُ حكماً — وهذه هي حالةُ الدَينِ بحرفِها.

for (const [name, claim] of /** @type {[string, string][]} */ ([
  ['صياغةُ اعتمادٍ لم تُعَدَّ في أيِّ قائمةٍ', 'RATIFIED'],
  ['صياغةٌ مركّبةٌ جديدةٌ', 'CERTIFIED-COMPLETE'],
  ['صياغةٌ تحملُ لفظاً مُدرَجاً وزيادةً', 'APPROVED-BY-EXECUTOR'],
  ['ادّعاءُ نسبةٍ', '100%'],
  ['ادّعاءُ نسبةٍ بفراغٍ', '100 %'],
  ['رمزُ حالةٍ مسموحٌ في موضعٍ غيرِ مسموحٍ', '✅'],
  ['اعتمادٌ راكبٌ على نفيٍ — البابُ الذي كانَ مفتوحاً', 'لا شيءَ هنا: APPROVED'],
  ['اعتمادٌ راكبٌ على نفيٍ بصياغةٍ جديدةٍ', 'ليس هذا إلا: GO-LIVE'],
]))
  test(`${name} في الوثيقةِ ⇒ يُرَدُّ`, () => {
    const root = sandbox();
    append(root, DOC, claim);
    const guard = runGuard(root);
    assert.equal(guard.status, 1, guard.stdout);
    assert.match(guard.stderr, /R6|LAUNCH_CLAIM/);
  });

test('الادّعاءُ في العقدِ نفسِه يُرَدُّ عندَ التحميلِ لا عندَ العرضِ', () => {
  const root = sandbox();
  append(root, CONFIG, '# RATIFIED — 100%');
  const guard = runGuard(root);
  assert.equal(guard.status, 1);
  assert.match(guard.stderr, /R6|LAUNCH_CLAIM/);
  const generator = runGenerator(root);
  assert.equal(generator.status, 85, generator.stderr);
  assert.match(generator.stderr, /LAUNCH_CLAIM|royal-decision:impersonated/);
});

test('ذكرُ مُعرِّفٍ ليس ادّعاءً: `M11.09` و`G11` و`CI` تمرُّ لأنها مقروءةٌ من مصادرِها', () => {
  const root = sandbox();
  append(root, CONFIG, '# مرجعٌ: M11.09 و G11 و CI و WL-072 و JSON.');
  const guard = runGuard(root);
  assert.equal(guard.status, 1, 'انزياحُ الوثيقةِ متوقَّعٌ');
  assert.doesNotMatch(guard.stderr, /LAUNCH_CLAIM/);
});

test('استخراجُ رموزِ الادّعاءِ شكليٌّ لا معجميٌّ — فلا قائمةَ ألفاظٍ ممنوعةٍ فيه', () => {
  const glyphs = readRoadmapStatusGlyphs(ROOT);
  const tokens = collectClaimTokens('نصٌّ فيه RATIFIED و 100% و ✅ ورمزٌ VERIFIED', glyphs);
  for (const expected of ['RATIFIED', '100%', '✅', 'VERIFIED']) {
    assert.ok(tokens.includes(expected), `الرمزُ «${expected}» لم يُستخرَجْ`);
  }
});

// ————— خامساً: مسارُ الخطأِ لا يُقرأُ نجاحاً، ورموزُ الخروجِ على معناها.

test('رفضُ الاعتمادِ يُكتَبُ على `stderr` ورمزُ الخروجِ ليس صفراً', () => {
  const root = sandbox();
  patch(root, CONFIG, "value: '⬜'", "value: 'مُعتمَدٌ'");
  const guard = runGuard(root);
  assert.equal(guard.status, 1);
  assert.ok(guard.stderr.trim() !== '', 'الرفضُ صامتٌ — وصمتُ الرفضِ يُقرأُ نجاحاً');
  assert.doesNotMatch(guard.stdout, /✅/);
  const generator = runGenerator(root);
  assert.equal(generator.status, 85, generator.stderr);
  assert.match(generator.stderr, /SELF_APPROVAL/);
});

test('رمزُ الرفضِ مُعلَنٌ في عقدِ الأخطاءِ — فلا رمزَ مخترعٌ في مسارِ الاعتمادِ', () => {
  assert.equal(ROYAL_DECISION_ERRORS.SELF_APPROVAL, 'ROYAL_DECISION_SELF_APPROVAL');
  assert.equal(ROYAL_DECISION_ERRORS.LAUNCH_CLAIM, 'ROYAL_DECISION_LAUNCH_CLAIM');
  const error = new RoyalDecisionError(ROYAL_DECISION_ERRORS.SELF_APPROVAL, 'اختبارٌ');
  assert.equal(error.code, 'ROYAL_DECISION_SELF_APPROVAL');
});
