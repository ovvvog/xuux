/**
 * مخزنُ دوامِ ميزانيةِ الاستدلالِ على قرصٍ — `LIM-1` (‏`WL-197`).
 *
 * العيبُ الذي يُعالِجُه: عدّادُ الميزانيةِ كان في ذاكرةِ العمليّةِ، فإعادةُ
 * التشغيلِ تُصفِّرُه وتبدأُ نافذةً جديدةً. والحدُّ الذي كان مُعلَناً في `WL-167`
 * هو أنّ «اختيارَ موضعِ الدوامِ قرارُ تركيبٍ» — فالبوابةُ تُعطي اللقطةَ ولا تختارُ
 * المخزنَ. ولكنّ `LIM-1` يُلزِمُ بدوامٍ على قرصٍ: مخزنٌ يُقرأُ منه ويُكتَبُ إليه،
 * لا مصفوفةٌ في الذاكرةِ تعيشُ ما عاشتِ العمليّةُ.
 *
 * هذا المخزنُ يكتبُ لقطةً JSON على قرصٍ: قراءةٌ عندَ الإقلاعِ، وكتابةٌ عندَ كلِّ
 * تغيُّرٍ. والتعطُّلُ يُرفَعُ لا يُبتلَعُ: ملفٌ لا يُقرأُ يعني استهلاكاً مجهولاً لا
 * يُفترَضُ صفراً — والبوابةُ ترفضُه برمزٍ مُسمّىً (`INFERENCE_BUDGET_UNREADABLE`).
 *
 * **حدٌّ مُعلَنٌ:** هذا مخزنُ قرصٍ لا مخزنُ إنتاجٍ موزَّعٍ. قاعدةُ بياناتٍ أو
 * كائنُ تخزينٍ موزَّعٍ قرارُ تركيبٍ آخرُ خارجَ هذا الملفِّ — البوابةُ تطلبُ
 * عقدَ `load`/`save` وحدَه، ومَن يُمرِّرُ هذا المخزنَ يختارُ القرصَ.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {object} BudgetEntry
 * @property {string} actorId
 * @property {number} startedAt
 * @property {number} tokens
 * @property {number} cost
 */

/**
 * مخزنُ ميزانيةِ استدلالٍ على ملفِّ JSON.
 *
 * القراءةُ **متزامنةٌ**: البوابةُ تُنادي `load()` عندَ أوّلِ قياسٍ، والكتابةُ
 * متزامنةٌ أيضاً لأنّ الاستهلاكَ وقعَ ولم يُقيَّدْ هو عيبٌ يُعالَجُ فوراً لا
 * في الخلفيّةِ.
 */
export class FileInferenceBudgetStore {
  /**
   * @param {{ filePath: string }} options
   */
  constructor({ filePath }) {
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      throw new Error('FileInferenceBudgetStore: filePath مطلوبٌ ومسارٌ غيرُ فارغٍ');
    }
    this.filePath = filePath;
  }

  /**
   * يقرأُ اللقطةَ من القرصِ. الملفُّ الغائبُ يعني عدّاداً نظيفاً (أوّلُ إقلاعٍ).
   * والملفُّ الموجودُ والمعطوبُ يعني استهلاكاً مجهولاً — يُرفَعُ لا يُفترَضُ صفراً.
   *
   * @returns {BudgetEntry[]}
   */
  load() {
    if (!fs.existsSync(this.filePath)) return [];
    const raw = fs.readFileSync(this.filePath, 'utf8');
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error(`اللقطةُ ليست مصفوفةً: ${typeof parsed}`);
      }
      return /** @type {BudgetEntry[]} */ (parsed);
    } catch (error) {
      throw new Error(
        `تعذُّرَ قراءةُ ملفِّ الميزانيةِ (${this.filePath}): ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * يكتبُ اللقطةَ إلى القرصِ. والفشلُ يُرفَعُ لا يُبتلَعُ: استهلاكٌ وقعَ ولم يُدَمْ
   * هو العيبُ نفسُه الذي يُعالِجُه `LIM-1`.
   *
   * @param {BudgetEntry[]} entries
   * @returns {void}
   */
  save(entries) {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }
}
