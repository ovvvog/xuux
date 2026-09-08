// scripts/pkcs11-oids.mjs
// ثوابت OID الخاصة بـEd25519/X25519 — مصدرٌ واحدٌ مشتركٌ لسكربتات PKCS#11.
//
// حرج: آخر بايت في ED25519_EC_PARAMS يجب أن يكون 0x70 (= 112) وهو OID 1.3.101.112
// (Ed25519). أمّا 0x6e (= 110) فهو OID 1.3.101.110 (X25519) — وتوليد مفتاحٍ بهذا الـOID
// تحت CKM_EC_EDWARDS_KEY_PAIR_GEN يُنتج مفتاح X25519 لا يستطيع التوقيع عبر CKM_EDDSA
// (يُرجع CKR_GENERAL_ERROR). كان هذا هو الجذر الفعلي لفشل توقيع F06/F07 قبل الإصلاح.
// انظر: docs/adr/ADR-hsm-eddsa-oid.md
import { Buffer } from 'node:buffer';

/** DER OBJECT_ID لـEd25519 (1.3.101.112) = 06 03 2B 65 70. */
export const ED25519_EC_PARAMS = Buffer.from([0x06, 0x03, 0x2b, 0x65, 0x70]);

/** DER OBJECT_ID لـX25519 (1.3.101.110) = 06 03 2B 65 6E. يُستخدم فقط للاختبار/التحذير. */
export const X25519_EC_PARAMS = Buffer.from([0x06, 0x03, 0x2b, 0x65, 0x6e]);

export const ED25519_OID_DOTTED = '1.3.101.112';
export const X25519_OID_DOTTED = '1.3.101.110';

// حارس انحدار: يتعطّل فوراً عند استيراد الوحدة إن انزلق الثابت إلى قيمة X25519.
const _lastByte = ED25519_EC_PARAMS[ED25519_EC_PARAMS.length - 1];
if (_lastByte !== 0x70) {
  throw new Error(
    'ED25519_EC_PARAMS must end with 0x70 (Ed25519 / 1.3.101.112); got 0x' +
      (_lastByte ?? 0).toString(16) +
      ' which is X25519 and breaks CKM_EDDSA signing.',
  );
}
