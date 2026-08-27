/**
 * محرّكُ التعارض التشريعي — الخطوة M8.02
 *
 * **العيبُ الذي يُغلقه هذا الملف:** لم يكن في الدولة كشفٌ للتعارض أصلاً. حين
 * تتقاطع سياستان في فعلٍ ومَورِدٍ ودورٍ ونطاقٍ واحد وأثرُهما متعاكس، يحلُّ
 * `PolicyDecisionPoint` الأمرَ بترتيبٍ محدَّد: الأولويةُ تنازلياً، ثم الرفضُ قبل
 * السماح، ثم المعرّفُ أبجدياً. وهذا **ترتيبٌ سليمٌ للحسم، وسيّئٌ للتشريع**: هو
 * يُخفي أنّ مشرِّعَين قالا قولين متضادّين، ويُنفِّذ أحدَهما بلا أن يعلم أحدٌ أنّ
 * الآخرَ أُهدر. فصار التعارضُ يُحسم بحرف الاسم لا بقرارٍ يُقرأ ويُوقَّع.
 *
 * وهذا الملفُّ يقلب المعادلة: التعارضُ **يُكشف قبل الإنفاذ** ويُسمّى برمزٍ
 * مُعلَنٍ في `config/legislation.yaml`، ويبقى الفعلُ المتقاطع **ممنوعَ الإنفاذ**
 * حتى يُحَلَّ التعارضُ ويُقاس زوالُه بإعادة الكشف — لا بعَلَمٍ يُرفع.
 *
 * والمحرِّكُ **دالّةٌ خالصة**: يقرأ قوانينَ مربوطةً وحزمةَ سياساتٍ ويردّ قائمةَ
 * تعارضاتٍ مُجمَّدة. لا يقرأ قاعدةً ولا يكتب سجلاً ولا يقرِّر منعاً — القرارُ
 * لصاحب الصلاحية في `legislature.mjs`، والمنعُ في `enforcement-point.mjs`.
 * وخلوصُه هو ما يجعل «هل زال التعارض؟» سؤالاً يُجاب بإعادة الحساب.
 *
 * **حدٌّ معلَن (شروطُ السياسة لا تُحَلُّ رمزياً):** إذا حملت إحدى السياستين
 * المتقاطعتين شرطاً (`conditions`) فالتقاطعُ **مُحتملٌ لا مؤكَّد**: قد يضيّق
 * الشرطُ المجالَ حتى لا يلتقيا في طلبٍ واقع. والفصلُ في ذلك يقتضي حلَّ قيودٍ
 * رمزياً (SMT) وهو ليس في هذه الخطوة. فيُبلَّغ عن هذا التقاطع بـ`certain: false`
 * ولا يمنع إنفاذاً، ويُقرأ إعلاناً للمشرِّع لا حكماً عليه. وهو مسجَّل في
 * `docs/REMAINING_WORK.md`.
 */

/** @typedef {import('./legislation.mjs').LegislationPolicy} LegislationPolicy */
/** @typedef {import('../policy/loader.mjs').PolicyBundle} PolicyBundle */
/** @typedef {import('../policy/model.mjs').PolicyActorMatch} PolicyActorMatch */

/**
 * قانونٌ مربوطٌ كما يقرؤه المحرّك: لا يحتاج نصَّ القانون، بل سنَده وأدواتَ
 * إنفاذه. وحصرُ المُدخل على هذا القدر مقصود: محرِّكٌ يقرأ النصَّ الحرَّ يصير
 * مفسِّراً للنصوص، وذلك ما لا يُقاس.
 * @typedef {object} BoundLaw
 * @property {string} id
 * @property {string} articleId - المادةُ الدستوريةُ السند
 * @property {readonly string[]} policyIds - السياساتُ المُنفِّذة
 * @property {string} scope
 */

/**
 * تعارضٌ مكشوف.
 * @typedef {object} LegislationConflict
 * @property {string} kind
 * @property {string} code
 * @property {boolean} blocking - يمنع الإنفاذ (لا يمنع إن كان التقاطع غير مؤكّد)
 * @property {boolean} certain - مؤكَّدٌ بلا شروطٍ تضيّقه
 * @property {readonly [string, string]} lawIds - القانونان، مرتَّبان أبجدياً
 * @property {readonly string[]} policyIds - السياستان المتقاطعتان
 * @property {readonly string[]} actions - الأفعالُ التي يقع فيها التقاطع
 * @property {string} detail - وصفٌ عربيٌّ يذكر الفعلَ والمَورِدَ والدورَ والنطاق
 */

