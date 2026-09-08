#!/usr/bin/env node
// @ts-nocheck
// scripts/pkcs11-eddsa-sign-probe.mjs
// فحص مستقل: هل يستطيع توكن SoftHSM2 توقيع Ed25519 داخل الحدود؟
//
// الغرض: يعزل قدرة التوقيع (C_Sign بـCKM_EDDSA) عن التوليد. ينشئ مفتاح Ed25519
// مؤقتاً، يوقّع رسالة داخل HSM، ثم يتحقق من التوقيع بالمفتاح العام المُصدَّر
// عبر node:crypto. يطبع PASS/FAIL مع رمز الخطأ الدقيق.
//
// الاستعمال (على WSL2):
//   export SOFTHSM2_CONF=/home/reeveero/.config/softhsm2/softhsm2.conf
//   XUUX_PKCS11_MODULE=/usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so \
//   XUUX_PKCS11_PIN="$PIN" node scripts/pkcs11-eddsa-sign-probe.mjs
//
// ملاحظة: لا يطبع الـPIN ولا المادة الخاصة. المفتاح المؤقت يُطمس في النهاية.
import { Buffer } from 'node:buffer';
import { createPublicKey, verify } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { ED25519_EC_PARAMS } from './pkcs11-oids.mjs';

const CKM_EC_EDWARDS_KEY_PAIR_GEN = 0x00001055;
const CKM_EDDSA = 0x00001057;
const CKK_EC_EDWARDS = 0x00000040;
const PROBE_LABEL = 'xuux-eddsa-probe';

function out(msg) {
  process.stdout.write(msg + '\n');
}
function fail(code, msg) {
  process.stderr.write(`[probe] FAIL (${code}): ${msg}\n`);
  process.exit(1);
}

async function loadPkcs11() {
  let ns;
  try {
    ns = await import('pkcs11js');
  } catch {
    fail('MODULE_MISSING', 'pkcs11js غير مثبَّت');
  }
  const lib = ns.default ?? ns;
  const PKCS11 = lib.PKCS11;
  if (!PKCS11) fail('MODULE_SHAPE', 'pkcs11js لم يُصدِّر PKCS11');
  return { lib, PKCS11 };
}

function resolvePin() {
  if (process.env.XUUX_PKCS11_PIN) return process.env.XUUX_PKCS11_PIN;
  const pinFile = process.env.XUUX_PKCS11_PIN_FILE ?? `${process.env.HOME}/.config/xuux/pkcs11-pin`;
  try {
    const st = statSync(pinFile);
    const mode = st.mode & 0o777;
    if (mode & 0o077) {
      fail(
        'PIN_FILE_TOO_OPEN',
        `ملف الـPIN ${pinFile} بصلاحية ${mode.toString(8)} — يجب 0600. أصلِح: chmod 600 ${pinFile}`,
      );
    }
    return readFileSync(pinFile, 'utf8').replace(/\r?\n$/, '');
  } catch {
    fail('PIN_MISSING', `ضَع XUUX_PKCS11_PIN أو ملف ${pinFile} بصلاحية 600 (chmod 600)`);
  }
}

function discover({ PKCS11, modulePath, tokenLabel, expectedSerial }) {
  const mod = new PKCS11();
  mod.load(modulePath);
  mod.C_Initialize();
  const slots = mod.C_GetSlotList(true);
  if (!slots?.length) fail('NO_TOKEN', 'لا توكنات');
  let found = null;
  for (const slot of slots) {
    try {
      const info = mod.C_GetTokenInfo(slot);
      if (info?.label?.trim() === tokenLabel) {
        if (found) fail('AMBIGUOUS_TOKEN', `تعددت التوكنات بالاسم ${tokenLabel}`);
        found = { slot, serial: info.serialNumber };
      }
    } catch {
      /* تجاوز */
    }
  }
  if (!found) fail('TOKEN_NOT_FOUND', `لا توكن بالاسم ${tokenLabel}`);
  if (expectedSerial && found.serial.trim() !== expectedSerial)
    fail('SERIAL_MISMATCH', `${found.serial} ≠ ${expectedSerial}`);
  return { mod, slot: found.slot };
}

