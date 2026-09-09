#!/usr/bin/env node
// @ts-nocheck
// scripts/pkcs11-keygen.mjs
// إنشاء مفاتيح Grok-F05 / F06 / F07 داخل توكن SoftHSM2 عبر PKCS#11.
//
// القواعد الحاكمة:
//  - لا مادة خاصة خارج التوكن: لا في Git ولا السجلات ولا مخرجات CI ولا رسائل الأخطاء.
//  - اكتشاف بالـlabel ثم التحقق بالـserial؛ رقم Slot لا يُثبَّت في الكود.
//  - PIN من XUUX_PKCS11_PIN أو ملف بصلاحية 600؛ لا في argv ولا npm script ولا سجل.
//  - فشلٌ مغلق: غياب المكتبة/الموديول/التوكن/الآلية = رفضٌ صريح لا fallback.
//
// الاستعمال:
//   export SOFTHSM2_CONF=... XUUX_PKCS11_MODULE=... XUUX_PKCS11_PIN=... \
//     npm run hsm:keygen
//   (PIN من متغيّر بيئة، أو ملف بصلاحية 600 عبر XUUX_PKCS11_PIN_FILE)
//   --replace : يُتلِف المفاتيح القائمة بنفس الاسم قبل الإنشاء (افتراضياً يرفض التكرار).
//   --log <path> : يكتبُ شهادةَ التوليدِ (نفسَ سطورِ المخرَجِ) في ملفٍّ يقرؤُه
//     `hsm:verify:f05`. عقدٌ واحدٌ بينَ الأمرينِ (`UF-16`): كان المتحقِّقُ يطلبُ
//     سجلاً لا يُنشئُه أحدٌ، فيخرجُ الأمرُ بـ1 دائماً. المسارُ من العَلَمِ ثمَّ
//     `XUUX_KEYGEN_LOG` ثمَّ الافتراضِ `artifacts/hsm/keygen.log`.
//     ولا يُكتَبُ في السجلِّ PIN ولا مادةُ مفتاحٍ — المكتوبُ هو المطبوعُ نفسُه.
//
// المخرجات: المفتاح العام فقط (PEM) + إثبات عدم الاستخراج. لا تُطبع المادة الخاصة.
import { Buffer } from 'node:buffer';
import { createPublicKey } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ED25519_EC_PARAMS } from './pkcs11-oids.mjs';

// ثوابت PKCS#11 v3.0 غير المُصدَّرة في pkcs11js 2.1.7 (متحقَّق من ترويسة p11-kit).
const CKM_EC_EDWARDS_KEY_PAIR_GEN = 0x00001055;
const CKM_EDDSA = 0x00001057;
const CKK_EC_EDWARDS = 0x00000040; // 0x40 وليس 0x28
// CKM_AES_GCM = 0x1087 (lib.CKM_AES_GCM)؛ CKM_AES_KEY_GEN = 0x1080؛ CKK_AES = 0x1f.
// ED25519_EC_PARAMS مستورد من ./pkcs11-oids.mjs (OID 1.3.101.112 = Ed25519).

const KEY_SPECS = [
  {
    id: '06',
    label: 'king-signing-key',
    kind: 'ed25519',
    purpose: 'توقيع أوامر التاج (F06)',
  },
  {
    id: '05',
    label: 'event-log-aead-key',
    kind: 'aes',
    purpose: 'تشفير سجل الأحداث AES-256-GCM (F05)',
  },
  {
    id: '07',
    label: 'command-ledger-signing-key',
    kind: 'ed25519',
    purpose: 'توقيع سجل الأوامر (F07)',
  },
];

// تحديد المفاتيح المستهدفة بالتدوير (--only 06,07) وحماية F05 من التدمير العرضي.
// دوالٌ نقيةٌ قابلةٌ للاختبارِ بلا HSM.
export function parseOnly(argv) {
  const idx = argv.indexOf('--only');
  if (idx === -1) return null;
  const raw = argv[idx + 1];
  if (!raw) fail('ONLY_REQUIRED', '--only يتطلب قائمة معرّفات مفصولة بفواصل (مثل 06,07)');
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.length === 1 ? `0${s}` : s)),
  );
}

