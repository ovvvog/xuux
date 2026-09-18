// اختبارُ قبولِ الخطوة M9.05: **حادثةٌ مُصطنعةٌ تظهر في الواجهةِ خلال مهلةٍ
// معلَنة**. وثلاثةُ أشقٍّ لا شقٌّ واحد، وكلٌّ يفشل وحدَه إن انكسر:
//   ١. «حادثةٌ مُصطنعة» — تُسجَّل من مِقبضِ المركزِ `record` بمعرّفٍ ودرجةٍ
//      معلَنةٍ ومصدرٍ، لا بحقنِ صفٍّ في حقلٍ خاصٍّ ولا بتزييفٍ في الذاكرة.
//   ٢. «تظهر في الواجهة» — تُقرأ من `panel:incidents` عبر مِقبضِ القراءةِ نفسِه
//      الذي يقرأه أيُّ قارئٍ آخر، ويُقاس أثرُها في **ملفِّ** السجلِّ الدائمِ على
//      القرصِ نصّاً لا بلقطةٍ من الذاكرة.
//   ٣. «خلال مهلةٍ معلَنة» — المهلةُ تُقرأ من `config/operations-center.yaml` لا
//      من ثابتٍ في الاختبار، والزمنُ يُقاس على **ساعةٍ مُقادةٍ** تُمرَّر إلى
//      الوحدة؛ فتُقاس المهلةُ صعوداً (تُحتَرم) وهبوطاً (تُفوَّت عمداً فيُرَدَّ
//      برمزٍ مُعلَن).
//
// والمكوّناتُ **حقيقية**: `PersistentEventLog` بملفٍّ متسلسلٍ على القرص،
// و`ApiGateway` حقيقيةٌ على نقطةِ تفويضٍ حقيقيةٍ ووكيلِ مراقبةٍ حقيقيٍّ لقياسِ أن
// لوحةَ المهامِ تُقرأ من طبقةٍ مُدقَّقةٍ لا من مستودعٍ في يدِ المركز، وقارئُ
// الحصصِ مبنيٌّ على `config/quotas.yaml` نفسِها فحدودُه من الوثيقةِ الأصل.
//
// **حدٌّ معلَن أول:** لا نقلَ شبكيّاً ولا واجهةَ رسوميّة — «الواجهة» عقدُ نداءٍ
// مُعلَنٌ ومُدقَّقٌ كحالِ الديوانِ في `M9.03`، ودَينُ النقلِ مُسنَدٌ إلى `M10`.
//
// **حدٌّ معلَن ثانٍ:** مستودعاتُ مشهدِ القراءةِ ذاكريةٌ لا PostgreSQL، وسجلُّ
// الهوياتِ قارئٌ يُرجِع صفّاً مصنوعاً؛ فما يُقاس هنا مرورُ قراءةِ اللوحةِ بالطبقةِ
// المُدقَّقةِ وقيدُها، وسلامةُ الطبقةِ نفسِها مقيسةٌ في `tests/api`.
//
// **حدٌّ معلَن ثالث:** سعةُ سجلِّ الحوادثِ المُعلَنةُ 500، ولا يُقاس تجاوزُها
// بخمسِ مئةِ حادثةٍ حقيقيةٍ بل بوثيقةٍ **بديلةٍ** في مجلدٍ مؤقّتٍ سعتُها اثنتان —
// فالمقيسُ هو أن الحدَّ من الوثيقةِ لا من الكود، لا الرقمُ نفسُه.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import YAML from 'yaml';

import { ApiGateway, loadApiPolicy } from '../../src/api/index.mjs';
import { MonitorAgent, loadMonitoringPolicy } from '../../src/observability/index.mjs';
import {
  OPERATIONS_ERRORS,
  OPERATIONS_FACES,
  OperationsCenter,
  loadOperationsPolicy,
  quotaReaderFromPolicy,
} from '../../src/operations/index.mjs';
import { createMemoryRepositories } from '../../src/persistence/composition.mjs';
import { PersistentEventLog } from '../../src/root-of-trust/index.mjs';
import { enforcementPointFor } from '../helpers/authorization.mjs';