async function main() {
  let result;
  const tokenLabel = process.env.XUUX_PKCS11_TOKEN ?? 'xuux-security';
  const expectedSerial = process.env.XUUX_PKCS11_TOKEN_SERIAL ?? '';
  const modulePath =
    process.env.XUUX_PKCS11_MODULE ?? '/usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so';
  const { lib, PKCS11 } = await loadPkcs11();
  const pin = resolvePin();
  const { mod, slot } = discover({
    PKCS11,
    lib,
    modulePath,
    tokenLabel,
    expectedSerial: expectedSerial || undefined,
  });
  const CKF = lib.CKF_SERIAL_SESSION ?? 0x4;
  const CKF_RW = lib.CKF_RW_SESSION ?? 0x2;
  const session = mod.C_OpenSession(slot, CKF | CKF_RW);
  mod.C_Login(session, lib.CKU_USER ?? 1, pin);

  out(`[probe] token=${tokenLabel} serial=${expectedSerial || '(غير متحقَّق)'}`);
  out('[probe] الخطوة 1/4: توليد مفتاح Ed25519 مؤقت داخل HSM...');
  const id = Buffer.from('ee', 'hex');
  const pub = [
    { type: lib.CKA_CLASS, value: lib.CKO_PUBLIC_KEY },
    { type: lib.CKA_KEY_TYPE, value: CKK_EC_EDWARDS },
    { type: lib.CKA_TOKEN, value: true },
    { type: lib.CKA_LABEL, value: PROBE_LABEL },
    { type: lib.CKA_ID, value: id },
    { type: lib.CKA_EC_PARAMS, value: ED25519_EC_PARAMS },
    { type: lib.CKA_VERIFY, value: true },
  ];
  const priv = [
    { type: lib.CKA_CLASS, value: lib.CKO_PRIVATE_KEY },
    { type: lib.CKA_KEY_TYPE, value: CKK_EC_EDWARDS },
    { type: lib.CKA_TOKEN, value: true },
    { type: lib.CKA_LABEL, value: PROBE_LABEL },
    { type: lib.CKA_ID, value: id },
    { type: lib.CKA_SENSITIVE, value: true },
    { type: lib.CKA_EXTRACTABLE, value: false },
    { type: lib.CKA_SIGN, value: true },
  ];
  const kp = mod.C_GenerateKeyPair(session, { mechanism: CKM_EC_EDWARDS_KEY_PAIR_GEN }, pub, priv);
  out('[probe] الخطوة 2/4: تصدير المفتاح العام...');
  const ecPoint = mod.C_GetAttributeValue(session, kp.publicKey, [{ type: lib.CKA_EC_POINT }])[0]
    .value;
  const raw = ecPoint.slice(ecPoint[0] === 0x04 ? 2 : 0, (ecPoint[0] === 0x04 ? 2 : 0) + 32);
  const der = Buffer.concat([
    Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]),
    raw,
  ]);
  const pubKey = createPublicKey({ key: der, format: 'der', type: 'spki' });
  out('[probe] الخطوة 3/4: التوقيع داخل HSM عبر C_Sign(CKM_EDDSA)...');
  const message = Buffer.from('xuux-eddsa-probe-message');
  let signature;
  let signError;
  try {
    mod.C_SignInit(session, { mechanism: CKM_EDDSA }, kp.privateKey);
    const outBuf = Buffer.alloc(64);
    signature = mod.C_Sign(session, message, outBuf);
    out(`[probe]   C_Sign نجح، طول التوقيع=${signature.length} بايت`);
  } catch (e) {
    signError = e.message || String(e.code ?? e);
    out(`[probe]   C_Sign فشل: ${signError}`);
  }

  if (signature) {
    out('[probe] الخطوة 4/4: التحقق من التوقيع بالمفتاح العام...');
    let ok = false;
    try {
      ok = verify(null, message, pubKey, signature);
      if (ok) {
        out('[probe] === PASS: التوقيع داخل HSM يعمل والتحقق ناجح ===');
      } else {
        out('[probe] === FAIL: التوقيع أُنتج لكنه لا يُتحقَّق — تناقض ===');
      }
    } catch (e) {
      out(`[probe] === FAIL: تعذّر التحقق: ${e.message} ===`);
    }
    result = ok ? 'pass' : 'fail';
  } else {
    out('[probe] === FAIL: التوقيع داخل HSM (CKM_EDDSA) فشل ===');
    out('[probe] تحقَّق أولاً من OID Ed25519 (1.3.101.112 / 0x70 وليس X25519 1.3.101.110 / 0x6e).');
    out(
      '[probe] إن صحّ OID: تأكد من تفعيل EdDSA في البناء (SoftHSM2 بخلفية Botan مع WITH_EDDSA، أو عتادياً YubiHSM2).',
    );
    result = 'fail';
  }

  // تنظيف: طمس المفتاح المؤقت.
  try {
    mod.C_DestroyObject(session, kp.privateKey);
    mod.C_DestroyObject(session, kp.publicKey);
  } catch {
    /* تجاوز */
  }
  mod.C_Logout(session);
  mod.C_CloseSession(session);
  mod.C_Finalize();
  if (result !== 'pass') {
    process.stderr.write(`[probe] exiting nonzero (result=${result})\n`);
    process.exit(1);
  }
}

main().catch((e) => fail('UNEXPECTED', e.stack || e.message));
