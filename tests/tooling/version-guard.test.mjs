// اختبار حاجز تطابق الإصدار — أُضيف في `WL-046`.
//
// **العيبُ الذي يُغلقه:** كان التحقُّقُ من تطابقِ `package.json` و`version.json`
// خطوةً مكتوبةً داخلَ `ci.yml` وحدَه، فلم يكن ما يُقاس محلّياً هو ما يُقاس في
// المسار: خرجت `npm run validate` صفراً وأخفق الطلبُ `#3` على تلك الخطوةِ
// بالذات. فصار الفحصُ حاجزاً مُسمّىً في سلسلةِ `validate` يُنادى في `ci.yml`
// بنصِّه نفسِه.
//
// **قرارٌ مقصود:** الاختبارُ **يُشغِّل الحاجزَ فعلاً** على نسخةٍ مؤقّتةٍ فيها
// عيبٌ مصنوع، ويقيس خروجَه لا نصَّه: حاجزٌ يُقاس بقراءةِ سطوره قد يكون كلَّه
// طباعةً بلا حكم.
//
// **حدودٌ معلَنة:** يُقاس التطابقُ ووجودُ المُدخلةِ لا صحّةُ الترقيمِ الدلاليّ —
// أن الرفعَ يوافق قواعدَ `versioning` حكمٌ لا يُقاس نصّاً ويبقى شرطَ مُدخلةٍ في
// سجلِّ الأعمال بالمادة 1. والنسخةُ المؤقّتةُ تُنسخ بملفّاتٍ معدودةٍ لا بالشجرة
// كلِّها كي لا يصير الاختبارُ ثقيلاً.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const guard = path.join(repoRoot, 'scripts', 'guard-version.mjs');

/**
 * يبني نسخةً مؤقّتةً بأقلِّ ما يحتاجه الحاجز، ويُطبِّق تعديلاً عليها.
 *
 * @param {{ packageVersion?: string, stateVersion?: string, lastEntry?: string, logText?: string }} patch
 * @returns {string} مسارُ الجذرِ المؤقَّت.
 */
function makeRoot(patch) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'version-guard-'));
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const state = JSON.parse(readFileSync(path.join(repoRoot, 'version.json'), 'utf8'));
  if (patch.packageVersion !== undefined) pkg.version = patch.packageVersion;
  if (patch.stateVersion !== undefined) state.version = patch.stateVersion;
  if (patch.lastEntry !== undefined) state.completion.last_entry = patch.lastEntry;
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  writeFileSync(path.join(root, 'version.json'), JSON.stringify(state));
  mkdirSync(path.join(root, 'docs', 'roadmap'), { recursive: true });
  writeFileSync(
    path.join(root, 'docs', 'roadmap', '05-work-log.md'),
    patch.logText ?? readFileSync(path.join(repoRoot, 'docs/roadmap/05-work-log.md'), 'utf8'),
  );
  return root;
}

/**
 * يُشغِّل الحاجزَ على جذرٍ معيَّنٍ ويُرجع خروجَه ومخرَجَه.
 *
 * @param {string} root
 * @returns {{ status: number, output: string }}
 */
function runGuard(root) {
  const result = spawnSync(process.execPath, [guard, '--root', root], { encoding: 'utf8' });
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

test('الحاجز مفتوح على المستودع كما هو — نسخةٌ واحدةٌ ومُدخلةٌ قائمة', () => {
  const result = runGuard(repoRoot);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /✅/u);
});

test('نسختان مختلفتان تُغلقان الحاجز — وهو العيبُ الذي أخفق به الطلب #3 فعلاً', () => {
  const root = makeRoot({ packageVersion: '0.40.0', stateVersion: '0.41.0' });
  try {
    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.output, /R3/u);
    assert.match(result.output, /0\.40\.0/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('مُدخلةُ سجلٍّ مُعلَنةٌ ولا وجودَ لها تُغلق الحاجز (المادة 1)', () => {
  const root = makeRoot({ lastEntry: 'WL-999', logText: '# سجل بلا تلك المُدخلة\n' });
  try {
    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.output, /R4/u);
    assert.match(result.output, /WL-999/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('إصدارٌ ليس على صيغةِ semver يُغلق الحاجز', () => {
  const root = makeRoot({ packageVersion: '0.41', stateVersion: '0.41' });
  try {
    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.output, /R2/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
