// اختبار حاجز نقطة التفويض — M4.05.
//
// حاجزٌ يُقاس بنجاحه وحده ليس دليلاً: النجاح قد يكون لأنه لا يفحص شيئاً. فالمقيس
// هنا أنه **يفشل حين يجب**: تُنسخ شجرة المشروع إلى مجلد مؤقّت، ويُزرع فيها مسارٌ
// جانبي واحدٌ في كل مرّة، ويُطلب من الحاجز أن يرفض. والحالات المزروعة هي نفس
// الطرق التي كان التجاوز ممكناً بها: نواةٌ لا تتحقّق من التذكرة، ووحدةٌ أخرى
// تُسمّي فعلاً محكوماً وتنفّذه بنفسها، وقائمةٌ حسّاسة في الكود لا تعرفها البيانات.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = join(ROOT, 'scripts', 'guard-authorization.mjs');

/**
 * ينسخ ما يحتاجه الحاجز فقط: البيانات والكود المصدري. نسخُ المستودع كاملاً يجعل
 * الاختبار بطيئاً بلا فائدة.
 * @returns {{ dir: string, cleanup: () => void }}
 */
function copyTree() {
  const dir = mkdtempSync(join(tmpdir(), 'xuux-guard-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  cpSync(join(ROOT, 'config'), join(dir, 'config'), { recursive: true });
  cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * يشغّل الحاجز على شجرة معيّنة ويعيد الخروج ونصّ الخطأ.
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

test('الحاجز يمرّ على شجرة المشروع كما هي', () => {
  const { status, output } = runGuard(ROOT);
  assert.equal(status, 0, `الحاجز يرفض المستودع الحالي: ${output}`);
  assert.match(output, /فعلاً محكوماً/);
});

test('الحاجز يفشل إن كفّت النواة عن التحقّق من التذكرة', () => {
  const { dir, cleanup } = copyTree();
  try {
    const kernelPath = join(dir, 'src', 'core', 'execution-kernel.mjs');
    const source = readFileSync(kernelPath, 'utf8');
    writeFileSync(kernelPath, source.replace(/this\.enforcement\.verify\(/g, 'noop('));
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'نواةٌ لا تتحقّق من التذكرة عبرت الحاجز');
    assert.match(output, /R1/);
  } finally {
    cleanup();
  }
});

test('الحاجز يفشل إن رفضت النواة الاعتماد على البيانات في معرفة المحكوم', () => {
  const { dir, cleanup } = copyTree();
  try {
    const kernelPath = join(dir, 'src', 'core', 'execution-kernel.mjs');
    const source = readFileSync(kernelPath, 'utf8');
    writeFileSync(kernelPath, source.replace(/loadGovernedActions/g, 'emptySet'));
    const { status, output } = runGuard(dir);
    assert.equal(status, 1);
    assert.match(output, /R1/);
  } finally {
    cleanup();
  }
});

test('الحاجز يفشل إن نفّذت وحدةٌ أخرى فعلاً محكوماً بنفسها', () => {
  const { dir, cleanup } = copyTree();
  try {
    // وحدةٌ جديدة تُسمّي فعلاً محكوماً ولا تمرّ بنقطة التفويض — وهذا هو شكل
    // المسار الجانبي في الواقع: لا أحد يخرق السياسة، إنما يبني طريقاً حولها.
    writeFileSync(
      join(dir, 'src', 'core', 'shadow-path.mjs'),
      "export function purge(store) {\n  return store.run('purge-data');\n}\n",
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'مسارٌ جانبي عبر الحاجز');
    assert.match(output, /R2/);
    assert.match(output, /purge-data/);
  } finally {
    cleanup();
  }
});

test('الحاجز يفشل إن عرف الكود فعلاً حسّاساً لا تعرفه البيانات', () => {
  const { dir, cleanup } = copyTree();
  try {
    const legacyPath = join(dir, 'src', 'root-of-trust', 'policy.mts');
    const source = readFileSync(legacyPath, 'utf8');
    writeFileSync(legacyPath, source.replace('new Set([', "new Set([\n  'dissolve-state',"));
    const { status, output } = runGuard(dir);
    assert.equal(status, 1);
    assert.match(output, /R3|R4/);
    assert.match(output, /dissolve-state/);
  } finally {
    cleanup();
  }
});

test('الحاجز يفشل إن نُزع فعلٌ من الكتالوج المحكوم في البيانات', () => {
  const { dir, cleanup } = copyTree();
  try {
    const policiesPath = join(dir, 'config', 'policies.yaml');
    const source = readFileSync(policiesPath, 'utf8');
    // `create-agent` معلَن حسّاساً وليس في العتبة السيادية؛ فإسقاط حسّاسيته من
    // البيانات وحده يُخرجه من الكتالوج المحكوم فيُنفَّذ بلا تذكرة. والحاجز يمسك
    // ذلك لأن المحرّك الأدنى في الكود ما زال يعدّه حسّاساً — أي أن البيانات
    // والكود انحرفا، وهو ما يجب أن يُفشل البناء لا أن يُحسم صامتاً.
    writeFileSync(
      policiesPath,
      source.replace(/\n {2}- id: create-agent\n(.*\n)*? {4}sensitive: true/, (match) =>
        match.replace('sensitive: true', 'sensitive: false'),
      ),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'إسقاط الحسّاسية من البيانات عبر الحاجز');
    assert.match(output, /R4|R2/);
  } finally {
    cleanup();
  }
});

// ── R5 (‏`R6-A-02`): الحاجزُ يفشلُ إن رجعَ مقدارُ الخصمِ رقماً ثابتاً أو سياقاً ──
//
// وهذه هي القاعدةُ التي كان غيابُها سببَ نجاةِ الطفرةِ M15 («ثبِّت المقدارَ على
// 1») من الاختباراتِ كلِّها في جولةِ M11.06.

test('الحاجز يفشل إن قرأت نقطة التفويض مقدار الخصم من سياق المُنادي', () => {
  const { dir, cleanup } = copyTree();
  try {
    const target = join(dir, 'src', 'policy', 'enforcement-point.mjs');
    const source = readFileSync(target, 'utf8');
    writeFileSync(
      target,
      source.replace(
        'const resolved = this.resolveQuotaAmount(quotaResource, measurement.measured);',
        "const amountRaw = evaluated.context?.['quotaAmount'];\n        const resolved = { ok: true, amount: typeof amountRaw === 'number' ? amountRaw : 1, measure: 'x' };",
      ),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'قراءةُ المقدارِ من السياقِ عبرت الحاجز');
    assert.match(output, /R5/);
    assert.match(output, /quotaAmount/);
  } finally {
    cleanup();
  }
});

test('الحاجز يفشل إن مُرِّر مقدارٌ ثابتٌ إلى دفتر الحصص', () => {
  const { dir, cleanup } = copyTree();
  try {
    const target = join(dir, 'src', 'policy', 'enforcement-point.mjs');
    const source = readFileSync(target, 'utf8');
    writeFileSync(target, source.replace('amount: resolved.amount,', 'amount: 1,'));
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'تثبيتُ المقدارِ على 1 عبر الحاجز');
    assert.match(output, /R5/);
  } finally {
    cleanup();
  }
});

test('الحاجز يفشل إن حُذفت وحدة القياس المعلَنة من وثيقة الحصص', () => {
  const { dir, cleanup } = copyTree();
  try {
    const quotasPath = join(dir, 'config', 'quotas.yaml');
    const source = readFileSync(quotasPath, 'utf8');
    writeFileSync(
      quotasPath,
      source.replace(/\n {4}measure:\n {6}kind: measured\n {6}key: bytes/, ''),
    );
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, `حذفُ وحدةِ القياسِ من الوثيقةِ عبر الحاجز: ${output}`);
  } finally {
    cleanup();
  }
});

test('الحاجز يفشل إن كفّت بوابة الإخراج عن تمرير الحجم المقيس', () => {
  const { dir, cleanup } = copyTree();
  try {
    const target = join(dir, 'src', 'egress', 'egress-gate.mjs');
    const source = readFileSync(target, 'utf8');
    writeFileSync(target, source.replace('measured: { bytes },', 'measured: {},'));
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, 'قطعُ قناةِ القياسِ عبر الحاجز');
    assert.match(output, /R5/);
    assert.match(output, /egress-bytes/);
  } finally {
    cleanup();
  }
});
