// نموذج الصلاحيات — M4.01
//
// هذا الملف هو المقابل النوعي لوثيقة `docs/POLICY_MODEL.md`: كل بُعد في الوثيقة
// نوعٌ هنا، وكل رمز خطأ في القرار قيمةٌ في اتحاد مُغلق. الغرض أن يكون الانحراف
// بين الوثيقة والكود خطأ تصريف لا اكتشافاً متأخراً في المراجعة.
//
// النموذج مركّب: أدوار (RBAC) تحدّد من يملك القدرة، وخصائص (ABAC) تحدّد متى
// تسري — فالدور وحده لا يقرّر، والخصائص وحدها لا تُعرف صاحبها.

/** فئة الفاعل. `human` شخص، و`autonomous` وكيل ينفّذ بلا مراجعة لحظية، و`service` خدمة داخلية. */
export type ActorKind = 'human' | 'autonomous' | 'service';

/**
 * الفاعل كما يراه المحرّك. `state` حاضر دائماً لأن سياسة `pol:deny-non-active-actor`
 * تقرأه: فاعلٌ بلا حالة معروفة يُقرأ غير نشط فيُمنع، لا يُفترض نشاطه.
 */
export interface PolicyActor {
  id: string;
  role: string;
  kind?: ActorKind;
  state: string;
  scope?: string;
  capabilities?: readonly string[];
}

/** المورد المطلوب الفعل عليه. الخصائص الثلاث الباقية تقرؤها الشروط. */
export interface PolicyResource {
  id: string;
  type: string;
  scope?: string;
  owner?: string;
  classification?: string;
  legalHold?: boolean;
}

/** سياق الطلب: خصائص لحظية لا تنتمي للفاعل ولا للمورد (الجهة، نتيجة التقييم، الكمّية). */
export type PolicyContext = Readonly<Record<string, unknown>>;

/** طلب تفويض واحد بأبعاده الخمسة: الفاعل، الفعل، المورد، النطاق، الشروط (في السياق). */
export interface PolicyRequest {
  actor: PolicyActor;
  action: string;
  resource: PolicyResource;
  scope?: string;
  context?: PolicyContext;
  /** معرّف أمر ملكي **مقبول من بوابة التاج**؛ حضوره وحده لا يكفي للعتبة السيادية. */
  royalCommandId?: string;
  /**
   * ملخصُ الأمرِ الملكيِّ المقبولِ (`royalCommandDigest`) — ربطٌ إضافيٌّ يمنعُ
   * استبدالَ أمرٍ بآخرَ يحملُ المعرّفَ نفسه ويطابقُ الفاعلَ/الفعلَ/الموردَ.
   * التذكرةُ تربطُ المعرّفَ والملخصَ معاً، وتقارنُ النواةُ الأمرَ الفعليَّ
   * بهما قبلَ الاستهلاك. مطلوبٌ متى وُجد `royalCommandId`.
   */
  royalCommandDigest?: string;
}

/** عوامل الشروط المدعومة. أي عامل خارج هذا الاتحاد يُرفض في التحميل لا في التقييم. */
export type ConditionOperator =
  | 'eq'
  | 'ne'
  | 'in'
  | 'not-in'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'exists'
  // R6-A-03: يفحصُ هل القيمةُ المُعطاةُ عضوٌ في مصفوفةِ الخاصِّيةِ — كأن يتحقَّقَ
  // من حضورِ قدرةٍ في `actor.capabilities`. عكسُ `in` الذي يفحصُ هل الخاصِّيةُ عضوٌ
  // في مصفوفةٍ مُعطاةٍ. `not-includes` عكسُه: يرفضُ إن وُجدت القيمةُ في المصفوفة.
  | 'includes'
  | 'not-includes';

export interface PolicyCondition {
  attribute: string;
  operator: ConditionOperator;
  value?: unknown;
}

export interface PolicyActorMatch {
  roles?: readonly string[];
  ids?: readonly string[];
  kinds?: readonly string[];
}

/** سياسة واحدة كما تُقرأ من `config/policies.yaml` بعد التحقق من مخطَّطها. */
export interface PolicyRecord {
  id: string;
  name: string;
  owner: string;
  version: number;
  effect: 'allow' | 'deny';
  priority: number;
  reason: string;
  lawRef?: string;
  enabled: boolean;
  approvedBy?: string;
  actors: PolicyActorMatch;
  actions: readonly string[];
  resources: readonly string[];
  scopes?: readonly string[];
  conditions?: readonly PolicyCondition[];
}

/** بند في كتالوج الأفعال: الحسّاس منها لا يُنفَّذ إلا عبر نقطة التفويض (M4.05). */
export interface ActionDefinition {
  id: string;
  description: string;
  sensitive: boolean;
  quotaResource?: string;
}