export function selectSpecs(onlySet, specs = KEY_SPECS) {
  if (!onlySet) return specs;
  const selected = specs.filter((s) => onlySet.has(s.id));
  if (selected.length === 0) {
    fail('ONLY_NO_MATCH', `لا يوجد مفتاحٌ في KEY_SPECS يطابق --only: ${[...onlySet].join(',')}`);
  }
  return selected;
}

// هل يُحظَر تدمير F05 (AES) صراحةً؟ يُسمح فقط إذا كان 05 ضمن --only.
export function f05Protected(spec, onlySet) {
  return spec.id === '05' && (!onlySet || !onlySet.has('05'));
}

/** المسارُ الافتراضيُّ لشهادةِ التوليدِ — نفسُه في `pkcs11-f05-verify.mjs`. */
export const DEFAULT_KEYGEN_LOG = 'artifacts/hsm/keygen.log';

/**
 * يحلُّ مسارَ شهادةِ التوليدِ: العَلَمُ ثمَّ `XUUX_KEYGEN_LOG` ثمَّ الافتراض.
 * ترتيبٌ مطابقٌ لِمَا في المتحقِّقِ، فلا يفترقُ الأمرانِ (`UF-16`).
 * @param {NodeJS.ProcessEnv} [env] - بيئةُ العملية
 * @param {string[]} [argv] - وسائطُ الأمر
 * @returns {string} مسارُ السجل
 */
export function resolveKeygenLogPath(env = process.env, argv = process.argv) {
  const index = argv.indexOf('--log');
  const flag = (index >= 0 ? (argv[index + 1] ?? '') : '').trim();
  if (flag !== '') return flag;
  const declared = (env.XUUX_KEYGEN_LOG ?? '').trim();
  if (declared !== '') return declared;
  return DEFAULT_KEYGEN_LOG;
}

let logFile = null;

/**
 * يطبعُ سطراً ويكتبُه في شهادةِ التوليدِ.
 * @param {string} line - السطرُ المطبوع
 */
function say(line) {
  console.log(line);
  if (logFile === null) return;
  appendFileSync(logFile, line + '\n', 'utf8');
}

function fail(code, msg) {
  process.stderr.write(`[keygen] FAIL (${code}): ${msg}\n`);
  process.exit(1);
}

function boolStr(v) {
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (v && typeof v === 'object') return v[0] ? 'true' : 'false';
  return '?';
}

// حرّاس الاستبدال: يمنع --replace من تدمير مفاتيح F06/F07 قبل وثائق خطة النسخ/التدوير/التراجع.
// يجب أن يفشل قبل تحميل موديول PKCS#11 أو قراءة PIN أو الوصول إلى HSM.
const REPLACE_PLAN_REQUIRED_HEADINGS = ['backup', 'rotation', 'rollback'];
function assertReplacePlan(argv) {
  if (!argv.includes('--replace')) return; // لا استبدال → لا حاجة للخطة
  const idx = argv.indexOf('--replace-plan');
  const planPath = idx >= 0 ? argv[idx + 1] : null;
  if (!planPath) {
    fail(
      'REPLACE_PLAN_REQUIRED',
      '--replace يتطلب --replace-plan <path> يوثّق النسخ الاحتياطي والتدوير والتراجع. ' +
        'استعمل --only 06,07 لتدوير انتقائي يحمي F05 (AES) السليم. ' +
        'أنشئ ملف ADR (مثال: docs/adr/0002-hsm-eddsa-oid.md) يحتوي الأقسام: ' +
        REPLACE_PLAN_REQUIRED_HEADINGS.join('، ') +
        '.',
    );
  }
  let text;
  try {
    text = readFileSync(planPath, 'utf8');
  } catch {
    fail('REPLACE_PLAN_MISSING', `ملف خطة الاستبدال غير موجود: ${planPath}`);
  }
  const missing = REPLACE_PLAN_REQUIRED_HEADINGS.filter(
    (h) => !new RegExp(`\\b${h}\\b`, 'i').test(text),
  );
  if (missing.length) {
    fail(
      'REPLACE_PLAN_INCOMPLETE',
      `خطة الاستبدال ${planPath} ناقصة الأقسام: ${missing.join('، ')}.`,
    );
  }
  console.log(`[keygen] خطة الاستبدال مقبولة: ${planPath}`);
}

