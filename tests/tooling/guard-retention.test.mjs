// اختبارُ حاجزِ الاحتفاظِ — قاعدةُ `R6` وحدَها (إغلاقُ `R6-A-01`).
//
// حاجزٌ يُقاسُ بنجاحِه وحدَه ليس دليلاً: النجاحُ قد يكون لأنّه لا يفحصُ شيئاً.
// فالمقيسُ هنا أنّه **يفشلُ حين يجب**: تُنسخُ شجرةُ المشروعِ إلى مجلدٍ مؤقّتٍ،
// وتُزرعُ فيها في كلِّ مرّةٍ طفرةٌ واحدةٌ من نفسِ الطرقِ التي كان التجاوزُ ممكناً
// بها، ويُطلبُ من الحاجزِ أن يرفض.
//
// وأخصُّها الطفرةُ الأولى `M16`: إعادةُ العيبِ الأصليِّ بنصِّه — مسارُ المحوِ يعودُ
// إلى `assertSweeper` (نصُّ دورٍ يُرسلُه المُنادي) مع بقاءِ `#authorizeSweep`
// موجودةً في الملفِّ بلا مُنادٍ. وهذه بعينُها تعبرُ حاجزَ نقطةِ التفويضِ لأنّ
// النداءَ **موجودٌ في الملفِّ**؛ ولذلك لا يكفي فحصُ الملفِّ، بل يُقتطعُ متنُ كلِّ
// مسارِ محوٍ ويُفحصُ وحدَه.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = join(ROOT, 'scripts', 'guard-retention.mjs');
const CYCLE = join('src', 'data', 'retention-cycle.mjs');

/**
 * ينسخ ما يحتاجه الحاجز فقط: البيانات والكود والهجرات.
 * @returns {{ dir: string, cleanup: () => void }}
 */
