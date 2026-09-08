#!/usr/bin/env node
// @ts-nocheck
// scripts/pkcs11-backend-probe.mjs
// يُثبت أنّ موديول PKCS#11 المُحدَّد يرتبط بخلفية Botan (libbotan-2.so.19) لا OpenSSL.
//
// الاستعمال:
//   XUUX_PKCS11_MODULE=/opt/softhsm-botan/lib/softhsm/libsofthsm2.so \
//     node scripts/pkcs11-backend-probe.mjs
//
// يقرأ مسار الموديول من XUUX_PKCS11_MODULE (افتراضي: مسار التوزيعة)،
// يتحقّق من وجوده، ثمّ يفحص روابطه الديناميكية عبر `ldd` للبحث عن libbotan
// أو libcrypto/libssl. يخرج رمزاً غير صفريٍّ إن لم يربط Botan.
import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const modulePath =
  process.env.XUUX_PKCS11_MODULE ?? '/usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so';
console.log(`backend-probe: module=${modulePath}`);

if (!existsSync(modulePath)) {
  console.error(`FAIL: module not found at ${modulePath}`);
  console.error('  set XUUX_PKCS11_MODULE to the full path of libsofthsm2.so');
  process.exit(2);
}
const st = statSync(modulePath);
if (!st.isFile()) {
  console.error(`FAIL: ${modulePath} is not a regular file`);
  process.exit(2);
}

let lddOut;
try {
  lddOut = execFileSync('ldd', [modulePath], { encoding: 'utf8' });
} catch (e) {
  console.error(`FAIL: ldd failed: ${e.message}`);
  process.exit(1);
}
console.log('--- ldd ---');
console.log(lddOut.trim());
console.log('-----------');

const linksBotan = /libbotan-2\.so(\.\d+)?/i.test(lddOut);
const linksOpenssl = /libcrypto(\.so|\d)/i.test(lddOut) || /libssl\.so/i.test(lddOut);

console.log(`links libbotan-2: ${linksBotan}`);
console.log(`links libcrypto/libssl: ${linksOpenssl}`);

if (linksBotan) {
  console.log('PASS: module links Botan (libbotan-2) backend.');
  process.exit(0);
}
if (linksOpenssl) {
  console.log('NOTE: module links OpenSSL (libcrypto/libssl), NOT Botan.');
  console.log('  This is the distro SoftHSM build. EdDSA works only if WITH_EDDSA is on');
  console.log('  AND the Ed25519 OID constant is correct (1.3.101.112 / 0x70).');
  process.exit(1);
}
console.error('FAIL: module links neither Botan nor OpenSSL — unexpected.');
process.exit(1);
