/**
 * مخزنُ دوامِ منحِ القدراتِ على قرصٍ — شطرُ «المنح» من `R6-A-05`.
 *
 * العيبُ الذي يُعالِجُه: دفترُ المنحِ كانَ خريطةً في ذاكرةِ العمليّةِ، فمنحاً
 * سارياً يُمحى بإعادةِ التشغيلِ ويَلزمُ منحُه من جديدٍ. ومسبرُ الجولةِ السابعةِ
 * قاسَها: منحةٌ واحدةٌ قبلَ الإقلاعِ صارتْ صفراً في العمليّةِ الجديدةِ
 * (‏`docs/external-review/reports/M11.06-round-7-model-council-report-gpt-6-astra.md`،
 * المسبارُ E12). والاتجاهُ آمنٌ (فقدانُ منحٍ يُضيّقُ الصلاحيةَ لا يوسّعُها) لكنّه
 * نقصٌ مُعلَنٌ لا ميزة.
 *
 * هذا المخزنُ يكتبُ لقطةَ JSON على قرصٍ: غائبةٌ = إقلاعٌ نظيفٌ (‏تُقرأُ عدداً
 * صفراً من المنحِ)، ومعطوبٌ = رفعٌ لا افتراضُ صفرٍ — فمنحٌ مجهولُ الحالةِ لا
 * يُفترضُ سليماً ولا معدوماً. والدفترُ نفسُه يُحاوِلُ التحقّقَ من صحةِ كلِّ
 * مُدخلٍ (شكلُ الحقولِ وتواريخُ المنحِ والانتهاءِ والسحبِ) قبلَ قبولِ اللقطةِ.
 *
 * **حدٌّ مُعلَنٌ:** هذا مخزنُ قرصٍ لا مخزنُ إنتاجٍ موزَّعٍ. أينَ تعيشُ اللقطةُ
 * (جذرُ حالةٍ مختومٍ أو غيرُه) قرارُ تركيبٍ — الدفترُ يطلبُ عقدَ `load`/`save`
 * وحدَه، ومَن يُمرِّرُ هذا المخزنَ يختارُ القرصَ، كما اختارَت بوابةُ الاستدلالِ
 * مخزنَها (‏`budget-store.mjs`، `LIM-1`).
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { beforeDurableWrite, fsyncDirectoryOrFail } from '../root-of-trust/commit-barrier.mjs';

/**
 * مخزنُ منحِ قدراتٍ على ملفِّ JSON.
 *
 * القراءةُ **متزامنةٌ**: الدفترُ يُنادي `load()` عندَ بنائِه، والكتابةُ متزامنةٌ
 * أيضاً لأنّ منحاً وقعَ ولم يُدَمْ هو العيبُ نفسُه الذي يُعالِجُه هذا الملفُّ.
 */
export class FileCapabilityGrantStore {
  /**
   * @param {{ filePath: string }} options
   */
  constructor({ filePath }) {
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      throw new Error('FileCapabilityGrantStore: filePath مطلوبٌ ومسارٌ غيرُ فارغٍ');
    }
    this.filePath = filePath;
  }

  /**
   * يقرأُ اللقطةَ من القرصِ. الملفُّ الغائبُ يعني إقلاعاً نظيفاً (‏لا منحَ
   * سابقةً)، والملفُّ الموجودُ والمعطوبُ يُرفَعُ خطأً لا يُفترَضُ صفراً.
   *
   * @returns {unknown | null}
   */
  load() {
    if (!fs.existsSync(this.filePath)) return null;
    const raw = fs.readFileSync(this.filePath, 'utf8');
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `تعذُّرَ قراءةُ ملفِّ منحِ القدراتِ (${this.filePath}): ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * يكتبُ اللقطةَ إلى القرصِ كتابةً ذرّيّةً (‏مؤقّتٌ ثمّ إعادةُ تسميةٍ)، والفشلُ
   * يُرفَعُ لا يُبتلَعُ: منحٌ وقعَ ولم يُدَمْ هو العيبُ نفسُه.
   *
   * **داخلَ حاجزِ الالتزامِ (`WL-363`):** الكتابةُ للمسارِ النهائيِّ تُسجَّلُ قبلَها
   * (`beforeDurableWrite`) فتُصبحَ منَ المعاملةِ — تُدرِجُ تراجعَها وتُحدِّثُ هضمَ
   * الحالةِ وترفَعُ البيانَ. وخارجَ معاملةٍ بعدَ التنشيطِ تُرفَضُ (`STATE_WRITE_OUTSIDE_BARRIER`)
   * لا تُقبَلُ صامتةً: لا كاتبَ ثانٍ في الجذرِ.
   *
   * @param {unknown} entries
   * @returns {void}
   */
  save(entries) {
    const dir = path.dirname(this.filePath);
    const created = fs.existsSync(dir) ? null : fs.mkdirSync(dir, { recursive: true });
    beforeDurableWrite(this.filePath, 'replace');
    // **WL-534 (`LIVE-39`):** مؤقّتٌ فريدٌ حصريٌّ (`wx`) يُزامَنُ قبلَ إعادةِ التسمية، ثمّ
    // يُزامَنُ المجلّدُ (‏ومجلّداتُ الإنشاءِ حتّى أوّلِ قائمٍ) — فلا يُقَرُّ بمنحٍ أو إبطالٍ
    // قبلَ دوامِ اسمِه ومحتواه. وكانت الكتابةُ بلا أيِّ مزامنةٍ وبمؤقّتٍ ثابتِ الاسم.
    const tmp = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      try {
        const buffer = Buffer.from(JSON.stringify(entries, null, 2), 'utf8');
        let written = 0;
        while (written < buffer.length) written += fs.writeSync(fd, buffer, written);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, this.filePath);
    } catch (error) {
      fs.rmSync(tmp, { force: true });
      throw error;
    }
    fsyncDirectoryOrFail(dir);
    if (typeof created === 'string') {
      // مجلّداتٌ أُنشئت الآنَ: مدخلُ كلٍّ منها في أبيه حتّى أبِ أوّلِها إنشاءً.
      const stop = path.dirname(created);
      for (let parent = path.dirname(dir); ; parent = path.dirname(parent)) {
        fsyncDirectoryOrFail(parent);
        if (parent === stop || parent === path.dirname(parent)) break;
      }
    }
  }
}