async function loadPkcs11() {
  let ns;
  try {
    ns = await import('pkcs11js');
  } catch {
    fail(
      'MODULE_MISSING',
      'pkcs11js غير مثبَّت. شغّل: npm install pkcs11js (يتطلب g++/make/python3)',
    );
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
    // فحص صلاحية الملف: يجب 0600 (قابل للقراءة/الكتابة للمالك وحدَه).
    const st = statSync(pinFile);
    const mode = st.mode & 0o777;
    if (mode & 0o077) {
      fail(
        'PIN_FILE_TOO_OPEN',
        `ملف الـPIN ${pinFile} بصلاحية ${mode.toString(8)} — يجب 0600. أصلِح: chmod 600 ${pinFile}`,
      );
    }
    const raw = readFileSyncText(pinFile);
    const pin = raw.replace(/\r?\n$/, '');
    if (!pin) fail('PIN_EMPTY', `ملف الـPIN فارغ: ${pinFile}`);
    return pin;
  } catch {
    fail('PIN_MISSING', `ضَع XUUX_PKCS11_PIN أو ملف ${pinFile} بصلاحية 600 (chmod 600)`);
  }
}

// قراءة نصية متزامنة بديلة (لتجنّب import إضافي)
import { readFileSync, statSync } from 'node:fs';
function readFileSyncText(p) {
  return readFileSync(p, 'utf8');
}

function discoverToken(PKCS11, lib, modulePath, tokenLabel, expectedSerial) {
  const mod = new PKCS11();
  try {
    mod.load(modulePath);
  } catch (e) {
    fail('MODULE_LOAD', `تعذّر تحميل الموديول ${modulePath}: ${e.message}`);
  }
  mod.C_Initialize();
  const slots = mod.C_GetSlotList(true);
  if (!slots || slots.length === 0) fail('NO_TOKEN', 'لا توجد توكنات SoftHSM مهيَّأة');
  let found = null;
  for (const slot of slots) {
    try {
      const info = mod.C_GetTokenInfo(slot);
      if (info && info.label && info.label.trim() === tokenLabel) {
        if (found) fail('AMBIGUOUS_TOKEN', `تعددت التوكنات بالاسم ${tokenLabel} — فشلٌ مغلق`);
        found = { slot, serial: info.serialNumber };
      }
    } catch {
      /* تجاوز */
    }
  }
  if (!found) fail('TOKEN_NOT_FOUND', `لم يُعثر على توكن بالاسم ${tokenLabel}`);
  if (expectedSerial && found.serial.trim() !== expectedSerial) {
    fail('SERIAL_MISMATCH', `الـserial ${found.serial} لا يطابق المتوقع ${expectedSerial}`);
  }
  return { mod, lib, slot: found.slot };
}

function openSession({ mod, lib, slot }, pin) {
  const CKF = lib.CKF_SERIAL_SESSION ?? 0x00000004;
  const CKF_RW = lib.CKF_RW_SESSION ?? 0x00000002;
  const CKU_USER = lib.CKU_USER ?? 1;
  const session = mod.C_OpenSession(slot, CKF | CKF_RW);
  mod.C_Login(session, CKU_USER, pin);
  return { session };
}