function copyTree() {
  const dir = mkdtempSync(join(tmpdir(), 'xuux-retention-guard-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  cpSync(join(ROOT, 'config'), join(dir, 'config'), { recursive: true });
  cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
  cpSync(join(ROOT, 'migrations'), join(dir, 'migrations'), { recursive: true });
  cpSync(join(ROOT, 'scripts'), join(dir, 'scripts'), { recursive: true });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * يشغّل الحاجز على شجرةٍ معيّنة. و`DATABASE_URL` تُنزع كي يبقى المقيسُ قاعدةَ
 * `R6` وحدها لا اتّصالَ قاعدةٍ.
 * @param {string} dir
 * @returns {{ status: number, output: string }}
 */
function runGuard(dir) {
  const env = { ...process.env };
  delete env['DATABASE_URL'];
  try {
    const output = execFileSync(process.execPath, [GUARD, '--root', dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    return { status: 0, output };
  } catch (error) {
    const failure = /** @type {{ status?: number, stdout?: string, stderr?: string }} */ (error);
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

/**
 * @param {string} dir
 * @param {(source: string) => string} mutate
 */
function mutateCycle(dir, mutate) {
  const file = join(dir, CYCLE);
  const source = readFileSync(file, 'utf8');
  const mutated = mutate(source);
  assert.notEqual(mutated, source, 'الطفرةُ لم تُزرع: نصُّ الاستبدالِ غيرُ موجودٍ في الملف.');
  writeFileSync(file, mutated);
}

test('الحاجز يمرّ على شجرة المشروع كما هي', () => {
  const { status, output } = runGuard(ROOT);
  assert.equal(status, 0, `الحاجز يرفض المستودع الحالي: ${output}`);
  assert.match(output, /حاجز الاحتفاظ/);
});

test('M16: الحاجز يفشل إن عاد مسارُ المحوِ إلى نصِّ الدورِ — وهذا نصّ `R6-A-01`', () => {
  const { dir, cleanup } = copyTree();
  try {
    mutateCycle(dir, (source) =>
      source.replace(
        /const sweeper = await this\.#authorizeSweep\(\{\n {6}actor,\n {6}resourceKey: 'data:retention-cycle',[\s\S]*?\n {4}\}\);/,
        'const sweeper = assertSweeper(actor, this.policy);\n    void royalCommand;',
      ),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'مسارُ محوٍ يحكمُه نصُّ دورٍ عبرَ الحاجز');
    assert.match(output, /R6/);
    assert.match(output, /async run\(/);
  } finally {
    cleanup();
  }
});

test('M17: الحاجز يفشل إن لم تُستهلَك تذكرةُ القرارِ قبلَ الحذف', () => {
  const { dir, cleanup } = copyTree();
  try {
    mutateCycle(dir, (source) =>
      source.replace('this.authorizer.verify(token ?? undefined, {', 'void token; ({'),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'قرارٌ لا تُستهلَكُ تذكرتُه عبرَ الحاجز');
    assert.match(output, /R6/);
    assert.match(output, /verify/);
  } finally {
    cleanup();
  }
});

test('M18: الحاجز يفشل إن كفَّ التركيبُ المُشغَّلُ عن تمريرِ نقطةِ التفويض', () => {
  const { dir, cleanup } = copyTree();
  try {
    const file = join(dir, 'src', 'persistence', 'composition.mjs');
    const source = readFileSync(file, 'utf8');
    // النصُّ نفسُه يقعُ مرّتين بعدَ `LIM-3` (الدورةُ والمطهِّرُ)، فالطفرةُ
    // تُثبَّتُ على موضعِ الدورةِ بسياقِه: طفرةٌ تُصيبُ الموضعَ الآخرَ تقيسُ
    // قاعدةً أخرى وتُخفي أنّ `R6` كفَّ عن الفحصِ.
    const mutated = source.replace(
      '      erasureLedger,\n      ...(enforcementPoint === null ? {} : { authorizer: enforcementPoint }),\n',
      '      erasureLedger,\n',
    );
    assert.notEqual(mutated, source, 'الطفرةُ لم تُزرع.');
    writeFileSync(file, mutated);
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'تركيبٌ يبني الدورةَ بلا نقطةِ تفويضٍ عبرَ الحاجز');
    assert.match(output, /R6/);
    assert.match(output, /التركيبُ المُشغَّلُ/);
  } finally {
    cleanup();
  }
});

test('M19: الحاجز يفشل إن كفَّ التفويضُ عن اشتراطِ بوابةِ الهويةِ', () => {
  const { dir, cleanup } = copyTree();
  try {
    mutateCycle(dir, (source) => source.replace(/identityGate/g, 'anyGateWillDo'));
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'نقطةُ تفويضٍ بلا بوابةِ هويةٍ عبرت الحاجز');
    assert.match(output, /R6/);
  } finally {
    cleanup();
  }
});

test('M20: الحاجز يفشل إن كفَّ المحوُ الموجَّهُ وحدَه عن التفويض', () => {
  const { dir, cleanup } = copyTree();
  try {
    mutateCycle(dir, (source) =>
      source.replace(
        /const sweeper = await this\.#authorizeSweep\(\{\n {6}actor,\n {6}resourceKey: `data:\$\{target\}:\$\{id\}`,[\s\S]*?\n {4}\}\);/,
        'const sweeper = assertSweeper(actor, this.policy);\n    void royalCommand;',
      ),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'محوٌ موجَّهٌ بلا تفويضٍ عبرَ الحاجز');
    assert.match(output, /eraseDirected/);
  } finally {
    cleanup();
  }
});

test('M21: الحاجز يفشل إن لم تُعلَن الوحدةُ الفعلَ المحكومَ باسمِه', () => {
  const { dir, cleanup } = copyTree();
  try {
    mutateCycle(dir, (source) =>
      source.replace("PURGE_ACTION = 'purge-data'", "PURGE_ACTION = 'sweep-rows'"),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'محوٌ لا يُسمّي فعلَه المحكومَ عبرَ الحاجز');
    assert.match(output, /R6/);
  } finally {
    cleanup();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// قاعدةُ `R7` (‏`LIM-3`، `WL-190`): أدوارُ المطهِّرِ أهليّةٌ لا سلطةٌ. وتُقاسُ
// بنفسِ الطريقِ: تُزرعُ الطفرةُ التي كان التجاوزُ ممكناً بها، ويُطلبُ الرفضُ.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} dir
 * @param {string} relative
 * @param {(source: string) => string} mutate
 */
function mutateFile(dir, relative, mutate) {
  const file = join(dir, relative);
  const source = readFileSync(file, 'utf8');
  const mutated = mutate(source);
  assert.notEqual(mutated, source, 'الطفرةُ لم تُزرع.');
  writeFileSync(file, mutated);
}

test('M22: الحاجز يفشل إن عادَ مطهِّرُ الذاكرةِ إلى حارسِ الدورِ وحدَه', () => {
  const { dir, cleanup } = copyTree();
  try {
    // هذه هي إعادةُ عيبِ `LIM-3` بنصِّه: `sweepExpired` يبقى يقرأُ `isSweeper`
    // ويحذفُ الصفوفَ، ولا يبقى في الملفِّ نداءٌ لسلطةِ المحوِ.
    mutateFile(dir, join('src', 'data', 'memory-store.mjs'), (source) =>
      source
        .replace(/assertRoyalCommandForPurge/g, 'assertSweeperRoleOnly')
        .replace(/#authorizeSweep/g, '#sweepRoleGuard'),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'مطهِّرٌ بحارسِ دورٍ وحدَه عبرَ الحاجز');
    assert.match(output, /R7/);
    assert.match(output, /memory-store\.mjs/);
  } finally {
    cleanup();
  }
});

test('M23: الحاجز يفشل إن أُسقط إعلانُ الحدِّ من موضعِ قراءةِ الدورِ', () => {
  const { dir, cleanup } = copyTree();
  try {
    mutateFile(dir, join('src', 'data', 'memory-limits.mjs'), (source) =>
      source.replace('أهليّةً لا سلطةً', 'إذناً كافياً'),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'دالّةُ الأهليّةِ بلا إعلانِ حدِّها عبرت الحاجز');
    assert.match(output, /R7/);
  } finally {
    cleanup();
  }
});

test('M24: الحاجز يفشل إن نزلَ `purge-data` عن العتبةِ السياديّةِ', () => {
  const { dir, cleanup } = copyTree();
  try {
    // إنزالُ الفعلِ عن العتبةِ **قرارُ مالكٍ** جائزٌ، لكنّه يُكذِّبُ ما تُعلنُه
    // الوثيقةُ والشفرةُ عن أدوارِ المطهِّرِ؛ فالحاجزُ يوقفُ الخبرَ الكاذبَ.
    mutateFile(dir, join('config', 'royal-authority.yaml'), (source) =>
      source.replace(
        '  - action: purge-data\n    reason: المحو يُفقد الدليل نفسه، فيُقرَّر فوق مستوى من يشغّل أداة المحو.\n    lawRef: law:retention\n    delegable: false',
        '  - action: purge-data\n    reason: المحو يُفقد الدليل نفسه، فيُقرَّر فوق مستوى من يشغّل أداة المحو.\n    lawRef: law:retention\n    delegable: true',
      ),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'فعلٌ نزلَ عن العتبةِ عبرَ الحاجزَ بلا أن يُقال');
    assert.match(output, /R7/);
  } finally {
    cleanup();
  }
});

test('M25: الحاجز يفشل إن كفَّ التركيبُ عن تمريرِ التفويضِ إلى المطهِّر', () => {
  const { dir, cleanup } = copyTree();
  try {
    mutateFile(dir, join('src', 'persistence', 'composition.mjs'), (source) =>
      source.replace(
        '      ...(enforcementPoint === null ? {} : { authorizer: enforcementPoint }),\n      ...(memoryPolicy === null ? {} : { policy: memoryPolicy }),',
        '      ...(memoryPolicy === null ? {} : { policy: memoryPolicy }),',
      ),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'مطهِّرٌ بلا نقطةِ تفويضٍ في التركيبِ عبرَ الحاجز');
    assert.match(output, /R7/);
  } finally {
    cleanup();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// قاعدةُ `R8` (‏`R6-A-11`): لا مسارَ محوٍ من سطرِ الأوامرِ. `scripts/retention.mjs
// purge` كان مسارَ حذفٍ رابعاً خارجَ سلطةِ `purge-data`. المسارُ المحكومُ هو
// `RetentionCycle.run` وحده.
// ─────────────────────────────────────────────────────────────────────────────

test('M26: الحاجز يفشل إن استوردَ ملفٌّ في scripts/ دالّةَ purge من retention.mjs', () => {
  const { dir, cleanup } = copyTree();
  try {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    writeFileSync(
      join(dir, 'scripts', 'bad-tool.mjs'),
      "import { plan, purge } from '../src/persistence/retention.mjs';\nexport { plan, purge };\n",
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'استيرادُ purge من scripts/ عبرَ الحاجز');
    assert.match(output, /R8/);
    assert.match(output, /bad-tool\.mjs/);
  } finally {
    cleanup();
  }
});

test('M27: الحاجز يفشل إن استوردَ scripts/retention.mjs دالّةَ purge', () => {
  const { dir, cleanup } = copyTree();
  try {
    mutateFile(dir, join('scripts', 'retention.mjs'), (source) =>
      source.replace(
        "import { plan } from '../src/persistence/retention.mjs';",
        "import { plan, purge } from '../src/persistence/retention.mjs';",
      ),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'استيرادُ purge في scripts/retention.mjs عبرَ الحاجز');
    assert.match(output, /R8/);
    assert.match(output, /retention\.mjs/);
  } finally {
    cleanup();
  }
});

test('M28: أداةُ retention.mjs ترفضُ purge قبلَ الاتصالِ بقاعدةِ البيانات', () => {
  const env = { ...process.env, DATABASE_URL: '' };
  let status = 0;
  let output;
  try {
    output = execFileSync(process.execPath, [join(ROOT, 'scripts', 'retention.mjs'), 'purge'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
  } catch (error) {
    const failure = /** @type {{ status?: number, stdout?: string, stderr?: string }} */ (error);
    status = failure.status ?? 1;
    output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }
  assert.equal(status, 1, 'أداةُ retention.mjs purge لم تُرفَض');
  assert.match(output, /RETENTION_PURGE_CLI_FORBIDDEN/);
});
