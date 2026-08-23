// جذر الثقة — تطبيق العقد على قرص محلي مشفَّر (M2.02). للتطوير فقط.
//
// لا يُعيد هذا الملف كتابة التشفير: يبني على `EncryptedKeyStore` القائم
// (‏AES-256-GCM ومفتاح مشتق بـ scrypt) بملف لكل مفتاح، فيبقى التشفير في موضع
// واحد مُختبر ولا يوجد تنفيذان للسرية يتفارقان مع الزمن.
//
// وهو **غير صالح للإنتاج** ويُعلن ذلك عن نفسه في `describe()`: المفتاح الرئيسي
// يصل عبر المعامل (‏غالباً من متغير بيئة)، والمادة تقيم على قرص الخدمة نفسها —
// وهي بعينها الفجوة G1 في وثيقة التدقيق. سدّها مهمة التطبيق الخارجي والخطوة M2.03.

import { readdirSync, statSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { EncryptedKeyStore } from './key-store.mjs';
import {
  assertKeyMaterial,
  assertKeyName,
  KeyProviderError,
  type KeyProvider,
  type KeyProviderDescription,
  type KeyRecord,
  type PutOptions,
} from './key-provider.mjs';

/** لاحقة موحَّدة تُميّز ملفات المفاتيح عن أي ملف آخر يقع في المجلد. */
const SUFFIX = '.key.json';

export class LocalEncryptedKeyProvider implements KeyProvider {
  readonly directory: string;
  private readonly masterKey: string | Uint8Array;

  /**
   * @param directory - مجلد يقيم فيه ملف مشفَّر لكل مفتاح
   * @param masterKey - مادة اشتقاق المفتاح الرئيسي؛ تُمرَّر ولا تُقرأ من المستودع
   */
  constructor(directory: string, masterKey: string | Uint8Array) {
    if (!directory) throw new KeyProviderError('PROVIDER_NOT_CONFIGURED');
    // الفحص هنا وليس عند أول كتابة: مخزن بمفتاح رئيسي ضعيف يجب أن يفشل عند
    // الإنشاء، لا بعد أن يكون النظام قد بنى عليه.
    if (!masterKey || masterKey.length < 16) throw new Error('MASTER_KEY_TOO_SHORT');
    this.directory = directory;
    this.masterKey = masterKey;
  }

  describe(): KeyProviderDescription {
    return {
      kind: 'local-encrypted-file',
      location: this.directory,
      canExport: true,
      productionReady: false,
    };
  }

  /**
   * يحفظ المادة مشفَّرة في ملف باسم المفتاح.
   * @param name - اسم المفتاح
   * @param material - المادة السرية
   * @param options - خيارات الكتابة؛ الطمس ممنوع افتراضياً
   * @returns سجل المفتاح دون مادته
   */
  put(name: string, material: string, options?: PutOptions): Promise<KeyRecord> {
    assertKeyName(name);
    assertKeyMaterial(material);
    const file = this.pathOf(name);
    if (existsSync(file) && options?.overwrite !== true) {
      throw new KeyProviderError('KEY_ALREADY_EXISTS');
    }
    mkdirSync(this.directory, { recursive: true });
    new EncryptedKeyStore(file, this.masterKey).save(name, material);
    return Promise.resolve(this.recordOf(name, file));
  }

  /**
   * يقرأ المادة بعد فك تشفيرها.
   * @param name - اسم المفتاح
   * @returns المادة الأصلية حرفاً بحرف
   */
  get(name: string): Promise<string> {
    assertKeyName(name);
    const file = this.pathOf(name);
    if (!existsSync(file)) throw new KeyProviderError('KEY_NOT_FOUND');
    return Promise.resolve(new EncryptedKeyStore(file, this.masterKey).load(name));
  }

  /**
   * @param name - اسم المفتاح
   * @returns صحيح إن كان للمفتاح ملف قائم
   */
  has(name: string): Promise<boolean> {
    assertKeyName(name);
    return Promise.resolve(existsSync(this.pathOf(name)));
  }

  /**
   * @returns جرد المفاتيح مرتَّباً بالاسم، بلا أي مادة سرية
   */
  list(): Promise<KeyRecord[]> {
    if (!existsSync(this.directory)) return Promise.resolve([]);
    const names = readdirSync(this.directory)
      .filter((f) => f.endsWith(SUFFIX))
      .map((f) => f.slice(0, -SUFFIX.length))
      .sort();
    return Promise.resolve(names.map((name) => this.recordOf(name, this.pathOf(name))));
  }

  /**
   * يحذف المفتاح. الحذف الصريح للمفقود خطأ لا لا-عملية، حتى لا يظن المستدعي
   * أنه أبطل مفتاحاً وهو لم يجد شيئاً ليبطله.
   * @param name - اسم المفتاح
   */
  destroy(name: string): Promise<void> {
    assertKeyName(name);
    const file = this.pathOf(name);
    if (!existsSync(file)) throw new KeyProviderError('KEY_NOT_FOUND');
    rmSync(file);
    return Promise.resolve();
  }

  /**
   * @param name - اسم المفتاح
   * @returns مسار الملف المشفَّر الخاص به
   */
  private pathOf(name: string): string {
    return join(this.directory, `${name}${SUFFIX}`);
  }

  /**
   * @param name - اسم المفتاح
   * @param file - مسار ملفه
   * @returns سجل المفتاح مع زمن آخر كتابة كزمن إنشاء
   */
  private recordOf(name: string, file: string): KeyRecord {
    return { name, createdAt: statSync(file).mtime.toISOString() };
  }
}
