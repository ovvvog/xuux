// اختبارُ حاجزِ الجدولةِ — إغلاقُ الدَينِ `D-4` (‏`WL-191`).
//
// حاجزٌ يُقاسُ بنجاحِه وحدَه ليس دليلاً: النجاحُ قد يكونُ لأنّه لا يفحصُ شيئاً.
// فالمقيسُ هنا أنّه **يفشلُ حينَ يجبُ**: تُنسخُ شجرةُ المشروعِ إلى مجلدٍ مؤقّتٍ،
// وتُزرعُ فيها في كلِّ مرّةٍ طفرةٌ واحدةٌ من نفسِ الطرقِ التي كانَ التجاوزُ
// ممكناً بها، ويُطلَبُ من الحاجزِ أن يرفضَ.
//
// وأخصُّها `M7`: إعادةُ العيبِ الذي وقعَ فعلاً في هذا الدَينِ — تصفيةُ المستودعِ
// بشكلٍ لا يعرفُه (‏`list({ jobId })` بدلَ `list({ filter: { jobId } })`). وهذه
// طفرةٌ **تعبرُ كلَّ اختبارِ نوعٍ وكلَّ فحصِ نمطٍ**: لا خطأَ ولا تحذيرَ، وتُعادُ
// معها كلُّ صفوفِ الدفترِ فيُقرأُ شقُّ عملٍ آخرَ محجوزاً ويُرفَضُ إطلاقٌ مستحقٌّ
// باسمِ قفلٍ لم يقعْ. ولذلك يُقاسُ نصُّ النداءِ لا وجودُه.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = join(ROOT, 'scripts', 'guard-scheduling.mjs');

/**
 * ينسخُ ما يحتاجُه الحاجزُ وحدَه: البياناتُ والشفرةُ والهجراتُ والمُشغِّلُ.
 * @returns {{ dir: string, cleanup: () => void }}
 */
