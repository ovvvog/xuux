/**
 * نقطة التفويض المركزية (P0) — M4.05
 *
 * المسألة التي تحلّها: قبلها كان القرار موزّعاً — بوابة التاج تسأل محرّكاً أدنى،
 * وسجل الوكلاء يفحص قدرةً محرَّمة بنفسه، والنواة لا تسأل أحداً. فمن أراد تجاوز
 * السياسة لم يحتج خرقها، بل احتاج مساراً لا يمرّ بها.
 *
 * فصارت **نقطة واحدة**: `authorize` تُقيّم وتُخصم الحصّة وتُسجّل القرار وتُصدر
 * **تذكرة قرار** موقّعة بمفتاح داخلي، لا تُقبل إلا مرّة واحدة ولا تصلح لفعلٍ أو
 * موردٍ أو فاعلٍ غير الذي صدرت له. والنواة لا تنفّذ فعلاً محكوماً بلا تذكرة
 * تتحقّق منها هذه النقطة — فلم يبقَ للتجاوز مسارٌ جانبي، بل صار الغياب رفضاً
 * مُسمّى `AUTHORIZATION_POINT_REQUIRED`.
 *
 * والتذكرة داخلية لا سيادية: هي إثبات «مررتُ بالنقطة»، لا بديل عن توقيع الملك.
 * توقيع الأمر الملكي يتحقّق منه التاج كما كان، والعتبة السيادية تشترط أمراً
 * مقبولاً فوق ذلك.
 *
 * **وأُضيف في الخطوة `M8.02` حاجزُ التشريع** (`legislationGate`): كان تضادُّ
 * قانونين يُحسم صامتاً بغَلَبةِ الرفض ثم بترتيب المعرّفات أبجدياً، فيَنفُذ أحدُ
 * المشرِّعين على الآخر بلا قرارٍ يُقرأ. فصار الفعلُ الذي يقع فيه تعارضٌ مانعٌ
 * **ممنوعَ الإنفاذ** برمز `LEGISLATION_CONFLICT_UNRESOLVED` حتى يُحَلَّ التعارضُ
 * ويُقاس زوالُه. والحاجزُ يُسأل **قبل** تقييم السياسة وبعد الهوية: سياسةٌ تُقيَّم
 * على فعلٍ متعارَضٍ فيه تُنتج قراراً يبدو محكوماً وهو محسومٌ بحرف الاسم.
 */

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/** @typedef {import('./model.mjs').PolicyRequest} PolicyRequest */
/** @typedef {import('./model.mjs').PolicyDecision} PolicyDecision */
/** @typedef {import('./engine.mjs').PolicyDecisionPoint} PolicyDecisionPoint */

/**
 * دفتر الحصص كما تحتاجه النقطة. الواجهة ضيقة عن قصد: النقطة لا تعرف SQL ولا
 * نوافذ زمنية، والدفتر لا يعرف السياسة.
 * @typedef {object} QuotaLedgerLike
 * @property {(request: { subjectType: string, subjectId: string, resource: string, amount: number }) => Promise<{ resource: string, consumed: number, limit: number, remaining: number }>} debit
 */

/** @typedef {(record: { decision: PolicyDecision, request: PolicyRequest }) => void | Promise<void>} DecisionSink */

/**
 * بوابة الهوية كما تحتاجها النقطة (‏M6.01). الواجهة ضيقة عن قصد: النقطة لا
 * تعرف شهادات ولا منحاً، والبوابة لا تعرف سياسةً ولا تذاكر.
 * @typedef {object} IdentityGateLike
 * @property {(actorId: string) => Promise<{ ok: boolean, code: string, reason: string, actor: { id: string, role: string, state: string, kind: import('./model.mjs').ActorKind, capabilities: readonly string[] } | null }>} verify
 */

