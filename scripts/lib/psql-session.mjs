/**
 * @typedef {{ rows: Array<Record<string, unknown>>, rowCount: number }} QueryResult
 * @typedef {{ query: (text: string, params?: unknown[]) => Promise<QueryResult> }} Queryable
 */

/** علامةُ أسطرِ الخرجِ التي يقرؤها `PsqlSession`؛ كلُّ سطرٍ غيرِها (‏خرجُ `pg_restore` نفسِه) يُهمَل. */
const SENTINEL = 'XUUX_RESTORE_R';

/**
 * يُدرِجُ معاملاتِ `$n` قيماً حرفيّةً مقتبسة. لا يُدخِلُ هنا نصٌّ من المستخدم: الاستعلاماتُ ثابتةٌ في
 * هذه الأداةِ و`scripts/backup.mjs`، وقيمُها أسماءٌ من الكتالوجِ أو البيانِ المتحقَّقِ منه.
 * @param {string} text
 * @param {unknown[]} params
 * @returns {string}
 */
function inlineParams(text, params) {
  return text.replace(/\$(\d+)/g, (_, index) => {
    const value = params[Number(index) - 1];
    if (value === undefined) throw new Error(`معاملٌ ناقص $${index}`);
    return `'${String(value).replace(/'/g, "''")}'`;
  });
}

/**
 * ‏`WL-624` (‏`LIVE-78`): جلسةُ `psql` واحدةٌ تحملُ **معاملةً صريحةً واحدة** للاستعادةِ كلِّها — الفحصِ والحجزِ
 * والمحوِ و`pg_restore` والتحقّقِ وتركيبِ الدفتر — ولا `COMMIT` إلّا بأمرٍ صريحٍ بعدَ نجاحِ التحقّق.
 * **لا `--single-transaction`:** ‏psql به يُرسِلُ `COMMIT` عندَ نهايةِ مدخلِه، فموتُ العمليّةِ الأمِّ (‏EOF) يلتزمُ
 * استعادةً ناقصة. هنا نهايةُ المدخلِ بلا `COMMIT` ⇒ يخرجُ psql والمعاملةُ مفتوحة ⇒ يُجهِضُها الخادم.
 * الاستعلامُ يُلفُّ بـ`jsonb_agg` في سطرٍ مُعلَّم، فيُقرأُ الخرجُ كما يُقرأُ من `pg` (‏`rows`).
 */
export class PsqlSession {
  /**
   * @param {import('node:child_process').ChildProcessWithoutNullStreams} child
   */
  constructor(child) {
    this.child = child;
    /** @type {string} */
    this.stderr = '';
    this.buffer = '';
    this.counter = 0;
    /** @type {Map<string, { resolve: (v: string) => void, reject: (e: Error) => void }>} */
    this.waiting = new Map();
    /** @type {number | null} */
    this.exitCode = null;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (/** @type {string} */ chunk) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf('\n');
      while (newline !== -1) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        const match = /^XUUX_RESTORE_R(\d+)=(.*)$/s.exec(line);
        if (match !== null) {
          const waiter = this.waiting.get(String(match[1]));
          if (waiter !== undefined) {
            this.waiting.delete(String(match[1]));
            waiter.resolve(String(match[2]));
          }
        }
        newline = this.buffer.indexOf('\n');
      }
    });
    child.stderr.on('data', (/** @type {string} */ chunk) => {
      this.stderr += chunk;
    });
    child.stdin.on('error', () => undefined);
    this.exited = new Promise((resolve) => {
      child.on('close', (code) => {
        this.exitCode = code ?? 1;
        const error = this.failure();
        for (const waiter of this.waiting.values()) waiter.reject(error);
        this.waiting.clear();
        resolve(this.exitCode);
      });
    });
  }

  /** @returns {boolean} */
  get alive() {
    return this.exitCode === null && !this.child.stdin.destroyed;
  }

  /**
   * خطأٌ يحملُ رمزَ SQLSTATE من `VERBOSITY verbose` (‏«ERROR:  42P06: …») إن وُجد.
   * @returns {Error & { code?: string }}
   */
  failure() {
    const match = /(?:ERROR|FATAL|PANIC):\s+([0-9A-Z]{5}):\s+([^\n]*)/.exec(this.stderr);
    /** @type {Error & { code?: string }} */
    const error = new Error(
      match !== null
        ? String(match[2])
        : this.stderr.trim() || `psql خرجَ برمز ${String(this.exitCode)}`,
    );
    if (match !== null) error.code = String(match[1]);
    return error;
  }

  /**
   * @param {string} text
   * @returns {void}
   */
  write(text) {
    if (!this.alive) throw this.failure();
    this.child.stdin.write(text);
  }

  /**
   * يكتبُ عبارةً ثمّ سطرَ علامةٍ وينتظرُه؛ إن سقطت العبارةُ خرجَ psql (‏`ON_ERROR_STOP`) فيُرفَضُ الوعد.
   * @param {string | null} statement عبارةٌ بلا `;` ختاميّة، أو `null` للعلامةِ وحدَها.
   * @param {string} [selectExpression] تعبيرُ العلامة؛ افتراضيّاً `'ok'`.
   * @returns {Promise<string>}
   */
  mark(statement, selectExpression = `'ok'`) {
    const id = String((this.counter += 1));
    const answer = new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
    });
    try {
      this.write(
        `${statement === null ? '' : `${statement};\n`}SELECT '${SENTINEL}${id}=' || ${selectExpression};\n`,
      );
    } catch (error) {
      this.waiting.delete(id);
      return Promise.reject(error);
    }
    return /** @type {Promise<string>} */ (answer);
  }

  /**
   * واجهةُ `pg` الدنيا التي تحتاجُها فحوصُ هذه الأداةِ وبصمةُ `scripts/backup.mjs`.
   * @param {string} text
   * @param {unknown[]} [params]
   * @returns {Promise<QueryResult>}
   */
  async query(text, params = []) {
    const sql = inlineParams(text, params).trim();
    if (/^(SELECT|WITH)\b/i.test(sql)) {
      const raw = await this.mark(
        null,
        `coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(xuux_q))::text FROM (${sql}) AS xuux_q), '[]')`,
      );
      const rows = /** @type {Array<Record<string, unknown>>} */ (JSON.parse(raw));
      return { rows, rowCount: rows.length };
    }
    await this.mark(sql);
    return { rows: [], rowCount: 0 };
  }

  /** يُغلِقُ المدخلَ بلا `COMMIT` ⇒ psql يخرجُ والمعاملةُ يُجهِضُها الخادم. */
  abandon() {
    if (!this.child.stdin.destroyed) this.child.stdin.end();
  }
}
