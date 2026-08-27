/**
 * ناقلُ قنوات الأحداث: تدفّقاتٌ حقيقية بمُنتِجٍ ومستهلكٍ وموضعِ قراءةٍ محفوظ
 * — الخطوة `M7.07`.
 *
 * **الحالُ قبل هذه الوحدة:** كان في الدولة **سجلٌّ** واحدٌ للأحداث
 * (`src/root-of-trust/event-log.mjs`) تكتب فيه خمسةٌ وعشرون موضعاً، وهو سجلٌّ
 * مُجزَّأٌ سليمُ السلسلة — لكنه **ليس قناة**:
 *
 *  1. **لا تدفّقَ لكل مجال**: من أراد أحداث الاحتفاظ قرأ السجلَّ كلّه من أوّله
 *     ورشّح بنفسه، فقارئان يرشّحان بشرطين مختلفين يقرأان مجالين مختلفين ويحسبان
 *     أنهما يقرأان الشيء نفسه.
 *  2. **لا موضعَ قراءةٍ محفوظ**: `snapshot()` يُعيد كل شيء في كل نداء، فمستهلكٌ
 *     يُعاد تشغيله يُعالج ما عالجه — أو يبتدئ من الطرف فيُسقط ما فاته. وكلاهما
 *     خطأٌ صامت.
 *  3. **لا سلطةَ على النشر ولا على القراءة**: أي حاملٍ للسجل ينشر أي نوع، وأي
 *     قارئٍ يقرأ أحداث التاج وأحداث الاستدلال معاً بلا تخليص.
 *  4. **لا عقدَ ولا نسخة**: لا شيءَ يقول ما الحقولُ التي يضمنها نوعٌ لقارئه.
 *
 * فصار لكل مجالٍ **تدفّقٌ مستقل** بسلسلةِ تجزئةٍ **لكل قناة على حدةٍ** (ترقيمٌ
 * متّصل من 1 داخل القناة)، وبموضعِ قراءةٍ محفوظٍ لكل مجموعةِ استهلاك، وبتخليصٍ
 * يُقاس على تصنيف القناة بشبكة التصنيف نفسها التي تحكم أصول البيانات، وبعقدٍ
 * لكل نوعٍ منشور تُقاس عليه الرسالةُ **قبل** كتابتها.
 *
 * **ولماذا سلسلةٌ لكل قناة لا واحدةٌ للدفتر كلّه؟** لأن القناة هي وحدةُ القراءة:
 * مستهلكٌ يقرأ قناةً واحدة يجب أن يستطيع فحصَ ما قرأه بلا قراءةِ قنواتٍ لا
 * تخليصَ له عليها. وسلسلةٌ عامّةٌ تجعل فحصَ قناةٍ يقتضي قراءةَ الكل، وذلك يهدم
 * التخليصَ نفسه. والثمنُ معلَن: حذفُ **قناةٍ كاملة** من المخزن لا تكشفه سلسلةُ
 * قناةٍ أخرى، ويكشفه سجلُّ جذر الثقة الذي يبقى المرجعَ الأول.
 *
 * **والنقلُ ليس تأليفاً:** `relay` يحمل أحداثاً **مكتوبةً أصلاً** في سجل جذر
 * الثقة إلى قنواتها، ويحفظ فاعلَها الأصلي (`authorId`) منفصلاً عن ناقلها
 * (`actorId`). فالناقلُ لا يُنشئ واقعةً، ولذلك يجوز له كل القنوات بينما
 * `publish` المباشر مقيَّدٌ بمنتِجي القناة. وهو **يتوقّف مغلقاً** عند أول حدثٍ
 * يخالف عقده ولا يتجاوزه: تجاوزُه إسقاطٌ صامتٌ لواقعةٍ وقعت.
 *
 * **وحدٌّ معلَن:** الأحداثُ القائمة في `src/` تُكتب في السجل بـ`append` المتزامنة
 * ثم تُنقل إلى القنوات بـ`relay`؛ ولم تُحوَّل مواضعُ النشر الخمسةُ والعشرون إلى
 * `publish` مباشرةً، لأن الكتابةَ في المستودع غيرُ متزامنة وتحويلُ `append`
 * المتزامنة إلى غير متزامنة يمسّ خمسةً وعشرين موضعاً وعقدَ كل سجلٍّ يحملها —
 * وذلك تغييرٌ أوسع من هذه الخطوة، ومكتوبٌ في `docs/REMAINING_WORK.md`. والنقلُ
 * لا يُفقد حدثاً لأن السجلَّ دائمٌ ومُجزَّأ، لكنه **غيرُ فوري**: بين الكتابة
 * والنقل نافذةٌ لا يرى فيها المستهلكُ الحدث.
 */

