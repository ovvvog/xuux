// @ts-nocheck
// tests/root-of-trust/pkcs11-object-class-regression.test.mjs
//
// اختبار انحدار لأصناف كائنات PKCS#11 في سكربت جرد/نسخ التوكن.
//
// السبب (WL-088): كان scripts/pkcs11-backup-token.mjs يعرّف
//   CKO_SECRET_KEY = 0x03  (وهي في الحقيقة CKO_PRIVATE_KEY)
//   CKO_PRIVATE_KEY = 0x01 (وهي في الحقيقة CKO_CERTIFICATE)
// فصنّف البيان مفتاح F05 (AES، الصنف الحقيقي 4) كصنفٍ مجهول `0x4`،
// وصنّف مفتاحَي F06/F07 الخاصَّين (الصنف 3) كـCKO_SECRET_KEY. النتيجة أن
// أيّ تحققٍ يبحث عن F05 بالصنف CKO_SECRET_KEY يفشل زوراً، ويظهر مفتاحٌ خاص
// في خانة المفتاح السري داخل سجل تدقيق — خطأ تصنيفٍ في مسار الأدلة.
//
// المرجع المعياري: PKCS#11 v3.0 §4.1 (CK_OBJECT_CLASS):
//   CKO_DATA=0، CKO_CERTIFICATE=1، CKO_PUBLIC_KEY=2،
//   CKO_PRIVATE_KEY=3، CKO_SECRET_KEY=4.
//
// لا يتطلّب HSM ولا PIN — فحصٌ استاتيكيٌّ للمصدر، يُشغَّل في CI.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  ED25519_EC_PARAMS,
  X25519_EC_PARAMS,
  ED25519_OID_DOTTED,
  X25519_OID_DOTTED,
} from '../../scripts/pkcs11-oids.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..');

// القيم المعيارية الوحيدة المقبولة.
const CANONICAL = {
  CKO_DATA: 0,
  CKO_CERTIFICATE: 1,
  CKO_PUBLIC_KEY: 2,
  CKO_PRIVATE_KEY: 3,
  CKO_SECRET_KEY: 4,
};

// كل ملفٍ يعرّف أصناف الكائنات يدوياً (بدل استيرادها من pkcs11js) يجب أن يمرّ.
const TARGETS = [
  'scripts/pkcs11-backup-token.mjs',
  'scripts/pkcs11-restore-token.mjs',
  'scripts/pkcs11-keygen.mjs',
  'scripts/pkcs11-eddsa-sign-probe.mjs',
  'scripts/pkcs11-existing-eddsa-sign-test.mjs',
];

/**
 * يستخرج تعريفات `const CKO_* = <int>;` من نصّ مصدر.
 * @param {string} src
 * @returns {Record<string, number>}
 */
function extractClassConstants(src) {
  const out = {};
  const re = /^\s*(?:export\s+)?const\s+(CKO_[A-Z_]+)\s*=\s*(0x[0-9a-fA-F]+|\d+)\s*;/gm;
  let m;
  while ((m = re.exec(src)) !== null) out[m[1]] = Number(m[2]);
  return out;
}

