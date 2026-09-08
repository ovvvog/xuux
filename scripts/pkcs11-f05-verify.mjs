#!/usr/bin/env node
// @ts-nocheck
// scripts/pkcs11-f05-verify.mjs
//
// تحقّقٌ موجَّهٌ من ثبات مفتاح F05 (AES-256-GCM، CKA_ID=05) بعد تدوير F06/F07.
//
// السبب (WL-088): المقارنة بين ملفات تخزين SoftHSM لا تُثبت شيئاً عن F05،
// لأن تطابق ملفٍ ما بين نسختين لا يربط ذلك الملف بـCKA_ID=05. صيغة ملفات
// `.object` في SoftHSM2 داخليةٌ غير موثّقةٍ معيارياً وقابلةٌ للتغيّر بين
// الإصدارات، فلا تُبنى عليها أدلّة. لذلك يُثبَت ثبات F05 بسماته وبعملٍ
// تشفيريٍّ ناجحٍ داخل التوكن، لا باستنتاجٍ من بصمات ملفات.
//
// ما يُثبِته هذا السكربت:
//   1. وجود كائنٍ واحدٍ فقط بـCKA_ID=05 (لا تكرار ولا نسخة ثانية).
//   2. class = CKO_SECRET_KEY (4).
//   3. key_type = CKK_AES (0x1f) وطول 256 بت حيث يُتاح CKA_VALUE_LEN.
//   4. CKA_LABEL مطابقٌ للمتوقَّع (event-log-aead-key).
//   5. CKA_SENSITIVE = true.
//   6. CKA_EXTRACTABLE = false.
//   7. CKA_NEVER_EXTRACTABLE = true.
//   8. CKA_VALUE مرفوضٌ بـCKR_ATTRIBUTE_SENSITIVE (لا مادة مفتاح تُقرأ).
//   9. جولة AES-256-GCM كاملة داخل التوكن: تشفيرٌ ثم فكٌّ يُعيد النصّ نفسه،
//      مع رفض فكِّ نصٍّ مُعدَّلٍ (إثبات صحّة وسم المصادقة).
//  10. أن نطاق الإتلاف في سجل keygen كان 06 و07 فقط ولم يشمل 05.
//
// لا يُطبع ولا يُسجَّل: PIN، CKA_VALUE، أو أيّ مادة مفتاح. النصوص المستخدمة
// في جولة GCM ثابتةٌ معروفةٌ ولا تحمل معلومات.
//
// الاستعمال:
//   SOFTHSM2_CONF=... XUUX_PKCS11_MODULE=... XUUX_PKCS11_PIN=... \
//     node scripts/pkcs11-f05-verify.mjs [--keygen-log <path>] [--label <label>]
//
// الخروج: 0 عند نجاح كل الفحوص، وغير صفري عند أول فشل. لا يُعدِّل شيئاً.
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';

// ---- ثوابت PKCS#11 v3.0 (§4.1 للأصناف، §4.9 للسمات) ----
const CKO_SECRET_KEY = 0x00000004;
const CKK_AES = 0x0000001f;
const CKA_CLASS = 0x00000000;
const CKA_LABEL = 0x00000003;
const CKA_KEY_TYPE = 0x00000100;
const CKA_ID = 0x00000102;
const CKA_SENSITIVE = 0x00000103;
const CKA_VALUE = 0x00000011;
const CKA_VALUE_LEN = 0x00000161;
const CKA_EXTRACTABLE = 0x00000162;
const CKA_NEVER_EXTRACTABLE = 0x00000164;
const CKA_ALWAYS_SENSITIVE = 0x00000165;

const EXPECTED_ID = '05';
const DEFAULT_LABEL = 'event-log-aead-key';

const results = [];
let failed = 0;

/**
 * يسجّل نتيجة فحصٍ واحد. لا يطبع أيّ قيمةٍ حسّاسة — المتّصل مسؤولٌ عن التفاصيل.
 * @param {boolean} ok
 * @param {string} name
 * @param {string} detail
 */