/**
 * هل يلتقي نمطان في قيمةٍ واحدة على الأقل؟ يحاكي `matchesPattern` في
 * `src/policy/engine.mjs`: `*` يعمّ، و`x:*` بادئة، وما عداهما مطابقةٌ حرفية.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function patternsOverlap(a, b) {
  if (a === '*' || b === '*') return true;
  const aPrefix = a.endsWith(':*') ? a.slice(0, -1) : null;
  const bPrefix = b.endsWith(':*') ? b.slice(0, -1) : null;
  if (aPrefix !== null && bPrefix !== null) {
    return aPrefix.startsWith(bPrefix) || bPrefix.startsWith(aPrefix);
  }
  if (aPrefix !== null) return b.startsWith(aPrefix);
  if (bPrefix !== null) return a.startsWith(bPrefix);
  return a === b;
}

/**
 * @param {readonly string[] | undefined} left
 * @param {readonly string[] | undefined} right
 * @returns {readonly string[]} القيمُ التي تُثبت التقاطع (فارغةٌ إن لم يلتقيا)
 */
function overlappingPatterns(left, right) {
  if (left === undefined || right === undefined) return [];
  /** @type {string[]} */
  const found = [];
  for (const a of left) {
    for (const b of right) {
      if (patternsOverlap(a, b)) found.push(a === '*' ? b : a);
    }
  }
  return [...new Set(found)];
}

/**
 * النطاقُ الغائب في السياسة يعني «كلَّ نطاق» (هكذا يقرؤه المحرّك: شرطُ النطاق
 * يُتخطّى إن لم تُعلن نطاقات). فيُقرأ هنا `['*']` لا `[]`، وإلا لظُنّ أنه لا
 * يلتقي بشيء وهو يلتقي بكل شيء.
 * @param {readonly string[] | undefined} scopes
 * @returns {readonly string[]}
 */
function effectiveScopes(scopes) {
  return scopes === undefined || scopes.length === 0 ? ['*'] : scopes;
}

/**
 * أدوارُ الفاعل ومعرّفاته وفئاته مجموعةٌ واحدةٌ في التقاطع: السياسةُ تُطابق إن
 * طابق **أيٌّ** منها (انظر `matchesPolicy`)، فالتفريقُ بينها في الكشف كان
 * سيُفوِّت تقاطعَ سياسةٍ بالدور مع سياسةٍ بالمعرّف على الفاعل نفسه.
 * @param {PolicyActorMatch} actors
 * @returns {readonly string[]}
 */
function actorPatterns(actors) {
  return [...(actors.roles ?? []), ...(actors.ids ?? []), ...(actors.kinds ?? [])];
}

/**
 * يكشف تعارضاتِ التشريع بين القوانين المربوطة.
 *
 * الترتيبُ في الردّ مُحدَّد (النوعُ ثم معرّفا القانونين) كي يكون «التعارضُ
 * نفسُه» قابلاً للمقارنة بين نداءَين — وهو أساسُ قياس زوالِه بعد الحلّ.
 * @param {object} input
 * @param {readonly BoundLaw[]} input.laws - القوانينُ النافذة المربوطة
 * @param {PolicyBundle} input.bundle
 * @param {LegislationPolicy} input.policy
 * @returns {readonly LegislationConflict[]}
 */
