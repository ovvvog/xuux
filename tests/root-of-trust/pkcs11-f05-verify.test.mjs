// @ts-nocheck
// tests/root-of-trust/pkcs11-f05-verify.test.mjs
//
// اختبار محلّل سجل keygen في التحقق الموجَّه من F05 (WL-088).
//
// السبب: الدليل على أن نطاق الإتلاف كان 06 و07 فقط يُقرأ من سجل keygen. لو
// انزلق المحلّل — فطابق سطراً لا يعني إتلافاً، أو أهمل سطر إتلافٍ حقيقياً، أو
// قبِل نطاقاً أوسع — لصار السجل دليلاً كاذباً على سلامة F05. هذه هي الحالة
// التي يحرسها هذا الملف. لا HSM ولا PIN — دوالٌ نقيةٌ فقط.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { parseKeygenLog, F06_F07_LABELS, F05_LABEL } =
  await import('../../scripts/pkcs11-f05-verify.mjs');

// سجلٌ مطابقٌ لمخرجات التدوير الفعلي في WL-088.
const GOOD_LOG = [
  '[keygen] خطة الاستبدال مقبولة: docs/adr/0003-hsm-f06-f07-key-rotation.md',
  '[keygen] token=xuux-security serial=(غير متحقَّق)',
  '[keygen] تدوير انتقائي: CKA_ID=06,07 (المفاتيح الأخرى محمية)',
  '[keygen] king-signing-key: أُتلِف 2 عنصر قائم (--replace).',
  '[keygen] king-signing-key (توقيع أوامر التاج (F06))',
  '  CKA_ID=06 نوع=ed25519',
  '[keygen] command-ledger-signing-key: أُتلِف 2 عنصر قائم (--replace).',
  '[keygen] command-ledger-signing-key (توقيع سجل الأوامر (F07))',
  '  CKA_ID=07 نوع=ed25519',
  '[keygen] تم.',
].join('\n');

describe('parseKeygenLog — نطاق التدوير', () => {
  test('يستخرج CKA_ID=06,07 مرتّباً من السجل الفعلي', () => {
    assert.deepEqual(parseKeygenLog(GOOD_LOG).scopeIds, ['06', '07']);
  });

  test('يُرجع null إن غاب سطر النطاق (لا يُفترض نطاقٌ ضمنيّ)', () => {
    const log = GOOD_LOG.split('\n')
      .filter((l) => !l.includes('تدوير انتقائي'))
      .join('\n');
    assert.equal(parseKeygenLog(log).scopeIds, null);
  });

  test('نطاقٌ أوسع يشمل 05 لا يُقرأ كـ06,07', () => {
    const log = GOOD_LOG.replace('CKA_ID=06,07', 'CKA_ID=05,06,07');
    assert.deepEqual(parseKeygenLog(log).scopeIds, ['05', '06', '07']);
    assert.notEqual(parseKeygenLog(log).scopeIds.join(','), '06,07');
  });

  test('ترتيب المعرّفات في السجل لا يغيّر النتيجة', () => {
    const log = GOOD_LOG.replace('CKA_ID=06,07', 'CKA_ID=07,06');
    assert.deepEqual(parseKeygenLog(log).scopeIds, ['06', '07']);
  });
});

describe('parseKeygenLog — أوسمة الإتلاف', () => {
  test('يستخرج وسمَي F06/F07 فقط من السجل الفعلي', () => {
    assert.deepEqual(parseKeygenLog(GOOD_LOG).destroyedLabels, F06_F07_LABELS);
  });

  test('يكشف إتلاف وسم F05 لو ظهر في السجل', () => {
    const log = `${GOOD_LOG}\n[keygen] ${F05_LABEL}: أُتلِف 1 عنصر قائم (--replace).`;
    const { destroyedLabels } = parseKeygenLog(log);
    assert.ok(destroyedLabels.includes(F05_LABEL), 'يجب أن يُرصد إتلاف وسم F05');
    assert.equal(destroyedLabels.length, 3);
  });

  test('سطر وصفٍ لا يحوي كلمة الإتلاف لا يُحسب إتلافاً', () => {
    const { destroyedLabels } = parseKeygenLog(
      '[keygen] king-signing-key (توقيع أوامر التاج (F06))\n  CKA_ID=06 نوع=ed25519',
    );
    assert.deepEqual(destroyedLabels, [], 'سطر الوصف ليس سطر إتلاف');
  });

  test('سجلٌ بلا إتلاف يُرجع قائمةً فارغة لا قائمةً مفترضة', () => {
    assert.deepEqual(parseKeygenLog('[keygen] تم.').destroyedLabels, []);
  });

  test('وسم F05 ليس من أوسمة F06/F07 المتوقّعة', () => {
    assert.ok(!F06_F07_LABELS.includes(F05_LABEL), 'وسم F05 لا يجوز أن يكون ضمن نطاق الإتلاف');
    assert.equal(F06_F07_LABELS.length, 2);
  });
});