import { createHash, randomUUID } from 'node:crypto';

import {
  EVENT_ERRORS,
  EventError,
  assertPayloadValid,
  assertVersionAcceptable,
  channelOfType,
} from './contracts.mjs';

/** أول وصلةٍ في سلسلة كل قناة: بدايةٌ معلَنة لا قيمةٌ فارغة. */
export const EVENT_GENESIS = 'genesis';

/** معرّفُ موضعِ النقل: مجموعةٌ محفوظة لا يجوز لمستهلكٍ أن يستعملها. */
export const RELAY_GROUP = 'relay';

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 * @returns {never}
 */
function fail(code, message, detail = {}) {
  throw new EventError(code, message, detail);
}

/**
 * تجزئةُ رسالةٍ في قناة. الترتيبُ مثبَّتٌ نصاً: كلُّ تغييرٍ فيه تغييرُ صيغةٍ
 * يُبطل تجزئة كل ما كُتب قبله، فيستوجب مُدخلةً في سجل الأعمال.
 * @param {object} fields
 * @param {string} fields.prevHash
 * @param {string} fields.channel
 * @param {number} fields.seq
 * @param {string} fields.type
 * @param {number} fields.contractVersion
 * @param {string} fields.authorId
 * @param {string} fields.actorId
 * @param {string} fields.actorRole
 * @param {string} fields.classification
 * @param {Record<string, unknown>} fields.payload
 * @param {string} fields.recordedAt
 * @returns {string}
 */
export function messageHash({
  prevHash,
  channel,
  seq,
  type,
  contractVersion,
  authorId,
  actorId,
  actorRole,
  classification,
  payload,
  recordedAt,
}) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        prevHash,
        channel,
        seq,
        type,
        contractVersion,
        authorId,
        actorId,
        actorRole,
        classification,
        payload,
        recordedAt,
      }),
    )
    .digest('hex');
}

/**
 * @typedef {object} EventActor
 * @property {string} id
 * @property {string} role
 */

/**
 * @typedef {object} EventConsumer
 * @property {string} id
 * @property {string} role
 * @property {string} clearance
 */

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requiredText(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') {
    fail(
      EVENT_ERRORS.INPUT_INVALID,
      `رسالةٌ بلا «${field}»: رسالةٌ ناقصةُ الفاعل تُقرأ لاحقاً كأنها نشأت من لا أحد.`,
      { field },
    );
  }
  return text;
}

/** ناقلُ الأحداث: قنواتٌ مستقلّة، كلٌّ منها تدفّقٌ مُجزَّأٌ بموضعِ قراءةٍ محفوظ. */
export class EventBus {
  /**
   * @param {object} deps
   * @param {import('./contracts.mjs').EventsPolicy} deps.policy
   * @param {{ dominates: (clearance: string, classification: string) => boolean, tier: (value: string) => { id: string } }} deps.lattice
   * @param {{ insert: (record: Record<string, unknown>) => Promise<Record<string, unknown>>, list: (query?: object) => Promise<Array<Record<string, unknown>>> }} deps.messages
   * @param {{ insert: (record: Record<string, unknown>) => Promise<Record<string, unknown>>, list: (query?: object) => Promise<Array<Record<string, unknown>>>, update: (id: string, version: number, patch: Record<string, unknown>) => Promise<Record<string, unknown>> }} deps.offsets
   * @param {(() => Date) | undefined} [deps.now]
   */
  constructor({ policy, lattice, messages, offsets, now }) {
    if (policy === undefined || lattice === undefined) {
      fail(
        EVENT_ERRORS.INPUT_INVALID,
        'الناقل يحتاج سياسةً وشبكةَ تصنيف: بلا سياسةٍ لا عقد، وبلا شبكةٍ لا تخليصَ يُقاس عليه.',
      );
    }
    if (messages === undefined || offsets === undefined) {
      fail(
        EVENT_ERRORS.INPUT_INVALID,
        'الناقل يحتاج مستودعَ رسائل ومستودعَ مواضع: تدفّقٌ في الذاكرة يزول بإعادة التشغيل، وموضعٌ غيرُ محفوظ يجعل المستهلك يُعيد ما عالجه.',
      );
    }
    this.policy = policy;
    this.lattice = lattice;
    this.messages = messages;
    this.offsets = offsets;
    this.now = now ?? (() => new Date());
  }