/**
 * حاجزُ التشريع كما تحتاجه النقطة (الخطوة `M8.02`). الواجهةُ ضيّقةٌ عن قصد:
 * النقطةُ لا تعرف قوانينَ ولا موادَّ دستورية ولا تملك سبيلاً إلى الإصدار، وهذا
 * ما يمنع أن يصير الإنفاذُ مُشرِّعاً. وترْكُه `null` يُبقي السلوكَ كما كان.
 * @typedef {object} LegislationGateLike
 * @property {() => Promise<ReadonlySet<string>>} blockedActions
 */

/** عمر التذكرة: القرار يُنفَّذ الآن أو يُطلب من جديد. */
const DECISION_TTL_MS = 60000;

/**
 * ينسخ ما تُسجّله التذكرة من الطلب. الفاعل والفعل والمورد هي ما تُربط به
 * التذكرة، فتذكرةُ قراءةٍ لا تُنفَّذ بها كتابة.
 * @param {PolicyRequest} request
 * @returns {{ actorId: string, action: string, resourceKey: string }}
 */
function bindingOf(request) {
  return {
    actorId: request.actor.id,
    action: request.action,
    resourceKey: `${request.resource.type}:${request.resource.id}`,
  };
}

export class EnforcementPoint {
  /**
   * @param {{ decisionPoint?: PolicyDecisionPoint, log?: { append: (type: string, actor: string, payload: object) => unknown }, haltSwitch?: { assertOperational: () => void } | null, quotaLedger?: QuotaLedgerLike | null, decisionSink?: DecisionSink | null, identityGate?: IdentityGateLike | null, legislationGate?: LegislationGateLike | null, requireIdentityGate?: boolean, secret?: Buffer, now?: () => Date }} [deps]
   */
  constructor({
    decisionPoint,
    log,
    haltSwitch = null,
    quotaLedger = null,
    decisionSink = null,
    identityGate = null,
    legislationGate = null,
    requireIdentityGate = false,
    secret,
    now,
  } = {}) {
    if (!decisionPoint || !log) throw new Error('ENFORCEMENT_DEPENDENCY_MISSING');
    this.decisionPoint = decisionPoint;
    this.log = log;
    this.haltSwitch = haltSwitch;
    this.identityGate = identityGate;
    this.requireIdentityGate = requireIdentityGate;
    this.legislationGate = legislationGate;
    this.quotaLedger = quotaLedger;
    this.decisionSink = decisionSink;
    // مفتاح التذكرة يُولَّد لكل عملية: تذكرةٌ من عملية سابقة لا تُقبل بعد إعادة
    // التشغيل، وذلك هو المقصود — التذكرة إذنُ تنفيذٍ لحظي لا رخصة دائمة.
    this.secret = secret ?? randomBytes(32);
    this.now = now ?? (() => new Date());
    /** @type {Map<string, number>} التذاكر المُصدَرة وأوقات انتهائها */
    this.issued = new Map();
  }

  /**
   * قائمة الأفعال المحكومة مشتقّة من البيانات (الحسّاس في الكتالوج + العتبة).
   * @returns {ReadonlySet<string>}
   */
  governedActions() {
    return this.decisionPoint.governedActions();
  }