describe('parseKeygenLog — اشتباك حارس F05', () => {
  test('يرصد F05_PROTECTED إن اشتبك الحارس', () => {
    assert.equal(parseKeygenLog(`${GOOD_LOG}\n[keygen] FAIL (F05_PROTECTED): ...`).f05Trip, true);
  });

  test('السجل النظيف لا يُبلّغ عن اشتباك', () => {
    assert.equal(parseKeygenLog(GOOD_LOG).f05Trip, false);
  });
});

describe('سكربت التحقق من F05 — لا يمسّ HSM عند الاستيراد ولا يطبع سرّاً', () => {
  test('الاستيراد لا يشغّل main (حرس الاستدعاء المباشر موجود)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { join, dirname } = await import('node:path');
    const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = readFileSync(join(repo, 'scripts/pkcs11-f05-verify.mjs'), 'utf8');
    assert.match(src, /import\.meta\.url === `file:\/\/\$\{process\.argv\[1\]\}`/);
  });

  test('لا يطبع CKA_VALUE ولا PIN في أيّ مخرَج', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../scripts/pkcs11-f05-verify.mjs', import.meta.url),
      'utf8',
    );
    const logLines = src.split('\n').filter((l) => /console\.(log|error)/.test(l));
    for (const line of logLines) {
      assert.doesNotMatch(line, /\bpin\b/i, `سطر طباعة يذكر PIN: ${line.trim()}`);
      assert.doesNotMatch(line, /CKA_VALUE\s*\)/, `سطر طباعة قد يُخرج CKA_VALUE: ${line.trim()}`);
    }
  });
});

// ── WL-563 (G1): نُقلَ هنا حرفيّاً جسمُ `tests/root-of-trust/pkcs11-keygen-selective-rotation.test.mjs` (‏الاستيراداتُ
// ‏موحَّدةٌ أعلاه). رأسُه الأصليّ:
//
// التحقق من التدوير الانتقائي (--only 06,07) وحماية F05 من التدمير العرضي.
// لا يتطلّب HSM — يختبر الدوال النقية فقط.

const { parseOnly, selectSpecs, f05Protected } = await import('../../scripts/pkcs11-keygen.mjs');

const F05 = { id: '05', label: 'event-log-aead-key', kind: 'aes' };
const F06 = { id: '06', label: 'king-signing-key', kind: 'ed25519' };
const F07 = { id: '07', label: 'command-ledger-signing-key', kind: 'ed25519' };
const SPECS = [F06, F05, F07];

test('parseOnly: يُرجع null عند غياب --only', () => {
  assert.equal(parseOnly(['node', 'keygen']), null);
});

test('parseOnly: يُرجع مجموعة المعرّفات المفصولة بفواصل', () => {
  assert.deepEqual([...parseOnly(['node', 'keygen', '--only', '06,07'])].sort(), ['06', '07']);
});

test('parseOnly: يُطبّع المعرّف من رقم واحد إلى صيغة 06', () => {
  assert.ok(parseOnly(['node', 'keygen', '--only', '6,7']).has('06'));
  assert.ok(parseOnly(['node', 'keygen', '--only', '6,7']).has('07'));
});

test('selectSpecs: --only 06,07 يستثني F05 (AES) تماماً', () => {
  const only = parseOnly(['node', 'keygen', '--only', '06,07']);
  const selected = selectSpecs(only, SPECS);
  const ids = selected.map((s) => s.id);
  assert.deepEqual(ids.sort(), ['06', '07']);
  assert.ok(!ids.includes('05'), 'F05 يجب ألا يُختار عند --only 06,07');
});

test('selectSpecs: بدون --only يُرجع كل المفاتيح (تشمل F05)', () => {
  const selected = selectSpecs(null, SPECS);
  assert.equal(selected.length, 3);
});

test('f05Protected: F05 محميّة عند --only 06,07', () => {
  const only = parseOnly(['node', 'keygen', '--only', '06,07']);
  assert.equal(f05Protected(F05, only), true, 'F05 يجب أن تكون محمية');
});

test('f05Protected: F05 غير محمية فقط عند ذكر 05 صراحةً', () => {
  const only = parseOnly(['node', 'keygen', '--only', '05,06,07']);
  assert.equal(f05Protected(F05, only), false);
});

test('f05Protected: F06/F07 لا تُحظَر بقيد F05', () => {
  const only = parseOnly(['node', 'keygen', '--only', '06,07']);
  assert.equal(f05Protected(F06, only), false);
  assert.equal(f05Protected(F07, only), false);
});

test('f05Protected: F05 محمية عند --replace شامل بلا --only', () => {
  // تدويرٌ شاملٌ دون تحديد --only يجب أن يحمي F05 أيضاً.
  assert.equal(f05Protected(F05, null), true);
});

test('static: keygen يحتوي حارس F05_PROTECTED وواقي تشغيل main', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../scripts/pkcs11-keygen.mjs', import.meta.url), 'utf8');
  assert.match(src, /F05_PROTECTED/, 'يجب وجود رمز خطأ F05_PROTECTED');
  assert.match(src, /import\.meta\.url/, 'يجب أن يحمي main من التشغيل عند الاستيراد');
  assert.match(src, /--only/, 'يجب دعم علم --only');
});
