/**
 * مدوَّنةُ البياناتِ التمثيلية — المسار `M3`، الخطوة `M3.04`.
 *
 * برهانُ `WL-109` أثبتَ انعكاسَ كلِّ هجرةٍ على حدةٍ على قاعدةٍ **فارغة**، وأعلنَ
 * حدَّه صراحةً: «حفظُ البياناتِ عبرَ التراجعِ غيرُ مُبرهَن». وهذه المدوَّنةُ هي
 * المادّةُ التي يرفعُ بها ذلك الحدُّ: صفوفٌ حقيقيةٌ تجتازُ قيودَ المخطَّطِ كما
 * تكتبها مساراتُ الكود، تُزرَعُ في القاعدةِ قبلَ الهجرةِ ويُقاسُ بقاؤها بعدَها.
 *
 * **لماذا صفوفٌ مكتوبةٌ بيدٍ لا مولَّدةٌ آلياً:** جداولُ هذا المخطَّطِ محكومةٌ
 * بقيودِ `CHECK` دلاليّةٍ لا شكليّة — «الاعتمادُ لا يُعلَنُ بلا معتمِد»، «الحكمُ
 * لا يصدرُ قبلَ السماع»، «سببُ الرفضِ عشرون حرفاً على الأقل». ومولِّدٌ يقرأُ
 * الأنواعَ وحدَها يُنتجُ صفوفاً ترفضُها القاعدة، فيُقرَأُ عجزُ المولِّدِ عيباً في
 * الهجرة. فالصفوفُ هنا مكتوبةٌ لتجتازَ القيدَ بمعناه لا بشكلِه.
 *
 * **المستوى (`level`):** رقمُ الهجرةِ التي **بعدَها** تصيرُ الصفوفُ قابلةً
 * للإدراج. فصفوفُ `state.agents` مستواها 2 لأنّ الهجرةَ 0002 تضيفُ إليها أعمدةً
 * إلزاميةً — وتَرفضُ أن تُطبَّقَ على جدولٍ فيه صفوف. وترتيبُ المُدخلاتِ داخلَ
 * المستوى الواحدِ مقصود: الجدولُ المُشارُ إليه يسبقُ المُشيرَ إليه.
 *
 * **الطوابعُ الزمنيةُ ثابتةٌ مكتوبةٌ لا `now()`:** صورةُ البياناتِ تُقايَسُ
 * حرفاً بحرف، وقيمةٌ من الساعةِ تجعلُ بصمةَ التقريرِ تختلفُ في كلِّ تشغيلةٍ
 * فيصيرُ الدليلُ غيرَ قابلٍ للمقارنةِ بين تشغيلتَين.
 */

/** الطابعُ المرجعيُّ للمدوَّنة — كلُّ الأزمنةِ مشتقّةٌ منه أو مكتوبةٌ صريحةً. */
const T = {
  base: '2026-01-01T00:00:00.000Z',
  later: '2026-01-02T00:00:00.000Z',
  latest: '2026-01-03T00:00:00.000Z',
  future: '2027-01-01T00:00:00.000Z',
};

/**
 * غلافُ تعميةٍ مطابقٌ لقيدِ `memories_content_sealed` (الهجرة 0006).
 *
 * @param {string} marker
 * @returns {Record<string, unknown>}
 */
function sealed(marker) {
  return {
    __enc: true,
    alg: 'aes-256-gcm',
    kek: 'tier:hot',
    tier: 'hot',
    dek: `dek-${marker}`,
    dekIv: `dek-iv-${marker}`,
    dekTag: `dek-tag-${marker}`,
    iv: `iv-${marker}`,
    tag: `tag-${marker}`,
    ct: `ct-${marker}`,
  };
}

/**
 * بصمةٌ ستّينيةٌ رباعيةٌ صالحةٌ لقيودِ `^[0-9a-f]{64}$` — مميَّزةٌ بحرفٍ واحد.
 *
 * @param {string} marker
 * @returns {string}
 */
function hex64(marker) {
  return marker.repeat(64).slice(0, 64);
}

/**
 * @typedef {object} SeedEntry
 * @property {number} level رقمُ الهجرةِ التي بعدَها تُدرَجُ هذه الصفوف.
 * @property {string} table اسمُ الجدولِ مؤهَّلاً بمخطَّطِه.
 * @property {Record<string, unknown>[]} rows الصفوفُ كما تُدرَج.
 */