describe('أصناف كائنات PKCS#11 — لا تبديل بين PRIVATE_KEY وSECRET_KEY', () => {
  for (const rel of TARGETS) {
    test(`${rel}: كل ثابت CKO_* يطابق PKCS#11 v3.0 §4.1`, () => {
      const src = readFileSync(join(REPO, rel), 'utf8');
      const found = extractClassConstants(src);
      for (const [name, value] of Object.entries(found)) {
        assert.ok(
          name in CANONICAL,
          `${rel}: ثابت صنفٍ غير معروف ${name} — أضِفه إلى الجدول المعياري أو أزِله`,
        );
        assert.equal(
          value,
          CANONICAL[name],
          `${rel}: ${name} = ${value} والصحيح ${CANONICAL[name]} (PKCS#11 v3.0 §4.1)`,
        );
      }
    });
  }

  test('سكربت الجرد يعرّف PUBLIC=2 وPRIVATE=3 وSECRET=4 صراحةً', () => {
    const rel = 'scripts/pkcs11-backup-token.mjs';
    const found = extractClassConstants(readFileSync(join(REPO, rel), 'utf8'));
    assert.equal(found.CKO_PUBLIC_KEY, 2, `${rel}: CKO_PUBLIC_KEY يجب أن يكون 2`);
    assert.equal(found.CKO_PRIVATE_KEY, 3, `${rel}: CKO_PRIVATE_KEY يجب أن يكون 3`);
    assert.equal(found.CKO_SECRET_KEY, 4, `${rel}: CKO_SECRET_KEY يجب أن يكون 4`);
  });

  test('PRIVATE_KEY وSECRET_KEY لا يتساويان ولا يتبادلان القيم', () => {
    const found = extractClassConstants(
      readFileSync(join(REPO, 'scripts/pkcs11-backup-token.mjs'), 'utf8'),
    );
    assert.notEqual(
      found.CKO_PRIVATE_KEY,
      found.CKO_SECRET_KEY,
      'PRIVATE_KEY وSECRET_KEY لا يجوز أن يتساويا',
    );
    assert.notEqual(found.CKO_SECRET_KEY, 3, 'القيمة 3 هي CKO_PRIVATE_KEY لا CKO_SECRET_KEY');
    assert.notEqual(found.CKO_PRIVATE_KEY, 1, 'القيمة 1 هي CKO_CERTIFICATE لا CKO_PRIVATE_KEY');
  });

  test('لا يُعاد استخدام قيمةٍ واحدة لصنفين مختلفين في الملف نفسه', () => {
    for (const rel of TARGETS) {
      const found = extractClassConstants(readFileSync(join(REPO, rel), 'utf8'));
      const values = Object.values(found);
      assert.equal(
        new Set(values).size,
        values.length,
        `${rel}: قيمة صنفٍ مكرّرة بين ثابتين — ${JSON.stringify(found)}`,
      );
    }
  });
});

describe('أصناف كائنات PKCS#11 — تصنيف F05/F06/F07 في البيان', () => {
  test('سكربت الجرد يصنّف الصنف 4 كـCKO_SECRET_KEY (مسار F05)', () => {
    const src = readFileSync(join(REPO, 'scripts/pkcs11-backup-token.mjs'), 'utf8');
    const found = extractClassConstants(src);
    assert.ok(src.includes("'CKO_SECRET_KEY'"), 'يجب أن يُنتج البيان الوسم النصّي CKO_SECRET_KEY');
    // مفتاح F05 (AES) صنفه الحقيقي 4؛ لو بقي الثابت 3 لصُنّف كصنفٍ مجهول.
    assert.equal(found.CKO_SECRET_KEY, 4, 'F05 (AES) صنفه 4؛ أيّ قيمةٍ أخرى تُفقده من البيان');
  });

  test('سكربت الجرد يصنّف الصنف 3 كـCKO_PRIVATE_KEY (مسار F06/F07 الخاص)', () => {
    const found = extractClassConstants(
      readFileSync(join(REPO, 'scripts/pkcs11-backup-token.mjs'), 'utf8'),
    );
    assert.equal(found.CKO_PRIVATE_KEY, 3, 'المفتاح الخاص صنفه 3؛ تصنيفه سرّياً يفسد سجل التدقيق');
  });

  test('بصمة المفتاح العام تُحسب من الصنف 2 فقط', () => {
    const src = readFileSync(join(REPO, 'scripts/pkcs11-backup-token.mjs'), 'utf8');
    const found = extractClassConstants(src);
    assert.equal(found.CKO_PUBLIC_KEY, 2);
    assert.match(
      src,
      /clsNum\s*===\s*CKO_PUBLIC_KEY/,
      'بصمة CKA_EC_POINT يجب أن تُقيَّد بالمفاتيح العامة',
    );
  });
});

// ── WL-563 (G1): نُقلَ هنا حرفيّاً جسمُ `tests/root-of-trust/pkcs11-oid-regression.test.mjs` (‏الاستيراداتُ وُحِّدت،
// ‏و`__dirname`/`REPO` معرَّفان أعلاه بالقيمةِ نفسِها). رأسُه الأصليّ:
// tests/root-of-trust/pkcs11-oid-regression.test.mjs
// اختبار انحدار OID لـEd25519 — يضمن ألّا ينزلق الثابت إلى قيمة X25519 (1.3.101.110)
// التي كانت الجذر الفعلي لفشل توقيع F06/F07 (راجع ADR-0002). لا يتطلّب HSM — يُشغَّل في CI.