function makeEd25519Template(lib, label, idHex) {
  const id = Buffer.from(idHex, 'hex');
  const pub = [
    { type: lib.CKA_CLASS, value: lib.CKO_PUBLIC_KEY },
    { type: lib.CKA_KEY_TYPE, value: CKK_EC_EDWARDS },
    { type: lib.CKA_TOKEN, value: true },
    { type: lib.CKA_PRIVATE, value: false },
    { type: lib.CKA_LABEL, value: label },
    { type: lib.CKA_ID, value: id },
    { type: lib.CKA_EC_PARAMS, value: ED25519_EC_PARAMS },
    { type: lib.CKA_VERIFY, value: true },
  ];
  const priv = [
    { type: lib.CKA_CLASS, value: lib.CKO_PRIVATE_KEY },
    { type: lib.CKA_KEY_TYPE, value: CKK_EC_EDWARDS },
    { type: lib.CKA_TOKEN, value: true },
    { type: lib.CKA_PRIVATE, value: true },
    { type: lib.CKA_LABEL, value: label },
    { type: lib.CKA_ID, value: id },
    { type: lib.CKA_SENSITIVE, value: true },
    { type: lib.CKA_EXTRACTABLE, value: false },
    { type: lib.CKA_SIGN, value: true },
    { type: lib.CKA_SIGN_RECOVER, value: false },
    { type: lib.CKA_DECRYPT, value: false },
    { type: lib.CKA_UNWRAP, value: false },
    { type: lib.CKA_DERIVE, value: false },
  ];
  return { pub, priv };
}

function makeAesTemplate(lib, label, idHex) {
  const id = Buffer.from(idHex, 'hex');
  return [
    { type: lib.CKA_CLASS, value: lib.CKO_SECRET_KEY },
    { type: lib.CKA_KEY_TYPE, value: lib.CKK_AES },
    { type: lib.CKA_TOKEN, value: true },
    { type: lib.CKA_PRIVATE, value: true },
    { type: lib.CKA_LABEL, value: label },
    { type: lib.CKA_ID, value: id },
    { type: lib.CKA_VALUE_LEN, value: 32 },
    { type: lib.CKA_SENSITIVE, value: true },
    { type: lib.CKA_EXTRACTABLE, value: false },
    { type: lib.CKA_ENCRYPT, value: true },
    { type: lib.CKA_DECRYPT, value: true },
    { type: lib.CKA_SIGN, value: false },
    { type: lib.CKA_VERIFY, value: false },
    { type: lib.CKA_WRAP, value: false },
    { type: lib.CKA_UNWRAP, value: false },
    { type: lib.CKA_DERIVE, value: false },
  ];
}

function findKeyObjects(mod, session, lib, label) {
  // بحث بـCKA_LABEL عن كل العناصر (عام/خاص/سري) بنفس الاسم.
  try {
    mod.C_FindObjectsInit(session, [{ type: lib.CKA_LABEL, value: label }]);
    const handles = [];
    let batch;
    do {
      batch = mod.C_FindObjects(session, 8);
      if (batch && batch.length) handles.push(...batch);
    } while (batch && batch.length);
    mod.C_FindObjectsFinal(session);
    return handles;
  } catch {
    return [];
  }
}

function destroyKeyObjects(mod, session, lib, label) {
  const handles = findKeyObjects(mod, session, lib, label);
  for (const h of handles) {
    try {
      mod.C_DestroyObject(session, h);
    } catch {
      /* تجاوز */
    }
  }
  return handles.length;
}

function generateKey(mod, session, lib, spec) {
  if (spec.kind === 'ed25519') {
    const { pub, priv } = makeEd25519Template(lib, spec.label, spec.id);
    const r = mod.C_GenerateKeyPair(session, { mechanism: CKM_EC_EDWARDS_KEY_PAIR_GEN }, pub, priv);
    return { publicKey: r.publicKey, privateKey: r.privateKey };
  }
  const tmpl = makeAesTemplate(lib, spec.label, spec.id);
  return { secretKey: mod.C_GenerateKey(session, { mechanism: lib.CKM_AES_KEY_GEN }, tmpl) };
}