/** بند العتبة السيادية كما يُقرأ من `config/royal-authority.yaml`. */
export interface SovereignThresholdEntry {
  action: string;
  reason: string;
  lawRef?: string;
  delegable?: false;
}

/** حدّ حصّة معلَن في `config/quotas.yaml`. */
export interface QuotaDefinition {
  resource: string;
  subjectType: 'agent' | 'institution' | 'region' | 'model';
  limit: number;
  windowSeconds: number;
  unit?: string;
  reason: string;
  /**
   * وحدةُ القياسِ التي يُخصَمُ بها (‏`R6-A-02`). `calls` يخصمُ واحداً **بالإعلانِ**
   * لا بالسقوطِ، و`measured` يخصمُ ما قاسَتْه البوّابةُ نفسُها بالمفتاحِ `key`.
   * ومقدارٌ غيرُ مقيسٍ لحصّةٍ `measured` رفضٌ لا خصمُ واحدٍ.
   */
  measure: { kind: 'calls' } | { kind: 'measured'; key: string };
}

/** رموز القرار. الرمز للآلة والسبب للإنسان، ولا يُعاد قرار بلا الاثنين. */
export type DecisionCode =
  // `R6-A-02`: رفضٌ لأنّ الكمّيةَ غيرُ مقيسةٍ، أو لأنّ وحدةَ القياسِ غيرُ معلَنةٍ.
  // ورمزانِ مُسمّيانِ لا رمزٌ عامٌّ: خصمُ واحدٍ عندَ الجهلِ بالكمّيةِ يُنتج سقفاً
  // يُعلَن ولا يَنفُذ، فالجهلُ يُرفَضُ باسمِه.
  | 'QUOTA_MEASURE_UNDECLARED'
  | 'QUOTA_AMOUNT_UNMEASURED'
  | 'POLICY_ALLOW'
  | 'POLICY_DENY'
  | 'POLICY_NO_MATCH'
  | 'POLICY_UNKNOWN_ACTION'
  | 'POLICY_UNKNOWN_ROLE'
  | 'SOVEREIGN_COMMAND_REQUIRED'
  | 'QUOTA_EXCEEDED'
  | 'STATE_HALTED'
  // تعارضٌ تشريعيٌّ مانعٌ لم يُحَلّ (الخطوة `M8.02`): الفعلُ محكومٌ بقانونين
  // متضادَّين، ولا يُنفَّذ حتى يُحَلَّ التعارضُ ويُقاس زوالُه.
  | 'LEGISLATION_CONFLICT_UNRESOLVED'
  // الهوية لم تُحقَّق من جذر الثقة (‏M6.01): فاعلٌ ليس في السجل، أو حالته
  // غير نشطة، أو شهادته مسحوبة أو لموضوعٍ آخر. وهو متميز عن `POLICY_DENY` لأنّ هذا
  // رفضٌ قبل السياسة لا بها: لا تُراجَع له قاعدة، بل تُراجَع له الهوية.
  | 'IDENTITY_UNVERIFIED'
  // التركيبُ يلزمُ بوابةَ هويةٍ موصولةً ولم تُمرَّر (M11.04 — Grok-F01): فشلٌ مغلقٌ
  // قبل السياسةِ، يمنعُ تنفيذَ التركيبِ الناقصِ لا تنفيذَ سياسة. متميزٌ عن
  // `IDENTITY_UNVERIFIED` الذي يُحقِّقُ هويةً فلم تثبت، فهذا يَفقدُ البوابةَ نفسَها.
  | 'IDENTITY_GATE_REQUIRED';

/**
 * قرار مُسبَّب: يحمل الرمز والسبب والسياسة الحاكمة ونسختها. و`policyId` قد يكون
 * `null` في قرارٍ لم تحكمه سياسة (لا مطابق، أو فعل مجهول، أو عتبة سيادية) —
 * وذلك تصريحٌ بالحقيقة لا نقصٌ: نسبةُ الرفض لسياسة لم تُقيَّم تضليل.
 */
export interface PolicyDecision {
  allowed: boolean;
  effect: 'allow' | 'deny';
  code: DecisionCode;
  reason: string;
  policyId: string | null;
  policyVersion: number | null;
  requiresRoyalCommand: boolean;
  /**
   * المعرّفُ الذي صدرَ القرارُ من أجلِه عندَ العتبةِ السياديّة، إن وُجد — يجعلُ
   * القرارَ واصفاً ذاتَه: «هذا الإذنُ صدرَ للأمرِ الملكيِّ الفلانيِّ».
   */
  royalCommandId?: string;
  /** السياسات المطابقة كلها مرتّبة، كي يُرى ما زاحم الحاكمة لا الحاكمة وحدها. */
  matched: ReadonlyArray<{
    id: string;
    version: number;
    effect: 'allow' | 'deny';
    priority: number;
  }>;
  evaluatedAt: string;
}