describe('OID Ed25519 — ثابت مركزي صحيح', () => {
  test('ED25519_EC_PARAMS = DER OID 1.3.101.112 (06 03 2B 65 70)', () => {
    assert.deepEqual(
      Array.from(ED25519_EC_PARAMS),
      [0x06, 0x03, 0x2b, 0x65, 0x70],
      'OID Ed25519 يجب أن ينتهي بـ0x70 (=112) لا 0x6e (=110 = X25519)',
    );
  });

  test('آخر بايت هو 0x70 وليس 0x6e', () => {
    const last = ED25519_EC_PARAMS[ED25519_EC_PARAMS.length - 1];
    assert.equal(last, 0x70, `آخر بايت يجب أن 0x70؛ حصل 0x${last.toString(16)}`);
    assert.notEqual(last, 0x6e);
  });

  test('ED25519 ≠ X25519 ولا يتطابقان', () => {
    assert.notDeepEqual(Array.from(ED25519_EC_PARAMS), Array.from(X25519_EC_PARAMS));
    assert.equal(ED25519_OID_DOTTED, '1.3.101.112');
    assert.equal(X25519_OID_DOTTED, '1.3.101.110');
  });

  test('X25519_OID هو الذي يكسر CKM_EDDSA ولا يُستعمل لـEd25519', () => {
    assert.deepEqual(Array.from(X25519_EC_PARAMS), [0x06, 0x03, 0x2b, 0x65, 0x6e]);
  });
});

describe('OID Ed25519 — المُنتِج يستخدم الثابت الصحيح', () => {
  // فحصٌ استاتيكيٌّ لمصدر المُوفّر (.mts) لمنع انجراف الثابت المضمَّن عن الوحدة المشتركة.
  test('src/root-of-trust/pkcs11-provider.mts يستخدم OID 1.3.101.112 (0x70) لا X25519', () => {
    const src = readFileSync(join(REPO, 'src/root-of-trust/pkcs11-provider.mts'), 'utf8');
    const line = src.split('\n').find((l) => l.includes('ED25519_EC_PARAMS'));
    assert.ok(line, 'ED25519_EC_PARAMS غير موجود في المُوفّر');
    // افصل جزء Buffer.from([...]) عن التعليق لئلاّ يُسقط تحذيرات 0x6e الشرعيّة.
    const def = line.split('//')[0];
    assert.match(def, /0x70/, 'الثابت في المُوفّر يجب أن يستخدم 0x70 (Ed25519)');
    assert.doesNotMatch(def, /0x6e/, 'الثابت في المُوفّر لا يجب أن يستخدم 0x6e (X25519)');
  });

  test('لا توجد أيّ قيمة OID خاطئة (1.3.101.110 / 0x65, 0x6e) في المصادر', () => {
    const targets = [
      'src/root-of-trust/pkcs11-provider.mts',
      'scripts/pkcs11-keygen.mjs',
      'scripts/pkcs11-eddsa-sign-probe.mjs',
      'scripts/pkcs11-existing-eddsa-sign-test.mjs',
    ];
    for (const rel of targets) {
      const src = readFileSync(join(REPO, rel), 'utf8');
      // السماح بظهور "1.3.101.110"/"0x6e" فقط في سياق تحذيري صريح، لا في تعريف OID الفعلي.
      const defLine = src.split('\n').find((l) => /ED25519_EC_PARAMS\s*[:=]/.test(l));
      if (defLine) {
        const def = defLine.split('//')[0];
        assert.doesNotMatch(def, /0x6e/, `${rel}: تعريف ED25519_EC_PARAMS يستخدم 0x6e (X25519)`);
        assert.match(def, /0x70/, `${rel}: تعريف ED25519_EC_PARAMS لا يستخدم 0x70 (Ed25519)`);
      }
    }
  });
});