const REPO_ROOT = process.cwd();
const CONFIG_DIR = path.join(REPO_ROOT, 'config');
const OPERATIONS_POLICY = loadOperationsPolicy({ dir: CONFIG_DIR });
const API_POLICY = loadApiPolicy({ dir: CONFIG_DIR });
const MONITORING_POLICY = loadMonitoringPolicy({ dir: CONFIG_DIR });

const AUDITOR = 'agent:operations-auditor';

/**
 * الحصصُ من **الوثيقةِ الأصلِ** `config/quotas.yaml` لا من نسخةٍ في الاختبار:
 * فلوحةُ سعةٍ تُقاس على أرقامٍ مكتوبةٍ هنا لوحةٌ تُصادق نفسَها.
 * @type {ReadonlyArray<{ resource: string, limit: number, unit?: string, windowSeconds: number }>}
 */
const QUOTAS =
  /** @type {ReadonlyArray<{ resource: string, limit: number, unit?: string, windowSeconds: number }>} */ (
    /** @type {{ quotas: unknown }} */ (
      YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, 'quotas.yaml'), 'utf8'))
    ).quotas
  );

/**
 * @param {unknown} error
 * @returns {string}
 */
function codeOf(error) {
  return error !== null && typeof error === 'object' && 'code' in error
    ? String(/** @type {{ code: unknown }} */ (error).code)
    : `بلا رمز: ${String(error)}`;
}

/**
 * @param {() => unknown | Promise<unknown>} work
 * @param {string} expected
 * @param {string} what
 */
async function refuses(work, expected, what) {
  try {
    await work();
    assert.fail(`${what}: مرّ ولم يُرفض — والمرورُ هنا هو العيبُ نفسُه.`);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.equal(codeOf(error), expected, `${what}: رُفض برمزٍ آخر`);
  }
}

/**
 * طبقةُ واجهةٍ حقيقيةٌ بنقطةِ تفويضٍ حقيقيةٍ ووكيلِ مراقبةٍ حقيقيّ — كما في
 * اختبارِ الديوان.
 * @param {PersistentEventLog} log
 */
function realGateway(log) {
  const repositories = createMemoryRepositories();
  const identity = {
    id: AUDITOR,
    kind: 'service',
    state: 'active',
    role: MONITORING_POLICY.role,
    capabilities: ['action:read-registry', 'action:read-memory', 'action:read-audit'],
  };
  const agents = {
    /** @param {string} id */
    get: async (id) => (id === AUDITOR ? identity : null),
  };
  const monitor = new MonitorAgent({
    policy: MONITORING_POLICY,
    repositories,
    agents: /** @type {never} */ (agents),
    log: /** @type {never} */ (log),
  });
  return new ApiGateway({
    policy: API_POLICY,
    log: /** @type {never} */ (log),
    agents: /** @type {never} */ (agents),
    monitor,
    enforcementPoint: enforcementPointFor(/** @type {never} */ (log)),
    requirePoP: false, // اختباراتٌ بلا إثباتِ حيازةٍ
  });
}

/**
 * مركزُ عملياتٍ على سجلٍّ دائمٍ حقيقيٍّ في مجلدٍ مؤقّت، بساعةٍ **مُقادة**.
 * @param {object} [options]
 * @param {boolean} [options.withLog]
 * @param {boolean} [options.withGateway]
 * @param {boolean} [options.withProbes]
 * @param {boolean} [options.withQuotas]
 * @param {import('../../src/operations/operations-center.mjs').OperationsPolicy} [options.policy]
 * @param {(() => number) | undefined} [options.clock]
 */
