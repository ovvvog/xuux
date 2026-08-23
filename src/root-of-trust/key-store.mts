// جذر الثقة — مخزن مفاتيح محلي مشفَّر. نُقل إلى TypeScript في M2.01 بلا تغيير سلوك.
// Local encrypted keystore abstraction; production must replace this with HSM/KMS.

import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** الشكل المخزن على القرص؛ لا يحمل إلا المادة المشفرة وملحقاتها اللازمة للفك. */
export interface StoredKey {
  name: string;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

export class EncryptedKeyStore {
  file: string;
  masterKey: Buffer;

  /**
   * @param file - مسار الملف المشفر
   * @param masterKey - مادة الاشتقاق الرئيسية
   */
  constructor(file: string, masterKey: string | Uint8Array) {
    if (!masterKey || masterKey.length < 16) throw new Error('MASTER_KEY_TOO_SHORT');
    this.file = file;
    this.masterKey =
      typeof masterKey === 'string' ? Buffer.from(masterKey) : Buffer.from(masterKey);
  }

  /**
   * يشتق مفتاحاً محلياً جديداً ويحفظ القيمة مشفرة باسمها.
   * @param name - الاسم المتوقع للمادة
   * @param value - المادة النصية المراد حمايتها
   */
  save(name: string, value: string): void {
    const salt = randomBytes(16),
      iv = randomBytes(12),
      key = scryptSync(this.masterKey, salt, 32);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(
      this.file,
      JSON.stringify({
        name,
        salt: salt.toString('base64url'),
        iv: iv.toString('base64url'),
        tag: tag.toString('base64url'),
        data: ciphertext.toString('base64url'),
      }),
    );
  }

  /**
   * يفك المادة المشفرة بعد التحقق من مطابقة اسمها المتوقع.
   * @param expectedName - الاسم الذي يجب أن ينتمي إليه الملف
   * @returns المادة الأصلية بعد فك التشفير
   */
  load(expectedName: string): string {
    const x = JSON.parse(readFileSync(this.file, 'utf8')) as StoredKey;
    if (x.name !== expectedName) throw new Error('KEY_NAME_MISMATCH');
    const key = scryptSync(this.masterKey, Buffer.from(x.salt, 'base64url'), 32);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(x.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(x.tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(x.data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