  /**
   * المسار الوحيد للتفويض: يفحص الإيقاف الشامل، ثم يقيّم السياسة، ثم يخصم
   * الحصّة إن كان للفعل حصّة معلنة، ثم يسجّل القرار ويصدر التذكرة.
   *
   * الترتيب مقصود: **لا تُخصم حصّة على طلبٍ مرفوض** (وإلا لأمكن استنزاف حصّة
   * وكيلٍ بطلباتٍ مرفوضة)، و**يُسجَّل الرفض كما يُسجَّل السماح** (وإلا صار سجل
   * التدقيق سجل النجاح فقط).
   * @param {PolicyRequest} request
   * @returns {Promise<{ decision: PolicyDecision, token: string | null }>}
   */
  async authorize(request) {
    const evaluatedAt = this.now().toISOString();
    // الطلب المُقيَّم متغيّرٌ محلي: بوابة الهوية تستبدل فاعله بما يقوله جذر
    // الثقة، وتعديل المُعامل نفسه يخفي على من يقرأ أيُّ طلبٍ وصل وأيُّ طلبٍ قُيّم.
    let evaluated = request;
    if (this.haltSwitch) {
      try {
        this.haltSwitch.assertOperational();
      } catch (error) {
        const decision = Object.freeze({
          allowed: false,
          effect: /** @type {const} */ ('deny'),
          code: /** @type {const} */ ('STATE_HALTED'),
          reason: `الدولة موقوفة إيقافاً شاملاً: ${error instanceof Error ? error.message : String(error)}`,
          policyId: null,
          policyVersion: null,
          requiresRoyalCommand: this.decisionPoint.requiresRoyalCommand(request.action),
          matched: Object.freeze([]),
          evaluatedAt,
        });
        await this.record(decision, request);
        return { decision, token: null };
      }
    }

    // الهوية تُحقَّق قبل السياسة وبعد الإيقاف الشامل (‏M6.01). والترتيب مقصود
    // مرّتين: الدولة الموقوفة لا تُستعلَم فيها هوية أصلاً، والسياسة لا تُقيّم على
    // فاعلٍ مزعوم. وما تردّه البوابة **يستبدل** مطالبة المستدعي لا يُدمج معها:
    // الدمج يترك للمستدعي أن يزيد قدرةً ليست له، وهو عين ما تمنعه الخطوة.
    //
    // حمايةٌ من تركيبٍ ناقص (مراجعة M11.04 — Grok-F01): المصنع الرسمي للإدارة
    // يلزم بوابةَ هويةٍ موصولة. فمن بنى النقطة بلا بوابةٍ وهو يعلم أنها لازمةٌ
    // لا يجتاز هذا الحدّ: الرفضُ مُسمَّى `IDENTITY_GATE_REQUIRED` لا قبولٌ صامتٌ
    // لفاعلٍ يصفه المستدعي كما يشاء. وهذا هو الفرق بين «الضابط موجودٌ في الشجرة»
    // و«الضابط نافذٌ في التشغيل».
    if (this.requireIdentityGate && this.identityGate === null) {
      const decision = Object.freeze({
        allowed: false,
        effect: /** @type {const} */ ('deny'),
        code: /** @type {const} */ ('IDENTITY_GATE_REQUIRED'),
        reason:
          'التركيبُ يلزم بوابةَ هويةٍ موصولةً، ولم تُمرَّر؛ فلا يُقبل فاعلٌ بلا شهادةٍ من جذر الثقة (M11.04 — Grok-F01).',
        policyId: null,
        policyVersion: null,
        requiresRoyalCommand: this.decisionPoint.requiresRoyalCommand(evaluated.action),
        matched: Object.freeze([]),
        evaluatedAt,
      });
      await this.record(decision, evaluated);
      return { decision, token: null };
    }
    if (this.identityGate !== null) {
      const verdict = await this.identityGate.verify(evaluated.actor.id);
      if (!verdict.ok || verdict.actor === null) {
        const decision = Object.freeze({
          allowed: false,
          effect: /** @type {const} */ ('deny'),
          code: /** @type {const} */ ('IDENTITY_UNVERIFIED'),
          reason: `${verdict.code}: ${verdict.reason}`,
          policyId: null,
          policyVersion: null,
          requiresRoyalCommand: this.decisionPoint.requiresRoyalCommand(evaluated.action),
          matched: Object.freeze([]),
          evaluatedAt,
        });
        await this.record(decision, evaluated);
        return { decision, token: null };
      }
      evaluated = Object.freeze({
        ...evaluated,
        actor: Object.freeze({
          ...evaluated.actor,
          id: verdict.actor.id,
          role: verdict.actor.role,
          state: verdict.actor.state,
          kind: verdict.actor.kind,
          capabilities: verdict.actor.capabilities,
        }),
      });
    }

    // حاجزُ التشريع (‏M8.02): فعلٌ يقع فيه تعارضٌ تشريعيٌّ مانعٌ لا يُنفَّذ حتى
    // يُحَلَّ التعارض. والقائمةُ محسوبةٌ من البيانات في كل نداء لا مخزَّنةً:
    // قائمةٌ مخزَّنةٌ تحتاج من يُحدِّثها عند الحلّ، ومن نسي منع فعلاً لا مانعَ له.
    if (this.legislationGate !== null) {
      const blocked = await this.legislationGate.blockedActions();
      if (blocked.has(evaluated.action)) {
        const decision = Object.freeze({
          allowed: false,
          effect: /** @type {const} */ ('deny'),
          code: /** @type {const} */ ('LEGISLATION_CONFLICT_UNRESOLVED'),
          reason: `الفعل ${evaluated.action} يقع في تعارضٍ تشريعيٍّ مانعٍ لم يُحَلّ؛ ولا يُنفَّذ حتى يُحَلَّ التعارضُ ويُقاس زوالُه (M8.02).`,
          policyId: null,
          policyVersion: null,
          requiresRoyalCommand: this.decisionPoint.requiresRoyalCommand(evaluated.action),
          matched: Object.freeze([]),
          evaluatedAt,
        });
        this.log.append('law.enforcement.blocked', evaluated.actor.id, {
          id: evaluated.action,
          reason: 'LEGISLATION_CONFLICT_UNRESOLVED',
          open: true,
        });
        await this.record(decision, evaluated);
        return { decision, token: null };
      }
    }

    let decision = this.decisionPoint.evaluate(evaluated);

    if (decision.allowed) {
      const quotaResource = this.decisionPoint.bundle.actions.get(evaluated.action)?.quotaResource;
      if (quotaResource !== undefined && this.quotaLedger !== null) {
        const amountRaw = evaluated.context?.['quotaAmount'];
        const amount = typeof amountRaw === 'number' && amountRaw > 0 ? amountRaw : 1;
        const subject = this.quotaSubject(evaluated, quotaResource);
        try {
          const state = await this.quotaLedger.debit({
            subjectType: subject.type,
            subjectId: subject.id,
            resource: quotaResource,
            amount,
          });
          this.log.append('policy.quota.debited', evaluated.actor.id, {
            resource: quotaResource,
            amount,
            remaining: state.remaining,
          });
        } catch (error) {
          decision = Object.freeze({
            ...decision,
            allowed: false,
            effect: /** @type {const} */ ('deny'),
            code: /** @type {const} */ ('QUOTA_EXCEEDED'),
            reason: `الحصّة استُنفدت على المورد ${quotaResource}: ${error instanceof Error ? error.message : String(error)}. السياسة ${decision.policyId ?? '—'} تأذن بالفعل، والحدّ يوقفه.`,
          });
        }
      }
    }

    await this.record(decision, evaluated);
    if (!decision.allowed) return { decision, token: null };
    return { decision, token: this.issue(evaluated, decision) };
  }

