/**
 * سجلُّ إقلاعِ العمالِ — قيدُ تفرُّدِ اسمِ العاملِ الحيِّ (`LIVE-45`/د — `WL-394`).
 *
 * ## العطبُ الذي تعالجه هذه الوحدة
 *
 * `releaseUnstarted` (‏`src/execution/queue.mjs`) يُفرِجُ مهمّةً حُجزت بعدَ
 * لحظةِ إقلاعِ العمليةِ لأنّ حجزَ الحياةِ السابقةِ للاسمِ نفسِه قد بدأه
 * مُعالِجُه. وهذا الحكمُ صحيحٌ **بعاملٍ واحدٍ حيٍّ للاسمِ**: أمّا عاملانِ
 * بالاسمِ نفسِه فالثاني يُفرِجُ حجزَ الأوّلِ وقد بدأ مُعالِجُه فعلًا — فيُعادُ
 * إلى الطابورِ فوقَ تنفيذٍ جارٍ. وضمانُ «مرّةً على الأقلّ» يُنقَضُ بمسارٍ
 * مُسمّى، لا بثغرةٍ نظريّةٍ.
 *
 * ## العلاجُ: قيدٌ في القاعدةِ لا فحصٌ في الكودِ
 *
 * عمليةٌ تُقلعُ باسمِ عاملٍ تُثبِتُ ملكيّتَه للاسمِ بمعاملةٍ ذرّيّةٍ واحدةٍ
 * (‏`INSERT ... ON CONFLICT (name) DO UPDATE ... WHERE`)، فإقلاعانِ متزامنانِ
 * على الاسمِ نفسِه يفشلُ أحدُهما بتضادٍّ مُسمّى من القاعدةِ (`WORKER_NAME_TAKEN`)
 * لا بكتابةٍ مزدوجةٍ صامتةٍ. والحياةُ عقدٌ ينتهي: النبضةُ تُمدَّدُ في كلِّ دورةِ
 * عاملٍ، وتقادُمُها فوقَ العتبةِ (`ttlMs`) يفتحُ الاسمَ لإقلاعٍ جديدٍ **بأخذٍ
 * ذرّيٍّ** — فلا يُعزَلُ عاملٌ حيٌّ عن اسمهِ بعَطَلةِ قاعدةٍ عابرةٍ (‏`WL-387`
 * ينتظرُ بلا إفراجٍ) ولا يُدفنُ الاسمُ مع موتِ صاحبهِ (`SIGKILL`): العتبةُ
 * تحسمُ، والتوقّفُ السليمُ يُخلي الاسمَ فورًا (`deregister`).
 *
 * ## الحدودُ المعلنة
 *
 * - **الملكيّةُ عهدةُ قاعدةٍ لا ذاكرةِ عمليةٍ:** العاملُ يتحقّقُ من ملكيّتِه
 *   لاسمِه في كلِّ دورةٍ (`heartbeat`)؛ فإن وجدَ الاسمَ مأخوذًا من إقلاعٍ أحدثَ
 *   توقّفَ **قبلَ أيِّ حجزٍ** برمزٍ مُسمّى (`WORKER_REGISTRATION_LOST`) — فلا
 *   يعملُ عاملانِ بالاسمِ نفسِه ولو انقطعتِ القاعدةُ فوقَ العتبةِ ثم عادت.
 * - **والعتبةُ إعدادُ إقلاعٍ لا ثابتًا مخفيًّا:** تُمرَّرُ صريحةً من
 *   `scripts/worker.mjs` (‏`--registration-ttl-ms`) وتُسجَّلُ في واقعةِ
 *   الإقلاعِ، فلا تُقرأَ النبضةُ بلا عتبةٍ معلومةٍ.
 * - **وهذا سجلُّ حياةٍ لا تدقيقٍ:** آثارُ الرفضِ والفقدِ والأخذِ تُقيَّدُ في
 *   سجلِّ العاملِ الدائمِّ (`kernel.worker.boot-*`)، والجدولُ يحملُ الحدَّ
 *   الأدنى الذي يُحكَمُ به فقط.
 *
 * @module execution/worker-registry
 */

