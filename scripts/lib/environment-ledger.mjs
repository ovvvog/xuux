/**
 * سجلُّ مسارِ البيئةِ على القرص — الخطوة `M10.05`.
 *
 * **حدٌّ معلَنٌ في متنِ الملفِّ لا في هامشِه:** هذا **ليس** `PersistentEventLog`
 * الذي بنته `M2.06` بترقيمٍ متسلسلٍ ورأسٍ منفصلٍ يكشف العبث، بل مُلحِقُ أسطرٍ
 * JSONL بسيطٌ يُطابق عقدَ `append(type, actor, data)` نفسَه. **وسببُ ذلك بنيويٌّ
 * لا تفضيليّ:** `PersistentEventLog` مكتوبٌ بـ`.mts` ويُصرَّف بطورِ `phase:build`
 * الذي **يُنفِّذه هذا السكربتُ نفسُه**، فمن استورده في `bootstrap` جعل الإقامةَ
 * تتوقّف على ناتجِ طورٍ لم يقع بعد — ورأى في بيئةٍ نظيفةٍ خطأَ استيرادٍ لا
 * رسالةَ بيئةٍ ناقصة.
 *
 * والدَينُ مسجَّلٌ في `docs/REMAINING_WORK.md` **لا سهوٌ يُكتشَف**: سجلُّ الإقامةِ
 * لا يحمل ترقيماً متسلسلاً ولا رأساً موقَّعاً، فالعبثُ به لا يُكشَف؛ وهو سجلُّ
 * **أثرِ إقامةٍ** لا سجلُّ دولةٍ، ووصلُه بالسجلِّ الدائمِ موضعُه `M10.06`.
 *
 * @module scripts/lib/environment-ledger
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * مُلحِقُ أسطرِ JSONL يُطابق عقدَ السجلِّ المُحقَنِ في `src/environment/`.
 *
 * **و`createDir` عَلَمٌ حاكمٌ لا تفصيلٌ:** المُقيمُ (`bootstrap`) يُنشئ مجلَّدَ
 * السجلِّ لأنّ إنشاءَ المجلَّداتِ **طورٌ من عملِه المُعلَن**؛ والفاحصُ
 * (`verify:env`) **لا يُنشئ شيئاً** — ولو أنشأه لكان الفحصُ يُصلِح المجلَّدَ
 * الذي يفحص مجسٌّ حاسمٌ حضورَه، فيسقط المجسُّ مرّةً ثم يقوم بلا إقامةٍ:
 * **فحصٌ يُخضِّر نفسَه بالتشغيلِ الثاني**، وهو أسوأُ ما يُصاب به فحصُ صحّة.
 * وعند غيابِ المجلَّدِ يُحصى القيدُ **مُسقَطاً مُعلَناً** في `dropped` ويُطبَع
 * في مخرَجِ الفاحصِ — فالإسقاطُ يُقال ولا يُسكَت.
 */
export class EnvironmentLedger {
  /** @type {string} */
  #file;
  /** @type {boolean} */
  #createDir;
  /** @type {number} */
  #count = 0;
  /** @type {number} */
  #dropped = 0;

  /**
   * @param {string} file مسارُ ملفِّ السجلِّ.
   * @param {{ createDir?: boolean }} [options]
   */
  constructor(file, options = {}) {
    this.#file = path.resolve(file);
    this.#createDir = options.createDir === true;
  }

  /**
   * إلحاقُ قيدٍ واحدٍ.
   *
   * @param {string} type
   * @param {string} actor
   * @param {Record<string, unknown>} data
   * @returns {number} ترتيبُ القيدِ في هذه العمليةِ — لا رقمَه في الملفّ.
   */
  append(type, actor, data) {
    const dir = path.dirname(this.#file);
    if (!fs.existsSync(dir)) {
      if (!this.#createDir) {
        this.#dropped += 1;
        return 0;
      }
      fs.mkdirSync(dir, { recursive: true });
    }
    this.#count += 1;
    fs.appendFileSync(this.#file, `${JSON.stringify({ type, actor, data })}\n`, 'utf8');
    return this.#count;
  }

  /** عدَدُ ما أُلحِق في هذه العمليةِ. */
  get count() {
    return this.#count;
  }

  /** عدَدُ ما أُسقِط لغيابِ مجلَّدِ السجلِّ — **يُعلَن ولا يُسكَت**. */
  get dropped() {
    return this.#dropped;
  }

  /** مسارُ الملفِّ المُعلَن. */
  get file() {
    return this.#file;
  }
}
