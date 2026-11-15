// اختبار حاجز نسب البيانات — M7.04.
//
// حاجزٌ يُقاس بنجاحه وحده ليس دليلاً: النجاح قد يكون لأنه لا يفحص شيئاً. فالمقيس
// هنا أنه **يفشل حين يجب**: تُنسخ شجرة المشروع إلى مجلد مؤقّت، ويُزرع فيها في كل
// مرّة عودةٌ واحدة إلى النسب المُدّعى، ويُطلب من الحاجز أن يرفض. والحالات المزروعة
// هي نفس الطرق التي كان النسب بها ادّعاءً: عمود حرّ يكتبه صاحب الطلب، ومُسجّلٌ
// معلَنٌ لا يسجّل، وقيدٌ في الإعداد بلا قيدٍ في القاعدة.
//
// دُمِجَ هنا (‏WL-543، حدُّ G1): ما كان tests/tooling/guard-memory.test.mjs —
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
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = join(ROOT, 'scripts', 'guard-lineage.mjs');

/**
 * ينسخ ما يحتاجه الحاجز فقط: الإعداد والكود والهجرات.
 * @returns {{ dir: string, cleanup: () => void }}
 */
function copyTree() {
  const dir = mkdtempSync(join(tmpdir(), 'xuux-lineage-guard-'));
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
      // الحاجز يفحص المخزون إن وُجدت `DATABASE_URL`؛ والاختبار يقيس القواعد
      // الساكنة، فتُنزع الوصلة كي لا يتعلّق نتيجةُ الاختبار ببيئة المشغّل.
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
  assert.match(output, /عمود الادّعاء لم يعد/);
  // المادة 2: ما لم يُقَس يُعلَن متروكاً ولا يُدّعى نجاحه.
  assert.match(output, /R5: فحص المخزون متروك/);
});

test('الحاجز يفشل إن عاد حقل النسب المُدّعى إلى مواصفة الأصل', () => {
  const { dir, cleanup } = copyTree();
  try {
    const specPath = join(dir, 'src', 'persistence', 'entities.mjs');
    const source = readFileSync(specPath, 'utf8');
    // نفس الشكل القديم بعينه: مصفوفةٌ حرّة يكتبها من يسجّل الأصل. والزرع يُحدَّد
    // بموضعه داخل مواصفة الأصل لا بنصٍّ قد يتكرّر في مواصفةٍ أخرى.
    const specStart = source.indexOf('export const DATA_ASSET_SPEC');
    const anchor = source.indexOf("id: { column: 'id'", specStart);
    writeFileSync(
      specPath,
      `${source.slice(0, anchor)}lineage: { column: 'lineage', type: 'json', required: false },\n      ${source.slice(anchor)}`,
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'عودةُ حقل الادّعاء عبرت الحاجز');
    assert.match(output, /R1/);
    assert.match(output, /lineage/);
  } finally {
    cleanup();
  }
});

test('الحاجز يفشل إن أعادت هجرةٌ لاحقة عمود النسب', () => {
  const { dir, cleanup } = copyTree();
  try {
    writeFileSync(
      join(dir, 'migrations', '0099_relapse.up.sql'),
      "ALTER TABLE state.data_assets ADD COLUMN lineage jsonb NOT NULL DEFAULT '[]'::jsonb;\n",
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'هجرةٌ تُعيد العمود عبرت الحاجز');
    assert.match(output, /R1/);
    assert.match(output, /0099_relapse/);
  } finally {
    cleanup();
  }
});

test('الحاجز يفشل إن كفّ مُسجّلٌ معلَن عن الكتابة في الدفتر', () => {
  const { dir, cleanup } = copyTree();
  try {
    const gatePath = join(dir, 'src', 'data', 'access-gate.mjs');
    const source = readFileSync(gatePath, 'utf8');
    // البوابة تبقى تفحص التخليص وتسجّل الحدث، لكنها تكفّ عن تسجيل النسب — وهذا
    // هو الانحراف الصامت: الإعداد يقول «من قرأه محفوظ» والكود لا يحفظه.
    writeFileSync(gatePath, source.replaceAll('.record(', '.noRecord('));
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'مُسجّلٌ لا يسجّل عبر الحاجز');
    assert.match(output, /R2/);
    assert.match(output, /access-gate/);
  } finally {
    cleanup();
  }
});

test('الحاجز يفشل إن أُعلن قيدٌ في السياسة ولا وجود له في هجرة', () => {
  const { dir, cleanup } = copyTree();
  try {
    const configPath = join(dir, 'config', 'lineage.yaml');
    const source = readFileSync(configPath, 'utf8');
    writeFileSync(
      configPath,
      source.replace('    - data_lineage_kind_known', '    - data_lineage_promise_only'),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'قيدٌ موعودٌ بلا قيدٍ في القاعدة عبر الحاجز');
    assert.match(output, /R3/);
    assert.match(output, /data_lineage_promise_only/);
  } finally {
    cleanup();
  }
});

// ── دُمِجَ هنا (‏WL-543، حدُّ G1): ما كان tests/tooling/guard-memory.test.mjs — (‏كتلةٌ مستقلّةُ النطاق: أسماءٌ مشتركة) ──
{
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
}
