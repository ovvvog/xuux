/**
 * محرّك السياسات — M4.03 و M4.04
 *
 * ما كان قبله: `src/root-of-trust/policy.mts` — مجموعةُ ستة أفعال حسّاسة مكتوبة
 * في الكود، وقرارٌ يُعاد `true` أو يرفع `POLICY_DENIED` بلا سبب ولا سياسة حاكمة.
 * فمن رُفض لم يعرف لِمَ رُفض، ومن سُمح له لم يُسجَّل بأي بند سُمح.
 *
 * قواعد التقييم، بهذا الترتيب حرفياً:
 *   1. **فعل مجهول** (غير معلَن في الكتالوج) ⇒ رفض `POLICY_UNKNOWN_ACTION`.
 *      الافتراض منعٌ لا سماحٌ (المادة 9): فعلٌ لا تعرفه الدولة لا تأذن به.
 *   2. **دور مجهول** ⇒ رفض `POLICY_UNKNOWN_ROLE`. دورٌ في شهادة لا يقابله دور
 *      معلَن يعني شهادة تمنح نفسها ما لم يمنحه أحد.
 *   3. تُجمع السياسات المفعّلة المطابقة للأبعاد الخمسة.
 *   4. **المنع الصريح يتقدّم**: إن وُجد مانعٌ واحد فالقرار منع، ولو كانت أولوية
 *      سماحٍ آخر أعلى. الأولوية تُرتّب المتماثلين في الأثر لا تُرجّح السماح على
 *      المنع؛ لأن سياسة منعٍ كُتبت لحادثة أمنية لا يجوز أن يُبطلها سماحٌ واسع.
 *   5. لا مطابق ⇒ رفض `POLICY_NO_MATCH`.
 *   6. ثم — وبعد كل ما سبق — **العتبة السيادية**: فعلٌ في العتبة بلا أمر ملكي
 *      مقبول يُرفض `SOVEREIGN_COMMAND_REQUIRED` ولو كان القرار سماحاً. والعتبة
 *      تُقرأ من `royal-authority.yaml` لا من قائمة في هذا الملف.
 *
 * والتقييم **حتمي**: نفس الطلب على نفس المجموعة يُعيد نفس السياسة الحاكمة، لأن
 * الترتيب لا يعتمد على ترتيب ورود السياسات في الملف بل على (الأولوية تنازلياً،
 * ثم المنع قبل السماح، ثم المعرّف أبجدياً) — والمعرّف فاصلٌ نهائي لا يتكرّر.
 */

import { loadPolicyBundle } from './loader.mjs';

/** @typedef {import('./model.mjs').PolicyRequest} PolicyRequest */
/** @typedef {import('./model.mjs').PolicyRecord} PolicyRecord */
/** @typedef {import('./model.mjs').PolicyDecision} PolicyDecision */
/** @typedef {import('./model.mjs').PolicyCondition} PolicyCondition */
/** @typedef {import('./loader.mjs').PolicyBundle} PolicyBundle */

/**
 * يطابق نمطاً واحداً: `*` يطابق الكل، والنمط المنتهي بـ`:*` يطابق البادئة،
 * وغيرهما يطابق حرفياً. لا تعبير نمطي عام هنا عن قصد: نمطٌ حرٌّ في بيانات
 * السياسة يجعل مطابقةً واسعة تُكتب سهواً، ويفتح باب توقّف المطابقة.
 * @param {string} pattern
 * @param {string} value
 * @returns {boolean}
 */
function matchesPattern(pattern, value) {
  if (pattern === '*') return true;
  if (pattern.endsWith(':*')) return value.startsWith(pattern.slice(0, -1));
  return pattern === value;
}

/**
 * @param {readonly string[] | undefined} patterns
 * @param {string} value
 * @returns {boolean}
 */
function matchesAny(patterns, value) {
  if (patterns === undefined || patterns.length === 0) return false;
  return patterns.some((pattern) => matchesPattern(pattern, value));
}

/**
 * يقرأ خاصّية بمسار منقّط من الطلب: `actor.state` و`resource.classification`
 * و`context.destination`. المسار المجهول يُعيد `undefined` فيسقط الشرط بالمنع
 * لا بالتجاهل — شرطٌ يقرأ خاصّية غائبة لا يجوز أن يُقرأ محقَّقاً.
 * @param {PolicyRequest} request
 * @param {string} attribute
 * @returns {unknown}
 */
function readAttribute(request, attribute) {
  const parts = attribute.split('.');
  /** @type {unknown} */
  let cursor = request;
  for (const part of parts) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = /** @type {Record<string, unknown>} */ (cursor)[part];
  }
  return cursor;
}

/**
 * يحلّ قيمة الشرط: القيمة النصّية بصيغة `{actor.scope}` تُقرأ من الطلب نفسه،
 * فتصير المقارنة بين خاصّيتين (نطاق المورد بنطاق الفاعل) لا بين خاصّية وثابت.
 * @param {PolicyRequest} request
 * @param {unknown} value
 * @returns {unknown}
 */
