// @ts-nocheck
// tests/root-of-trust/pkcs11-oid-regression.test.mjs
// اختبار انحدار OID لـEd25519 — يضمن ألّا ينزلق الثابت إلى قيمة X25519 (1.3.101.110)
// التي كانت الجذر الفعلي لفشل توقيع F06/F07 (راجع ADR-0002). لا يتطلّب HSM — يُشغَّل في CI.
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