/** رموز سجلِّ العمال. */
export const WORKER_REGISTRY_ERRORS = Object.freeze({
  FIELD_INVALID: 'WORKER_REGISTRY_FIELD_INVALID',
  NAME_TAKEN: 'WORKER_NAME_TAKEN',
  REGISTRATION_LOST: 'WORKER_REGISTRATION_LOST',
});

/** خطأ سجلِّ عمالٍ مسمّى برمزٍ يُفرَّقُ به آليّاً. */
export class WorkerRegistryError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'WorkerRegistryError';
    /** @type {string} */
    this.code = code;
  }
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WorkerRegistryError(
      WORKER_REGISTRY_ERRORS.FIELD_INVALID,
      `الحقل ${field} مطلوبٌ نصًّا غيرَ فارغٍ: ملكيّةُ اسمٍ بلا صاحبٍ معلومٍ لا تُحفَظ.`,
    );
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireUuid(value, field) {
  const text = requireText(value, field);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
    throw new WorkerRegistryError(
      WORKER_REGISTRY_ERRORS.FIELD_INVALID,
      `الحقل ${field} مُعرِّفُ إقلاعٍ (UUID) لا نصٌّ حرٌّ: هويةُ الحياةِ التي تُملَكُ بها الأسماءُ.`,
    );
  }
  return text;
}

/**
 * @typedef {object} WorkerRegistryEntry
 * @property {string} name
 * @property {string} bootId
 * @property {Date} bootedAt
 * @property {Date} heartbeatAt
 */

/**
 * سجلُّ إقلاعِ العمالِ.
 *
 * @param {object} dependencies
 * @param {import('pg').Pool} dependencies.pool
 * @param {number} dependencies.ttlMs عتبةُ تقادُمِ النبضةِ: فوقَها يُفتَحُ الاسمُ لإقلاعٍ جديدٍ.
 * @param {() => Date} [dependencies.now] ساعةٌ قابلةٌ للاختبارِ لا `new Date()` خِفيةً.
 * @param {{ append: (type: string, actor: string, payload: object) => unknown }} [dependencies.log] سجلُّ العاملِ الدائمُ (المختومُ في الإنتاجِ) — آثارُ الحياةِ هنا لا في الجدولِ.
 * @returns {{
 *   register: (request: { worker: string, bootId: string }) => Promise<{ tookOver: boolean }>,
 *   heartbeat: (request: { worker: string, bootId: string }) => Promise<void>,
 *   deregister: (request: { worker: string, bootId: string }) => Promise<number>,
 *   readEntry: (worker: string) => Promise<WorkerRegistryEntry | null>,
 * }}
 */