function resolveValue(request, value) {
  if (typeof value !== 'string') return value;
  const reference = /^\{([a-zA-Z0-9_.]+)\}$/.exec(value);
  if (reference === null) return value;
  const path = reference[1];
  return path === undefined ? undefined : readAttribute(request, path);
}

/**
 * يقيّم شرطاً واحداً. كل عامل مقارنةٍ عددية يشترط أن يكون الطرفان عددين فعلاً:
 * مقارنة نصّ بعدد في JavaScript تنجح صامتة وتعطي نتيجة لا يقصدها أحد.
 * @param {PolicyRequest} request
 * @param {PolicyCondition} condition
 * @returns {boolean}
 */
function evaluateCondition(request, condition) {
  const actual = readAttribute(request, condition.attribute);
  const expected = resolveValue(request, condition.value);
  switch (condition.operator) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'eq':
      return actual === expected;
    case 'ne':
      return actual !== expected;
    case 'in':
      return Array.isArray(expected) && expected.includes(actual);
    case 'not-in':
      return Array.isArray(expected) && !expected.includes(actual);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (typeof actual !== 'number' || typeof expected !== 'number') return false;
      if (condition.operator === 'gt') return actual > expected;
      if (condition.operator === 'gte') return actual >= expected;
      if (condition.operator === 'lt') return actual < expected;
      return actual <= expected;
    }
    default:
      // عاملٌ خارج الاتحاد لا يصل هنا: المحمّل يرفضه بالمخطَّط. والسقوط إلى
      // `false` هو الفشل المغلق لو وصل يوماً عبر مسار لا يمرّ بالمحمّل.
      return false;
  }
}

/**
 * يطابق سياسة واحدة على طلب: الأبعاد الخمسة كلها يجب أن تطابق.
 * @param {PolicyRecord} policy
 * @param {PolicyRequest} request
 * @returns {boolean}
 */
function matchesPolicy(policy, request) {
  if (!matchesAny(policy.actions, request.action)) return false;
  const resourceKey = `${request.resource.type}:${request.resource.id}`;
  if (
    !matchesAny(policy.resources, resourceKey) &&
    !matchesAny(policy.resources, request.resource.type)
  ) {
    return false;
  }
  const actorMatch = policy.actors;
  const byRole = matchesAny(actorMatch.roles, request.actor.role);
  const byId = matchesAny(actorMatch.ids, request.actor.id);
  // الفاعل بلا فئة معلنة يُقرأ `autonomous`: الافتراض الأضيق: فمن لم يُعلن أنه
  // إنسان لا يُمنح ما يُمنح للإنسان.
  const byKind = matchesAny(actorMatch.kinds, request.actor.kind ?? 'autonomous');
  if (!byRole && !byId && !byKind) return false;
  const scopes = policy.scopes;
  if (scopes !== undefined && scopes.length > 0) {
    const scope = request.scope ?? request.actor.scope;
    if (scope === undefined || !matchesAny(scopes, scope)) return false;
  }
  for (const condition of policy.conditions ?? []) {
    if (!evaluateCondition(request, condition)) return false;
  }
  return true;
}

/**
 * ترتيب حتمي: الأولوية تنازلياً، ثم المنع قبل السماح، ثم المعرّف أبجدياً.
 * @param {PolicyRecord} a
 * @param {PolicyRecord} b
 * @returns {number}
 */