/** @type {readonly SeedEntry[]} */
export const SEED_CORPUS = [
  // ── المستوى 1 — ما لا تمسُّه الهجرة 0002 ──────────────────────────────────
  // الهجرةُ 0002 ترفضُ العملَ على `agents` و`models` و`laws` و`data_assets`
  // و`memories` إن كانت عامرة، فهذه الأربعةُ وحدَها تُزرَعُ قبلها لتكونَ في
  // القاعدةِ مادّةٌ تُقاسُ حينَ تُفحَصُ الهجرةُ 0002 نفسُها.
  {
    level: 1,
    table: 'state.events',
    rows: [
      {
        event_id: 'evt:0001',
        type: 'state.agent_registered',
        actor: 'crown:office',
        payload: { agent: 'agent:alpha-001' },
        hash: hex64('a'),
        prev_hash: null,
        occurred_at: T.base,
        recorded_at: T.base,
      },
      {
        event_id: 'evt:0002',
        type: 'state.law_drafted',
        actor: 'agent:alpha-001',
        payload: { law: 'law:0001' },
        hash: hex64('b'),
        prev_hash: hex64('a'),
        occurred_at: T.later,
        recorded_at: T.later,
      },
    ],
  },
  {
    level: 1,
    table: 'state.commands',
    rows: [
      {
        id: 'cmd:0001',
        nonce: 'nonce-000000001',
        issued_by: 'crown:office',
        kind: 'register-agent',
        state: 'claimed',
        payload: { target: 'agent:alpha-001' },
        created_at: T.base,
        settled_at: null,
        settle_reason: null,
      },
      {
        id: 'cmd:0002',
        nonce: 'nonce-000000002',
        issued_by: 'crown:office',
        // نوعٌ غيرُ محكومٍ عمداً: `guard:authorization` (R2) يمنعُ أيَّ ملفٍ في
        // `src/` خارجَ وحدةِ السياسةِ من ذكرِ اسمِ فعلٍ محكومٍ نصّاً، ولو كان
        // مجرَّدَ بيانٍ تمثيليٍّ في مدوَّنةِ زرع. والبرهانُ لا يتعلّقُ باسمِ
        // الفعلِ بحال، فاختيرَ اسمٌ محايدٌ بدلَ إضعافِ الحاجز.
        kind: 'record-effect',
        state: 'committed',
        payload: { target: 'law:0001' },
        created_at: T.base,
        settled_at: T.later,
        settle_reason: 'نفذ الأمر وسُجِّل أثره',
      },
    ],
  },
  {
    level: 1,
    table: 'state.quotas',
    rows: [
      {
        id: 'quota:0001',
        subject_type: 'agent',
        subject_id: 'agent:alpha-001',
        resource: 'compute-seconds',
        limit_value: '1000.0000',
        window_seconds: 3600,
        consumed: '250.5000',
        window_started_at: T.base,
        updated_at: T.later,
      },
    ],
  },
  {
    level: 1,
    table: 'state.policies',
    rows: [
      {
        id: 'pol:0001',
        name: 'قراءة سجل الأحداث',
        effect: 'allow',
        resource: 'events',
        action: 'read',
        condition: { role: 'auditor' },
        law_id: null,
        version: 1,
        enabled: true,
        approved_by: 'crown:office',
        created_at: T.base,
      },
      {
        id: 'pol:0002',
        name: 'منع محو الذاكرة المحفوظة',
        effect: 'deny',
        resource: 'memories',
        action: 'erase',
        condition: { legalHold: true },
        law_id: null,
        version: 1,
        enabled: false,
        approved_by: null,
        created_at: T.base,
      },
    ],
  },

  // ── المستوى 2 — الجداولُ التي وسّعتها الهجرة 0002 ────────────────────────
  {
    level: 2,
    table: 'state.agents',
    rows: [
      {
        id: 'agent:alpha-001',
        name: 'وكيل السجل الأول',
        kind: 'service',
        status: 'active',
        capabilities: ['registry.read', 'registry.write'],
        version: 1,
        created_at: T.base,
        updated_at: T.later,
        suspended_reason: null,
        role: 'registrar',
        owner: 'crown:office',
        certificate: { issuer: 'crown', serial: '0001' },
        state_changed_at: T.later,
      },
      {
        id: 'agent:beta-002',
        name: 'وكيل التدقيق الثاني',
        kind: 'autonomous',
        status: 'suspended',
        capabilities: ['audit.read'],
        version: 3,
        created_at: T.base,
        updated_at: T.latest,
        suspended_reason: 'تجاوز حصة الاستهلاك المعلنة مرتين',
        role: 'auditor',
        owner: 'crown:office',
        certificate: { issuer: 'crown', serial: '0002' },
        state_changed_at: T.latest,
      },
    ],
  },
  {
    level: 2,
    table: 'state.models',
    rows: [
      {
        id: 'model:gov-001',
        name: 'نموذج الحوكمة',
        provider: 'sovereign-lab',
        purpose: 'governance',
        fingerprint: hex64('c'),
        status: 'approved',
        approved_by: 'agent:alpha-001',
        version: 2,
        created_at: T.base,
        updated_at: T.later,
        model_version: '1.4.0',
        capabilities: ['reason', 'summarize'],
        state_reason: null,
        state_changed_at: T.later,
        is_active: true,
      },
      {
        id: 'model:res-002',
        name: 'نموذج البحث',
        provider: 'sovereign-lab',
        purpose: 'research',
        fingerprint: hex64('d'),
        status: 'sandboxed',
        approved_by: null,
        version: 1,
        created_at: T.base,
        updated_at: T.base,
        model_version: '0.9.1',
        capabilities: [],
        state_reason: 'قيد التقييم في بيئة معزولة',
        state_changed_at: null,
        is_active: false,
      },
    ],
  },
  {
    level: 2,
    table: 'state.laws',
    rows: [
      {
        id: 'law:0001',
        title: 'نظام حماية البيانات السيادية',
        body: 'تُصنَّف البيانات وتُحفظ بمدد معلنة ولا تُمحى إلا بشاهد مسجَّل.',
        status: 'draft',
        version: 1,
        enacted_by: null,
        enacted_at: null,
        repealed_at: null,
        created_at: T.base,
        scope: 'data-protection',
        proposer: 'agent:alpha-001',
        state_changed_at: null,
        updated_at: T.base,
      },
      {
        id: 'law:0002',
        title: 'نظام مساءلة المؤسسات',
        body: 'كل مؤسسة تُقدِّم تقريراً دورياً وتُسجَّل مخالفاتها ولا تُعالج صامتة.',
        status: 'proposed',
        version: 1,
        enacted_by: null,
        enacted_at: null,
        repealed_at: null,
        created_at: T.base,
        scope: 'institutions',
        proposer: 'agent:beta-002',
        state_changed_at: T.later,
        updated_at: T.later,
      },
    ],
  },
  {
    level: 2,
    table: 'state.data_assets',
    rows: [
      {
        id: 'asset:census-001',
        name: 'سجل التعداد السيادي',
        classification: 'sovereign',
        owner: 'agent:alpha-001',
        retention_days: 3650,
        legal_hold: true,
        created_at: T.base,
        source: 'crown-registry',
        quality: 'verified',
        version: 2,
        updated_at: T.later,
      },
      {
        id: 'asset:telemetry-002',
        name: 'قياسات التشغيل الداخلية',
        classification: 'internal',
        owner: 'agent:beta-002',
        retention_days: 30,
        legal_hold: false,
        created_at: T.base,
        source: 'runtime-probe',
        quality: 'unverified',
        version: 1,
        updated_at: T.base,
      },
    ],
  },
  {
    level: 2,
    table: 'state.memories',
    rows: [
      {
        id: 'mem:0001',
        agent_id: 'agent:alpha-001',
        kind: 'episodic',
        content: sealed('one'),
        tags: ['registry', 'audit'],
        legal_hold: false,
        created_at: T.base,
        expires_at: T.future,
        dataset_id: 'asset:telemetry-002',
        version: 1,
        updated_at: T.base,
      },
      {
        id: 'mem:0002',
        agent_id: 'agent:beta-002',
        kind: 'semantic',
        content: sealed('two'),
        tags: [],
        legal_hold: true,
        created_at: T.base,
        expires_at: null,
        dataset_id: 'asset:census-001',
        version: 4,
        updated_at: T.latest,
      },
    ],
  },

  // ── المستوى 3 — حوكمة السياسات ────────────────────────────────────────────
  {
    level: 3,
    table: 'state.policy_versions',
    rows: [
      {
        policy_id: 'pol:0001',
        version: 1,
        document: { effect: 'allow', action: 'read' },
        change_reason: 'الإصدار الأول المعتمد',
        proposed_by: 'agent:alpha-001',
        approved_by: 'crown:office',
        approval_signature: 'sig-pol-0001-v1',
        active: true,
        created_at: T.base,
      },
      {
        policy_id: 'pol:0002',
        version: 1,
        document: { effect: 'deny', action: 'erase' },
        change_reason: 'مسودة بانتظار الاعتماد',
        proposed_by: 'agent:beta-002',
        approved_by: null,
        approval_signature: null,
        active: false,
        created_at: T.base,
      },
    ],
  },
  {
    level: 3,
    table: 'state.policy_decisions',
    rows: [
      {
        actor_id: 'agent:alpha-001',
        actor_role: 'registrar',
        actor_state: 'active',
        actor_kind: 'service',
        actor_scope: 'registry',
        action: 'read',
        resource: { kind: 'events' },
        context: { channel: 'api' },
        scope: 'registry',
        royal_command_id: null,
        code: 'POLICY_ALLOWED',
        allowed: true,
        policy_id: 'pol:0001',
        policy_version: 1,
        created_at: T.base,
      },
      {
        actor_id: 'agent:beta-002',
        actor_role: 'auditor',
        actor_state: 'suspended',
        actor_kind: null,
        actor_scope: null,
        action: 'erase',
        resource: { kind: 'memories' },
        context: {},
        scope: null,
        royal_command_id: null,
        code: 'POLICY_ACTOR_SUSPENDED',
        allowed: false,
        policy_id: null,
        policy_version: null,
        created_at: T.later,
      },
    ],
  },

  // ── المستوى 4 — مهامُّ التنفيذ ────────────────────────────────────────────
  {
    level: 4,
    table: 'state.tasks',
    rows: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        idempotency_key: 'task-key-0001',
        action: 'registry.sync',
        target: 'asset:census-001',
        actor_id: 'agent:alpha-001',
        payload: { mode: 'full' },
        parent_id: null,
        root_id: '11111111-1111-4111-8111-111111111111',
        priority: 100,
        state: 'created',
        attempts: 0,
        max_attempts: 3,
        available_at: T.base,
        timeout_ms: 30000,
        memory_limit_mb: 256,
        budget_resource: null,
        budget_amount: '0.0000',
        budget_debited_at: null,
        lease_owner: null,
        lease_expires_at: null,
        cancel_requested: false,
        cancel_reason: null,
        result: null,
        error_code: null,
        error_message: null,
        created_at: T.base,
        state_changed_at: T.base,
        started_at: null,
        finished_at: null,
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        idempotency_key: 'task-key-0002',
        action: 'registry.verify',
        target: 'asset:census-001',
        actor_id: 'agent:alpha-001',
        payload: {},
        parent_id: '11111111-1111-4111-8111-111111111111',
        root_id: '11111111-1111-4111-8111-111111111111',
        priority: 50,
        state: 'succeeded',
        attempts: 1,
        max_attempts: 3,
        available_at: T.base,
        timeout_ms: 60000,
        memory_limit_mb: 512,
        budget_resource: 'compute-seconds',
        budget_amount: '12.5000',
        budget_debited_at: T.base,
        lease_owner: null,
        lease_expires_at: null,
        cancel_requested: false,
        cancel_reason: null,
        result: { verified: true },
        error_code: null,
        error_message: null,
        created_at: T.base,
        state_changed_at: T.later,
        started_at: T.base,
        finished_at: T.later,
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        idempotency_key: 'task-key-0003',
        action: 'registry.export',
        target: 'asset:telemetry-002',
        actor_id: 'agent:beta-002',
        payload: {},
        parent_id: null,
        root_id: '33333333-3333-4333-8333-333333333333',
        priority: 900,
        state: 'failed',
        attempts: 3,
        max_attempts: 3,
        available_at: T.base,
        timeout_ms: 30000,
        memory_limit_mb: 256,
        budget_resource: null,
        budget_amount: '0.0000',
        budget_debited_at: null,
        lease_owner: null,
        lease_expires_at: null,
        cancel_requested: false,
        cancel_reason: null,
        result: null,
        error_code: 'EXPORT_TOOL_MISSING',
        error_message: 'أداة التصدير غير موجودة في بيئة التشغيل',
        created_at: T.base,
        state_changed_at: T.later,
        started_at: T.base,
        finished_at: T.later,
      },
    ],
  },
  {
    level: 4,
    table: 'state.task_transitions',
    rows: [
      {
        task_id: '11111111-1111-4111-8111-111111111111',
        from_state: null,
        to_state: 'created',
        reason: 'رُفعت المهمة',
        actor: 'agent:alpha-001',
        attempt: 0,
        at: T.base,
      },
      {
        task_id: '22222222-2222-4222-8222-222222222222',
        from_state: 'running',
        to_state: 'succeeded',
        reason: 'اكتمل التحقق',
        actor: 'worker-01',
        attempt: 1,
        at: T.later,
      },
    ],
  },
  {
    level: 4,
    table: 'state.task_dead_letters',
    rows: [
      {
        task_id: '33333333-3333-4333-8333-333333333333',
        action: 'registry.export',
        payload: { asset: 'asset:telemetry-002' },
        attempts: 3,
        error_code: 'EXPORT_TOOL_MISSING',
        error_message: 'أداة التصدير غير موجودة في بيئة التشغيل',
        moved_at: T.later,
      },
    ],
  },

  // ── المستوى 5 — اعتماداتُ إعادة التصنيف ──────────────────────────────────
  {
    level: 5,
    table: 'state.classification_approvals',
    rows: [
      {
        id: 'approval:0001',
        asset_id: 'asset:telemetry-002',
        from_classification: 'internal',
        to_classification: 'sensitive',
        requested_by: 'agent:beta-002',
        approved_by: 'crown:office',
        approver_role: 'data-steward',
        justification: 'القياسات تكشف مواقع التشغيل فتُرفَع درجتها',
        record_version: 1,
        expires_at: T.future,
        consumed_at: null,
        consumed_by: null,
        version: 1,
        created_at: T.base,
        updated_at: T.base,
      },
      {
        id: 'approval:0002',
        asset_id: 'asset:census-001',
        from_classification: 'sovereign',
        to_classification: 'sensitive',
        requested_by: 'agent:alpha-001',
        approved_by: 'crown:office',
        approver_role: 'data-steward',
        justification: 'خفض الدرجة بعد إزالة الحقول المُعرِّفة من النسخة المنشورة',
        record_version: 2,
        expires_at: T.future,
        consumed_at: T.later,
        consumed_by: 'agent:alpha-001',
        version: 2,
        created_at: T.base,
        updated_at: T.later,
      },
    ],
  },

  // ── المستوى 7 — نسبُ البيانات ─────────────────────────────────────────────
  {
    level: 7,
    table: 'state.data_lineage',
    rows: [
      {
        id: 'lin:0001',
        asset_id: 'asset:census-001',
        seq: 1,
        kind: 'origin',
        actor_id: 'agent:alpha-001',
        parents: [],
        purpose: 'التسجيل الأول للأصل',
        recorded_at: '2026-01-01T00:00:00.000Z',
        prev_hash: 'genesis',
        hash: hex64('e'),
        version: 1,
        created_at: T.base,
        updated_at: T.base,
      },
      {
        id: 'lin:0002',
        asset_id: 'asset:telemetry-002',
        seq: 1,
        kind: 'derivation',
        actor_id: 'agent:beta-002',
        parents: ['asset:census-001'],
        purpose: 'اشتقاق قياسات من السجل الأصلي',
        recorded_at: '2026-01-02T00:00:00.000Z',
        prev_hash: 'genesis',
        hash: hex64('f'),
        version: 1,
        created_at: T.later,
        updated_at: T.later,
      },
    ],
  },

  // ── المستوى 9 — شواهدُ المحو ──────────────────────────────────────────────
  {
    level: 9,
    table: 'state.erasure_records',
    rows: [
      {
        id: 'era:0001',
        target: 'memories',
        target_id: 'mem:9999',
        reason: 'retention',
        actor_id: 'retention-worker',
        classification: 'internal',
        owner: 'agent:beta-002',
        dependents: { lineage: 0 },
        seq: 1,
        recorded_at: '2026-01-02T00:00:00.000Z',
        prev_hash: 'genesis',
        hash: hex64('1'),
        version: 1,
        created_at: T.later,
        updated_at: T.later,
      },
    ],
  },

  // ── المستوى 10 — قنواتُ الأحداث ───────────────────────────────────────────
  {
    level: 10,
    table: 'state.event_messages',
    rows: [
      {
        id: 'msg:0001',
        channel: 'policy',
        type: 'policy.updated',
        contract_version: 1,
        seq: 1,
        author_id: 'policy-engine',
        actor_id: 'agent:alpha-001',
        actor_role: 'registrar',
        classification: 'internal',
        payload: { policy: 'pol:0001' },
        relayed: true,
        recorded_at: '2026-01-01T00:00:00.000Z',
        prev_hash: 'genesis',
        hash: hex64('2'),
        version: 1,
        created_at: T.base,
        updated_at: T.base,
      },
      {
        id: 'msg:0002',
        channel: 'registry',
        type: 'registry.asset_created',
        contract_version: 1,
        seq: 1,
        author_id: 'registry-service',
        actor_id: 'agent:alpha-001',
        actor_role: 'registrar',
        classification: 'sovereign',
        payload: { asset: 'asset:census-001' },
        relayed: false,
        recorded_at: '2026-01-02T00:00:00.000Z',
        prev_hash: 'genesis',
        hash: hex64('3'),
        version: 1,
        created_at: T.later,
        updated_at: T.later,
      },
    ],
  },
  {
    level: 10,
    table: 'state.event_offsets',
    rows: [
      {
        id: 'off:0001',
        consumer_group: 'auditors',
        channel: 'policy',
        committed_seq: 1,
        committed_at: '2026-01-02T00:00:00.000Z',
        version: 2,
        created_at: T.base,
        updated_at: T.later,
      },
    ],
  },

  // ── المستوى 11 — قانونٌ نافذٌ مربوطٌ بمادّةٍ وسياسة ───────────────────────
  {
    level: 11,
    table: 'state.laws',
    rows: [
      {
        id: 'law:0003',
        title: 'نظام الأمر الملكي النافذ',
        body: 'لا ينفذ أمر إلا بتوقيع وسجل، ولا يُنفَّذ حكم بلا مراجعة معلنة.',
        status: 'enacted',
        version: 1,
        enacted_by: 'crown:office',
        enacted_at: T.later,
        repealed_at: null,
        created_at: T.base,
        scope: 'royal-command',
        proposer: 'agent:alpha-001',
        state_changed_at: T.later,
        updated_at: T.later,
        article_id: 'art:07',
        policy_ids: ['pol:0001'],
      },
    ],
  },

  // ── المستوى 12 — القضايا بمسارها الكامل ──────────────────────────────────
  {
    level: 12,
    table: 'state.cases',
    rows: [
      {
        id: 'case:0001',
        law_id: 'law:0001',
        subject: 'agent:beta-002',
        state: 'opened',
        opened_at: T.base,
        heard_at: null,
        verdict: null,
        closed_at: null,
        version: 1,
        created_at: T.base,
        updated_at: T.base,
        claimant: 'agent:alpha-001',
        claim: 'تجاوز الوكيل حصته المعلنة في نافذة واحدة',
        judge: null,
        reason: null,
        judged_at: null,
        executed_at: null,
        executed_effect: null,
        execution_command_id: null,
        execution_fingerprint_before: null,
        reversed_at: null,
        reversal_reason: null,
        reversal_command_id: null,
        appealed_at: null,
        appellant: null,
        appeal_reason: null,
      },
      {
        id: 'case:0002',
        law_id: 'law:0002',
        subject: 'agent:alpha-001',
        state: 'judged',
        opened_at: T.base,
        heard_at: T.later,
        verdict: 'innocent',
        closed_at: null,
        version: 2,
        created_at: T.base,
        updated_at: T.latest,
        claimant: 'agent:beta-002',
        claim: 'تأخر السجل عن نشر تقرير الدورة',
        judge: 'crown:judge-01',
        reason:
          'ثبت من صفوف الدورة التقريرية أن التقرير أُغلق قبل موعده المعلن، وأن التأخر وقع في قناة النشر لا في المؤسسة المدعى عليها، فلا مخالفة تُنسب إليها.',
        judged_at: T.latest,
        executed_at: null,
        executed_effect: null,
        execution_command_id: null,
        execution_fingerprint_before: null,
        reversed_at: null,
        reversal_reason: null,
        reversal_command_id: null,
        appealed_at: null,
        appellant: null,
        appeal_reason: null,
      },
    ],
  },

  // ── المستوى 14 — تشغيلُ المؤسسات ──────────────────────────────────────────
  {
    level: 14,
    table: 'state.institutions',
    rows: [
      {
        id: 'inst:registry',
        charter_key: 'sovereign-registry',
        seed_id: '001',
        name: 'هيئة السجل السيادي',
        agent_roles: ['registrar', 'auditor'],
        budget_resource: 'compute-seconds',
        budget_allocated: 10000,
        budget_consumed: 1200,
        charter_version: 2,
        commissioned_at: T.base,
        version: 1,
        created_at: T.base,
        updated_at: T.later,
      },
    ],
  },
  {
    level: 14,
    table: 'state.institution_tasks',
    rows: [
      {
        id: 'itask:0001',
        institution_id: 'inst:registry',
        kind: 'registry-audit',
        subject: 'مراجعة سجل التعداد السيادي للدورة الأولى',
        submitted_by: 'crown:office',
        state: 'received',
        received_at: T.base,
        budget_cost: 10,
        agent_id: null,
        assigned_at: null,
        budget_debited_at: null,
        effect: null,
        output_id: null,
        fingerprint_before: null,
        fingerprint_after: null,
        executed_at: null,
        refusal_code: null,
        refusal_reason: null,
        refused_at: null,
        version: 1,
        created_at: T.base,
        updated_at: T.base,
      },
      {
        id: 'itask:0002',
        institution_id: 'inst:registry',
        kind: 'registry-publish',
        subject: 'نشر خلاصة السجل بعد إزالة الحقول المعرِّفة',
        submitted_by: 'crown:office',
        state: 'executed',
        received_at: T.base,
        budget_cost: 25,
        agent_id: 'agent:alpha-001',
        assigned_at: T.base,
        budget_debited_at: T.base,
        effect: 'publish-summary',
        output_id: 'iout:0001',
        fingerprint_before: hex64('4'),
        fingerprint_after: hex64('5'),
        executed_at: T.later,
        refusal_code: null,
        refusal_reason: null,
        refused_at: null,
        version: 2,
        created_at: T.base,
        updated_at: T.later,
      },
    ],
  },
  {
    level: 14,
    table: 'state.institution_outputs',
    rows: [
      {
        id: 'iout:0001',
        institution_id: 'inst:registry',
        task_id: 'itask:0002',
        kind: 'summary',
        effect: 'publish-summary',
        payload: { rows: 1240 },
        produced_by: 'agent:alpha-001',
        produced_at: T.later,
        version: 1,
        created_at: T.later,
        updated_at: T.later,
      },
    ],
  },

  // ── المستوى 15 — نموذجُ التشغيل المؤسسي ───────────────────────────────────
  {
    level: 15,
    table: 'state.institution_mandates',
    rows: [
      {
        id: 'mandate:registry',
        institution_id: 'inst:registry',
        charter_key: 'sovereign-registry',
        domains: ['registry', 'audit'],
        excluded_domains: ['judiciary'],
        powers: ['read-assets', 'publish-summary'],
        prohibitions: ['erase-assets'],
        budget_period_days: 30,
        budget_ceiling: 5000,
        accountable_to: 'role:crown',
        escalate_to: 'role:auditor-general',
        reporting_period_days: 30,
        reporting_grace_days: 5,
        model_version: 1,
        enacted_at: T.base,
        version: 1,
        created_at: T.base,
        updated_at: T.base,
      },
    ],
  },
  {
    level: 15,
    table: 'state.institution_breaches',
    rows: [
      {
        id: 'breach:0001',
        institution_id: 'inst:registry',
        charter_key: 'sovereign-registry',
        task_id: 'itask:0002',
        code: 'MANDATE_DOMAIN_OUT_OF_SCOPE',
        domain: 'judiciary',
        power: 'publish-summary',
        detail: 'رُفعت مهمة في مجال مستثنى صراحة من اختصاص المؤسسة',
        accountable_to: 'role:crown',
        escalate_to: 'role:auditor-general',
        detected_at: T.later,
        version: 1,
        created_at: T.later,
        updated_at: T.later,
      },
    ],
  },
  {
    level: 15,
    table: 'state.institution_report_cycles',
    rows: [
      {
        id: 'cycle:0001',
        institution_id: 'inst:registry',
        charter_key: 'sovereign-registry',
        period_start: T.base,
        period_end: T.later,
        due_at: T.latest,
        closed_at: T.latest,
        closed_by: 'role:crown',
        tasks_total: 2,
        tasks_executed: 1,
        tasks_refused: 0,
        breach_count: 1,
        budget_consumed: 25,
        version: 1,
        created_at: T.latest,
        updated_at: T.latest,
      },
    ],
  },

  // ── المستوى 16 — التفويضُ الترابي ─────────────────────────────────────────
  {
    level: 16,
    table: 'state.federation_delegations',
    rows: [
      {
        id: 'deleg:R001',
        territory_key: 'R001',
        level: 'region',
        parent_key: null,
        exercised_by: 'role:governor',
        powers: ['local-permit'],
        kinds: ['permit-issue'],
        model_version: 1,
        activated_at: T.base,
        activated_by: 'role:crown',
        revoked_at: null,
        revoked_by: null,
        revocation_reason: null,
        version: 1,
        created_at: T.base,
        updated_at: T.base,
      },
      {
        id: 'deleg:P001-01',
        territory_key: 'P001-01',
        level: 'province',
        parent_key: 'R001',
        exercised_by: 'role:prefect',
        powers: ['local-permit'],
        kinds: ['permit-issue'],
        model_version: 1,
        activated_at: T.base,
        activated_by: 'role:crown',
        revoked_at: T.later,
        revoked_by: 'role:crown',
        revocation_reason: 'تجاوز الحد الترابي المعلن في نموذج التفويض',
        version: 2,
        created_at: T.base,
        updated_at: T.later,
      },
    ],
  },
  {
    level: 16,
    table: 'state.federation_local_acts',
    rows: [
      {
        id: 'act:0001',
        territory_key: 'P001-01',
        acting_key: 'R001',
        level: 'region',
        kind: 'permit-issue',
        power: 'local-permit',
        subject: 'إصدار رخصة تشغيل محطة قياس في المقاطعة الأولى',
        exercised_by: 'role:governor',
        exercised_at: T.base,
        version: 1,
        created_at: T.base,
        updated_at: T.base,
      },
    ],
  },
  {
    level: 16,
    table: 'state.federation_refusals',
    rows: [
      {
        id: 'refusal:0001',
        territory_key: 'P001-01',
        requested_territory_key: 'P002-03',
        level: 'province',
        kind: 'permit-issue',
        power: 'local-permit',
        code: 'FEDERATION_OUT_OF_TERRITORY',
        reason: 'المفتاح المطلوب خارج التراب المفوَّض للطالب',
        actor_role: 'role:prefect',
        refused_at: T.later,
        version: 1,
        created_at: T.later,
        updated_at: T.later,
      },
    ],
  },

  // ── المستوى 17 — سجلُّ نفاذ التفويض ───────────────────────────────────────
  {
    level: 17,
    table: 'state.federation_delegation_register',
    rows: [
      {
        id: 'reg:0001',
        command_id: 'cmd:deleg-0001',
        action: 'grant-region',
        effect: 'GRANT',
        territory_key: 'R001',
        level: 'region',
        actor_role: 'role:crown',
        issued_at: '2026-01-01T00:00:00.000Z',
        accepted_at: '2026-01-01T00:00:01.000Z',
        effective_at: '2026-01-01T00:00:02.000Z',
        latency_ms: 2000,
        deadline_ms: null,
        within_deadline: null,
        reason: null,
        version: 1,
        created_at: T.base,
        updated_at: T.base,
      },
      {
        id: 'reg:0002',
        command_id: 'cmd:deleg-0002',
        action: 'revoke-province',
        effect: 'REVOKE',
        territory_key: 'P001-01',
        level: 'province',
        actor_role: 'role:crown',
        issued_at: '2026-01-02T00:00:00.000Z',
        accepted_at: '2026-01-02T00:00:01.000Z',
        effective_at: '2026-01-02T00:00:03.000Z',
        latency_ms: 3000,
        deadline_ms: 5000,
        within_deadline: true,
        reason: 'سحب التفويض بعد تجاوز الحد الترابي المعلن',
        version: 1,
        created_at: T.later,
        updated_at: T.later,
      },
    ],
  },

  // ── المستوى 18 — التقاريرُ الملكية ────────────────────────────────────────
  {
    level: 18,
    table: 'state.royal_reports',
    rows: [
      {
        id: 'report:0001',
        report_id: 'RR-2026-001',
        period_start: T.base,
        period_end: T.later,
        generated_by: 'role:crown',
        generated_at: T.latest,
        state: 'generated',
        fields_declared: 2,
        fields_measured: 1,
        fields_estimated: 1,
        digest: hex64('6'),
        sections: [
          {
            key: 'tasks',
            estimated: false,
            measuredFrom: 'state.institution_tasks',
            rowCount: 2,
            value: 2,
          },
          {
            key: 'risk',
            estimated: true,
            assumption:
              'المخاطر غير مقيسة لأن سجل الحوادث لم يُفعَّل بعد في هذه الدورة، والتقدير يُعلَن ولا يُحسب.',
            value: null,
          },
        ],
        reviewer: null,
        review_decision: null,
        review_reason: null,
        reviewed_at: null,
        publish_command_id: null,
        published_at: null,
        model_version: 1,
        version: 1,
        created_at: T.latest,
        updated_at: T.latest,
      },
    ],
  },

  // ── المستوى 19 — غلافُ توقيع السياسة ─────────────────────────────────────
  {
    level: 19,
    table: 'state.policy_versions',
    rows: [
      {
        policy_id: 'pol:0001',
        version: 2,
        document: { effect: 'allow', action: 'read', note: 'rollback' },
        change_reason: 'إرجاع السياسة إلى إصدارها الأول',
        proposed_by: 'agent:alpha-001',
        approved_by: 'crown:office',
        approval_signature: 'sig-pol-0001-rollback',
        active: false,
        created_at: T.latest,
        signature_kind: 'rollback',
        rollback_from_version: 1,
      },
    ],
  },

  // ── المستوى 20 — سحبُ الشهادات ────────────────────────────────────────────
  {
    level: 20,
    table: 'state.certificate_revocations',
    rows: [
      {
        certificate_id: 'cert:agent-beta-002',
        revoked_by: 'crown:office',
        reason: 'تعليق الوكيل بعد تجاوز الحصة',
        revoked_at: T.later,
      },
    ],
  },
];

