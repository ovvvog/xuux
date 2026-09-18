// اختباراتُ حاجزِ عدّاداتِ الوثائق — WL-196 (D-5).
//
// تَفحَصُ أنّ الحاجزَ يَرفضُ الأرقامَ المنحرفةَ ويَقبلُ المطابقةَ.
// والطفراتُ تُثبِتُ أنّ تغييرَ رقمٍ يدويٍّ يُسقِطُ الحاجز.

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/[A-Z]:/, ''),
  '../..',
);
const GUARD = path.join(ROOT, 'scripts/guard-doc-counts.mjs');

/**
 * يَنسخُ جذرَ المشروعِ إلى مجلّدٍ مؤقّتٍ ويُعيدُ مسارَه.
 * @returns {string}
 */
function cloneRepo() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'xuux-doc-counts-'));
  // انسخْ ما يلزمُ للحاجزِ: package.json، tests/، docs/، scripts/.
  copyFileSync(path.join(ROOT, 'package.json'), path.join(tmp, 'package.json'));
  // انسخ scripts/ لأن الحاجزَ يستوردُ doc-count-facts.mjs منها.
  mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
  mkdirSync(path.join(tmp, 'scripts/lib'), { recursive: true });
  copyFileSync(
    path.join(ROOT, 'scripts/guard-doc-counts.mjs'),
    path.join(tmp, 'scripts/guard-doc-counts.mjs'),
  );
  copyFileSync(
    path.join(ROOT, 'scripts/lib/doc-count-facts.mjs'),
    path.join(tmp, 'scripts/lib/doc-count-facts.mjs'),
  );
  mkdirSync(path.join(tmp, 'tests'), { recursive: true });
  copyDirRecursive(path.join(ROOT, 'tests'), path.join(tmp, 'tests'));
  mkdirSync(path.join(tmp, 'docs'), { recursive: true });
  mkdirSync(path.join(tmp, 'docs/roadmap'), { recursive: true });
  copyFileSync(path.join(ROOT, 'docs/ROOT_OF_TRUST.md'), path.join(tmp, 'docs/ROOT_OF_TRUST.md'));
  copyFileSync(path.join(ROOT, 'PROJECT_STATUS.md'), path.join(tmp, 'PROJECT_STATUS.md'));
  copyFileSync(
    path.join(ROOT, 'docs/roadmap/06-debt-register.md'),
    path.join(tmp, 'docs/roadmap/06-debt-register.md'),
  );
  return tmp;
}

/**
 * @param {string} src
 * @param {string} dst
 */