function copyTree() {
  const dir = mkdtempSync(join(tmpdir(), 'xuux-scheduling-guard-'));
  for (const entry of ['config', 'src', 'migrations', 'scripts']) {
    cpSync(join(ROOT, entry), join(dir, entry), { recursive: true });
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * @param {string} dir
 * @returns {{ status: number, output: string }}
 */
function runGuard(dir) {
  try {
    const output = execFileSync(process.execPath, [GUARD, '--root', dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
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
 * @param {string} relative
 * @param {(source: string) => string} rewrite
 */
function seed(dir, relative, rewrite) {
  const file = join(dir, relative);
  const source = readFileSync(file, 'utf8');
  const mutated = rewrite(source);
  assert.notEqual(mutated, source, `الطفرةُ لم تُزرع في ${relative}: نصُّ الاستبدالِ غيرُ موجودٍ.`);
  writeFileSync(file, mutated);
}

test('الحاجزُ يمرُّ على شجرةِ المشروعِ كما هي', () => {
  const { status, output } = runGuard(ROOT);
  assert.equal(status, 0, `الحاجزُ يرفضُ المستودعَ الحاليَّ: ${output}`);
  assert.match(output, /حاجز الجدولة/u);
});

test('M1: عملٌ مُعلَنٌ بلا مُنفِّذٍ مسجَّلٍ يُرفَضُ', () => {
  const { dir, cleanup } = copyTree();
  try {
    seed(dir, join('scripts', 'scheduler.mjs'), (source) =>
      source.replaceAll("'job:recovery-drill'", "'job:recovery-drill-renamed'"),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, `الحاجزُ قبلَ عملاً بلا مُنفِّذٍ: ${output}`);
    assert.match(output, /S2/u);
  } finally {
    cleanup();
  }
});

test('M2: جدولةُ فعلٍ فوقَ العتبةِ السياديّةِ تُرفَضُ', () => {
  const { dir, cleanup } = copyTree();
  try {
    // `purge-data` فعلٌ فوقَ العتبةِ في `config/policies.yaml`. وجدولتُه تعني أنّ
    // مؤقِّتاً يفعلُ ما لا يقعُ إلا بأمرٍ ملكيٍّ.
    seed(dir, join('config', 'schedule.yaml'), (source) =>
      source.replace('      - read-registry\n', '      - read-registry\n      - purge-data\n'),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, `الحاجزُ قبلَ جدولةَ فعلٍ سياديٍّ: ${output}`);
    assert.match(output, /SOVEREIGN_ACTION_NOT_SCHEDULABLE/u);
    assert.doesNotMatch(output, /at ModuleJob\.run/u);
  } finally {
    cleanup();
  }
});

test('M3: نزعُ فحصِ نقطةِ التفويضِ من مسارِ الإطلاقِ يُرفَضُ', () => {
  const { dir, cleanup } = copyTree();
  try {
    seed(dir, join('src', 'scheduling', 'scheduler.mjs'), (source) =>
      source.replace('    this.#assertAuthorizer();\n', ''),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, `الحاجزُ قبلَ إطلاقاً بلا فحصِ نقطةِ تفويضٍ: ${output}`);
    assert.match(output, /S4/u);
  } finally {
    cleanup();
  }
});

test('M4: إطلاقٌ بلا استهلاكِ تذكرةٍ يُرفَضُ', () => {
  const { dir, cleanup } = copyTree();
  try {
    seed(dir, join('src', 'scheduling', 'scheduler.mjs'), (source) =>
      source.replace(
        'authorizer.verify(token ?? undefined, {',
        'const unusedVerify = (/** @type {unknown} */ _ignored) => _ignored;\n    unusedVerify({',
      ),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, `الحاجزُ قبلَ إطلاقاً بلا استهلاكِ تذكرةٍ: ${output}`);
    assert.match(output, /S4/u);
  } finally {
    cleanup();
  }
});

test('M5: قراءةُ الموعدِ من الذاكرةِ تُرفَضُ', () => {
  const { dir, cleanup } = copyTree();
  try {
    seed(dir, join('src', 'scheduling', 'scheduler.mjs'), (source) =>
      source.replace('    this.handlers = new Map();', '    this.lastRunAt = new Map();'),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, `الحاجزُ قبلَ موعداً في الذاكرةِ: ${output}`);
    assert.match(output, /S5/u);
  } finally {
    cleanup();
  }
});

test('M6: رفعُ قفلِ الشقِّ من الهجرةِ يُرفَضُ', () => {
  const { dir, cleanup } = copyTree();
  try {
    seed(dir, join('migrations', '0021_scheduled_runs.up.sql'), (source) =>
      source.replace(/UNIQUE\s*\(\s*job_id\s*,\s*slot_at\s*,\s*phase\s*\)/iu, 'UNIQUE (hash)'),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, `الحاجزُ قبلَ دفتراً بلا قفلِ شقٍّ في القاعدةِ: ${output}`);
    assert.match(output, /S6/u);
  } finally {
    cleanup();
  }
});

test('M7: تصفيةُ المستودعِ بشكلٍ لا يعرفُه تُرفَضُ — وهي العيبُ الذي وقعَ فعلاً', () => {
  const { dir, cleanup } = copyTree();
  try {
    seed(dir, join('src', 'scheduling', 'run-ledger.mjs'), (source) =>
      source.replace(
        'this.repository.list({ filter: { jobId } })',
        'this.repository.list({ jobId })',
      ),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, `الحاجزُ قبلَ مُصفّياً لا يعرفُه المستودعُ: ${output}`);
    assert.match(output, /S7/u);
  } finally {
    cleanup();
  }
});

test('M8: نزعُ المُجدوِلِ من التركيبِ يُرفَضُ', () => {
  const { dir, cleanup } = copyTree();
  try {
    seed(dir, join('src', 'persistence', 'composition.mjs'), (source) =>
      source.replace('new Scheduler(', 'buildSchedulerSomehow('),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, `الحاجزُ قبلَ تركيباً بلا مُجدوِلٍ: ${output}`);
    assert.match(output, /S6/u);
  } finally {
    cleanup();
  }
});
