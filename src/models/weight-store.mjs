/**
 * مخزن أوزان معنوَن بالمحتوى — M6.06
 *
 * العيب الذي يعالجه: كان سجل النماذج يحسب بصمة الأوزان **وقت التسجيل** ثم
 * ينشّط النموذج بلا إعادة حساب. فبين التسجيل والتنشيط يمكن أن يُبدَّل ملف
 * الأوزان بلا أن يمنع ذلك التنشيط: البصمة كانت وصفاً محفوظاً لا شرطاً مفحوصاً.
 *
 * فالمخزن هنا **معنوَن بالمحتوى**: اسم الملف هو بصمته. ولذلك أثرٌ مقصود: لا
 * يحتاج السجل عموداً جديداً لمسار الأوزان، والبصمة المخزَّنة في السجل هي عنوان
 * الملف نفسه، فأيّ تبديل بايتٍ واحد يجعل المحتوى لا يطابق عنوانه ويُكشف بإعادة
 * الحساب لا بالثقة.
 *
 * الكتابة ذريّة: يُكتب إلى ملف مؤقّت ثم يُنقل نقلاً ذريّاً، لأن انقطاعاً في
 * منتصف كتابةٍ مباشرة يترك ملفاً ناقصاً يحمل عنوان محتوى كامل — وذلك أسوأ من
 * غياب الملف، لأنه غيابٌ يبدو حضوراً.
 *
 * حدود معلنة: المخزن لا يشفّر ولا يوقّع ولا ينسخ احتياطياً، ولا يمنع من يملك
 * صلاحية الكتابة على القرص من حذف ملف. هو يكشف التبديل ولا يمنعه.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const WEIGHT_STORE_ERRORS = Object.freeze({
  ROOT_REQUIRED: 'WEIGHT_STORE_ROOT_REQUIRED',
  DIGEST_INVALID: 'WEIGHT_DIGEST_INVALID',
  WEIGHTS_MISSING: 'MODEL_WEIGHTS_MISSING',
  FINGERPRINT_MISMATCH: 'MODEL_FINGERPRINT_MISMATCH',
});

/** خطأ مُسمّى يفرّق غياب الأوزان عن تبدّلها؛ الخلط بينهما يجعل التشخيص تخميناً. */
export class WeightStoreError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'WeightStoreError';
    /** @type {string} */
    this.code = code;
  }
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

/**
 * يحسب بصمة sha256 للبايتات كما يحسبها سجل النماذج تماماً.
 * @param {import('node:crypto').BinaryLike} bytes
 * @returns {string}
 */
export function digestOf(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export class WeightStore {
  /**
   * @param {{ root?: string }} [options]
   */
  constructor({ root } = {}) {
    if (typeof root !== 'string' || root.trim() === '') {
      throw new WeightStoreError(
        WEIGHT_STORE_ERRORS.ROOT_REQUIRED,
        'مخزن الأوزان يحتاج جذراً معلَناً: جذرٌ ضمني يجعل موضع الأوزان مجهولاً لمن يراجع.',
      );
    }
    /** @type {string} */
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
  }

  /**
   * مسار الأوزان لبصمةٍ ما. البصمة تُفحص شكلاً قبل أن تُركَّب في مسار: قيمةٌ
   * مثل `../../etc/passwd` في موضع بصمة تصير قراءةً خارج الجذر.
   * @param {string} digest
   * @returns {string}
   */
  pathFor(digest) {
    if (typeof digest !== 'string' || !DIGEST_PATTERN.test(digest)) {
      throw new WeightStoreError(
        WEIGHT_STORE_ERRORS.DIGEST_INVALID,
        `البصمة «${String(digest)}» ليست sha256 سّتّينية من ٦٤ محرفاً.`,
      );
    }
    return path.join(this.root, `${digest}.weights`);
  }

  /**
   * يخزّن الأوزان ويعيد بصمتها. تخزين ما هو مخزَّن لا يكتب شيئاً: المحتوى واحد
   * فالعنوان واحد.
   * @param {import('node:crypto').BinaryLike} bytes
   * @returns {string} البصمة
   */
  put(bytes) {
    const digest = digestOf(bytes);
    const target = this.pathFor(digest);
    if (fs.existsSync(target)) return digest;
    const temporary = `${target}.${process.pid}.partial`;
    fs.writeFileSync(temporary, /** @type {any} */ (bytes));
    fs.renameSync(temporary, target);
    return digest;
  }

  /**
   * @param {string} digest
   * @returns {boolean}
   */
  has(digest) {
    return fs.existsSync(this.pathFor(digest));
  }

  /**
   * @param {string} digest
   * @returns {Buffer}
   */
  read(digest) {
    const target = this.pathFor(digest);
    if (!fs.existsSync(target)) {
      throw new WeightStoreError(
        WEIGHT_STORE_ERRORS.WEIGHTS_MISSING,
        `أوزان البصمة ${digest} غير موجودة في ${this.root}؛ التنشيط بلا أوزان قابلة للفحص ممنوع.`,
      );
    }
    return fs.readFileSync(target);
  }

  /**
   * يعيد حساب بصمة المحتوى المخزَّن ويقارنها بالبصمة المطلوبة.
   *
   * لا يُقبل هنا اختصارُ «الملف موجود فالبصمة صحيحة»: وجودَ ملفٍ باسم بصمةٍ لا
   * يعني أن محتواه يطابقها، وذلك هو بالضبط ما يجب أن يُكشف.
   * @param {string} digest
   * @returns {{ verified: true, digest: string, bytes: number }}
   */
  verify(digest) {
    const content = this.read(digest);
    const actual = digestOf(content);
    if (actual !== digest) {
      throw new WeightStoreError(
        WEIGHT_STORE_ERRORS.FINGERPRINT_MISMATCH,
        `بصمة الأوزان المخزَّنة ${actual} لا تطابق البصمة المسجَّلة ${digest}؛ الأوزان بُدِّلت بعد التسجيل.`,
      );
    }
    return { verified: true, digest, bytes: content.byteLength };
  }
}

/**
 * @param {ConstructorParameters<typeof WeightStore>[0]} options
 * @returns {WeightStore}
 */
export function createWeightStore(options) {
  return new WeightStore(options);
}