  /**
   * صاحب الحصّة: الوكيل نفسه، أو نطاقه إن كانت الحصّة على مؤسسة. صاحبٌ مجهول
   * يُرفض بخطأ مُسمّى لا يُخصم على الجميع.
   * @param {PolicyRequest} request
   * @param {string} resource
   * @returns {{ type: string, id: string }}
   */
  quotaSubject(request, resource) {
    const definition = this.decisionPoint.bundle.quotas.find((q) => q.resource === resource);
    const type = definition?.subjectType ?? 'agent';
    if (type === 'agent') return { type, id: request.actor.id };
    const scope = request.scope ?? request.actor.scope;
    if (scope === undefined || scope.trim() === '') throw new Error('QUOTA_SUBJECT_UNKNOWN');
    return { type, id: scope };
  }

  /**
   * يسجّل القرار في سجل الأحداث وفي المصرف الدائم إن وُصل (M4.08 يقرأ منه).
   * @param {PolicyDecision} decision
   * @param {PolicyRequest} request
   * @returns {Promise<void>}
   */
  async record(decision, request) {
    this.log.append('policy.decision', request.actor.id, {
      action: request.action,
      resource: `${request.resource.type}:${request.resource.id}`,
      code: decision.code,
      allowed: decision.allowed,
      policyId: decision.policyId,
      policyVersion: decision.policyVersion,
      reason: decision.reason,
    });
    if (this.decisionSink !== null) await this.decisionSink({ decision, request });
  }

