// @ts-nocheck
// tests/sim/tpm-attestation.test.mjs
//
// اختبارات attestation السلبية السبع. تختبر عقد التحقق من شهادة TPM2_NV_Certify
// (الربط: akName, nvIndexName, qualifyingData=بصمة المتن, counter, التوقيع).
//
// ملاحظة: تُحاكى بنية الشهادة وعقد تحققها في الذاكرة (CertifySim). أمر TPM الحقيقي
// (tpm2 nvcertify) يتطلب إعداد EK/AK خارج نطاق هذا التحقيق غير الإنتاجي.
// عقد التحقق هو ما يُختبر هنا — وهو الجزء الأمني المهم.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CertifySim } from '../../sim/tpm/manifest_seal_sim.mjs';

const AK = 'ak-attest-001';
const NV = 'nv-attest-001';

function makeBody(sequence = 2, instanceId = 'inst-attest') {
  return { version: 3, instanceId, sequence, journalHead: 'j', anchoredCount: 0, haltEpoch: 0, ledgerCommitted: 0 };
}

function freshCertify() {
  const c = new CertifySim(AK, NV);
  const body = makeBody();
  const qd = CertifySim.qualifyingData(body);
  const counter = 5;
  return { c, body, counter, certify: c.attest(counter, qd) };
}

test('attest 1: akName خاطئ ⇒ رفض', () => {
  const { c, body, counter, certify } = freshCertify();
  const v = c.verify(certify, { akName: 'ak-WRONG', nvIndexName: NV, counter, body });
  assert.equal(v.ok, false);
  assert.equal(v.error, 'akName_mismatch');
});

test('attest 2: nvIndexName خاطئ ⇒ رفض', () => {
  const { c, body, counter, certify } = freshCertify();
  const v = c.verify(certify, { akName: AK, nvIndexName: 'nv-WRONG', counter, body });
  assert.equal(v.ok, false);
  assert.equal(v.error, 'nvIndexName_mismatch');
});

test('attest 3: qualifyingData خاطئة (بصمة متن مختلفة) ⇒ رفض', () => {
  const { c, counter, certify } = freshCertify();
  // متن مختلف (sequence مغاير) ⇒ qualifyingData مختلفة
  const otherBody = makeBody(99);
  const v = c.verify(certify, { akName: AK, nvIndexName: NV, counter, body: otherBody });
  assert.equal(v.ok, false);
  assert.equal(v.error, 'qualifyingData_mismatch');
});

test('attest 4: instanceId مختلف ⇒ qualifyingData مختلفة ⇒ رفض', () => {
  const { c, counter, certify } = freshCertify();
  const otherBody = makeBody(2, 'inst-DIFFERENT');
  const v = c.verify(certify, { akName: AK, nvIndexName: NV, counter, body: otherBody });
  assert.equal(v.ok, false);
  assert.equal(v.error, 'qualifyingData_mismatch');
});

test('attest 5: توقيع مُلبّد ⇒ رفض', () => {
  const { c, body, counter, certify } = freshCertify();
  const tampered = { attest: certify.attest, signature: '00'.repeat(64) };
  const v = c.verify(tampered, { akName: AK, nvIndexName: NV, counter, body });
  assert.equal(v.ok, false);
  assert.equal(v.error, 'signature_invalid');
});

test('attest 6: شهادة قديمة مع متن أحدث ⇒ counter mismatch ⇒ رفض', () => {
  const { c, body, counter, certify } = freshCertify();
  // الشهادة عند counter=5، لكن المتن الحالي يتوقع counter=6
  const v = c.verify(certify, { akName: AK, nvIndexName: NV, counter: counter + 1, body });
  assert.equal(v.ok, false);
  assert.equal(v.error, 'counter_mismatch');
});

test('attest 7: شهادة غائبة/مشوّهة ⇒ رفض', () => {
  const { c, body, counter } = freshCertify();
  assert.equal(c.verify(null, { akName: AK, nvIndexName: NV, counter, body }).ok, false);
  assert.equal(c.verify({}, { akName: AK, nvIndexName: NV, counter, body }).ok, false);
  assert.equal(
    c.verify({ attest: {}, signature: 'x' }, { akName: AK, nvIndexName: NV, counter, body }).ok,
    false,
  );
});

// 8) بصمةُ المتنِ مختلفةٌ معَ نَفسِ instanceId وsequence — تغييرُ محتوىً لا
//    هويةٍ (journalHead/ledgerCommitted) ⇒ qualifyingData مختلفة ⇒ رفض.
//    هذا هو اختبارُ «manifest digest مختلف» مستقلاً عن الهويةِ والتسلسلِ.
test('attest 8: manifest digest مختلف (محتوىً لا هويةً) ⇒ qualifyingData_mismatch', () => {
  const { c, certify, counter } = freshCertify();
  const tamperedBody = { ...makeBody(), journalHead: 'tampered:' + 'x'.repeat(32) };
  const v = c.verify(certify, { akName: AK, nvIndexName: NV, counter, body: tamperedBody });
  assert.equal(v.ok, false);
  assert.equal(v.error, 'qualifyingData_mismatch');
  // وكذلك تغييرُ حقلِ عدٍّ رتيبٍ آخرَ في المتنِ:
  const tamperedBody2 = { ...makeBody(), ledgerCommitted: 42 };
  assert.equal(
    c.verify(certify, { akName: AK, nvIndexName: NV, counter, body: tamperedBody2 }).error,
    'qualifyingData_mismatch',
  );
});

// 9) شهادةٌ أحدثُ (counter أعلى) معَ manifest أقدمَ (متوقّعٌ أدنى) ⇒ رفض.
test('attest 9: شهادة أحدث مع manifest أقدم ⇒ counter_mismatch', () => {
  const { c, body, certify } = freshCertify(); // الشهادة عند counter=5
  const v = c.verify(certify, { akName: AK, nvIndexName: NV, counter: 4, body }); // المتنُّ يتوقّعُ 4
  assert.equal(v.ok, false);
  assert.equal(v.error, 'counter_mismatch');
});

// 10) شهادةٌ قديمةٌ معَ manifest أحدثَ (العكسُ) ⇒ رفض — والاتجاهانِ معاً
//     يمنعانِ خلطَ شهاداتِ عصورٍ مختلفةٍ على متنٍّ واحدٍ.
test('attest 10: شهادة قديمة مع manifest أحدث ⇒ counter_mismatch (الاتجاهانِ مرفوضانِ)', () => {
  const { c, body, certify } = freshCertify(); // الشهادة عند counter=5
  const newer = c.verify(certify, { akName: AK, nvIndexName: NV, counter: 6, body }); // المتنُّ يتوقّعُ 6
  assert.equal(newer.ok, false);
  assert.equal(newer.error, 'counter_mismatch');
  const older = c.verify(certify, { akName: AK, nvIndexName: NV, counter: 4, body });
  assert.equal(older.ok, false);
  assert.equal(older.error, 'counter_mismatch');
});

test('attest: شهادة صالحة ⇒ قبول', () => {
  const { c, body, counter, certify } = freshCertify();
  const v = c.verify(certify, { akName: AK, nvIndexName: NV, counter, body });
  assert.equal(v.ok, true);
});