export function detectConflicts({ laws, bundle, policy }) {
  const kinds = new Map(policy.conflictKinds.map((entry) => [entry.kind, entry]));
  const byId = new Map(bundle.policies.map((record) => [record.id, record]));
  /** @type {LegislationConflict[]} */
  const conflicts = [];

  /**
   * @param {string} kind
   * @param {boolean} certain
   * @param {readonly [string, string]} lawIds
   * @param {readonly string[]} policyIds
   * @param {readonly string[]} actions
   * @param {string} detail
   */
  const push = (kind, certain, lawIds, policyIds, actions, detail) => {
    const declared = kinds.get(kind);
    // نوعٌ غير معلَنٍ في الوثيقة لا يُبلَّغ عنه: البلاغُ برمزٍ لا سندَ له في
    // `config/legislation.yaml` يُنشئ رمزَ رفضٍ لا يعرفه الحاجزُ ولا الوثيقة.
    if (declared === undefined) return;
    conflicts.push(
      Object.freeze({
        kind,
        code: declared.code,
        blocking: declared.blocking && certain,
        certain,
        lawIds: Object.freeze(/** @type {[string, string]} */ ([...lawIds])),
        policyIds: Object.freeze([...policyIds]),
        actions: Object.freeze([...actions]),
        detail,
      }),
    );
  };

  for (let i = 0; i < laws.length; i += 1) {
    for (let j = i + 1; j < laws.length; j += 1) {
      const first = laws[i];
      const second = laws[j];
      if (first === undefined || second === undefined) continue;
      /** @type {[string, string]} */
      const pair = first.id <= second.id ? [first.id, second.id] : [second.id, first.id];

      // (1) سياسةٌ واحدةٌ مربوطةٌ بقانونين: سندٌ مزدوجٌ لأداةِ إنفاذٍ واحدة.
      const shared = first.policyIds.filter((id) => second.policyIds.includes(id));
      if (shared.length > 0) {
        push(
          'shared-policy',
          true,
          pair,
          shared,
          [],
          `السياسةُ ${shared.join('، ')} مربوطةٌ بالقانونين ${pair[0]} و${pair[1]}: إلغاءُ أحدهما يتركها نافذةً بسند الآخر.`,
        );
      }

      // (2) استنادٌ إلى المادة نفسها: يُعلَن ولا يمنع.
      if (first.articleId === second.articleId) {
        push(
          'article-collision',
          true,
          pair,
          [],
          [],
          `القانونان يستندان إلى المادة ${first.articleId}: موضعُ التعارضِ الأرجح، يُقرأ ولا يمنع.`,
        );
      }

      // (3) التضادُّ في الأثر على تقاطعٍ واقع.
      for (const leftId of first.policyIds) {
        for (const rightId of second.policyIds) {
          const left = byId.get(leftId);
          const right = byId.get(rightId);
          if (left === undefined || right === undefined) continue;
          if (!left.enabled || !right.enabled) continue;
          if (left.effect === right.effect) continue;

          const actions = overlappingPatterns(left.actions, right.actions);
          if (actions.length === 0) continue;
          const resources = overlappingPatterns(left.resources, right.resources);
          if (resources.length === 0) continue;
          const actors = overlappingPatterns(
            actorPatterns(left.actors),
            actorPatterns(right.actors),
          );
          if (actors.length === 0) continue;
          const scopes = overlappingPatterns(
            effectiveScopes(left.scopes),
            effectiveScopes(right.scopes),
          );
          if (scopes.length === 0) continue;

          const conditioned =
            (left.conditions ?? []).length > 0 || (right.conditions ?? []).length > 0;
          const certain = !conditioned;
          const surface = `الفعل: ${actions.join('، ')} · المَورِد: ${resources.join('، ')} · الفاعل: ${actors.join('، ')} · النطاق: ${scopes.join('، ')}`;
          const tie = left.priority === right.priority;
          if (tie) {
            push(
              'priority-tie',
              certain,
              pair,
              [leftId, rightId],
              actions,
              `${leftId} و${rightId} متعاكستا الأثر بأولويةٍ واحدة (${left.priority}) على تقاطعٍ واقع — الحسمُ يعود إلى ترتيب المعرّفات أبجدياً. ${surface}${certain ? '' : ' (تقاطعٌ محتملٌ: شرطٌ يضيّقه)'}`,
            );
          } else {
            push(
              'effect-contradiction',
              certain,
              pair,
              [leftId, rightId],
              actions,
              `${leftId} (${left.effect}/${left.priority}) و${rightId} (${right.effect}/${right.priority}) متعاكستا الأثر على تقاطعٍ واقع — يُحسم صامتاً بغَلَبةِ الرفض والأولوية. ${surface}${certain ? '' : ' (تقاطعٌ محتملٌ: شرطٌ يضيّقه)'}`,
            );
          }
        }
      }
    }
  }

  conflicts.sort((a, b) =>
    a.kind === b.kind
      ? a.lawIds.join('|').localeCompare(b.lawIds.join('|'))
      : a.kind.localeCompare(b.kind),
  );
  return Object.freeze(conflicts);
}

/**
 * الأفعالُ الممنوعةُ إنفاذاً بسبب تعارضٍ مانعٍ قائم. تُحسب من الكشف لا تُخزَّن:
 * حالةٌ مخزَّنةٌ للمنع تحتاج من يُحدِّثها عند الحلّ، ومن نسي التحديثَ منع فعلاً
 * لا مانعَ له أو أباح فعلاً قائمَ التعارض.
 * @param {readonly LegislationConflict[]} conflicts
 * @returns {ReadonlySet<string>}
 */
export function blockedActions(conflicts) {
  /** @type {Set<string>} */
  const blocked = new Set();
  for (const conflict of conflicts) {
    if (!conflict.blocking) continue;
    for (const action of conflict.actions) blocked.add(action);
  }
  return blocked;
}

/**
 * بصمةُ مجموعةِ تعارضاتٍ: تُقارَن قبل الحلِّ وبعده، وتساويهما يعني أنّ «الحلَّ»
 * لم يحلّ شيئاً. وهي نصٌّ مقروءٌ لا تجزئة: البصمةُ تُعرَض في سبب الرفض.
 * @param {readonly LegislationConflict[]} conflicts
 * @returns {string}
 */
export function conflictFingerprint(conflicts) {
  return conflicts
    .filter((conflict) => conflict.blocking)
    .map(
      (conflict) => `${conflict.kind}:${conflict.lawIds.join('|')}:${conflict.actions.join(',')}`,
    )
    .sort()
    .join(' ; ');
}