  /**
   * يصدر تذكرة قرار مرتبطة بالفاعل والفعل والمورد، صالحة مرّة واحدة.
   * @param {PolicyRequest} request
   * @param {PolicyDecision} decision
   * @returns {string}
   */
  issue(request, decision) {
    const payload = {
      nonce: randomUUID(),
      ...bindingOf(request),
      policyId: decision.policyId,
      expiresAt: this.now().getTime() + DECISION_TTL_MS,
    };
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const mac = createHmac('sha256', this.secret).update(body).digest('base64url');
    this.issued.set(payload.nonce, payload.expiresAt);
    return `${body}.${mac}`;
  }

  /**
   * يتحقّق من تذكرة ويستهلكها. كل إخفاق خطأٌ مُسمّى: تذكرة مبتورة، أو توقيع لا
   * يطابق، أو انتهت، أو استُهلكت، أو صدرت لفعل أو مورد أو فاعل آخر.
   * @param {string | undefined} token
   * @param {{ actorId: string, action: string, resourceKey: string }} binding
   * @returns {{ policyId: string | null }}
   */
  verify(token, binding) {
    if (typeof token !== 'string' || !token.includes('.')) {
      throw new Error('AUTHORIZATION_DECISION_MISSING');
    }
    const [body, mac] = token.split('.');
    if (body === undefined || mac === undefined)
      throw new Error('AUTHORIZATION_DECISION_MALFORMED');
    const expected = createHmac('sha256', this.secret).update(body).digest('base64url');
    const given = Buffer.from(mac, 'utf8');
    const wanted = Buffer.from(expected, 'utf8');
    // المقارنة ثابتة الزمن: مقارنة نصّية تُسرّب موضع أول اختلاف، وذلك يكفي
    // لتخمين توقيع بمحاولات متتابعة.
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      throw new Error('AUTHORIZATION_DECISION_FORGED');
    }
    /** @type {{ nonce?: unknown, actorId?: unknown, action?: unknown, resourceKey?: unknown, policyId?: unknown, expiresAt?: unknown }} */
    let payload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      throw new Error('AUTHORIZATION_DECISION_MALFORMED');
    }
    const { nonce, actorId, action, resourceKey, expiresAt } = payload;
    if (typeof nonce !== 'string' || typeof expiresAt !== 'number') {
      throw new Error('AUTHORIZATION_DECISION_MALFORMED');
    }
    if (!this.issued.has(nonce)) throw new Error('AUTHORIZATION_DECISION_REUSED');
    if (expiresAt < this.now().getTime()) {
      this.issued.delete(nonce);
      throw new Error('AUTHORIZATION_DECISION_EXPIRED');
    }
    if (
      actorId !== binding.actorId ||
      action !== binding.action ||
      resourceKey !== binding.resourceKey
    ) {
      throw new Error('AUTHORIZATION_DECISION_MISMATCH');
    }
    this.issued.delete(nonce);
    return { policyId: typeof payload.policyId === 'string' ? payload.policyId : null };
  }
}

/**
 * ينشئ نقطة التفويض.
 * @param {ConstructorParameters<typeof EnforcementPoint>[0]} deps
 * @returns {EnforcementPoint}
 */
export function createEnforcementPoint(deps) {
  return new EnforcementPoint(deps);
}