function center(options = {}) {
  const {
    withLog = true,
    withGateway = true,
    withProbes = true,
    withQuotas = true,
    policy = OPERATIONS_POLICY,
  } = options;
  const directory = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'operations-center-')));
  const logFile = path.join(directory, 'events.log');
  const log = new PersistentEventLog(logFile, { fsync: false });
  const clockState = { nowMs: 1_000_000 };
  const probes = [
    { id: 'probe:event-log', check: () => ({ status: 'ok', detail: 'السجلُّ يكتب' }) },
    {
      id: 'probe:broken',
      check: () => {
        throw new Error('المسبارُ سقط');
      },
    },
  ];
  const operations = new OperationsCenter({
    policy,
    log: withLog ? /** @type {never} */ (log) : null,
    gateway: withGateway ? /** @type {never} */ (realGateway(log)) : null,
    healthProbes: withProbes ? probes : null,
    quotaReader: withQuotas ? quotaReaderFromPolicy({ quotas: QUOTAS }) : null,
    nowMs: options.clock ?? (() => clockState.nowMs),
  });
  const cleanup = () => {
    log.close?.();
    fs.rmSync(directory, { recursive: true, force: true });
  };
  return { operations, log, logFile, clockState, directory, cleanup };
}

/**
 * قراءةُ **ملفِّ** السجلِّ من القرص — لا لقطةٌ من الذاكرة.
 * @param {string} logFile
 * @returns {ReadonlyArray<{ type: string, actor: string, data: Record<string, unknown> }>}
 */