/**
 * اجمعْ مُدخلاتِ مستوىً واحد.
 * @param {number} level
 * @returns {readonly SeedEntry[]}
 */
export function corpusForLevel(level) {
  return SEED_CORPUS.filter((entry) => entry.level === level);
}

/**
 * ازرعْ صفوفَ مستوىً واحدٍ في القاعدة.
 *
 * كلُّ صفٍّ يُدرَجُ بمعاملاتٍ مُربوطةٍ لا بنصٍّ مُركَّب: قيمةٌ تُلصَقُ في نصِّ
 * SQL تُغيِّرُ معناه، والمدوَّنةُ تُدرَجُ في قاعدةٍ حقيقيةٍ لا في نصٍّ يُقرأ.
 *
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> }} pool
 * @param {number} level
 * @returns {Promise<{ table: string, inserted: number }[]>}
 */
export async function seedLevel(pool, level) {
  /** @type {{ table: string, inserted: number }[]} */
  const seeded = [];
  for (const entry of corpusForLevel(level)) {
    // نوعُ العمودِ يُقرأُ من القاعدةِ لا يُخمَّنُ من شكلِ القيمة: مصفوفةُ
    // JavaScript تصلحُ عمودَ `text[]` وعمودَ `jsonb` معاً، والتخمينُ بشكلِ
    // القيمةِ يُرسلُ `['x']` إلى عمودٍ `jsonb` فيُخفقُ الإدراجُ برسالةٍ لا
    // تدلُّ على سببِها («cannot get array length of a non-array»).
    const types = await columnTypes(pool, entry.table);
    for (const row of entry.rows) {
      const columns = Object.keys(row);
      const placeholders = columns.map((_, index) => `$${index + 1}`);
      const values = columns.map((column) => {
        const value = row[column];
        const type = types.get(column);
        if (value !== null && typeof value === 'object' && (type === 'jsonb' || type === 'json')) {
          return JSON.stringify(value);
        }
        return value;
      });
      await pool.query(
        `INSERT INTO ${entry.table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
        values,
      );
    }
    seeded.push({ table: entry.table, inserted: entry.rows.length });
  }
  return seeded;
}

/**
 * أنواعُ أعمدةِ جدولٍ كما هي في القاعدةِ **الآن** — لا تُخزَّنُ بين النداءات:
 * الهجراتُ تُضيفُ الأعمدةَ وتحذفُها، فذاكرةٌ محفوظةٌ تصفُ مخطَّطاً مضى.
 *
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> }} pool
 * @param {string} qualified اسمُ الجدولِ مؤهَّلاً بمخطَّطِه.
 * @returns {Promise<Map<string, string>>}
 */
async function columnTypes(pool, qualified) {
  const [schema, table] = qualified.split('.');
  const result = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2`,
    [schema, table],
  );
  return new Map(
    /** @type {{ column_name: string, data_type: string }[]} */ (result.rows).map((row) => [
      row.column_name,
      row.data_type,
    ]),
  );
}

/**
 * أعلى مستوىً في المدوَّنة — يُقرأُ في التقرير ليُعرَفَ مدى التغطية.
 * @returns {number}
 */
export function maxSeededLevel() {
  return SEED_CORPUS.reduce((max, entry) => Math.max(max, entry.level), 0);
}

/**
 * @typedef {object} RefusalScenario
 * @property {number} version الهجرةُ المتوقَّعُ أن ترفض.
 * @property {string} title وصفُ المخالفةِ بالعربية.
 * @property {string} table الجدولُ الذي تُزرَعُ فيه الصفوفُ المخالِفة.
 * @property {Record<string, unknown>[]} rows الصفوفُ المخالِفة.
 * @property {string} marker جزءٌ من نصِّ الخطأِ المنتظَر — يُميَّزُ به الرفضُ المُعلَنُ عن عطلٍ عارض.
 */

/**
 * مواضعُ **الرفضِ المُعلَن**: صفوفٌ تُزرَعُ قبل الهجرةِ فتُلزِمُها أن ترفض.
 *
 * لماذا هذا جزءٌ من برهانِ الحفظِ لا زيادةٌ عليه: هجرةٌ تُعلنُ أنّها ترفضُ
 * جدولاً مأهولاً ثمّ تُخفقُ **بعد** أن غيَّرت شيئاً تكونُ قد أتلفت بيانات وهي
 * تدَّعي حمايتَها. فالمطلوبُ إثباتُ أمرَينِ معاً: أنّ الرفضَ يقعُ برسالتِه
 * المُعلَنة، وأنّ الصورةَ بعد الرفضِ مطابقةٌ لما قبله حرفاً.
 *
 * والهجرةُ 0002 لا موضعَ لها هنا: جداولُها لا توجدُ قبلها، فلا يمكنُ إمهالُها
 * صفّاً مخالفاً — وذلك حدٌّ يُعلَنُ في التقرير لا يُسكَت.
 *
 * @type {RefusalScenario[]}
 */
export const REFUSAL_SCENARIOS = [
  {
    version: 6,
    title: 'ذاكرةٌ بمادّةٍ نصّيةٍ غير مغلَّفة',
    table: 'state.memories',
    marker: 'الترحيل 0006 متوقّف',
    rows: [
      {
        id: 'mem:9006',
        agent_id: 'agent:alpha-001',
        kind: 'episodic',
        content: { value: 'مادّةٌ صريحةٌ لا غلافَ لها' },
        tags: [],
        legal_hold: false,
        created_at: T.base,
        expires_at: T.future,
        dataset_id: 'asset:census-001',
        version: 1,
        updated_at: T.base,
      },
    ],
  },
  {
    version: 7,
    title: 'أصلٌ يحملُ نسباً مُدّعىً في العمودِ الملغى',
    table: 'state.data_assets',
    marker: 'الترحيل موقوف',
    rows: [
      {
        id: 'asset:9007',
        name: 'أصلٌ بنسبٍ مُدّعى',
        classification: 'internal',
        owner: 'agent:alpha-001',
        retention_days: 30,
        legal_hold: false,
        created_at: T.base,
        source: 'runtime-probe',
        quality: 'unverified',
        lineage: ['asset:census-001'],
        version: 1,
        updated_at: T.base,
      },
    ],
  },
  {
    version: 8,
    title: 'ذاكرةٌ بلا انتهاءٍ ولا حفظٍ قانوني',
    table: 'state.memories',
    marker: 'الترحيل 0008 متوقّف',
    rows: [
      {
        id: 'mem:9008',
        agent_id: 'agent:beta-002',
        kind: 'semantic',
        content: sealed('refusal-0008'),
        tags: [],
        legal_hold: false,
        created_at: T.base,
        expires_at: null,
        dataset_id: 'asset:telemetry-002',
        version: 1,
        updated_at: T.base,
      },
    ],
  },
  {
    version: 11,
    title: 'قانونٌ نافذٌ بلا مادّةٍ ولا سياسة',
    table: 'state.laws',
    marker: 'الهجرة 0011 موقوفة',
    rows: [
      {
        id: 'law:9011',
        title: 'نظامٌ نافذٌ بلا ربط',
        body: 'نصٌّ نافذٌ لم يُربط بمادّةٍ ولا سياسة.',
        status: 'enacted',
        version: 1,
        enacted_by: 'crown:office',
        enacted_at: T.later,
        repealed_at: null,
        created_at: T.base,
        scope: 'royal-command',
        proposer: 'agent:alpha-001',
        state_changed_at: T.later,
        updated_at: T.later,
        // ولا `article_id` ولا `policy_ids` هنا: العمودانِ تُضيفُهما الهجرةُ
        // 0011 نفسُها قبلَ حارسِها، فالصفُ المخالفُ يُزرَعُ بدونِهما ثمّ
        // يصيرُ «نافذاً بلا ربط» لحظةَ إضافتِهما — وهي الحالةُ التي يصفُها
        // الحارسُ ويرفضُ عليها.
      },
    ],
  },
  {
    version: 12,
    title: 'قضيّةٌ سابقةٌ بلا مدّعٍ ولا دعوى',
    table: 'state.cases',
    marker: 'الهجرة 0012 موقوفة',
    rows: [
      {
        id: 'case:9012',
        law_id: 'law:0001',
        subject: 'agent:beta-002',
        state: 'opened',
        opened_at: T.base,
        heard_at: null,
        verdict: null,
        closed_at: null,
      },
    ],
  },
];

/**
 * ازرعْ صفوفَ موضعِ رفضٍ واحد.
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> }} pool
 * @param {RefusalScenario} scenario
 * @returns {Promise<void>}
 */
export async function plantRefusal(pool, scenario) {
  const types = await columnTypes(pool, scenario.table);
  for (const row of scenario.rows) {
    const columns = Object.keys(row);
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const values = columns.map((column) => {
      const value = row[column];
      const type = types.get(column);
      return value !== null && typeof value === 'object' && (type === 'jsonb' || type === 'json')
        ? JSON.stringify(value)
        : value;
    });
    await pool.query(
      `INSERT INTO ${scenario.table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
      values,
    );
  }
}

/**
 * انزعْ صفوفَ موضعِ الرفضِ بمعرِّفاتِها وحدَها — لا `TRUNCATE`: البرهانُ يقومُ
 * على أنّ ما سواها باقٍ، وكنسُ الجدولِ يمحو ما يُراد إثباتُ بقائِه.
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> }} pool
 * @param {RefusalScenario} scenario
 * @returns {Promise<void>}
 */
export async function removeRefusal(pool, scenario) {
  const ids = scenario.rows.map((row) => row.id);
  await pool.query(`DELETE FROM ${scenario.table} WHERE id = ANY($1::text[])`, [ids]);
}