  /**
   * القناةُ المُعلَنة لنوعٍ، أو رفضٌ مُسمّى.
   * @param {string} type
   * @returns {import('./contracts.mjs').EventChannel}
   */
  #channelOf(type) {
    const id = channelOfType(type);
    const channel = this.policy.channelFor(id);
    if (channel === null) {
      fail(
        EVENT_ERRORS.TYPE_UNKNOWN,
        `لا قناةَ معلَنة للمجال «${id}» المستخرج من النوع «${type}».`,
        { type, channel: id },
      );
    }
    return channel;
  }

  /**
   * رسائلُ قناةٍ بترتيب سلسلتها. الترتيبُ يُفرض هنا ولا يُفترض من المستودع:
   * تطبيقان قد يختلفان في ترتيب الإرجاع، وسلسلةٌ تُفحص بغير ترتيبها تُبلّغ عن
   * كسرٍ لم يقع.
   * @param {string} channel
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async entries(channel) {
    const rows = await this.messages.list({ filter: { channel } });
    return [...rows].sort((left, right) => Number(left['seq']) - Number(right['seq']));
  }

  /**
   * رأسُ القناة: آخرُ ترقيمٍ وآخرُ تجزئة.
   * @param {string} channel
   * @returns {Promise<{ seq: number, hash: string }>}
   */
  async head(channel) {
    const rows = await this.entries(channel);
    const last = rows[rows.length - 1];
    if (last === undefined) return { seq: 0, hash: EVENT_GENESIS };
    return { seq: Number(last['seq']), hash: String(last['hash']) };
  }

  /**
   * ينشر رسالةً في قناتها بعد قياسها على عقدها وعلى سلطة ناشرها.
   * @param {object} input
   * @param {string} input.type
   * @param {EventActor} input.actor
   * @param {Record<string, unknown>} input.payload
   * @param {string} [input.authorId] فاعلُ الواقعة الأصلي إن كان غير الناشر (النقل).
   * @param {boolean} [input.relayed] هل هذه رسالةٌ منقولة من سجل جذر الثقة.
   * @returns {Promise<Record<string, unknown>>}
   */
  async publish({ type, actor, payload, authorId, relayed = false }) {
    const channel = this.#channelOf(type);
    const actorId = requiredText(actor?.id, 'actor.id');
    const actorRole = requiredText(actor?.role, 'actor.role');
    // النقلُ حملٌ لا تأليف: الناقلُ يُقاس على `relayRoles`، والمؤلِّفُ على
    // منتِجي القناة. وخلطُهما يعني أن أي ناقلٍ صار مؤلِّفاً في كل قناة.
    const allowed = relayed ? this.policy.relayRoles : channel.producers;
    if (!allowed.includes(actorRole)) {
      fail(
        EVENT_ERRORS.PUBLISH_REFUSED,
        relayed
          ? `دورُ «${actorRole}» ليس من أدوار النقل المعلَنة (${this.policy.relayRoles.join('، ')}).`
          : `دورُ «${actorRole}» ليس من منتِجي قناة «${channel.id}» (${channel.producers.join('، ')}).`,
        { type, channel: channel.id, actorId, actorRole, relayed },
      );
    }
    const contract = assertPayloadValid(this.policy, type, payload);
    const previous = await this.head(channel.id);
    const seq = previous.seq + 1;
    const recordedAt = this.now().toISOString();
    const fields = {
      channel: channel.id,
      type,
      contractVersion: contract.version,
      authorId: authorId === undefined ? actorId : requiredText(authorId, 'authorId'),
      actorId,
      actorRole,
      classification: this.lattice.tier(channel.classification).id,
      payload: Object.freeze({ ...payload }),
      recordedAt,
    };
    const hash = messageHash({ prevHash: previous.hash, seq, ...fields });
    return this.messages.insert({
      id: 'event:' + randomUUID(),
      ...fields,
      seq,
      prevHash: previous.hash,
      hash,
      relayed,
    });
  }

  /**
   * ينقل أحداثاً من سجل جذر الثقة إلى قنواتها، ويحفظ موضعَ ما نُقل.
   *
   * ويتوقّف **مغلقاً** عند أول حدثٍ يخالف عقده: تجاوزُه إسقاطٌ صامتٌ لواقعة،
   * والتوقّفُ يجعل الانحراف مقروءاً في التقرير وفي رمز الخطأ.
   * @param {object} input
   * @param {ReadonlyArray<{ seq: number, type: string, actor: string, data: object }>} input.events
   * @param {EventActor} input.actor
   * @returns {Promise<{ relayed: number, fromSeq: number, toSeq: number, perChannel: Record<string, number>, stoppedAt: number | null, fault: string | null }>}
   */
  async relay({ events, actor }) {
    const actorRole = requiredText(actor?.role, 'actor.role');
    if (!this.policy.relayRoles.includes(actorRole)) {
      fail(
        EVENT_ERRORS.PUBLISH_REFUSED,
        `دورُ «${actorRole}» لا يجوز له نقلُ الأحداث؛ الأدوار المعلَنة: ${this.policy.relayRoles.join('، ')}.`,
        { actorRole },
      );
    }
    const marker = await this.#offsetRow(RELAY_GROUP, '*');
    const from = Number(marker['committedSeq']);
    /** @type {Record<string, number>} */
    const perChannel = {};
    let relayed = 0;
    let last = from;
    /** @type {number | null} */
    let stoppedAt = null;
    /** @type {string | null} */
    let fault = null;
    for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
      if (event.seq <= from) continue;
      try {
        const message = await this.publish({
          type: event.type,
          actor,
          payload: /** @type {Record<string, unknown>} */ (event.data ?? {}),
          authorId: event.actor,
          relayed: true,
        });
        const id = String(message['channel']);
        perChannel[id] = (perChannel[id] ?? 0) + 1;
        relayed += 1;
        last = event.seq;
      } catch (error) {
        stoppedAt = event.seq;
        fault = error instanceof EventError ? error.code : 'UNKNOWN';
        break;
      }
    }
    if (last > from) await this.#commitOffset(marker, last);
    return { relayed, fromSeq: from, toSeq: last, perChannel, stoppedAt, fault };
  }

  /**
   * يقرأ رسائلَ قناةٍ بعد الموضع المحفوظ لمجموعةٍ، بلا تثبيتِ الموضع.
   *
   * القراءةُ لا تُثبّت الموضع قصداً: مستهلكٌ يُثبّت قبل المعالجة يُسقط ما لم
   * يُعالجه إن سقط في المنتصف. فالتثبيتُ فعلٌ منفصل (`commit`) بعد المعالجة —
   * وهو تسليمٌ **مرّةً على الأقل** لا مرّةً واحدة، وذلك حدٌّ معلَن.
   * @param {object} input
   * @param {string} input.channel
   * @param {string} input.group
   * @param {EventConsumer} input.consumer
   * @param {number} [input.limit]
   * @param {number} [input.minVersion]
   * @returns {Promise<{ messages: Array<Record<string, unknown>>, fromSeq: number, headSeq: number, lag: number }>}
   */
  async consume({ channel, group, consumer, limit, minVersion }) {
    const declared = this.policy.channelFor(channel);
    if (declared === null) {
      fail(EVENT_ERRORS.CONSUME_REFUSED, `لا قناةَ معلَنة باسم «${channel}».`, { channel });
    }
    const role = requiredText(consumer?.role, 'consumer.role');
    const clearance = requiredText(consumer?.clearance, 'consumer.clearance');
    if (!declared.consumers.includes(role)) {
      fail(
        EVENT_ERRORS.CONSUME_REFUSED,
        `دورُ «${role}» ليس من قُرّاء قناة «${channel}» (${declared.consumers.join('، ')}).`,
        { channel, role },
      );
    }
    // التخليصُ يُقاس بشبكة التصنيف نفسها التي تحكم أصول البيانات: قناةٌ مصنّفةٌ
    // سياديةً يقرؤها من لا تخليصَ له تصير طريقاً حول بوابة الوصول.
    if (!this.lattice.dominates(clearance, declared.classification)) {
      fail(
        EVENT_ERRORS.CONSUME_REFUSED,
        `تخليصُ «${clearance}» لا يبلغ تصنيفَ قناة «${channel}» (${declared.classification}).`,
        { channel, clearance, classification: declared.classification },
      );
    }
    const offsetRow = await this.#offsetRow(requiredText(group, 'group'), channel);
    const from = Number(offsetRow['committedSeq']);
    const rows = await this.entries(channel);
    const last = rows[rows.length - 1];
    const head = last === undefined ? 0 : Number(last['seq']);
    const cap = Math.min(limit ?? this.policy.maxBatch, this.policy.maxBatch);
    const pending = rows.filter((row) => Number(row['seq']) > from).slice(0, cap);
    for (const row of pending) {
      const contract = this.policy.contractFor(String(row['type']));
      if (contract === null) {
        fail(
          EVENT_ERRORS.TYPE_UNKNOWN,
          `رسالةٌ مخزَّنة من نوعٍ لم يبقَ له عقد: «${String(row['type'])}». حذفُ عقدٍ لنوعٍ منشورٍ يجعل القراءة تخميناً.`,
          { channel, type: row['type'] },
        );
      }
      assertVersionAcceptable(contract, Number(row['contractVersion']), minVersion);
    }
    return { messages: pending, fromSeq: from, headSeq: head, lag: head - from };
  }

  /**
   * يثبّت موضعَ القراءة لمجموعةٍ على قناةٍ. التقدّمُ إلى الأمام وحده مقبول:
   * تراجعُ الموضع يُعيد معالجةَ ما عُولج ويُخفي ذلك عن التدقيق.
   * @param {object} input
   * @param {string} input.channel
   * @param {string} input.group
   * @param {number} input.seq
   * @returns {Promise<{ channel: string, group: string, committedSeq: number }>}
   */
  async commit({ channel, group, seq }) {
    if (this.policy.channelFor(channel) === null) {
      fail(EVENT_ERRORS.OFFSET_INVALID, `تثبيتُ موضعٍ على قناةٍ غير معلَنة: «${channel}».`, {
        channel,
      });
    }
    if (!Number.isInteger(seq) || seq < 1) {
      fail(EVENT_ERRORS.OFFSET_INVALID, `موضعٌ غير صالح: ${String(seq)}. الترقيم يبدأ من 1.`, {
        channel,
        seq,
      });
    }
    const row = await this.#offsetRow(requiredText(group, 'group'), channel);
    const current = Number(row['committedSeq']);
    if (seq < current) {
      fail(
        EVENT_ERRORS.OFFSET_INVALID,
        `تراجعُ موضعٍ من ${current} إلى ${seq} على قناة «${channel}»: إعادةُ معالجةٍ صامتة.`,
        { channel, group, current, seq },
      );
    }
    const { seq: headSeq } = await this.head(channel);
    if (seq > headSeq) {
      fail(
        EVENT_ERRORS.OFFSET_INVALID,
        `تثبيتُ موضعٍ ${seq} فوق رأس القناة ${headSeq}: إقرارٌ بمعالجة رسالةٍ لم تُكتب.`,
        { channel, group, headSeq, seq },
      );
    }
    const updated = await this.#commitOffset(row, seq);
    return {
      channel,
      group: String(updated['group']),
      committedSeq: Number(updated['committedSeq']),
    };
  }

  /**
   * يفحص سلسلةَ قناةٍ: الترقيمُ متّصلٌ من 1، وكلُّ رسالةٍ تُشير إلى تجزئة سابقتها،
   * وتجزئتُها تُطابق إعادةَ حسابها.
   * @param {string} channel
   * @returns {Promise<{ ok: boolean, count: number, fault?: string, at?: number }>}
   */
  async verifyChannel(channel) {
    const rows = await this.entries(channel);
    let expectedPrev = EVENT_GENESIS;
    let expectedSeq = 1;
    for (const row of rows) {
      const seq = Number(row['seq']);
      if (seq !== expectedSeq) {
        return { ok: false, count: rows.length, fault: 'ترقيمٌ منقطع', at: seq };
      }
      if (String(row['prevHash']) !== expectedPrev) {
        return { ok: false, count: rows.length, fault: 'وصلةٌ مكسورة بما قبلها', at: seq };
      }
      const recomputed = messageHash({
        prevHash: String(row['prevHash']),
        channel: String(row['channel']),
        seq,
        type: String(row['type']),
        contractVersion: Number(row['contractVersion']),
        authorId: String(row['authorId']),
        actorId: String(row['actorId']),
        actorRole: String(row['actorRole']),
        classification: String(row['classification']),
        payload: /** @type {Record<string, unknown>} */ (row['payload'] ?? {}),
        recordedAt: String(row['recordedAt']),
      });
      if (recomputed !== String(row['hash'])) {
        return { ok: false, count: rows.length, fault: 'تجزئةٌ لا تطابق الحقول', at: seq };
      }
      expectedPrev = String(row['hash']);
      expectedSeq += 1;
    }
    return { ok: true, count: rows.length };
  }

  /**
   * يفحص كل القنوات المعلَنة ويُعيد أولَ عيبٍ في كلٍّ منها إن وُجد.
   * @returns {Promise<{ ok: boolean, channels: Record<string, { ok: boolean, count: number, fault?: string, at?: number }> }>}
   */
  async verifyAll() {
    /** @type {Record<string, { ok: boolean, count: number, fault?: string, at?: number }>} */
    const report = {};
    let ok = true;
    for (const channel of this.policy.channels) {
      const result = await this.verifyChannel(channel.id);
      report[channel.id] = result;
      if (!result.ok) ok = false;
    }
    return { ok, channels: report };
  }

  /**
   * صفُّ موضعٍ لمجموعةٍ على قناة، يُنشأ عند أول طلب بموضعٍ صفريّ.
   * @param {string} group
   * @param {string} channel
   * @returns {Promise<Record<string, unknown>>}
   */
  async #offsetRow(group, channel) {
    // المعرّف تجزئةٌ حتمية لا تركيبٌ نصيٌّ: معرّفات الدولة محدودةُ الأبجدية،
    // واسمُ المجموعة يأتي من خارج فيحمل ما يحمل. والاسمُ نفسه محفوظٌ في
    // عموده كاملاً، فلا تُفقد قراءتُه بالتجزئة.
    const id =
      'offset:' +
      createHash('sha256').update(`${group}\u0000${channel}`).digest('hex').slice(0, 48);
    // الترشيحُ بـ`group`+`channel` لا بـ`id`: المستودع يرفض الترشيح بحقلٍ لم
    // يُعلَن قابلاً له، ومنعُه صائب — ترشيحٌ بلا فهرس مسحٌ كاملٌ يُخفي كلفته.
    const rows = await this.offsets.list({ filter: { group, channel } });
    const existing = rows[0];
    if (existing !== undefined) return existing;
    return this.offsets.insert({
      id,
      group,
      channel,
      committedSeq: 0,
      committedAt: this.now().toISOString(),
    });
  }

  /**
   * @param {Record<string, unknown>} row
   * @param {number} seq
   * @returns {Promise<Record<string, unknown>>}
   */
  async #commitOffset(row, seq) {
    return this.offsets.update(String(row['id']), Number(row['version']), {
      committedSeq: seq,
      committedAt: this.now().toISOString(),
    });
  }
}
