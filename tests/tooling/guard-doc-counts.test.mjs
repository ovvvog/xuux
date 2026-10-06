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
  // العقدُ — يَقرأُهُ `R5` ليَستخرجَ سلطةَ الإغلاقِ (`WL-221`).
  mkdirSync(path.join(tmp, 'config'), { recursive: true });
  copyFileSync(
    path.join(ROOT, 'config/external-review.yaml'),
    path.join(tmp, 'config/external-review.yaml'),
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

// ── الطفرتانِ 10 و11: سلطةُ الإغلاقِ في §4.3 (‏`R5`، `WL-221`) ──

test('الطفرةُ M10: إسنادُ إغلاقِ نتيجةِ مراجعةٍ إلى المنفِّذِ يُسقِطُ الحاجز', () => {
  const tmp = cloneRepo();
  try {
    const registerPath = path.join(tmp, 'docs/roadmap/06-debt-register.md');
    const register = readFileSync(registerPath, 'utf8');
    const mutated = register.replace(/(\| `R6-A-12` \|[^\n]*\|) مجلس \|/, '$1 منفِّذ |');
    assert.notEqual(mutated, register, 'ينبغي أن يُعثَرَ على صفِّ `R6-A-12`');
    writeFileSync(registerPath, mutated);
    assert.equal(
      runGuard(tmp),
      1,
      'صفٌّ يُسنِدُ إغلاقَ نتيجةِ مراجعةٍ إلى المنفِّذِ ينبغي أن يُسقِطَ الحاجز',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('الطفرةُ M11: انحرافُ سلطةِ النتائجِ في العقدِ يُسقِطُ الحاجز', () => {
  const tmp = cloneRepo();
  try {
    const contractPath = path.join(tmp, 'config/external-review.yaml');
    const contract = readFileSync(contractPath, 'utf8');
    const mutated = contract.replace('resultAuthority: model-council', 'resultAuthority: executor');
    assert.notEqual(mutated, contract, 'ينبغي أن يُعثَرَ على مفتاحِ سلطةِ النتائجِ');
    writeFileSync(contractPath, mutated);
    assert.equal(runGuard(tmp), 1, 'عقدٌ يُسنِدُ سلطةَ النتائجِ للمنفِّذِ ينبغي أن يُسقِطَ الحاجز');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── الطفرةُ 12: اكتمالُ جدولِ §4.3 (‏`R6`، `WL-240`) ──

test('الطفرأةُ M12: حذفُ صفِّ نتيجةٍ من جدولِ §4.3 يُسقِطُ الحاجز', () => {
  const tmp = cloneRepo();
  try {
    const registerPath = path.join(tmp, 'docs/roadmap/06-debt-register.md');
    const register = readFileSync(registerPath, 'utf8');
    const mutated = register.replace(
      // الصفُّ يُطابَقُ بمعرِّفِه وعمودِ مالكِه لا بنصِّ معالجتِه: نصُّ العمودِ يتغيّرُ
      // بكلِّ دفعةٍ تُعالِجُ النتيجةَ (‏`WL-276`)، والطفرةُ تحذفُ الصفَّ أيّاً كانَ نصُّه — ولا
      // بعلامةِ إغلاقِه: صارَ `~~ID~~ 🟢` لأنّ العقدَ يقولُ `closed` (‏`WL-338`، `DOC-29`).
      /^\| (?:~~)?`R5-A-03`(?:~~)?(?: 🟢)? \| منخفضة \| [^\n]* \| مجلس \|$/m,
      '',
    );
    assert.notEqual(mutated, register, 'ينبغي أن يُعثَرَ على صفِّ `R5-A-03`');
    writeFileSync(registerPath, mutated);
    assert.equal(runGuard(tmp), 1, 'حذفُ صفِّ نتيجةٍ من جدولِ §4.3 ينبغي أن يُسقِطَ الحاجزَ');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('القاعدةُ R6: الجدولُ المكتملُ يَمُرُّ', () => {
  const tmp = cloneRepo();
  try {
    assert.equal(runGuard(tmp), 0, 'جدولُ §4.3 المكتملُ مقابلَ العقدِ ينبغي أن يَمُرَّ');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── الطفراتُ S1…S3: المشطوبُ لا يُعَدُّ مفتوحاً (‏`WL-268`) ──
//
// كانَ العدُّ يَلتقطُ كلَّ معرِّفٍ بينَ علامتَيْ كودٍ، فعَدَّ `~~`LIVE-14`~~ 🟢`
// مفتوحاً، فخَضِرَ الحاجزُ على «5 بنودٍ» والمفتوحُ اثنانِ.

test('الطفرةُ S1: فكُّ شطبِ بندٍ مُغلَقٍ في السجلِّ يُسقِطُ الحاجز', () => {
  const tmp = cloneRepo();
  try {
    const registerPath = path.join(tmp, 'docs/roadmap/06-debt-register.md');
    const register = readFileSync(registerPath, 'utf8');
    const unstruck = register.replace('و~~`LIVE-14`~~ 🟢', 'و`LIVE-14`');
    assert.notEqual(unstruck, register, 'ينبغي أن يُعثَرَ على موضعِ الطفرةِ');
    writeFileSync(registerPath, unstruck);
    assert.equal(runGuard(tmp), 1, 'بندٌ صارَ مفتوحاً في السجلِّ ولم تَذكُرْهُ اللوحةُ ⇒ انحرافٌ');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('الطفرةُ S2: إضافةُ بندٍ **مشطوبٍ** إلى قائمةِ السجلِّ لا تُسقِطُ الحاجز', () => {
  const tmp = cloneRepo();
  try {
    const registerPath = path.join(tmp, 'docs/roadmap/06-debt-register.md');
    const register = readFileSync(registerPath, 'utf8');
    const added = register.replace(
      '`R3-A-01` و~~`LIVE-14`~~',
      '`R3-A-01` و~~`FAKE-9`~~ 🟢 و~~`LIVE-14`~~',
    );
    assert.notEqual(added, register, 'ينبغي أن يُعثَرَ على موضعِ الطفرةِ');
    writeFileSync(registerPath, added);
    assert.equal(runGuard(tmp), 0, 'المشطوبُ مُغلَقٌ فلا يُعَدُّ');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('الطفرةُ S3: معرِّفُ فرعٍ بـ`/` يُعَدُّ — حذفُهُ من اللوحةِ يُسقِطُ الحاجز', () => {
  const tmp = cloneRepo();
  try {
    const statusPath = path.join(tmp, 'PROJECT_STATUS.md');
    const status = readFileSync(statusPath, 'utf8');
    const removed = status.replaceAll(' و`OPS-1/MAIN-DRIFT-WINDOW`', '');
    assert.notEqual(removed, status, 'ينبغي أن يُعثَرَ على موضعِ الطفرةِ');
    writeFileSync(statusPath, removed);
    assert.equal(runGuard(tmp), 1, 'بندٌ مفتوحٌ غابَ عن اللوحةِ ⇒ انحرافٌ');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── الطفراتُ 13…15: بِنيةُ الجداولِ والأقسامِ (‏`R4/NO-SEPARATOR` و`R7`، `WL-273` إغلاقاً لـ`DOC-18`) ──

/**
 * يُشغِّلُ الحاجزَ ويُعيدُ رمزَ الخروجِ ومُخرَجَ الخطأِ — ليُقاسَ **سببُ** السقوطِ لا وقوعُه وحدَه.
 * @param {string} root
 * @returns {{ code: number, stderr: string }}
 */
function runGuardWithOutput(root) {
  try {
    execFileSync('node', [GUARD, '--root', root], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 15000,
    });
    return { code: 0, stderr: '' };
  } catch (err) {
    const e = /** @type {{ status?: number, stderr?: string }} */ (err);
    return { code: e.status ?? 1, stderr: String(e.stderr ?? '') };
  }
}

test('الطفرةُ M13: سطرُ `---` يَشطُرُ جدولَ §4.6 فيُسقِطُ الحاجزَ بـR4/NO-SEPARATOR', () => {
  const tmp = cloneRepo();
  try {
    const registerPath = path.join(tmp, 'docs/roadmap/06-debt-register.md');
    const register = readFileSync(registerPath, 'utf8');
    // العَطَبُ عينُه الذي أقحمَتْه `WL-227`: فاصلٌ أفقيٌّ قبلَ صفِّ `LIVE-11`.
    const split = register.replace('\n| ~~`LIVE-11`~~', '\n---\n\n| ~~`LIVE-11`~~');
    assert.notEqual(split, register, 'ينبغي أن يُعثَرَ على صفِّ `LIVE-11`');
    writeFileSync(registerPath, split);
    const { code, stderr } = runGuardWithOutput(tmp);
    assert.equal(code, 1, 'جدولٌ بلا فاصلٍ ينبغي أن يُسقِطَ الحاجز');
    assert.match(stderr, /R4\/NO-SEPARATOR/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('الطفرةُ M14: قسمٌ مكرَّرٌ من المستوى الثاني يُسقِطُ الحاجزَ بـR7/DUP-SECTION', () => {
  const tmp = cloneRepo();
  try {
    const registerPath = path.join(tmp, 'docs/roadmap/06-debt-register.md');
    const register = readFileSync(registerPath, 'utf8');
    // العَطَبُ عينُه الذي أحدثَتْه `WL-268`: نسخةٌ ثانيةٌ من §5 كاملاً.
    const start = register.indexOf('\n## 5 —');
    const end = register.indexOf('\n## 6 —');
    assert.ok(start !== -1 && end > start, 'ينبغي أن يُعثَرَ على §5 و§6');
    const section = register.slice(start, end);
    const duplicated = register.slice(0, end) + section + register.slice(end);
    writeFileSync(registerPath, duplicated);
    const { code, stderr } = runGuardWithOutput(tmp);
    assert.equal(code, 1, 'قسمٌ مكرَّرٌ ينبغي أن يُسقِطَ الحاجز');
    assert.match(stderr, /R7\/DUP-SECTION/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('الطفرةُ M15: ترويسةُ قسمٍ بلا مضمونٍ تُسقِطُ الحاجزَ بـR7/EMPTY-SECTION', () => {
  const tmp = cloneRepo();
  try {
    const registerPath = path.join(tmp, 'docs/roadmap/06-debt-register.md');
    const register = readFileSync(registerPath, 'utf8');
    // ترويسةُ §6 فارغةٌ قبلَ نسختِها الحقيقيّةِ — والحاجزُ يَرى الفراغَ لا التكرارَ وحدَه.
    const emptied = register.replace('\n## 7 —', '\n## 6ب — قسمٌ فارغٌ\n\n---\n\n## 7 —');
    assert.notEqual(emptied, register, 'ينبغي أن يُعثَرَ على §7');
    writeFileSync(registerPath, emptied);
    const { code, stderr } = runGuardWithOutput(tmp);
    assert.equal(code, 1, 'قسمٌ فارغٌ ينبغي أن يُسقِطَ الحاجز');
    assert.match(stderr, /R7\/EMPTY-SECTION/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── الطفرةُ 16: علامةُ الإغلاقِ غيرُ الموحَّدة (‏`R8`، `WL-330` إغلاقاً لـ`DOC-23`) ──

test('الطفرةُ M16: حذفُ 🟢 من معرِّفٍ مُغلَقٍ يُسقِطُ الحاجزَ بـR8/UNMARKED', () => {
  const tmp = cloneRepo();
  try {
    const debtPath = path.join(tmp, 'docs/roadmap/06-debt-register.md');
    const debt = readFileSync(debtPath, 'utf8');
    // احذف 🟢 من صفِّ D-1 المُغلَق (له ~~ بلا 🟢 في المعرِّف)
    const mutated = debt.replace('| ~~`D-1`~~ 🟢 |', '| ~~`D-1`~~ |');
    assert.notEqual(mutated, debt, 'ينبغي أن يُعثَرَ على صفِّ D-1');
    writeFileSync(debtPath, mutated);
    const { code, stderr } = runGuardWithOutput(tmp);
    assert.equal(code, 1, 'حذفُ 🟢 من معرِّفٍ مُغلَقٍ ينبغي أن يُسقِطَ الحاجز');
    assert.match(stderr, /R8\/UNMARKED/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ملاحظةٌ: الاختبارُ الإيجابيُّ لـR8 (العلامةُ الموحَّدةُ تَمرُّ) مُعلَّقٌ حتى يُحَلَّ انحرافُ R2/DRIFT

// ── الطفرةُ 17: صفٌّ مكرَّرٌ في الجدولِ الواحدِ (‏`R9`، `WL-336` لـ`DOC-28`) ──

test('الطفرةُ M17: صفُّ `LIVE-40` مكرَّراً في §4.6 (‏حادثةُ `#256`) يُسقِطُ الحاجزَ بـR9/DUP-ROW', () => {
  const tmp = cloneRepo();
  try {
    const debtPath = path.join(tmp, 'docs/roadmap/06-debt-register.md');
    const debt = readFileSync(debtPath, 'utf8');
    const lines = debt.split('\n');
    const i = lines.findIndex((line) => line.startsWith('| `LIVE-40` |'));
    assert.ok(i !== -1, 'ينبغي أن يُعثَرَ على صفِّ LIVE-40');
    // كما وقعَ: النسخةُ الأخرى من الصفِّ بعدَ صفٍّ آخرَ، بعرضٍ صحيحٍ فلا يراها `R4`.
    lines.splice(i + 2, 0, lines[i] ?? '');
    writeFileSync(debtPath, lines.join('\n'));
    const { code, stderr } = runGuardWithOutput(tmp);
    assert.equal(code, 1, 'صفٌّ مكرَّرٌ ينبغي أن يُسقِطَ الحاجز');
    assert.match(stderr, /R9\/DUP-ROW/);
    assert.match(stderr, /«LIVE-40»/);
    assert.doesNotMatch(stderr, /R4\/SHAPE/, 'النسخةُ بعرضٍ صحيحٍ — السببُ التكرارُ لا الشكل');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('R9: معرِّفٌ في جدولَينِ مختلفَينِ (‏§4.5 و§6: `REPO-4`) لا يُسقِطُ الحاجز', () => {
  const tmp = cloneRepo();
  try {
    const debt = readFileSync(path.join(tmp, 'docs/roadmap/06-debt-register.md'), 'utf8');
    const rows = debt.split('\n').filter((line) => /^\| (?:~~)?`REPO-4`/.test(line));
    assert.equal(rows.length, 2, 'شرطُ القياس: `REPO-4` صفٌّ في جدولَين');
    const { code, stderr } = runGuardWithOutput(tmp);
    assert.equal(code, 0, stderr);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── الطفراتُ 18–20: حالةُ §4.3 من العقدِ (‏`R8`، `WL-338` لـ`DOC-29`) ──

test('الطفرةُ M18: إزالةُ علامةِ نتيجةٍ مُغلَقةٍ في العقدِ (‏`R4-B-01`) تُسقِطُ الحاجزَ بـR8/YAML-CLOSED-UNMARKED — الحادثةُ نفسُها', () => {
  const tmp = cloneRepo();
  try {
    const debtPath = path.join(tmp, 'docs/roadmap/06-debt-register.md');
    const debt = readFileSync(debtPath, 'utf8');
    const mutated = debt.replace('| ~~`R4-B-01`~~ 🟢 |', '| `R4-B-01` |');
    assert.notEqual(mutated, debt, 'ينبغي أن يُعثَرَ على صفِّ R4-B-01 مُعلَّماً');
    writeFileSync(debtPath, mutated);
    const { code, stderr } = runGuardWithOutput(tmp);
    assert.equal(code, 1, stderr);
    assert.match(stderr, /R8\/YAML-CLOSED-UNMARKED: «R4-B-01»/);
    // ولا يراه `R8/UNMARKED` القديمُ — المعرِّفُ غيرُ مشطوبٍ؛ فالكشفُ من العقدِ لا من الشطب.
    assert.doesNotMatch(stderr, /R8\/UNMARKED/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('الطفرةُ M19: تعليمُ نتيجةٍ مفتوحةٍ بنقطةٍ في معرِّفِها (‏`M11.04-F05`) مُغلَقةً يُسقِطُ الحاجزَ بـR8/YAML-OPEN-MARKED', () => {
  const tmp = cloneRepo();
  try {
    const debtPath = path.join(tmp, 'docs/roadmap/06-debt-register.md');
    const debt = readFileSync(debtPath, 'utf8');
    const mutated = debt.replace('| `M11.04-F05` |', '| ~~`M11.04-F05`~~ 🟢 |');
    assert.notEqual(mutated, debt, 'ينبغي أن يُعثَرَ على صفِّ M11.04-F05');
    writeFileSync(debtPath, mutated);
    const { code, stderr } = runGuardWithOutput(tmp);
    assert.equal(code, 1, stderr);
    assert.match(stderr, /R8\/YAML-OPEN-MARKED: «M11.04-F05»/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('الطفرةُ M20: الحاجزُ يقرأُ الحالةَ من العقدِ — `M11.04-F07` تُجعَلُ `closed` في نسخةِ العقدِ وحدَها فيُرَدُّ صفُّها غيرُ المُعلَّم', () => {
  const tmp = cloneRepo();
  try {
    const yamlPath = path.join(tmp, 'config/external-review.yaml');
    const text = readFileSync(yamlPath, 'utf8');
    const lines = text.split('\n');
    const at = lines.findIndex((l) => /^\s*- id: ['"]?M11\.04-F07['"]?\s*$/.test(l));
    assert.ok(at !== -1, 'ينبغي أن يُعثَرَ على M11.04-F07 في العقد');
    const rel = lines.slice(at + 1).findIndex((l) => /^\s*status: open\s*$/.test(l));
    assert.ok(rel !== -1, 'ينبغي أن يُعثَرَ على حالتِها');
    lines[at + 1 + rel] = (lines[at + 1 + rel] ?? '').replace('open', 'closed');
    writeFileSync(yamlPath, lines.join('\n'));
    const { code, stderr } = runGuardWithOutput(tmp);
    assert.equal(code, 1, stderr);
    assert.match(stderr, /R8\/YAML-CLOSED-UNMARKED: «M11.04-F07»/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('R8 (‏§4.3): السجلُّ الحاليُّ يطابقُ العقدَ — لا علامةَ زائدةً ولا ناقصة', () => {
  const tmp = cloneRepo();
  try {
    const { code, stderr } = runGuardWithOutput(tmp);
    assert.equal(code, 0, stderr);
    assert.doesNotMatch(stderr, /R8\/YAML/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
