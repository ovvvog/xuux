#!/usr/bin/env node
// @ts-nocheck
// scripts/pkcs11-existing-eddsa-sign-test.mjs
// يتحقّق من قدرة مفتاحٍ Ed25519 موجود (F06/F07) على التوقيع داخل HSM، ويُبلِغ عن OID المنحنى.
//
// الاستعمال:
//   XUUX_PKCS11_KEY_ID=07 XUUX_PKCS11_MODULE=... XUUX_PKCS11_PIN="$PIN" \
//     node scripts/pkcs11-existing-eddsa-sign-test.mjs
//   # أو بالاسم:
//   XUUX_PKCS11_KEY_LABEL=command-ledger-signing-key ...
//
// يبحث عن المفتاح الخاص بـCKA_ID (أو CKA_LABEL)، يقرأ OID المنحنى من CKA_EC_PARAMS
// (للتمييز بين Ed25519 1.3.101.112 وX25519 1.3.101.110 دون لمس المادة الخاصة)،
// يوقّع رسالة عبر C_Sign(CKM_EDDSA)، ويتحقّق بالمفتاح العام. يخرج رمزاً غير صفري عند الفشل.
import { Buffer } from 'node:buffer';
import { createPublicKey, verify } from 'node:crypto';
import {
  ED25519_EC_PARAMS,
  X25519_EC_PARAMS,
  ED25519_OID_DOTTED,
  X25519_OID_DOTTED,
} from './pkcs11-oids.mjs';

const nsMod = (await import('pkcs11js')).default ?? (await import('pkcs11js'));
const PKCS11 = nsMod.PKCS11;
const lib = nsMod;

function curveOid(ecParams) {
  // ecParams = DER OBJECT_ID: 06 03 2B 65 xx
  const last = ecParams[ecParams.length - 1];
  if (ecParams.equals(ED25519_EC_PARAMS)) return { dotted: ED25519_OID_DOTTED, kind: 'Ed25519' };
  if (ecParams.equals(X25519_EC_PARAMS)) return { dotted: X25519_OID_DOTTED, kind: 'X25519' };
  return { dotted: `unknown(0x${last.toString(16)})`, kind: 'unknown' };
}

const mod = new PKCS11();
mod.load(process.env.XUUX_PKCS11_MODULE);
mod.C_Initialize();
const tokenLabel = process.env.XUUX_PKCS11_TOKEN ?? 'xuux-security';
const expectedSerial = process.env.XUUX_PKCS11_TOKEN_SERIAL ?? '';
const allSlots = mod.C_GetSlotList(true);
if (!allSlots?.length) {
  console.error('FAIL: no tokens present');
  process.exit(1);
}
let slot = null;
for (const sl of allSlots) {
  try {
    const ti = mod.C_GetTokenInfo(sl);
    if (ti?.label?.trim() === tokenLabel) {
      slot = sl;
      break;
    }
  } catch {
    /* skip */
  }
}
if (!slot) {
  console.error(`FAIL: token '${tokenLabel}' not found`);
  process.exit(1);
}
if (expectedSerial) {
  const ser = mod.C_GetTokenInfo(slot).serialNumber;
  if (ser && ser.trim() !== expectedSerial) {
    console.error(`FAIL: serial mismatch ${ser} ≠ ${expectedSerial}`);
    process.exit(1);
  }
}
const s = mod.C_OpenSession(slot, 6);
mod.C_Login(s, 1, process.env.XUUX_PKCS11_PIN);

const keyId = process.env.XUUX_PKCS11_KEY_ID;
const keyLabel = process.env.XUUX_PKCS11_KEY_LABEL;
if (!keyId && !keyLabel) {
  console.error('FAIL: set XUUX_PKCS11_KEY_ID (06|07) or XUUX_PKCS11_KEY_LABEL');
  process.exit(2);
}
const tmpl = keyId
  ? [{ type: 0x102, value: Buffer.from(keyId, 'hex') }] // CKA_ID
  : [{ type: 0x82, value: keyLabel }]; // CKA_LABEL
mod.C_FindObjectsInit(s, tmpl);
const objs = mod.C_FindObjects(s, 16);
mod.C_FindObjectsFinal(s);
console.log(
  `found ${objs.length} object(s) for ${keyId ? 'CKA_ID=' + keyId : 'label=' + keyLabel}`,
);
if (!objs.length) {
  console.error('FAIL: no objects');
  process.exit(1);
}

let priv = null,
  pubObj = null;
for (const o of objs) {
  const cls = mod.C_GetAttributeValue(s, o, [{ type: lib.CKA_CLASS }])[0].value;
  const clsNum = cls[0]; // CK_ULONG little-endian
  if (clsNum === 3)
    priv = o; // CKO_PRIVATE_KEY
  else if (clsNum === 2) pubObj = o; // CKO_PUBLIC_KEY
}
// CKA_EC_PARAMS (0x180) lives on the public key; read it there.
const ecParams = mod.C_GetAttributeValue(s, pubObj, [{ type: 0x180 }])[0].value;
const oi = curveOid(ecParams);
console.log(`curve OID=${oi.dotted} kind=${oi.kind}`);
if (oi.kind === 'X25519') {
  console.error(
    'FAIL: existing key is X25519 (wrong OID 1.3.101.110), not Ed25519 — cannot sign with CKM_EDDSA. Regenerate with the corrected keygen (OID 1.3.101.112).',
  );
  process.exit(1);
}
if (!priv) {
  console.error('FAIL: private key object not found');
  process.exit(1);
}
const ecPoint = mod.C_GetAttributeValue(s, pubObj ?? priv, [{ type: 0x181 }])[0].value; // CKA_EC_POINT
const raw = ecPoint.slice(ecPoint[0] === 0x04 ? 2 : 0, (ecPoint[0] === 0x04 ? 2 : 0) + 32);
const der = Buffer.concat([
  Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]),
  raw,
]);
const pubKey = createPublicKey({ key: der, format: 'der', type: 'spki' });
const msg = Buffer.from(`xuux-eddsa-sign-test-${keyId || keyLabel}`);
mod.C_SignInit(s, { mechanism: 0x1057 }, priv); // CKM_EDDSA
const sig = mod.C_Sign(s, msg, Buffer.alloc(64));
const ok = verify(null, msg, pubKey, sig);
console.log(`sign: siglen=${sig.length} verify=${ok}`);
if (!ok) {
  console.error('FAIL: signature did not verify');
  process.exit(1);
}
console.log(`PASS: existing ${keyId || keyLabel} (${oi.kind}) signs inside HSM and verifies.`);
// إغلاق نظيف لتجنّب انهيار التفكيك الأصيل (SoftHSM/Botan teardown).
try {
  mod.C_Logout(s);
  mod.C_CloseSession(s);
} catch {
  /* teardown */
}
try {
  mod.C_Finalize();
} catch {
  /* teardown */
}
process.exit(0);