function check(ok, name, detail = '') {
  results.push({ ok, name, detail });
  if (!ok) failed++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function fatal(code, msg) {
  console.error(`[f05-verify] FAIL (${code}): ${msg}`);
  console.log('F05_VERIFY_EXIT=1');
  process.exit(1);
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** يقرأ قيمة سمةٍ منطقيةٍ من buffer بطول بايت واحد أو أكثر. */
function readBool(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v;
  const b = Buffer.from(v);
  return b.length > 0 && b.some((x) => x !== 0);
}

function readU32(v) {
  if (v === undefined || v === null) return null;
  const b = Buffer.from(v);
  return b.length >= 4 ? b.readUInt32LE(0) : b.length === 1 ? b[0] : null;
}

/**
 * يُحلّل سجل keygen ويستخرج نطاق التدوير وأوسمة الإتلاف الفعلية.
 * دالةٌ نقيةٌ مُصدَّرةٌ لتُختبر بلا HSM.
 * @param {string} text نص السجل
 * @returns {{scopeIds: string[]|null, destroyedLabels: string[], f05Trip: boolean}}
 */
export function parseKeygenLog(text) {
  // أسطر الإتلاف: "[keygen] <label>: أُتلِف <n> عنصر قائم (--replace)."
  const destroyedLabels = [...text.matchAll(/^\[keygen\]\s+(\S+?):\s*أُتلِف\s+\d+\s+عنصر/gm)]
    .map((m) => m[1])
    .sort();
  const scope = text.match(/تدوير انتقائي:\s*CKA_ID=([0-9,]+)/);
  return {
    scopeIds: scope ? scope[1].split(',').filter(Boolean).sort() : null,
    destroyedLabels,
    f05Trip: /F05_PROTECTED/.test(text),
  };
}

/** أوسمة F06/F07 المتوقّعة في نطاق الإتلاف، ووسم F05 المحرّم لمسه. */
export const F06_F07_LABELS = ['command-ledger-signing-key', 'king-signing-key'];
export const F05_LABEL = DEFAULT_LABEL;

// ---- 10) نطاق الإتلاف من سجل keygen (فحصٌ نصّيٌّ لا يمسّ التوكن) ----
function verifyKeygenLogScope(logPath) {
  let text;
  try {
    text = readFileSync(logPath, 'utf8');
  } catch {
    check(false, 'keygen_log_readable', `لا يمكن قراءة ${logPath}`);
    return;
  }
  const { scopeIds, destroyedLabels, f05Trip } = parseKeygenLog(text);
  check(
    scopeIds !== null && scopeIds.join(',') === '06,07',
    'keygen_scope_is_06_07_only',
    scopeIds ? `CKA_ID=${scopeIds.join(',')}` : 'سطر النطاق غير موجود في السجل',
  );
  check(
    !destroyedLabels.includes(F05_LABEL),
    'keygen_destroyed_nothing_labelled_f05',
    `وسم F05 (${F05_LABEL}) ${destroyedLabels.includes(F05_LABEL) ? 'أُتلِف' : 'لم يُلمَس'}`,
  );
  check(
    destroyedLabels.length === F06_F07_LABELS.length &&
      destroyedLabels.every((l, i) => l === F06_F07_LABELS[i]),
    'keygen_destroyed_exactly_f06_f07',
    `أوسمة الإتلاف: ${destroyedLabels.join(', ') || '(لا شيء)'}`,
  );
  check(
    !f05Trip,
    'keygen_no_f05_protection_trip',
    'لم يُشتبك حارس F05 أي أن 05 لم يدخل النطاق أصلاً',
  );
}

// ---- التحقق داخل التوكن ----
async function main() {
  const label = argValue('--label') ?? DEFAULT_LABEL;
  const keygenLog = argValue('--keygen-log');

  console.log('[f05-verify] تحقّق موجَّه من ثبات F05 (CKA_ID=05, AES-256-GCM)');
  console.log(`[f05-verify] الوسم المتوقَّع: ${label}`);

  let ns;
  try {
    ns = await import('pkcs11js');
  } catch {
    fatal('MODULE_MISSING', 'pkcs11js غير مثبَّت');
  }
  const lib = ns.default ?? ns;
  const PKCS11 = lib.PKCS11;
  if (!PKCS11) fatal('MODULE_SHAPE', 'pkcs11js لم يُصدِّر PKCS11');

  const modulePath =
    process.env.XUUX_PKCS11_MODULE ?? '/usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so';
  const tokenLabel = process.env.XUUX_PKCS11_TOKEN ?? 'xuux-security';
  const pin = process.env.XUUX_PKCS11_PIN;
  if (!pin) fatal('PIN_MISSING', 'ضَع XUUX_PKCS11_PIN في البيئة (لا يُطبع ولا يُسجَّل)');

  const mod = new PKCS11();
  mod.load(modulePath);
  mod.C_Initialize();
  let session = null;
  try {
    const slots = mod.C_GetSlotList(true);
    if (!slots?.length) fatal('NO_TOKEN', 'لا توكن حاضر');
    let slot = null;
    for (const sl of slots) {
      try {
        if (mod.C_GetTokenInfo(sl)?.label?.trim() === tokenLabel) {
          slot = sl;
          break;
        }
      } catch {
        /* تجاوز */
      }
    }
    if (!slot) fatal('TOKEN_NOT_FOUND', `توكن '${tokenLabel}' غير موجود`);
    session = mod.C_OpenSession(slot, 4 | 2); // SERIAL_SESSION | RW لعمليات GCM
    mod.C_Login(session, 1, pin);

    // 1) عدد الكائنات بـCKA_ID=05
    mod.C_FindObjectsInit(session, [{ type: CKA_ID, value: Buffer.from(EXPECTED_ID, 'hex') }]);
    const handles = [];
    let batch;
    do {
      batch = mod.C_FindObjects(session, 8);
      if (batch?.length) handles.push(...batch);
    } while (batch && batch.length);
    mod.C_FindObjectsFinal(session);

    console.log('[f05-verify] الفحوص:');
    check(handles.length === 1, 'exactly_one_object_with_cka_id_05', `العدد=${handles.length}`);
    if (handles.length !== 1) {
      console.log('F05_VERIFY_EXIT=1');
      process.exit(1);
    }
    const h = handles[0];

    // 2-4) الصنف والنوع والوسم والطول
    const get = (type) => {
      try {
        return mod.C_GetAttributeValue(session, h, [{ type }])[0]?.value;
      } catch {
        return undefined;
      }
    };
    const cls = readU32(get(CKA_CLASS));
    check(cls === CKO_SECRET_KEY, 'class_is_CKO_SECRET_KEY', `class=${cls} (المتوقَّع 4)`);
    const kt = readU32(get(CKA_KEY_TYPE));
    check(kt === CKK_AES, 'key_type_is_CKK_AES', `key_type=0x${(kt ?? 0).toString(16)}`);
    const gotLabel = get(CKA_LABEL);
    const labelStr = gotLabel ? Buffer.from(gotLabel).toString('utf8') : null;
    check(labelStr === label, 'label_matches', `label=${labelStr ?? '(غائب)'}`);
    const vlen = readU32(get(CKA_VALUE_LEN));
    check(
      vlen === null || vlen === 32,
      'value_len_is_256_bit',
      vlen === null ? 'CKA_VALUE_LEN غير متاح (مقبول)' : `${vlen} بايت`,
    );

    // 5-7) علامات الحساسية
    check(readBool(get(CKA_SENSITIVE)) === true, 'CKA_SENSITIVE_true');
    check(readBool(get(CKA_EXTRACTABLE)) === false, 'CKA_EXTRACTABLE_false');
    const neverExt = readBool(get(CKA_NEVER_EXTRACTABLE));
    check(neverExt === true, 'CKA_NEVER_EXTRACTABLE_true', `القيمة=${neverExt}`);
    const alwaysSens = readBool(get(CKA_ALWAYS_SENSITIVE));
    if (alwaysSens !== null) check(alwaysSens === true, 'CKA_ALWAYS_SENSITIVE_true');

    // 8) CKA_VALUE مرفوض — لا يُطبع أيّ شيءٍ من المحاولة سوى نتيجة الرفض
    let valueRejected = false;
    try {
      mod.C_GetAttributeValue(session, h, [{ type: CKA_VALUE }]);
    } catch (e) {
      valueRejected = /SENSITIVE|UNEXTRACTABLE|0x11/i.test(e.message || String(e.code ?? ''));
    }
    check(valueRejected, 'CKA_VALUE_rejected_as_sensitive');

    // 9) جولة AES-256-GCM داخل التوكن
    const iv = Buffer.from('xuux-f05ver1'); // 12 بايت، ثابتٌ للفحص فقط
    const aad = Buffer.from('xuux-f05-verify');
    const gcm = () => ({
      mechanism: lib.CKM_AES_GCM,
      parameter: { type: lib.CK_PARAMS_AES_GCM, iv, ivBits: 96, aad, tagBits: 128 },
    });
    const pt = Buffer.from('f05-roundtrip-probe');
    let ct = null;
    try {
      mod.C_EncryptInit(session, gcm(), h);
      ct = Buffer.from(mod.C_Encrypt(session, pt, Buffer.alloc(pt.length + 16)));
      check(ct.length === pt.length + 16, 'aes_gcm_encrypt_ok', `ciphertext+tag=${ct.length} بايت`);
    } catch (e) {
      check(false, 'aes_gcm_encrypt_ok', `تعذّر التشفير: ${e.code ?? 'خطأ'}`);
    }
    if (ct) {
      try {
        mod.C_DecryptInit(session, gcm(), h);
        const out = Buffer.from(mod.C_Decrypt(session, ct, Buffer.alloc(ct.length)));
        check(out.equals(pt), 'aes_gcm_decrypt_roundtrip_matches');
      } catch (e) {
        check(false, 'aes_gcm_decrypt_roundtrip_matches', `تعذّر الفك: ${e.code ?? 'خطأ'}`);
      }
      // رفض نصٍّ مُعدَّل: إثبات أن وسم المصادقة يعمل ولم يتلف المفتاح.
      const tampered = Buffer.from(ct);
      tampered[0] ^= 0x01;
      let rejected = false;
      try {
        mod.C_DecryptInit(session, gcm(), h);
        mod.C_Decrypt(session, tampered, Buffer.alloc(tampered.length));
      } catch {
        rejected = true;
      }
      check(rejected, 'aes_gcm_rejects_tampered_ciphertext');
    }

    // 10) نطاق الإتلاف من سجل keygen
    if (keygenLog) verifyKeygenLogScope(keygenLog);
    else check(false, 'keygen_log_provided', 'مرّر --keygen-log <path> لإثبات نطاق الإتلاف');
  } finally {
    try {
      if (session) {
        mod.C_Logout(session);
        mod.C_CloseSession(session);
      }
    } catch {
      /* تجاوز */
    }
    try {
      mod.C_Finalize();
    } catch {
      /* تجاوز */
    }
  }

  console.log(`[f05-verify] ${results.length - failed}/${results.length} فحصاً ناجحاً`);
  if (failed === 0) {
    console.log('[f05-verify] === PASS: F05 ثابتٌ وسليمٌ ولم يُلمَس بتدوير F06/F07 ===');
  } else {
    console.log(`[f05-verify] === FAIL: ${failed} فحصاً فاشلاً ===`);
  }
  console.log(`F05_VERIFY_EXIT=${failed === 0 ? 0 : 1}`);
  process.exit(failed === 0 ? 0 : 1);
}

// يُشغّل التحقق فقط عند الاستدعاء المباشر؛ الاستيراد في الاختبارات لا يلمس HSM.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
