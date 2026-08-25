// اختبار حاجز حدود الذاكرة — M7.05.
//
// حاجزٌ يُقاس بنجاحه وحده ليس دليلاً: النجاح قد يكون لأنه لا يفحص شيئاً. فالمقيس
// هنا أنه **يفشل حين يجب**: تُنسخ شجرة المشروع إلى مجلد مؤقّت، ويُزرع فيها في كل
// مرّة عودةٌ واحدة إلى الطريق القديم، ويُطلب من الحاجز أن يرفض. والحالات المزروعة
// هي نفس الأبواب التي كانت مفتوحة: قيدٌ في الإعداد بلا قيدٍ في القاعدة، ومسارٌ
// محكومٌ يعود إلى قياس الملكية على وسيط المُنادي، ومسارٌ جانبي إلى المستودع،
// ومسارٌ محكومٌ معلَنٌ لا وجود له.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = join(ROOT, 'scripts', 'guard-memory.mjs');

/**
 * ينسخ ما يحتاجه الحاجز فقط: الإعداد والكود والهجرات.
 * @returns {{ dir: string, cleanup: () => void }}
 */
function copyTree() {
  const dir = mkdtempSync(join(tmpdir(), 'xuux-memory-guard-'));
  mkdirSync(dir, { recursive: true });
  cpSync(join(ROOT, 'config'), join(dir, 'config'), { recursive: true });
  cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
  cpSync(join(ROOT, 'migrations'), join(dir, 'migrations'), { recursive: true });
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
      // القواعد المقيسة ساكنة؛ فتُنزع وصلة القاعدة كي لا تتعلّق نتيجة الاختبار
      // ببيئة المشغّل، وفحصُ المخزون يُعلن متروكاً وهو نفسه مقيسٌ أدناه.
      env: { ...process.env, DATABASE_URL: '' },
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

test('الحاجز يمرّ على شجرة المشروع كما هي ويُعلن ما تركه', () => {
  const { status, output } = runGuard(ROOT);
  assert.equal(status, 0, `الحاجز يرفض المستودع الحالي: ${output}`);
  assert.match(output, /مساراً محكوماً يقيس الملكية على الفاعل/);
  // المادة 2: ما لم يُقَس يُعلَن متروكاً ولا يُدّعى نجاحه.
  assert.match(output, /R5: فحص المخزون متروك/);
});

test('R2: الحاجز يفشل إن أُعلن قيدٌ لا وجود له في أي هجرة', () => {
  const { dir, cleanup } = copyTree();
  try {
    const file = join(dir, 'config', 'memory.yaml');
    const source = readFileSync(file, 'utf8');
    writeFileSync(
      file,
      source.replace(
        '    - memories_expiry_required',
        '    - memories_expiry_required\n    - memories_promise_only',
      ),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1);
    assert.match(output, /R2: القيد «memories_promise_only»/);
  } finally {
    cleanup();
  }
});

test('R3: الحاجز يفشل إن عاد النسيان يقيس الملكية على وسيط المُنادي', () => {
  const { dir, cleanup } = copyTree();
  try {
    const file = join(dir, 'src', 'data', 'memory-store.mjs');
    const source = readFileSync(file, 'utf8');
    // نفس التوقيع القديم بعينه: `forget(agentId, id)` — من يعرف المعرّف يمحو.
    writeFileSync(
      file,
      source.replace('async forget(request, legacyId)', 'async forget(agentId, id)'),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1);
    assert.match(output, /R3: «forget».*تأخذ «agentId» وسيطاً أوّل/s);
  } finally {
    cleanup();
  }
});

test('R3: الحاجز يفشل إن اختفى مسارٌ محكوم معلَن', () => {
  const { dir, cleanup } = copyTree();
  try {
    const file = join(dir, 'src', 'data', 'memory-store.mjs');
    const source = readFileSync(file, 'utf8');
    // إزالةُ مسار السرد المحكوم تُعيد الحال الذي كان: لا مسارَ تصفّحٍ في المخزن،
    // فمن أراد التصفّح ذهب إلى المستودع مباشرةً.
    writeFileSync(
      file,
      source.replace('async list({ actor, agentId, limit })', 'async listAll(query)'),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1);
    assert.match(output, /R3: الطريقة «list» معلَنة مساراً محكوماً/);
  } finally {
    cleanup();
  }
});

test('R4: الحاجز يفشل على مسارٍ جانبي إلى مستودع الذاكرة', () => {
  const { dir, cleanup } = copyTree();
  try {
    const file = join(dir, 'src', 'data', 'memory-peek.mjs');
    writeFileSync(
      file,
      [
        '// وحدةٌ مزروعة للاختبار: تقرأ مستودع الذاكرة من غير المخزن.',
        'export async function peek(repositories, agentId) {',
        '  return repositories.memories.list({ filter: { agentId } });',
        '}',
        '',
      ].join('\n'),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1);
    assert.match(output, /R4: الوحدة «src\/data\/memory-peek\.mjs» تلمس مستودع الذاكرة/);
  } finally {
    cleanup();
  }
});