export function createWorkerRegistry({ pool, ttlMs, now = () => new Date(), log }) {
  if (pool === undefined) {
    throw new WorkerRegistryError(
      WORKER_REGISTRY_ERRORS.FIELD_INVALID,
      'السجلُّ يحتاج مجمّعَ قاعدةٍ: قيدُ اسمٍ بلا قاعدةٍ عهدٌ لا يُحفَظ.',
    );
  }
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
    throw new WorkerRegistryError(
      WORKER_REGISTRY_ERRORS.FIELD_INVALID,
      'عتبةُ تقادُمِ النبضةِ (ttlMs) مطلوبةٌ عددًا موجبًا: بلا عتبةٍ لا يُعرفَ متى يُفتَحُ الاسمُ.',
    );
  }

  /** @returns {Date} لحظةُ انقضاءِ العتبةِ — ما قبلَها نبضةٌ حيّةٌ وما بعدها ميتةٌ. */
  const cutoff = () => new Date(now().getTime() - ttlMs);

  /**
   * يُثبِتُ ملكيّةَ الاسمِ لهذا الإقلاعِ بمعاملةٍ ذرّيّةٍ واحدةٍ.
   *
   * **ولماذا جملةٌ واحدةً لا «اقرأ ثم اكتب»:** شرطُ الاستبدالِ (‏`WHERE` على
   * `DO UPDATE`) يُقيَّمُ على الصفِّ المقفولِ داخلَ القاعدةِ، فإقلاعانِ
   * متزامنانِ على الاسمِ نفسِه يفشلُ أحدُهما هنا بلا نافذةِ سباقٍ إطلاقًا —
   * وقراءةُ «الاسمُ حرٌّ» ثمّ الكتابةُ فوقَها تمرُّ منها سباقاتٌ بلا أثرٍ يُقرأ.
   *
   * @param {{ worker: string, bootId: string }} request
   * @returns {Promise<{ tookOver: boolean }>} نجاحُ الإقلاعِ، وهل أخذَ الاسمَ من مالكٍ سابقٍ (إقلاعٌ جديدٌ لا أوّلُ حياةٍ).
   * @throws {WorkerRegistryError} `NAME_TAKEN` إن كان الاسمُ لعملٍّ حيٍّ آخرَ.
   */
  async function register({ worker, bootId }) {
    const name = requireText(worker, 'worker');
    const id = requireUuid(bootId, 'bootId');
    const at = now();
    const inserted = await pool.query(
      `INSERT INTO state.worker_registrations (name, boot_id, booted_at, heartbeat_at)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (name) DO UPDATE
         SET boot_id = EXCLUDED.boot_id,
             booted_at = EXCLUDED.booted_at,
             heartbeat_at = EXCLUDED.heartbeat_at
         WHERE state.worker_registrations.heartbeat_at < $4
       RETURNING (xmax = 0) AS inserted`,
      [name, id, at, cutoff()],
    );
    const row = inserted.rows[0];
    if (row !== undefined) {
      const tookOver = /** @type {Record<string, unknown>} */ (row)['inserted'] !== true;
      if (log !== undefined) {
        log.append('kernel.worker.boot-registered', name, { bootId: id, ttlMs, tookOver });
      }
      return { tookOver };
    }
    // لا صفَّ عادَ: التضادُّ وقعَ وشرطُ الاستبدالِ رفضَهُ — فالاسمُ لحيٍّ ينبضُ.
    // والقراءةُ هنا للبيانِ (من يملكهُ ومنذُ متى) لا للحكمِ: الحكمُ وقعَ في القاعدةِ.
    const holder = await readEntry(name);
    if (holder === null) {
      // نظريٌّ (حذفٌ متزامنٌ لحظةَ التضادِّ) — يُعادُ الحكمُ مرّةً واحدةً فلا يُقرأَ
      // الغيابُ اللمسيُّ حكمًا. وإن تكرّرَ فالخطأُ مُسمّى لا صامتٌ.
      const retried = await pool.query(
        `INSERT INTO state.worker_registrations (name, boot_id, booted_at, heartbeat_at)
         VALUES ($1, $2, $3, $3)
         ON CONFLICT (name) DO NOTHING
         RETURNING (xmax = 0) AS inserted`,
        [name, id, at],
      );
      if (retried.rows[0] !== undefined) {
        if (log !== undefined) {
          log.append('kernel.worker.boot-registered', name, { bootId: id, ttlMs, tookOver: false });
        }
        return { tookOver: false };
      }
      throw new WorkerRegistryError(
        WORKER_REGISTRY_ERRORS.NAME_TAKEN,
        `الاسم ${name} مأخوذٌ من إقلاعٍ آخرَ ولا يُملَكُ بلا أخذٍ ذرّيٍّ.`,
      );
    }
    const ageMs = Math.max(0, now().getTime() - holder.heartbeatAt.getTime());
    if (log !== undefined) {
      log.append('kernel.worker.boot-rejected', name, {
        holderBootId: holder.bootId,
        heartbeatAgeMs: ageMs,
      });
    }
    throw new WorkerRegistryError(
      WORKER_REGISTRY_ERRORS.NAME_TAKEN,
      `الاسم ${name} لعملٍّ حيٍّ آخرَ (إقلاعُ ${holder.bootId}، نبضتُه قبلَ ${Math.round(ageMs / 1000)} ثانيةً): عاملانِ بالاسمِ نفسِه يُبطلانَ ضمانَ «لم يبدأ» — أقلعْ باسمٍ آخرَ.`,
    );
  }

  /**
   * يُمدِّدُ نبضةَ الملكيّةِ ويُثبِتُ أنّ الاسمَ ما زالَ لهذا الإقلاعِ.
   *
   * @param {{ worker: string, bootId: string }} request
   * @returns {Promise<void>}
   * @throws {WorkerRegistryError} `REGISTRATION_LOST` إن أخذَ الإقلاعَ الأحدثُ الاسمَ — فالاستمرارُ يُبطلُ الضمانَ.
   */
  async function heartbeat({ worker, bootId }) {
    const name = requireText(worker, 'worker');
    const id = requireUuid(bootId, 'bootId');
    const updated = await pool.query(
      `UPDATE state.worker_registrations
          SET heartbeat_at = $3
        WHERE name = $1 AND boot_id = $2
        RETURNING heartbeat_at`,
      [name, id, now()],
    );
    if (updated.rows[0] === undefined) {
      if (log !== undefined) {
        log.append('kernel.worker.registration-lost', name, { bootId: id });
      }
      throw new WorkerRegistryError(
        WORKER_REGISTRY_ERRORS.REGISTRATION_LOST,
        `الاسم ${name} لم يعدَ لهذا الإقلاعِ (${id}): أخذَهُ إقلاعٌ أحدثُ بعدَ تقادُمِ النبضةِ، والعملُ به يُبطلُ ضمانَ «لم يبدأ» — توقّفْ عندَ حدٍّ آمنٍ.`,
      );
    }
  }

  /**
   * يُخلي الاسمَ عندَ التوقّفِ السليمِ: فورًا لا انتظارَ العتبةِ.
   *
   * **والمُعرِّفُ في الشرطِ لا الاسمُ وحدَهُ:** فلو أخذَ الاسمَ إقلاعٌ أحدثُ
   * فلا يُحذفْ سجلُّهُ — الحذفُ يقعُ على ملكيّتِنا نحنُ فقط.
   *
   * @param {{ worker: string, bootId: string }} request
   * @returns {Promise<number>} عددُ الصفوفِ المحذوفةِ (صفرٌ إن لم نكنِ المالكَينَ).
   */
  async function deregister({ worker, bootId }) {
    const name = requireText(worker, 'worker');
    const id = requireUuid(bootId, 'bootId');
    const deleted = await pool.query(
      `DELETE FROM state.worker_registrations WHERE name = $1 AND boot_id = $2`,
      [name, id],
    );
    return deleted.rowCount ?? 0;
  }

  /**
   * يقرأُ ملكيّةَ اسمٍ — للبيانِ والاختبارِ لا للحكمِ (الحكمُ ذرّيٌّ في `register`).
   * @param {string} worker
   * @returns {Promise<WorkerRegistryEntry | null>}
   */
  async function readEntry(worker) {
    const name = requireText(worker, 'worker');
    const result = await pool.query(
      `SELECT name, boot_id, booted_at, heartbeat_at FROM state.worker_registrations WHERE name = $1`,
      [name],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const record = /** @type {Record<string, unknown>} */ (row);
    return {
      name: String(record['name']),
      bootId: String(record['boot_id']),
      bootedAt: new Date(String(record['booted_at'])),
      heartbeatAt: new Date(String(record['heartbeat_at'])),
    };
  }

  return { register, heartbeat, deregister, readEntry };
}