function comparePolicies(a, b) {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.effect !== b.effect) return a.effect === 'deny' ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export class PolicyDecisionPoint {
  /**
   * @param {{ bundle?: PolicyBundle, now?: () => Date }} [deps] - `bundle` تُمرَّر
   * في الاختبارات وفي محاكي الأثر (M4.08) كي يُقيَّم مقترحٌ لم يُفعَّل بعد؛ وإن
   * غابت حُمِّلت بيانات المشروع.
   */
  constructor({ bundle, now } = {}) {
    /** @type {PolicyBundle} */
    this.bundle = bundle ?? loadPolicyBundle();
    this.now = now ?? (() => new Date());
    /** @type {Map<string, import('./model.mjs').SovereignThresholdEntry>} */
    this.threshold = new Map(this.bundle.threshold.map((entry) => [entry.action, entry]));
    /** @type {readonly PolicyRecord[]} */
    this.active = Object.freeze(
      [...this.bundle.policies].filter((p) => p.enabled).sort(comparePolicies),
    );
  }

  /**
   * أفعال الكتالوج الحسّاسة موحَّدةً مع أفعال العتبة السيادية: هذه هي القائمة
   * التي لا تُنفَّذ إلا عبر نقطة التفويض (M4.05)، وهي **مشتقّة من البيانات**.
   * @returns {ReadonlySet<string>}
   */
  governedActions() {
    /** @type {Set<string>} */
    const governed = new Set();
    for (const action of this.bundle.actions.values()) {
      if (action.sensitive) governed.add(action.id);
    }
    for (const action of this.threshold.keys()) governed.add(action);
    return governed;
  }

  /**
   * @param {string} action
   * @returns {boolean} هل يتطلّب الفعل أمراً ملكياً حتماً
   */
  requiresRoyalCommand(action) {
    return this.threshold.has(action);
  }

  /**
   * يقيّم طلباً ويُعيد قراراً مُسبَّباً. لا يرفع استثناءً للرفض: الرفض قرارٌ
   * يُسجَّل ويُقرأ، والاستثناء يُخفي السبب في نصّ رسالة.
   * @param {PolicyRequest} request
   * @returns {PolicyDecision}
   */
  evaluate(request) {
    const evaluatedAt = this.now().toISOString();
    /** @type {PolicyDecision['matched']} */
    const noMatch = [];

    if (!this.bundle.actions.has(request.action)) {
      return Object.freeze({
        allowed: false,
        effect: 'deny',
        code: 'POLICY_UNKNOWN_ACTION',
        reason: `فعل غير معلَن في كتالوج الأفعال: ${request.action}. الافتراض منعٌ لا سماح.`,
        policyId: null,
        policyVersion: null,
        requiresRoyalCommand: this.requiresRoyalCommand(request.action),
        matched: noMatch,
        evaluatedAt,
      });
    }

    if (!this.bundle.roles.has(request.actor.role)) {
      return Object.freeze({
        allowed: false,
        effect: 'deny',
        code: 'POLICY_UNKNOWN_ROLE',
        reason: `دور غير معلَن في الأدوار: ${request.actor.role}. لا يُقيَّم طلبٌ بدور لم تمنحه الدولة.`,
        policyId: null,
        policyVersion: null,
        requiresRoyalCommand: this.requiresRoyalCommand(request.action),
        matched: noMatch,
        evaluatedAt,
      });
    }

    const matched = this.active.filter((policy) => matchesPolicy(policy, request));
    /** @type {PolicyDecision['matched']} */
    const trace = Object.freeze(
      matched.map((p) =>
        Object.freeze({ id: p.id, version: p.version, effect: p.effect, priority: p.priority }),
      ),
    );

    const governingDeny = matched.find((p) => p.effect === 'deny');
    if (governingDeny !== undefined) {
      return Object.freeze({
        allowed: false,
        effect: 'deny',
        code: 'POLICY_DENY',
        reason: governingDeny.reason,
        policyId: governingDeny.id,
        policyVersion: governingDeny.version,
        requiresRoyalCommand: this.requiresRoyalCommand(request.action),
        matched: trace,
        evaluatedAt,
      });
    }

    const governingAllow = matched[0];
    if (governingAllow === undefined) {
      return Object.freeze({
        allowed: false,
        effect: 'deny',
        code: 'POLICY_NO_MATCH',
        reason: `لا سياسة مفعّلة تطابق الطلب (${request.actor.role} ← ${request.action} ← ${request.resource.type}:${request.resource.id}). الافتراض منع.`,
        policyId: null,
        policyVersion: null,
        requiresRoyalCommand: this.requiresRoyalCommand(request.action),
        matched: trace,
        evaluatedAt,
      });
    }

    // العتبة السيادية بعد السماح لا قبله: القرار يبقى «مأذون به بالسياسة» لكنه
    // **غير منفَّذ** بلا أمر ملكي، والسبب المُعاد يقول ذلك صراحةً كي لا يُقرأ
    // الرفض نقصاً في الصلاحية فيُطلب توسيعها.
    if (this.threshold.has(request.action)) {
      const entry = this.threshold.get(request.action);
      const hasCommand =
        typeof request.royalCommandId === 'string' && request.royalCommandId.trim() !== '';
      if (!hasCommand) {
        return Object.freeze({
          allowed: false,
          effect: 'deny',
          code: 'SOVEREIGN_COMMAND_REQUIRED',
          reason: `فعلٌ فوق العتبة السيادية: ${request.action}. ${entry?.reason ?? ''} والسياسة ${governingAllow.id} تأذن به لكن التنفيذ يلزمه أمر ملكي مقبول.`,
          policyId: governingAllow.id,
          policyVersion: governingAllow.version,
          requiresRoyalCommand: true,
          matched: trace,
          evaluatedAt,
        });
      }
    }

    return Object.freeze({
      allowed: true,
      effect: 'allow',
      code: 'POLICY_ALLOW',
      reason: governingAllow.reason,
      policyId: governingAllow.id,
      policyVersion: governingAllow.version,
      requiresRoyalCommand: this.threshold.has(request.action),
      matched: trace,
      evaluatedAt,
    });
  }
}

/**
 * ينشئ نقطة قرار على بيانات المشروع.
 * @param {{ bundle?: PolicyBundle }} [options]
 * @returns {PolicyDecisionPoint}
 */
export function createPolicyDecisionPoint(options = {}) {
  return new PolicyDecisionPoint(options);
}
