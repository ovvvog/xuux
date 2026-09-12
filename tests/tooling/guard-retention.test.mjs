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
    const mutated = source.replace(
      '      ...(enforcementPoint === null ? {} : { authorizer: enforcementPoint }),\n',
      '',
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
