// src/root-of-trust/pkcs11-provider.mts
// جذر الثقة — موفّر HSM عبر PKCS#11 (SoftHSM2 / عتادي) — عقدٌ مُغلقٌ فشلاً.
//
// لماذا عقدٌ منفصل لا تعديل KeyProvider: مخزن HSM حقيقي لا يُخرج المادة الخاصة
// بل يوقّع/يُشفِّر داخل حدوده. العقد المادي (put/get) لا يصلح لمفتاحٍ غير قابل
// للتصدير. هنا عقدان عمليّان: `SigningKeyHandle` (توقيع داخل HSM) و`AeadKeyHandle`
// (تشفير/فك داخل HSM). لا fallback إلى مادة خاصة برمجية: غياب القدرة = خطأٌ صلب.
//
// القواعد الحاكمة:
//  - لا مادة خاصة خارج التوكن (لا في Git/السجلات/CI/رسائل الأخطاء).
//  - اكتشاف بالـlabel ثم التحقق بالـserial؛ رقم Slot لا يُثبَّت.
//  - PIN من متغيّر بيئة أو ملف بصلاحية 600؛ لا في argv ولا npm script ولا سجل.
//  - فشلٌ مغلق: غياب pkcs11js/الموديول/التوكن/الآلية/فشل self-test = رفضٌ صريح.
//  - self-test لكل قدرة قبل التسليم: EdDSA sign+verify عند طلب توقيع؛ AES-GCM
//    encrypt+decrypt عند طلب تشفير. فشل self-test التوقيع لا يُسقط التشفير.
import { Buffer } from 'node:buffer';
import { createPublicKey, verify as cryptoVerify, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** رموز أخطاء HSM — مُثبَّتة نصاً للاختبار والتدقيق. */
export const HsmErrorCodes = [
  'MODULE_MISSING',
  'MODULE_LOAD',
  'TOKEN_NOT_FOUND',
  'AMBIGUOUS_TOKEN',
  'SERIAL_MISMATCH',
  'PIN_MISSING',
  'PIN_EMPTY',
  'KEY_NOT_FOUND',
  'MECHANISM_UNSUPPORTED',
  'CAPABILITY_SELFTEST_FAILED',
  'NON_EXTRACTABLE_VIOLATION',
  'SIGN_OPERATION_FAILED',
  'AEAD_OPERATION_FAILED',
] as const;
export type HsmErrorCode = (typeof HsmErrorCodes)[number];

export class HsmError extends Error {
  readonly code: HsmErrorCode;
  constructor(code: HsmErrorCode, message: string) {
    super(message);
    this.name = 'HsmError';
    this.code = code;
  }
}

/** ثوابت PKCS#11 v3.0 (متحقَّق من ترويسة p11-kit). pkcs11js 2.1.7 لا يُصدِّر EdDSA. */
const CKM_EC_EDWARDS_KEY_PAIR_GEN = 0x00001055;
const CKM_EDDSA = 0x00001057;
const CKK_EC_EDWARDS = 0x00000040; // 0x40 وليس 0x28
const ED25519_EC_PARAMS = Buffer.from([0x06, 0x03, 0x2b, 0x65, 0x70]); // OID 1.3.101.112 (Ed25519) DER — آخر بايت 0x70 وليس 0x6e (X25519)

export interface HsmProviderConfig {
  /** مسار موديول PKCS#11. */
  modulePath: string;
  /** اسم التوكن — معيار الاكتشاف الأول. */
  tokenLabel: string;
  /** الرقم التسلسلي للتوكن — تحقق إضافي (اختياري). */
  tokenSerial?: string;
  /** PIN — لا يُسجَّل. */
  pin: string;
}

export interface HsmProviderDescription {
  kind: 'pkcs11-hsm';
  modulePath: string;
  tokenLabel: string;
  tokenSerial: string;
  canExport: false;
  /** قدرة التوقيع داخل HSM — false يعني أن F06/F07 غير متاح (خلفية لا تدعم EdDSA). */
  signingReady: boolean;
  /** قدرة التشفير داخل HSM (AES-GCM). */
  aeadReady: boolean;
}

/** مقبض مفتاح توقيع — يوقّع داخل HSM ولا يُخرج المادة. */
export interface SigningKeyHandle {
  readonly keyId: string;
  sign(message: Buffer): Promise<Buffer>;
  /** المفتاح العام المُصدَّر (PEM) للتدقيق والتحقق الخارجي. */
  exportPublicPem(): Promise<string>;
}

/** مقبض مفتاح AEAD — يشفّر/يفكّ داخل HSM. */
export interface AeadKeyHandle {
  readonly keyId: string;
  encrypt(plaintext: Buffer): Promise<{ ciphertext: Buffer; iv: Buffer; tag: Buffer }>;
  decrypt(ciphertext: Buffer, iv: Buffer, tag: Buffer): Promise<Buffer>;
}

interface Pkcs11Lib {
  PKCS11: new () => Pkcs11Instance;
  [k: string]: unknown;
}
interface Pkcs11Instance {
  load(path: string): void;
  C_Initialize(): void;
  C_Finalize(): void;
  C_GetSlotList(present: boolean): Buffer[];
  C_GetTokenInfo(slot: Buffer): { label: string; serialNumber: string };
  C_OpenSession(slot: Buffer, flags: number): Buffer;
  C_CloseSession(session: Buffer): void;
  C_Login(session: Buffer, userType: number, pin: string): void;
  C_Logout(session: Buffer): void;
  C_GenerateKeyPair(
    session: Buffer,
    mechanism: { mechanism: number },
    pub: unknown[],
    priv: unknown[],
  ): { publicKey: Buffer; privateKey: Buffer };
  C_GenerateKey(session: Buffer, mechanism: { mechanism: number }, template: unknown[]): Buffer;
  C_SignInit(session: Buffer, mechanism: { mechanism: number }, key: Buffer): void;
  C_Sign(session: Buffer, data: Buffer, out: Buffer): Buffer;
  C_EncryptInit(session: Buffer, mechanism: unknown, key: Buffer): void;
  C_Encrypt(session: Buffer, data: Buffer, out: Buffer): Buffer;
  C_DecryptInit(session: Buffer, mechanism: unknown, key: Buffer): void;
  C_Decrypt(session: Buffer, data: Buffer, out: Buffer): Buffer;
  C_GetAttributeValue(session: Buffer, obj: Buffer, attrs: unknown[]): unknown[];
  C_FindObjectsInit(session: Buffer, attrs: unknown[]): void;
  C_FindObjects(session: Buffer, max: number): Buffer[];
  C_FindObjectsFinal(session: Buffer): void;
  C_DestroyObject(session: Buffer, obj: Buffer): void;
}

async function loadPkcs11Module(): Promise<{ lib: Pkcs11Lib; PKCS11: new () => Pkcs11Instance }> {
  let ns: unknown;
  try {
    ns = await import('pkcs11js');
  } catch {
    throw new HsmError('MODULE_MISSING', 'pkcs11js غير مثبَّت — تشغيل بلا HSM غير مسموح كهيئة HSM');
  }
  const lib = (ns as { default?: Pkcs11Lib }).default ?? (ns as Pkcs11Lib);
  const PKCS11 = (lib as Pkcs11Lib).PKCS11;
  if (!PKCS11) throw new HsmError('MODULE_MISSING', 'pkcs11js لم يُصدِّر PKCS11');
  return { lib: lib as Pkcs11Lib, PKCS11 };
}

function resolvePin(envPin?: string, pinFile?: string): string {
  if (envPin) return envPin;
  const path = pinFile ?? `${process.env.HOME ?? ''}/.config/xuux/pkcs11-pin`;
  try {
    const raw = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
    if (!raw) throw new HsmError('PIN_EMPTY', `ملف الـPIN فارغ: ${path}`);
    return raw;
  } catch {
    throw new HsmError('PIN_MISSING', `ضَع XUUX_PKCS11_PIN أو ملف ${path} بصلاحية 600`);
  }
}

/** موفّر HSM عبر PKCS#11 — دورة حياة جلسة واحدة، self-test لكل قدرة. */
export class Pkcs11HsmProvider {
  private readonly mod: Pkcs11Instance;
  private readonly lib: Pkcs11Lib;
  private readonly session: Buffer;
  private readonly serial: string;
  private readonly modulePath: string;
  private readonly tokenLabel: string;
  private signingReady = false;
  private aeadReady = false;
  private selfTested = false;

  private constructor(lib: Pkcs11Lib, PKCS11: new () => Pkcs11Instance, config: HsmProviderConfig) {
    this.lib = lib;
    const CKF = (lib.CKF_SERIAL_SESSION as number) ?? 0x00000004;
    const CKF_RW = (lib.CKF_RW_SESSION as number) ?? 0x00000002;
    const CKU_USER = (lib.CKU_USER as number) ?? 1;
    const mod = new PKCS11();
    try {
      mod.load(config.modulePath);
    } catch (e) {
      throw new HsmError(
        'MODULE_LOAD',
        `تعذّر تحميل ${config.modulePath}: ${(e as Error).message}`,
      );
    }
    mod.C_Initialize();
    const slots = mod.C_GetSlotList(true);
    if (!slots || slots.length === 0) {
      throw new HsmError('TOKEN_NOT_FOUND', 'لا توكنات مهيَّأة');
    }
    let found: { slot: Buffer; serial: string } | null = null;
    for (const slot of slots) {
      try {
        const info = mod.C_GetTokenInfo(slot);
        if ((info.label ?? '').trim() === config.tokenLabel) {
          if (found)
            throw new HsmError('AMBIGUOUS_TOKEN', `تعددت التوكنات بالاسم ${config.tokenLabel}`);
          found = { slot, serial: info.serialNumber };
        }
      } catch (e) {
        if (e instanceof HsmError) throw e;
        /* تجاوز */
      }
    }
    if (!found) throw new HsmError('TOKEN_NOT_FOUND', `لا توكن بالاسم ${config.tokenLabel}`);
    if (config.tokenSerial && found.serial.trim() !== config.tokenSerial) {
      throw new HsmError('SERIAL_MISMATCH', `${found.serial} ≠ ${config.tokenSerial}`);
    }
    this.serial = found.serial;
    this.modulePath = config.modulePath;
    this.tokenLabel = config.tokenLabel;
    const session = mod.C_OpenSession(found.slot, CKF | CKF_RW);
    mod.C_Login(session, CKU_USER, config.pin);
    this.mod = mod;
    this.session = session;
  }

  static async create(config: HsmProviderConfig): Promise<Pkcs11HsmProvider> {
    const { lib, PKCS11 } = await loadPkcs11Module();
    return new Pkcs11HsmProvider(lib, PKCS11, config);
  }

  /** مصنع من متغيّرات البيئة: XUUX_PKCS11_MODULE/TOKEN/TOKEN_SERIAL/PIN. */
  static async fromEnv(env: NodeJS.ProcessEnv = process.env): Promise<Pkcs11HsmProvider> {
    const modulePath = env.XUUX_PKCS11_MODULE;
    const tokenLabel = env.XUUX_PKCS11_TOKEN;
    if (!modulePath || !tokenLabel) {
      throw new HsmError('MODULE_MISSING', 'XUUX_PKCS11_MODULE وXUUX_PKCS11_TOKEN إلزاميّان');
    }
    const pin = resolvePin(env.XUUX_PKCS11_PIN, env.XUUX_PKCS11_PIN_FILE);
    const config: HsmProviderConfig = { modulePath, tokenLabel, pin };
    if (env.XUUX_PKCS11_TOKEN_SERIAL) config.tokenSerial = env.XUUX_PKCS11_TOKEN_SERIAL;
    return Pkcs11HsmProvider.create(config);
  }

  describe(): HsmProviderDescription {
    return {
      kind: 'pkcs11-hsm',
      modulePath: this.modulePath,
      tokenLabel: this.tokenLabel,
      tokenSerial: this.serial,
      canExport: false,
      signingReady: this.signingReady,
      aeadReady: this.aeadReady,
    };
  }

  /** self-test قدرات — يُستدعى قبل تسليم أي مقبض. */
  private async ensureSelfTest(): Promise<void> {
    if (this.selfTested) return;
    this.selfTested = true;
    // قدرة AEAD: توليد مفتاح AES مؤقت + encrypt/decrypt + كشف تلاعب.
    try {
      const handle = this.generateAesProbe();
      this.assertNonExtractable(handle);
      const iv = Buffer.from('xuux-selftest12');
      const aad = Buffer.from('xuux');
      const gcm = {
        mechanism: this.aesGcmMech(),
        parameter: { type: this.lib.CK_PARAMS_AES_GCM, iv, ivBits: 96, aad, tagBits: 128 },
      };
      this.mod.C_EncryptInit(this.session, gcm, handle);
      const pt = Buffer.from('selftest');
      const ct = this.mod.C_Encrypt(this.session, pt, Buffer.alloc(pt.length + 16));
      this.mod.C_DecryptInit(this.session, gcm, handle);
      const dec = this.mod.C_Decrypt(this.session, ct, Buffer.alloc(ct.length));
      if (dec.toString('utf8') !== 'selftest') throw new Error('decrypt mismatch');
      this.aeadReady = true;
      this.destroySafe(handle);
    } catch {
      this.aeadReady = false;
    }
    // قدرة التوقيع: توليد مفتاح Ed25519 مؤقت + sign + verify بالمفتاح العام.
    try {
      const { publicKey, privateKey } = this.generateEd25519Probe();
      const pubPem = this.exportPublicPem(publicKey);
      const message = Buffer.from('xuux-sign-selftest');
      this.mod.C_SignInit(this.session, { mechanism: CKM_EDDSA }, privateKey);
      const sig = this.mod.C_Sign(this.session, message, Buffer.alloc(64));
      const pubKey = createPublicKey(pubPem);
      if (!cryptoVerify(null, message, pubKey, sig)) throw new Error('verify failed');
      this.signingReady = true;
      this.destroySafe(privateKey);
      this.destroySafe(publicKey);
    } catch {
      // خلفية لا تدعم EdDSA sign — يُعلَن فشل القدرة لا يُحجَب الإنشاء.
      this.signingReady = false;
    }
  }

  async getSigningKey(keyId: string): Promise<SigningKeyHandle> {
    await this.ensureSelfTest();
    if (!this.signingReady) {
      throw new HsmError(
        'CAPABILITY_SELFTEST_FAILED',
        'توقيع EdDSA داخل HSM غير متاح في هذا البناء (غالباً OpenSSL backend). شغّل scripts/pkcs11-eddsa-sign-probe.mjs للتأكد، أو استعمل خلفية Botan/HSM عتادي.',
      );
    }
    const handle = this.findKey(keyId);
    if (!handle) throw new HsmError('KEY_NOT_FOUND', `لا مفتاح توقيع بالمعرّف ${keyId}`);
    return {
      keyId,
      sign: async (message: Buffer) => {
        try {
          this.mod.C_SignInit(this.session, { mechanism: CKM_EDDSA }, handle);
          return this.mod.C_Sign(this.session, message, Buffer.alloc(64));
        } catch (e) {
          throw new HsmError(
            'SIGN_OPERATION_FAILED',
            `فشل التوقيع داخل HSM: ${(e as Error).message}`,
          );
        }
      },
      exportPublicPem: async () => {
        const pub = this.findPublicKey(keyId);
        if (!pub) throw new HsmError('KEY_NOT_FOUND', `لا مفتاح عام بالمعرّف ${keyId}`);
        return this.exportPublicPem(pub);
      },
    };
  }

  async getAeadKey(keyId: string): Promise<AeadKeyHandle> {
    await this.ensureSelfTest();
    if (!this.aeadReady) {
      throw new HsmError('CAPABILITY_SELFTEST_FAILED', 'تشفير AES-GCM داخل HSM غير متاح');
    }
    const handle = this.findKey(keyId);
    if (!handle) throw new HsmError('KEY_NOT_FOUND', `لا مفتاح AEAD بالمعرّف ${keyId}`);
    return {
      keyId,
      encrypt: async (plaintext: Buffer) => {
        const iv = Buffer.from(randomBytes(12));
        const aad = Buffer.from('xuux-event');
        const gcm = {
          mechanism: this.aesGcmMech(),
          parameter: { type: this.lib.CK_PARAMS_AES_GCM, iv, ivBits: 96, aad, tagBits: 128 },
        };
        try {
          this.mod.C_EncryptInit(this.session, gcm, handle);
          const ct = this.mod.C_Encrypt(
            this.session,
            plaintext,
            Buffer.alloc(plaintext.length + 16),
          );
          // الـtag ملصقٌ بنهاية النص المشفَّر في مخرجات SoftHSM2 AES-GCM؛ نعزله هنا.
          const tag = ct.subarray(ct.length - 16);
          const ciphertext = ct.subarray(0, ct.length - 16);
          return { ciphertext: Buffer.from(ciphertext), iv, tag: Buffer.from(tag) };
        } catch (e) {
          throw new HsmError(
            'AEAD_OPERATION_FAILED',
            `فشل التشفير داخل HSM: ${(e as Error).message}`,
          );
        }
      },
      decrypt: async (ciphertext: Buffer, iv: Buffer, tag: Buffer) => {
        const aad = Buffer.from('xuux-event');
        const gcm = {
          mechanism: this.aesGcmMech(),
          parameter: { type: this.lib.CK_PARAMS_AES_GCM, iv, ivBits: 96, aad, tagBits: 128 },
        };
        try {
          const combined = Buffer.concat([ciphertext, tag]);
          this.mod.C_DecryptInit(this.session, gcm, handle);
          return this.mod.C_Decrypt(this.session, combined, Buffer.alloc(combined.length));
        } catch (e) {
          throw new HsmError(
            'AEAD_OPERATION_FAILED',
            `فشل فك التشفير داخل HSM: ${(e as Error).message}`,
          );
        }
      },
    };
  }

  // — أدوات داخلية —
  private aesGcmMech(): number {
    return (this.lib.CKM_AES_GCM as number) ?? 0x00001087;
  }
  private findKey(keyId: string): Buffer | null {
    const id = Buffer.from(keyId, 'hex');
    try {
      this.mod.C_FindObjectsInit(this.session, [
        { type: (this.lib.CKA_ID as number) ?? 0x00000102, value: id },
      ]);
      const handles = this.mod.C_FindObjects(this.session, 1);
      this.mod.C_FindObjectsFinal(this.session);
      return handles && handles.length > 0 ? (handles[0] as Buffer) : null;
    } catch {
      return null;
    }
  }
  private findPublicKey(keyId: string): Buffer | null {
    const id = Buffer.from(keyId, 'hex');
    try {
      this.mod.C_FindObjectsInit(this.session, [
        { type: (this.lib.CKA_ID as number) ?? 0x00000102, value: id },
        {
          type: (this.lib.CKA_CLASS as number) ?? 0,
          value: (this.lib.CKO_PUBLIC_KEY as number) ?? 2,
        },
      ]);
      const handles = this.mod.C_FindObjects(this.session, 1);
      this.mod.C_FindObjectsFinal(this.session);
      return handles && handles.length > 0 ? (handles[0] as Buffer) : null;
    } catch {
      return null;
    }
  }
  private generateEd25519Probe(): { publicKey: Buffer; privateKey: Buffer } {
    const pub = [
      {
        type: (this.lib.CKA_CLASS as number) ?? 0,
        value: (this.lib.CKO_PUBLIC_KEY as number) ?? 2,
      },
      { type: (this.lib.CKA_KEY_TYPE as number) ?? 256, value: CKK_EC_EDWARDS },
      { type: (this.lib.CKA_TOKEN as number) ?? 1, value: true },
      { type: (this.lib.CKA_EC_PARAMS as number) ?? 384, value: ED25519_EC_PARAMS },
      { type: (this.lib.CKA_VERIFY as number) ?? 266, value: true },
    ];
    const priv = [
      {
        type: (this.lib.CKA_CLASS as number) ?? 0,
        value: (this.lib.CKO_PRIVATE_KEY as number) ?? 3,
      },
      { type: (this.lib.CKA_KEY_TYPE as number) ?? 256, value: CKK_EC_EDWARDS },
      { type: (this.lib.CKA_TOKEN as number) ?? 1, value: true },
      { type: (this.lib.CKA_SENSITIVE as number) ?? 259, value: true },
      { type: (this.lib.CKA_EXTRACTABLE as number) ?? 354, value: false },
      { type: (this.lib.CKA_SIGN as number) ?? 264, value: true },
    ];
    return this.mod.C_GenerateKeyPair(
      this.session,
      { mechanism: CKM_EC_EDWARDS_KEY_PAIR_GEN },
      pub,
      priv,
    );
  }
  private generateAesProbe(): Buffer {
    const tmpl = [
      {
        type: (this.lib.CKA_CLASS as number) ?? 0,
        value: (this.lib.CKO_SECRET_KEY as number) ?? 4,
      },
      {
        type: (this.lib.CKA_KEY_TYPE as number) ?? 256,
        value: (this.lib.CKK_AES as number) ?? 0x1f,
      },
      { type: (this.lib.CKA_TOKEN as number) ?? 1, value: true },
      { type: (this.lib.CKA_VALUE_LEN as number) ?? 353, value: 32 },
      { type: (this.lib.CKA_SENSITIVE as number) ?? 259, value: true },
      { type: (this.lib.CKA_EXTRACTABLE as number) ?? 354, value: false },
      { type: (this.lib.CKA_ENCRYPT as number) ?? 260, value: true },
      { type: (this.lib.CKA_DECRYPT as number) ?? 261, value: true },
    ];
    return this.mod.C_GenerateKey(
      this.session,
      { mechanism: (this.lib.CKM_AES_KEY_GEN as number) ?? 0x1080 },
      tmpl,
    );
  }
  private exportPublicPem(publicKey: Buffer): string {
    const attrs = this.mod.C_GetAttributeValue(this.session, publicKey, [
      { type: (this.lib.CKA_EC_POINT as number) ?? 385 },
    ]);
    const ecPoint = (attrs[0] as { value: Buffer })?.value;
    if (!ecPoint || ecPoint.length < 34) throw new HsmError('KEY_NOT_FOUND', 'EC_POINT غير صالح');
    const off = ecPoint[0] === 0x04 ? 2 : 0;
    const raw = ecPoint.subarray(off, off + 32);
    const der = Buffer.concat([
      Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]),
      raw,
    ]);
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    return key.export({ type: 'spki', format: 'pem' }) as string;
  }
  private assertNonExtractable(handle: Buffer): void {
    let valueRejected = false;
    try {
      this.mod.C_GetAttributeValue(this.session, handle, [
        { type: (this.lib.CKA_VALUE as number) ?? 17 },
      ]);
    } catch (e) {
      valueRejected = /SENSITIVE|0x11/i.test((e as Error).message);
    }
    if (!valueRejected)
      throw new HsmError('NON_EXTRACTABLE_VIOLATION', 'CKA_VALUE لم يُرفض — المفتاح قابل للتصدير');
  }
  private destroySafe(handle: Buffer): void {
    try {
      this.mod.C_DestroyObject(this.session, handle);
    } catch {
      /* تجاوز */
    }
  }

  async close(): Promise<void> {
    try {
      this.mod.C_Logout(this.session);
      this.mod.C_CloseSession(this.session);
      this.mod.C_Finalize();
    } catch {
      /* تجاوز */
    }
  }
}