function proveNonExtractable(mod, session, lib, handle, spec) {
  // (أ) قراءة CKA_VALUE يجب أن تُرفض بـCKR_ATTRIBUTE_SENSITIVE.
  let valueRejected = false;
  try {
    mod.C_GetAttributeValue(session, handle, [{ type: lib.CKA_VALUE }]);
  } catch (e) {
    valueRejected = /SENSITIVE|0x11/i.test(e.message || String(e.code ?? ''));
  }
  // (ب) التحقق من العلامات: EXTRACTABLE=false، NEVER_EXTRACTABLE=true.
  let extractable = null;
  let neverExtractable = null;
  try {
    const attrs = mod.C_GetAttributeValue(session, handle, [
      { type: lib.CKA_EXTRACTABLE },
      { type: lib.CKA_NEVER_EXTRACTABLE },
    ]);
    extractable = attrs[0]?.value;
    neverExtractable = attrs[1]?.value;
  } catch {
    /* بعض التوكنات لا تُرجع NEVER_EXTRACTABLE كقيمة؛ يُعتمد على CKA_VALUE */
  }
  // (ج) إثبات أن المفتاح موجود وفعّال: عملية ناجحة.
  let operational;
  if (spec.kind === 'ed25519') {
    try {
      mod.C_SignInit(session, { mechanism: CKM_EDDSA }, handle);
      const out = Buffer.alloc(64);
      mod.C_Sign(session, Buffer.from('xuux-keygen-probe'), out);
      operational = true;
    } catch {
      operational = false; // توقيع EdDSA قد يفشل في بعض خلفيات SoftHSM — يُبلَّغ لا يُحجَب الإنشاء
    }
  } else {
    try {
      const iv = Buffer.from('xuux-keygen12');
      const gcm = {
        mechanism: lib.CKM_AES_GCM,
        parameter: {
          type: lib.CK_PARAMS_AES_GCM,
          iv,
          ivBits: 96,
          aad: Buffer.from('xuux'),
          tagBits: 128,
        },
      };
      mod.C_EncryptInit(session, gcm, handle);
      const pt = Buffer.from('probe');
      mod.C_Encrypt(session, pt, Buffer.alloc(pt.length + 16));
      operational = true;
    } catch {
      operational = false;
    }
  }
  return { valueRejected, extractable, neverExtractable, operational };
}

function exportEd25519PublicPem(mod, session, lib, publicKeyHandle) {
  const attrs = mod.C_GetAttributeValue(session, publicKeyHandle, [{ type: lib.CKA_EC_POINT }]);
  const ecPoint = attrs[0]?.value;
  if (!ecPoint || ecPoint.length < 34) throw new Error('EC_POINT غير صالح');
  const raw = ecPoint.slice(ecPoint[0] === 0x04 ? 2 : 0, (ecPoint[0] === 0x04 ? 2 : 0) + 32);
  const der = Buffer.concat([
    Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]),
    raw,
  ]);
  const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  return key.export({ type: 'spki', format: 'pem' });
}