function copyDirRecursive(src, dst) {
  mkdirSync(dst, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

/**
 * يُشغِّلُ الحاجزَ ويُعيدُ رمزَ الخروج.
 * @param {string} root
 * @returns {number}
 */
function runGuard(root) {
  try {
    execFileSync('node', [GUARD, '--root', root], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 15000,
    });
    return 0;
  } catch (err) {
    const e = /** @type {{ status?: number }} */ (err);
    return e.status ?? 1;
  }
}

// ── الاختبارُ الإيجابيُّ: الأرقامُ المطابقةُ تَمرُّ ──

test('الحاجزُ يَقبلُ الأرقامَ المطابقةَ لمصدرِها', () => {
  const tmp = cloneRepo();
  try {
    assert.equal(runGuard(tmp), 0, 'الحاجزُ ينبغي أن يَمرَّ على أرقامٍ مطابقة');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── الطفرةُ 1: تغييرُ عددِ ملفاتِ الاختبارِ في ROOT_OF_TRUST.md ──

test('الطفرةُ M1: تغييرُ عددِ ملفاتِ الاختبارِ يُسقِطُ الحاجز', () => {
  const tmp = cloneRepo();
  try {
    const rotPath = path.join(tmp, 'docs/ROOT_OF_TRUST.md');
    const rot = readFileSync(rotPath, 'utf8');
    writeFileSync(rotPath, rot.replace(/\d+\s*ملف اختبار/, '999 ملف اختبار'));
    assert.equal(runGuard(tmp), 1, 'تغييرُ عددِ ملفاتِ الاختبارِ ينبغي أن يُسقِطَ الحاجز');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── الطفرةُ 2: تغييرُ عددِ الحواجزِ في PROJECT_STATUS.md ──

test('الطفرةُ M2: تغييرُ عددِ الحواجزِ يُسقِطُ الحاجز', () => {
  const tmp = cloneRepo();
  try {
    const statusPath = path.join(tmp, 'PROJECT_STATUS.md');
    const status = readFileSync(statusPath, 'utf8');
    writeFileSync(statusPath, status.replace(/\d+\s*حاجزاً/, '999 حاجزاً'));
    assert.equal(runGuard(tmp), 1, 'تغييرُ عددِ الحواجزِ ينبغي أن يُسقِطَ الحاجز');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── الطفرةُ 3: حذفُ ذِكرِ عددِ ملفاتِ الاختبارِ ──

test('الطفرةُ M3: حذفُ ذِكرِ عددِ ملفاتِ الاختبارِ يُسقِطُ الحاجز', () => {
  const tmp = cloneRepo();
  try {
    const rotPath = path.join(tmp, 'docs/ROOT_OF_TRUST.md');
    const rot = readFileSync(rotPath, 'utf8');
    writeFileSync(rotPath, rot.replace(/\d+\s*ملف اختبار/, 'ملفات اختبار'));
    assert.equal(runGuard(tmp), 1, 'حذفُ العددِ ينبغي أن يُسقِطَ الحاجز');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── الطفرةُ 4: تغييرُ عددِ البنودِ المفتوحةِ في PROJECT_STATUS.md ──

test('الطفرةُ M4: إضافةُ معرّفِ بندٍ زائفٍ يُسقِطُ الحاجز', () => {
  const tmp = cloneRepo();
  try {
    const statusPath = path.join(tmp, 'PROJECT_STATUS.md');
    const status = readFileSync(statusPath, 'utf8');
    // أضِف معرّفاً زائفاً إلى القائمة
    writeFileSync(statusPath, status.replace('`R3-A-01`', '`R3-A-01` و`FAKE-1`'));
    assert.equal(runGuard(tmp), 1, 'إضافةُ معرّفٍ زائفٍ ينبغي أن يُسقِطَ الحاجز');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── الطفرتانِ 5 و6: بِنيةُ صفوفِ §4.6 (‏`R4`، أُضيفَ في `WL-219`) ──

test('الطفرةُ M5: صفٌّ مُلتصِقٌ بسابقِه في §4.6 يُسقِطُ الحاجز', () => {
  const tmp = cloneRepo();
  try {
    const registerPath = path.join(tmp, 'docs/roadmap/06-debt-register.md');
    const register = readFileSync(registerPath, 'utf8');
    // ألصِقْ صفَّ `DOC-13` بسطرِ سابقِه — وهو العَطَبُ عينُه الذي وقعَ في `WL-218`.
    const glued = register.replace('| ✅ منفِّذ |\n| ~~`DOC-13`~~', '| ✅ منفِّذ || ~~`DOC-13`~~');
    assert.notEqual(glued, register, 'ينبغي أن يُعثَرَ على موضعِ الطفرةِ');
    writeFileSync(registerPath, glued);
    assert.equal(runGuard(tmp), 1, 'صفٌّ مُلتصِقٌ ينبغي أن يُسقِطَ الحاجز');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('الطفرةُ M6: علامةُ جدولٍ داخلَ كودٍ لا تُسقِطُ الحاجز', () => {
  const tmp = cloneRepo();
  try {
    const registerPath = path.join(tmp, 'docs/roadmap/06-debt-register.md');
    const register = readFileSync(registerPath, 'utf8');
    // `|` داخلَ علامتَيْ كودٍ ليسَ فاصلَ خليّةٍ — وحاجزٌ يُبلِّغُ عن سليمٍ يُدرَّبُ الناسُ على تجاهُلِه.
    const withPipeInCode = register.replace('| ✅ منفِّذ |', '| ✅ منفِّذ `a|b|c` |');
    assert.notEqual(withPipeInCode, register, 'ينبغي أن يُعثَرَ على موضعِ الطفرةِ');
    writeFileSync(registerPath, withPipeInCode);
    assert.equal(runGuard(tmp), 0, 'علامةٌ داخلَ كودٍ لا ينبغي أن تُسقِطَ الحاجز');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── الطفرتانِ 7 و8: بِنيةُ صفوفٍ خارجَ §4.6 (‏`R4`، وُسِّعَ في `WL-220` إغلاقاً لـ`DOC-14`) ──

test('الطفرةُ M7: صفٌّ بأربعةِ خلايا في §4.1 (خارجَ §4.6) يُسقِطُ الحاجز', () => {
  const tmp = cloneRepo();
  try {
    const registerPath = path.join(tmp, 'docs/roadmap/06-debt-register.md');
    const register = readFileSync(registerPath, 'utf8');
    // الدَّينُ D-2 في جدولِ §4.1 له خمسُ خلايا بعدَ التصحيحِ. أدمج الوصفَ والحالَ في خليّةٍ واحدةٍ لإعادةِ العَطَبِ الأصليَّ.
    // الفاصلُ بينَ الوصفِ والحالِ هو `~~ | **مُغلَقٌ في`.
    const marker = '~~ | **مُغلَقٌ في `WL-194`';
    const markerIdx = register.indexOf(marker);
    assert.notEqual(markerIdx, -1, 'ينبغي أن يُعثَرَ على موضعِ الطفرةِ في صفِّ D-2');
    // أزلِ الفاصلَ لدمجِ الوصفِ بالحالِ.
    const mutated = register.replace(marker, '~~ **مُغلَقٌ في `WL-194`');
    assert.notEqual(mutated, register, 'ينبغي أن تَتغيّرَ الطفرةُ');
    writeFileSync(registerPath, mutated);
    assert.equal(runGuard(tmp), 1, 'صفٌّ بأربعةِ خلايا في §4.1 ينبغي أن يُسقِطَ الحاجز');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('الطفرةُ M8: علامةُ جدولٍ داخلَ كودٍ في جدولٍ خارجَ §4.6 لا تُسقِطُ الحاجز', () => {
  const tmp = cloneRepo();
  try {
    const registerPath = path.join(tmp, 'docs/roadmap/06-debt-register.md');
    const register = readFileSync(registerPath, 'utf8');
    // `|` داخلَ كودٍ في جدولِ §4.1 لا ينبغي أن يُسقِطَ الحاجز.
    const withPipeInCode = register.replace('| منفِّذ |', '| منفِّذ `x|y|z` |');
    assert.notEqual(withPipeInCode, register, 'ينبغي أن يُعثَرَ على موضعِ الطفرةِ');
    writeFileSync(registerPath, withPipeInCode);
    assert.equal(runGuard(tmp), 0, 'علامةٌ داخلَ كودٍ في أيِّ جدولٍ لا ينبغي أن تُسقِطَ الحاجز');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── الطفرةُ 9: صفٌّ فاصلٌ بعرضٍ مكسورٍ يُسقِطُ الحاجز (‏`R4`، `WL-220`) ──

test('الطفرةُ M9: صفٌّ فاصلٌ بعددِ خلايا يُخالِفُ الترويسةَ يُسقِطُ الحاجز', () => {
  const tmp = cloneRepo();
  try {
    const registerPath = path.join(tmp, 'docs/roadmap/06-debt-register.md');
    const register = readFileSync(registerPath, 'utf8');
    // ابحثْ عن أوّلِ صفٍّ فاصلٍ في السجلِّ وألصِقْ به عموداً زائداً.
    const sepMatch = register.match(/^\|[ \t:|-]+\|$/m);
    assert.ok(sepMatch, 'ينبغي أن يُعثَرَ على صفٍّ فاصلٍ');
    const broken = sepMatch[0] + '|';
    const mutated = register.replace(sepMatch[0], broken);
    assert.notEqual(mutated, register, 'ينبغي أن تَتغيّرَ الطفرةُ');
    writeFileSync(registerPath, mutated);
    assert.equal(runGuard(tmp), 1, 'صفٌّ فاصلٌ بعرضٍ مكسورٍ ينبغي أن يُسقِطَ الحاجز');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