function onDisk(logFile) {
  return fs
    .readFileSync(logFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

test('الوثيقةُ تُعلن الأوجهَ الخمسةَ ومهلةً ورموزاً متقابلةً في الاتجاهين', () => {
  const faces = OPERATIONS_POLICY.panels.map((panel) => panel.face);
  for (const face of OPERATIONS_FACES) {
    assert.equal(
      faces.filter((entry) => entry === face).length,
      1,
      `الوجه ${face} ليس بلوحةٍ واحدةٍ بالضبط`,
    );
  }
  assert.ok(OPERATIONS_POLICY.visibility.deadlineMs > 0, 'المهلةُ المُعلَنةُ ليست رقماً موجباً');
  const listed = new Set(OPERATIONS_POLICY.refusalCodes);
  for (const code of Object.values(OPERATIONS_ERRORS)) {
    assert.ok(listed.has(code), `الرمز ${code} يرفعه الكودُ ولا إعلانَ له`);
  }
  assert.equal(listed.size, Object.values(OPERATIONS_ERRORS).length, 'إعلانٌ برمزٍ لا يرفعه كود');
  for (const guarantee of OPERATIONS_POLICY.guarantees) {
    const enforcing = fs.readFileSync(path.join(REPO_ROOT, guarantee.enforcedBy), 'utf8');
    for (const code of guarantee.codes) {
      assert.ok(
        enforcing.includes(code.replace('OPERATIONS_', '')),
        `${guarantee.id}: الرمز ${code} غائبٌ عن ملفِّ إنفاذِه`,
      );
    }
  }
});

test('معيارُ القبول: حادثةٌ مُصطنعةٌ تظهر في لوحةِ الحوادثِ خلال المهلةِ المُعلَنة', async () => {
  const harness = center();
  try {
    const { operations, clockState, logFile } = harness;
    const deadline = operations.deadlineMs;
    const recorded = operations.record({
      id: 'incident:synthetic-1',
      severity: 'critical',
      title: 'حادثةٌ مُصطنعةٌ لقياسِ المهلة',
      source: 'probe:synthetic',
      detail: { origin: 'acceptance-test' },
    });
    assert.equal(recorded.deadlineMs, deadline, 'المهلةُ المُعادةُ ليست مهلةَ الوثيقة');

    // الساعةُ تتقدّم أقلَّ من المهلةِ المُعلَنة، فالظهورُ داخلَها.
    clockState.nowMs += Math.floor(deadline / 4);
    const view = await operations.panel({ panel: 'panel:incidents', actor: AUDITOR });
    const row = view.rows.find((entry) => entry['id'] === 'incident:synthetic-1');
    assert.ok(row !== undefined, 'الحادثةُ المُسجَّلةُ لا تظهر في اللوحة');
    assert.equal(row['withinDeadline'], true, 'الحادثةُ ظهرت خارجَ المهلةِ المُعلَنة');
    assert.ok(
      Number(row['visibilityMs']) <= deadline,
      `زمنُ الظهورِ ${String(row['visibilityMs'])} فوقَ المهلةِ ${deadline}`,
    );

    const measured = await operations.assertVisible('incident:synthetic-1', { actor: AUDITOR });
    assert.equal(measured.withinDeadline, true);
    assert.equal(measured.deadlineMs, deadline);

    // «يظهر في السجلِّ الدائم» — من **ملفِّ** السجلِّ على القرصِ نصّاً.
    const entries = onDisk(logFile);
    const recordIndex = entries.findIndex(
      (entry) =>
        entry.type === OPERATIONS_POLICY.audit.incidentEvent &&
        entry.data['incident'] === 'incident:synthetic-1',
    );
    const readIndex = entries.findIndex(
      (entry) =>
        entry.type === OPERATIONS_POLICY.audit.panelEvent &&
        entry.data['panel'] === 'panel:incidents',
    );
    assert.ok(recordIndex >= 0, 'قيدُ الحادثةِ غائبٌ عن ملفِّ السجل');
    assert.ok(readIndex > recordIndex, 'قيدُ قراءةِ اللوحةِ لم يأتِ بعد قيدِ الحادثة');

    // زمنُ الظهورِ الأولُ يُثبَّت مرّةً واحدةً ولا يُعاد كتابتُه في كلِّ قراءة.
    clockState.nowMs += deadline * 10;
    const again = await operations.panel({ panel: 'panel:incidents', actor: AUDITOR });
    const sameRow = again.rows.find((entry) => entry['id'] === 'incident:synthetic-1');
    assert.equal(
      sameRow?.['firstSeenAtMs'],
      row['firstSeenAtMs'],
      'زمنُ الظهورِ الأولِ أُعيد كتابتُه — وذاك يُبطل قياسَ المهلةِ من أصلِه',
    );
  } finally {
    harness.cleanup();
  }
});

test('عدائيّ: حادثةٌ تظهر بعد المهلةِ المُعلَنةِ تُرَدُّ برمزِها ويُكتب رفضُها ولا تُخفى', async () => {
  const harness = center();
  try {
    const { operations, clockState, logFile } = harness;
    operations.record({
      id: 'incident:late',
      severity: 'warning',
      title: 'حادثةٌ يُفوَّت ظهورُها عمداً',
      source: 'probe:synthetic',
    });
    // الساعةُ تُقاد فوقَ المهلةِ **قبل** أولِ قراءة، فيُثبَّت ظهورٌ متأخّر.
    clockState.nowMs += operations.deadlineMs + 1;
    await refuses(
      () => operations.assertVisible('incident:late', { actor: AUDITOR }),
      OPERATIONS_ERRORS.VISIBILITY_MISSED,
      'ظهورٌ بعد المهلةِ المُعلَنة',
    );
    const refusal = onDisk(logFile).find(
      (entry) =>
        entry.type === OPERATIONS_POLICY.audit.incidentRefusedEvent &&
        entry.data['code'] === OPERATIONS_ERRORS.VISIBILITY_MISSED,
    );
    assert.ok(refusal !== undefined, 'تفويتُ المهلةِ بلا قيدِ رفضٍ في السجلِّ الدائم');
    // والحادثةُ تبقى ظاهرةً موسومةً بتأخُّرِها: التفويتُ لا يُخفي الحادثة.
    const view = await operations.panel({ panel: 'panel:incidents', actor: AUDITOR });
    const row = view.rows.find((entry) => entry['id'] === 'incident:late');
    assert.ok(row !== undefined, 'الحادثةُ المتأخّرةُ اختفت من اللوحة');
    assert.equal(row['withinDeadline'], false, 'الحادثةُ المتأخّرةُ غيرُ موسومةٍ بتأخُّرِها');
    await refuses(
      () => operations.assertVisible('incident:never-recorded', { actor: AUDITOR }),
      OPERATIONS_ERRORS.INCIDENT_UNKNOWN,
      'حادثةٌ لم تُسجَّل',
    );
  } finally {
    harness.cleanup();
  }
});

test('لوحةُ المهامِ تُقرأ من طبقةِ الواجهةِ وحدها، وردُّها يُغلَّف حافظاً رمزَه الأصليّ', async () => {
  const harness = center();
  try {
    const { operations, logFile } = harness;
    // بلا رمزِ جلسةٍ تردُّ طبقةُ الواجهةِ القراءةَ، فيُغلَّف الردُّ برمزٍ معلَنٍ
    // ويُحفَظ رمزُها الأصليُّ في التفصيل.
    try {
      await operations.panel({ panel: 'panel:tasks', actor: AUDITOR });
      assert.fail('قراءةٌ بلا جلسةٍ مرّت — والمرورُ هنا هو العيبُ نفسُه.');
    } catch (error) {
      assert.equal(codeOf(error), OPERATIONS_ERRORS.PANEL_REFUSED);
      const detail = /** @type {{ detail: Record<string, unknown> }} */ (error).detail;
      assert.equal(detail['route'], 'state.institution-tasks.list');
      assert.ok(String(detail['cause']).startsWith('API_'), 'رمزُ طبقةِ الواجهةِ الأصليُّ ضاع');
    }
    const refusal = onDisk(logFile).find(
      (entry) =>
        entry.type === OPERATIONS_POLICY.audit.panelRefusedEvent &&
        entry.data['code'] === OPERATIONS_ERRORS.PANEL_REFUSED,
    );
    assert.ok(refusal !== undefined, 'ردُّ اللوحةِ بلا قيدٍ في السجلِّ الدائم');
  } finally {
    harness.cleanup();
  }

  const noGateway = center({ withGateway: false });
  try {
    await refuses(
      () => noGateway.operations.panel({ panel: 'panel:tasks', actor: AUDITOR }),
      OPERATIONS_ERRORS.GATEWAY_REQUIRED,
      'لوحةٌ على مسارٍ بلا طبقةِ واجهة',
    );
  } finally {
    noGateway.cleanup();
  }
});

test('مزوِّدٌ غيرُ موصولٍ رفضٌ مُسمّىً لا لوحةٌ فارغةٌ تُقرأ صحيحةً', async () => {
  const harness = center({ withProbes: false, withQuotas: false });
  try {
    const { operations } = harness;
    await refuses(
      () => operations.panel({ panel: 'panel:health', actor: AUDITOR }),
      OPERATIONS_ERRORS.SOURCE_MISSING,
      'لوحةُ صحةٍ بلا مسابر',
    );
    await refuses(
      () => operations.panel({ panel: 'panel:capacity', actor: AUDITOR }),
      OPERATIONS_ERRORS.SOURCE_MISSING,
      'لوحةُ سعةٍ بلا مزوِّد',
    );
    await refuses(
      () => operations.panel({ panel: 'panel:cost', actor: AUDITOR }),
      OPERATIONS_ERRORS.SOURCE_MISSING,
      'لوحةُ تكلفةٍ بلا مزوِّد',
    );
  } finally {
    harness.cleanup();
  }
});

test('لوحاتُ الصحةِ والسعةِ والتكلفةِ تُقرأ من مصادرِها المُعلَنةِ ومسبارٌ ساقطٌ لا يُسقِط اللوحة', async () => {
  const harness = center();
  try {
    const { operations } = harness;
    const health = await operations.panel({ panel: 'panel:health', actor: AUDITOR });
    assert.equal(health.rows.length, 2, 'اللوحةُ لا تعرض المسابرَ كلَّها');
    const broken = health.rows.find((row) => row['id'] === 'probe:broken');
    assert.equal(broken?.['status'], 'failing', 'المسبارُ الساقطُ لا يُقرأ مُخفِقاً');
    assert.match(String(broken?.['detail']), /سقط/, 'نصُّ خطأِ المسبارِ ضاع');

    const capacityPanel = OPERATIONS_POLICY.panels.find((panel) => panel.face === 'capacity');
    const capacity = await operations.panel({ panel: 'panel:capacity', actor: AUDITOR });
    assert.equal(
      capacity.rows.length,
      (capacityPanel?.resources ?? []).length,
      'لوحةُ السعةِ لا تعرض المواردَ المُعلَنةَ كلَّها',
    );
    for (const row of capacity.rows) {
      assert.ok(Number(row['limit']) > 0, 'حدُّ الحصّةِ ليس رقماً موجباً من الوثيقةِ الأصل');
      assert.equal(row['consumed'], null, 'مستهلَكٌ غيرُ مقيسٍ يجب أن يُعاد null صريحاً');
    }
    const cost = await operations.panel({ panel: 'panel:cost', actor: AUDITOR });
    assert.ok(cost.rows.length > 0, 'لوحةُ التكلفةِ فارغة');

    // الصفوفُ صورٌ مُجمَّدةٌ عميقاً لا مراجعُ حالةٍ حيّة.
    assert.ok(Object.isFrozen(capacity.rows), 'صفوفُ اللوحةِ غيرُ مُجمَّدة');
    assert.ok(Object.isFrozen(capacity.rows[0]), 'صفُّ اللوحةِ غيرُ مُجمَّد');
    assert.throws(() => {
      /** @type {Record<string, unknown>} */ (capacity.rows[0] ?? {})['limit'] = 0;
    }, 'صفٌّ مُجمَّدٌ قَبِل كتابةً');
  } finally {
    harness.cleanup();
  }
});

test('لوحةٌ غيرُ معلَنةٍ لا تُقرأ، وبلا سجلٍّ دائمٍ لا لوحةَ ولا حادثة', async () => {
  const harness = center();
  try {
    await refuses(
      () => harness.operations.panel({ panel: 'panel:invented', actor: AUDITOR }),
      OPERATIONS_ERRORS.PANEL_UNDECLARED,
      'لوحةٌ يخترعها المُنادي',
    );
    const refusal = onDisk(harness.logFile).find(
      (entry) => entry.data['code'] === OPERATIONS_ERRORS.PANEL_UNDECLARED,
    );
    assert.ok(refusal !== undefined, 'ردُّ اللوحةِ غيرِ المُعلَنةِ بلا قيد');
  } finally {
    harness.cleanup();
  }

  const blind = center({ withLog: false });
  try {
    await refuses(
      () => blind.operations.panel({ panel: 'panel:health', actor: AUDITOR }),
      OPERATIONS_ERRORS.AUDIT_REQUIRED,
      'قراءةٌ بلا سجلٍّ دائم',
    );
    await refuses(
      () =>
        blind.operations.record({
          id: 'incident:no-log',
          severity: 'info',
          title: 'حادثةٌ بلا سجل',
          source: 'probe:synthetic',
        }),
      OPERATIONS_ERRORS.AUDIT_REQUIRED,
      'حادثةٌ بلا سجلٍّ دائم',
    );
  } finally {
    blind.cleanup();
  }
});

test('عقباتُ تسجيلِ الحادثة: حقولٌ ودرجةٌ ومعرّفٌ وسعةٌ وساعة', async () => {
  const harness = center();
  try {
    const { operations } = harness;
    await refuses(
      () => operations.record({ severity: 'info', title: 'بلا معرّف', source: 'probe:x' }),
      OPERATIONS_ERRORS.INCIDENT_INVALID,
      'حادثةٌ بلا حقلٍ لازم',
    );
    await refuses(
      () =>
        operations.record({
          id: 'incident:bad-severity',
          severity: 'catastrophic',
          title: 'درجةٌ مخترَعة',
          source: 'probe:x',
        }),
      OPERATIONS_ERRORS.SEVERITY_UNDECLARED,
      'درجةٌ غيرُ معلَنة',
    );
    operations.record({
      id: 'incident:once',
      severity: 'info',
      title: 'حادثةٌ أولى',
      source: 'probe:x',
    });
    await refuses(
      () =>
        operations.record({
          id: 'incident:once',
          severity: 'info',
          title: 'إعادةُ المعرّفِ نفسِه',
          source: 'probe:x',
        }),
      OPERATIONS_ERRORS.INCIDENT_REPLAYED,
      'معرّفٌ مستهلَك',
    );
  } finally {
    harness.cleanup();
  }

  // ساعةٌ فاسدةٌ لا يُقاس عليها ظهورٌ ولا تأخُّر.
  const broken = center({ clock: () => Number.NaN });
  try {
    await refuses(
      () =>
        broken.operations.record({
          id: 'incident:nan-clock',
          severity: 'info',
          title: 'ساعةٌ فاسدة',
          source: 'probe:x',
        }),
      OPERATIONS_ERRORS.CLOCK_INVALID,
      'ساعةٌ تُعطي NaN',
    );
    await refuses(
      () => broken.operations.panel({ panel: 'panel:health', actor: AUDITOR }),
      OPERATIONS_ERRORS.CLOCK_INVALID,
      'قراءةٌ بساعةٍ فاسدة',
    );
  } finally {
    broken.cleanup();
  }

  // السعةُ المُعلَنةُ **من الوثيقة**: نسخةٌ بديلةٌ سعتُها اثنتان تُثبت أن الحدَّ
  // ليس رقماً في الكود، وأن التجاوزَ رفضٌ مُسمّىً لا إسقاطُ أقدمِ حادثة.
  const smallPolicy =
    /** @type {import('../../src/operations/operations-center.mjs').OperationsPolicy} */ ({
      ...OPERATIONS_POLICY,
      incidents: { ...OPERATIONS_POLICY.incidents, maxOpen: 2 },
    });
  const tight = center({ policy: smallPolicy });
  try {
    tight.operations.record({
      id: 'incident:a',
      severity: 'info',
      title: 'أولى',
      source: 'probe:x',
    });
    tight.operations.record({
      id: 'incident:b',
      severity: 'info',
      title: 'ثانية',
      source: 'probe:x',
    });
    await refuses(
      () =>
        tight.operations.record({
          id: 'incident:c',
          severity: 'info',
          title: 'ثالثةٌ فوقَ السعة',
          source: 'probe:x',
        }),
      OPERATIONS_ERRORS.INCIDENT_OVERFLOW,
      'حادثةٌ فوقَ السعةِ المُعلَنة',
    );
    const view = await tight.operations.panel({ panel: 'panel:incidents', actor: AUDITOR });
    assert.equal(view.rows.length, 2, 'السعةُ أسقطت حادثةً بصمتٍ بدلَ أن ترفض');
    assert.ok(
      view.rows.some((row) => row['id'] === 'incident:a'),
      'أقدمُ حادثةٍ أُسقطت — والإسقاطُ الصامتُ عمًى في موضعِ الرؤية',
    );
  } finally {
    tight.cleanup();
  }
});

test('الحاجزُ نفسُه يُخفق على نسخةٍ مُزيَّفةٍ: وجهٌ محذوفٌ ورمزٌ محذوف', () => {
  const scratch = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'operations-guard-')));
  try {
    // نسخةٌ كاملةٌ من المستودعِ **بالربطِ الصلبِ للمجلداتِ اللازمةِ فقط**: الوثائقُ
    // والنصوصُ والوحدةُ والاختبارُ ومسارُ التكامل، فلا تُنسخ `node_modules`.
    for (const entry of ['config', 'scripts', 'src', 'tests', 'docs', '.github']) {
      fs.cpSync(path.join(REPO_ROOT, entry), path.join(scratch, entry), { recursive: true });
    }
    fs.copyFileSync(path.join(REPO_ROOT, 'package.json'), path.join(scratch, 'package.json'));

    const guard = path.join(REPO_ROOT, 'scripts', 'guard-operations.mjs');
    // النسخةُ السليمةُ تمرّ، وإلا لم يكن الإخفاقُ لاحقاً دليلاً على شيء.
    execFileSync(process.execPath, [guard, '--root', scratch], { encoding: 'utf8' });

    const configPath = path.join(scratch, 'config', 'operations-center.yaml');
    const original = fs.readFileSync(configPath, 'utf8');

    // تزييفٌ أول: حذفُ لوحةِ التكلفةِ — مركزُ عملياتٍ ناقصُ وجه.
    fs.writeFileSync(
      configPath,
      original.replace(/\n {2}- id: panel:cost[\s\S]*?- budget-allocated\n/, '\n'),
    );
    let failed = '';
    try {
      execFileSync(process.execPath, [guard, '--root', scratch], { encoding: 'utf8' });
      assert.fail('الحاجزُ مرَّ على وثيقةٍ ناقصةِ وجهٍ — والمرورُ هنا هو العيبُ نفسُه.');
    } catch (error) {
      const failure = /** @type {{ status?: number, stderr?: string, stdout?: string }} */ (error);
      assert.equal(failure.status, 1, 'خروجُ الحاجزِ ليس 1');
      failed = `${failure.stderr ?? ''}${failure.stdout ?? ''}`;
    }
    assert.match(failed, /R0|R1/, 'الحاجزُ لم يُسمِّ قاعدتَه');
    assert.match(failed, /panels|cost/, 'الحاجزُ لم يُسمِّ موضعَ النقص');

    // تزييفٌ ثانٍ: حذفُ رمزِ رفضٍ يرفعه الكودُ — تقابلٌ منكسرٌ في اتجاه.
    fs.writeFileSync(configPath, original.replace('  - OPERATIONS_VISIBILITY_MISSED\n', ''));
    try {
      execFileSync(process.execPath, [guard, '--root', scratch], { encoding: 'utf8' });
      assert.fail('الحاجزُ مرَّ على وثيقةٍ بلا رمزِ تفويتِ المهلة.');
    } catch (error) {
      const failure = /** @type {{ status?: number, stderr?: string, stdout?: string }} */ (error);
      assert.equal(failure.status, 1);
      const text = `${failure.stderr ?? ''}${failure.stdout ?? ''}`;
      assert.match(text, /R0|R3/, 'الحاجزُ لم يُسمِّ قاعدتَه');
      assert.match(text, /OPERATIONS_VISIBILITY_MISSED/, 'الحاجزُ لم يُسمِّ الرمزَ الغائب');
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('التركيبُ الحقيقيُّ يصل المركزَ دائماً بطبقةِ الواجهةِ وبحدودِ الحصصِ الأصل', async () => {
  const { createMemoryRepositories, createRegistries } =
    await import('../../src/persistence/composition.mjs');
  const { CertificateAuthority, KingIdentity } = await import('../../src/root-of-trust/index.mjs');
  const directory = registerTmpRoot(
    fs.mkdtempSync(path.join(os.tmpdir(), 'operations-composition-')),
  );
  const logFile = path.join(directory, 'events.log');
  const log = new PersistentEventLog(logFile, { fsync: false });
  try {
    const king = new KingIdentity();
    const registries = createRegistries({
      ca: new CertificateAuthority(king),
      log: /** @type {never} */ (log),
      repositories: createMemoryRepositories(),
      healthProbes: [{ id: 'probe:composed', check: () => ({ status: 'ok' }) }],
    });
    assert.ok(registries.operations !== undefined, 'التركيبُ بلا مركزِ عملياتٍ موصول');
    assert.equal(
      registries.operations.deadlineMs,
      OPERATIONS_POLICY.visibility.deadlineMs,
      'المهلةُ في التركيبِ ليست مهلةَ الوثيقة',
    );
    // حدودُ السعةِ في التركيبِ تُقرأ من `config/quotas.yaml` نفسِها.
    const capacity = await registries.operations.panel({
      panel: 'panel:capacity',
      actor: AUDITOR,
    });
    for (const row of capacity.rows) {
      const declared = QUOTAS.find((quota) => quota.resource === row['resource']);
      assert.ok(
        declared !== undefined,
        `موردٌ لا أصلَ له في وثيقةِ الحصص: ${String(row['resource'])}`,
      );
      assert.equal(row['limit'], declared.limit, 'حدُّ الحصّةِ في التركيبِ يخالف الوثيقةَ الأصل');
    }
  } finally {
    log.close?.();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