async function main() {
  const argv = process.argv;
  logFile = resolveKeygenLogPath(process.env, argv);
  mkdirSync(dirname(logFile), { recursive: true });
  // شهادةٌ جديدةٌ في كلِّ تشغيلٍ: سجلٌّ متراكمٌ يخلطُ تدويراً بإنشاءٍ فيُقرأُ غلطاً.
  writeFileSync(logFile, '', 'utf8');
  assertReplacePlan(argv); // يفشل قبل أي وصول إلى HSM
  const replace = argv.includes('--replace');
  const onlySet = parseOnly(argv);
  const specs = selectSpecs(onlySet);
  const tokenLabel = process.env.XUUX_PKCS11_TOKEN ?? 'xuux-security';
  const expectedSerial = process.env.XUUX_PKCS11_TOKEN_SERIAL ?? '';
  const modulePath =
    process.env.XUUX_PKCS11_MODULE ?? '/usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so';
  const { lib, PKCS11 } = await loadPkcs11();
  const pin = resolvePin();
  const ctx = discoverToken(PKCS11, lib, modulePath, tokenLabel, expectedSerial || undefined);
  const { session } = openSession(ctx, pin);
  const mod = ctx.mod;

  // سطرُ الوضعِ عقدٌ مقروءٌ آلياً: إنشاءٌ أوّليٌّ لا يُتلِفُ شيئاً، وتدويرٌ يُتلِفُ
  // في نطاقٍ مُعلَنٍ. والمتحقِّقُ يفرضُ على كلِّ وضعٍ شرطَه (`UF-16`).
  say(`[keygen] وضع=${replace ? 'rotation' : 'initial'}`);
  say(`[keygen] token=${tokenLabel} serial=${ctx.serial ?? '(غير متحقَّق)'}`);
  say(`[keygen] نطاق الإنشاء: CKA_ID=${specs.map((spec) => spec.id).join(',')}`);
  if (onlySet)
    say(`[keygen] تدوير انتقائي: CKA_ID=${[...onlySet].join(',')} (المفاتيح الأخرى محمية)`);
  // تحقّقٌ مسبقٌ: افشل قبل أي تدمير إن كان أي مفتاح محمي (F05) ضمن النطاق الشامل.
  if (replace) {
    for (const spec of specs) {
      const existing = findKeyObjects(mod, session, lib, spec.label);
      if (existing.length > 0 && f05Protected(spec, onlySet)) {
        fail(
          'F05_PROTECTED',
          `رفض تدمير F05 (${spec.label}). F05 سليمٌ ولا يُلمَس. أضف 05 صراحةً إلى --only لتأكيد تدوير مفتاح AES.`,
        );
      }
    }
  }
  for (const spec of specs) {
    const existing = findKeyObjects(mod, session, lib, spec.label);
    if (existing.length > 0) {
      if (!replace) {
        fail(
          'KEY_EXISTS',
          `مفتاح ${spec.label} موجود بالفعل (${existing.length} عنصر). استعمل --replace للاستبدال الصريح بعد تأكيد إتلاف القديم.`,
        );
      }
      // حارس F05 مكرّر (دفاعٌ في عمق) — يُفترض ألا يصل إليه بعد التحقق المسبق.
      if (f05Protected(spec, onlySet)) {
        fail(
          'F05_PROTECTED',
          `رفض تدمير F05 (${spec.label}). F05 سليمٌ ولا يُلمَس. أضف 05 صراحةً إلى --only لتأكيد تدوير مفتاح AES.`,
        );
      }
      const n = destroyKeyObjects(mod, session, lib, spec.label);
      say(`[keygen] ${spec.label}: أُتلِف ${n} عنصر قائم (--replace).`);
    }
    const handle = generateKey(mod, session, lib, spec);
    const signHandle = spec.kind === 'ed25519' ? handle.privateKey : handle.secretKey;
    const proof = proveNonExtractable(mod, session, lib, signHandle, spec);
    say(`[keygen] ${spec.label} (${spec.purpose})`);
    say(`  CKA_ID=${spec.id} نوع=${spec.kind}`);
    say(`  CKA_VALUE مرفوض=${proof.valueRejected ? 'نعم (CKR_ATTRIBUTE_SENSITIVE)' : 'لا — خطر'}`);
    say(
      `  CKA_EXTRACTABLE=${boolStr(proof.extractable)} CKA_NEVER_EXTRACTABLE=${boolStr(proof.neverExtractable)}`,
    );
    say(`  عملية داخل HSM=${proof.operational ? 'ناجحة' : 'فاشلة (انظر ملاحظة)'}`);
    if (spec.kind === 'ed25519') {
      try {
        const pem = exportEd25519PublicPem(mod, session, lib, handle.publicKey);
        say('  publicKeyPEM:');
        for (const line of pem.split(/\n/)) if (line) say(`    ${line}`);
      } catch (e) {
        say(`  تعذّر تصدير المفتاح العام: ${e.message}`);
      }
    }
  }
  mod.C_Logout(session);
  mod.C_CloseSession(session);
  mod.C_Finalize();
  say('[keygen] تم.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => fail('UNEXPECTED', e.stack || e.message));
}
