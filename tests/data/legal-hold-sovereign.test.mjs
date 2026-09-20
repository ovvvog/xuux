// الحفظُ القانونيُّ فعلٌ محكومٌ لا حقلٌ يُكتَبُ — `R6-A-09`.
//
// النتيجةُ كما كُتبت: «لا موافقةَ سياديّةً على تعيينِ أو رفعِ الحفظِ القانونيِّ».
// والمقيسُ قبلَ الإصلاحِ أنّها كانت أدقَّ ممّا تبدو: لم يكنْ في الفهرسِ **مسارُ
// تغييرٍ أصلاً** بعدَ التسجيلِ، فلم يكنْ ثمّةَ ما يُوافَقُ عليه. فالمفحوصُ هنا
// ليس «هل يُسجَّلُ التغييرُ» بل: هل بقيَ مسارُ تطبيقٍ يُغيِّرُ الحفظَ القانونيَّ
// بلا أمرٍ ملكيٍّ مقبولٍ — بفاعلٍ إداريٍّ، أو بلا أمرٍ، أو بملخصٍ مُصطنَعٍ، أو
// بفهرسٍ رُكِّبَ بلا نقطةِ تفويضٍ.
//
// ونقطةُ التفويضِ هنا **حقيقيّةٌ** بحزمةِ السياساتِ الحقيقيّةِ: فهرسٌ يُختبَرُ
// بنقطةٍ مزيّفةٍ يُثبتُ أنّه ينادي مزيّفاً لا أنّه محكومٌ.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Classification,
  DataCatalog,
  LEGAL_HOLD_ACTION,
  LEGAL_HOLD_ERRORS,
  loadClassificationLattice,
} from '../../src/data/index.mjs';
import { createPolicyDecisionPoint } from '../../src/policy/engine.mjs';
import { EnforcementPoint } from '../../src/policy/enforcement-point.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { createTestLedger } from '../helpers/lineage.mjs';

const bundle = loadPolicyBundle();
const lattice = loadClassificationLattice();

/** أمرٌ ملكيٌّ مقبولٌ: معرّفٌ وملخصٌ بصورةِ `sha256` الحقيقيّةِ (‏`R6-A-07`). */
const ROYAL = Object.freeze({ royalCommandId: 'cmd:hold-1', royalCommandDigest: 'c'.repeat(64) });
const WHY = 'أمرُ حجزٍ قضائيٌّ في القضيةِ رقم ١٢٣ يوقفُ المحوَ حتّى الفصلِ فيها';

/**
 * رمزُ الخطأِ المُسمّى: الاختبارُ يقيسُ الرمزَ لا نصَّ الرسالةِ.
 * @param {unknown} error
 * @returns {string}
 */
function codeOf(error) {
  return String(/** @type {{ code?: unknown }} */ (error)?.code ?? '');
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function memoryLog() {
  /** @type {Array<{ type: string, actor: string, payload: Record<string, unknown> }>} */
  const events = [];
  return {
    events,
    /**
     * @param {string} type
     * @param {string} actor
     * @param {object} payload
     * @returns {void}
     */
    append(type, actor, payload) {
      events.push({ type, actor, payload: /** @type {Record<string, unknown>} */ (payload) });
    },
  };
}

/**
 * @param {{ withEnforcement?: boolean }} [options]
 */
function setup({ withEnforcement = true } = {}) {
  const log = memoryLog();
  const enforcementPoint = new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint({ bundle }),
    log,
    requireIdentityGate: false,
    // R5-B-06: مُحقِّقُ أمرٍ موصولٌ — نطاقُ هذه المجموعةِ الاحتفاظُ والوصولُ
    // لا توثيقُ الأمرِ، والأمرُ في الاختبارِ صحيحٌ ببنائِه.
    royalCommandVerifier: () => true,
  });
  const assets = createMemoryRepository(DataCatalog.spec);
  const { ledger } = createTestLedger({ log: /** @type {never} */ (log), assets, lattice });
  const catalog = new DataCatalog({
    log: /** @type {never} */ (log),
    repository: assets,
    lattice,
    enforcementPoint: withEnforcement ? enforcementPoint : null,
    lineage: ledger,
  });
  return { log, catalog };
}

/** @param {Record<string, unknown>} [patch] */
function king(patch = {}) {
  return {
    id: 'crown',
    role: 'role:king',
    kind: /** @type {const} */ ('human'),
    state: 'active',
    ...patch,
  };
}

/** @param {Record<string, unknown>} [patch] */
function minister(patch = {}) {
  return {
    id: 'agent:minister-1',
    role: 'role:minister',
    kind: /** @type {const} */ ('human'),
    state: 'active',
    ...patch,
  };
}

/**
 * @param {DataCatalog} catalog
 * @param {{ legalHold?: boolean, retentionDays?: number }} [options]
 */
function registerAsset(catalog, { legalHold = false, retentionDays = 30 } = {}) {
  return catalog.register({
    name: `asset-${Math.random().toString(16).slice(2)}`,
    owner: 'crown',
    classification: Classification.INTERNAL,
    source: 'crown',
    retentionDays,
    legalHold,
  });
}

// ── الفعلُ معروفٌ للدولةِ وفوقَ العتبةِ ──────────────────────────────────────

test('R6-A-09: الفعلُ معلَنٌ في كتالوجِ الأفعالِ وفي العتبةِ السياديّةِ معاً', () => {
  // فعلٌ في العتبةِ ولا سياسةَ تأذنُ به يسقطُ إلى «الافتراضُ منع» فلا يُنادى
  // عليه أحدٌ ويقعُ التغييرُ من مسارٍ لا يعرفُه القانونُ — وهو عينُ ما وقعَ في
  // `R6-A-01`. فالإعلانانِ يُقاسانِ معاً لا واحداً منهما.
  assert.ok(
    bundle.actions.has(LEGAL_HOLD_ACTION),
    'الفعلُ غيرُ معلَنٍ في كتالوجِ الأفعالِ فيُرَدُّ بـPOLICY_UNKNOWN_ACTION',
  );
  assert.ok(
    bundle.threshold.some((entry) => entry.action === LEGAL_HOLD_ACTION),
    'الفعلُ خارجَ العتبةِ السياديّةِ فيُنفَّذُ بإذنِ سياسةٍ وحدَه',
  );
  assert.ok(
    bundle.policies.some(
      (policy) =>
        policy.effect === 'allow' &&
        policy.enabled === true &&
        policy.actions.includes(LEGAL_HOLD_ACTION),
    ),
    'لا سياسةَ إذنٍ مفعّلةٍ للفعلِ، فالمسارُ المحكومُ لا يُنادى عليه أصلاً',
  );
});

// ── ما لا يمرُّ ─────────────────────────────────────────────────────────────

test('R6-A-09: رفعُ الحفظِ القانونيِّ بلا أمرٍ ملكيٍّ مرفوضٌ ولو كان الفاعلُ الملكَ', async () => {
  const { catalog, log } = setup();
  const asset = await registerAsset(catalog, { legalHold: true });
  await assert.rejects(
    () => catalog.setLegalHold({ id: asset.id, actor: king(), hold: false, justification: WHY }),
    (error) => {
      assert.equal(codeOf(error), LEGAL_HOLD_ERRORS.NOT_AUTHORIZED);
      assert.match(messageOf(error), /SOVEREIGN_COMMAND_REQUIRED/);
      return true;
    },
  );
  const after = await catalog.get(asset.id);
  assert.equal(after?.legalHold, true, 'الحفظُ رُفعَ رغمَ الرفضِ — الرفضُ إعلانٌ لا إنفاذٌ');
  assert.equal(
    log.events.filter((event) => event.type === 'data.legal-hold.refused').length,
    1,
    'الرفضُ لم يُسجَّلْ؛ وسجلٌّ لا يحوي إلا النجاحَ لا يُرى فيه اعتداءٌ',
  );
});

test('R6-A-09: تعيينُ الحفظِ بلا أمرٍ ملكيٍّ مرفوضٌ أيضاً — ليس الاتجاهانِ سواءً في الأثرِ ولا في الحُكمِ', async () => {
  // تعيينُ الحفظِ يبدو «حمايةً»، وهو في الواقعِ تعطيلٌ لحقِّ محوٍ قد يكونَ واجباً.
  const { catalog } = setup();
  const asset = await registerAsset(catalog);
  await assert.rejects(
    () => catalog.setLegalHold({ id: asset.id, actor: king(), hold: true, justification: WHY }),
    (error) => codeOf(error) === LEGAL_HOLD_ERRORS.NOT_AUTHORIZED,
  );
});

test('R6-A-09: أمرٌ ملكيٌّ بيدِ فاعلٍ إداريٍّ لا يرفعُ الحفظَ — العتبةُ لا تُفوَّض', async () => {
  const { catalog } = setup();
  const asset = await registerAsset(catalog, { legalHold: true });
  await assert.rejects(
    () =>
      catalog.setLegalHold({
        id: asset.id,
        actor: minister(),
        hold: false,
        justification: WHY,
        ...ROYAL,
      }),
    (error) => codeOf(error) === LEGAL_HOLD_ERRORS.NOT_AUTHORIZED,
  );
});

test('R6-A-09: ملخصٌ مُصطنَعٌ لا يُقرأُ أمراً ملكيّاً', async () => {
  const { catalog } = setup();
  const asset = await registerAsset(catalog, { legalHold: true });
  await assert.rejects(
    () =>
      catalog.setLegalHold({
        id: asset.id,
        actor: king(),
        hold: false,
        justification: WHY,
        royalCommandId: 'cmd:hold-1',
        royalCommandDigest: 'digest:hold-1',
      }),
    (error) => {
      assert.equal(codeOf(error), LEGAL_HOLD_ERRORS.NOT_AUTHORIZED);
      assert.match(messageOf(error), /SOVEREIGN_COMMAND_DIGEST_MALFORMED/);
      return true;
    },
  );
});

test('R6-A-09: فهرسٌ بلا نقطةِ تفويضٍ يرفضُ ولا يُنفِّذُ بلا حكمٍ', async () => {
  const { catalog } = setup({ withEnforcement: false });
  const asset = await registerAsset(catalog, { legalHold: true });
  await assert.rejects(
    () =>
      catalog.setLegalHold({
        id: asset.id,
        actor: king(),
        hold: false,
        justification: WHY,
        ...ROYAL,
      }),
    (error) => codeOf(error) === LEGAL_HOLD_ERRORS.ENFORCEMENT_REQUIRED,
  );
  const after = await catalog.get(asset.id);
  assert.equal(after?.legalHold, true);
});

test('R6-A-09: تسبيبٌ أقصرُ من الحدِّ مرفوضٌ ولو صحبَه أمرٌ ملكيٌّ', async () => {
  const { catalog } = setup();
  const asset = await registerAsset(catalog, { legalHold: true });
  await assert.rejects(
    () =>
      catalog.setLegalHold({
        id: asset.id,
        actor: king(),
        hold: false,
        justification: 'رفع',
        ...ROYAL,
      }),
    (error) => codeOf(error) === LEGAL_HOLD_ERRORS.JUSTIFICATION_REQUIRED,
  );
});

test('R6-A-09: حفظٌ على أصلٍ بلا مدّةِ احتفاظٍ يُرَدُّ برمزٍ مُسمّى لا بخطأِ قاعدةٍ خامٍ', async () => {
  const { catalog } = setup();
  const asset = await registerAsset(catalog, { retentionDays: 0 });
  await assert.rejects(
    () =>
      catalog.setLegalHold({
        id: asset.id,
        actor: king(),
        hold: true,
        justification: WHY,
        ...ROYAL,
      }),
    (error) => codeOf(error) === LEGAL_HOLD_ERRORS.RETENTION_UNDECLARED,
  );
});

test('R6-A-09: تغييرٌ لا يغيّرُ شيئاً يُرَدُّ فلا يمتلئُ السجلُّ بقراراتٍ بلا أثرٍ', async () => {
  const { catalog } = setup();
  const asset = await registerAsset(catalog);
  await assert.rejects(
    () =>
      catalog.setLegalHold({
        id: asset.id,
        actor: king(),
        hold: false,
        justification: WHY,
        ...ROYAL,
      }),
    (error) => codeOf(error) === LEGAL_HOLD_ERRORS.UNCHANGED,
  );
});

// ── ما يمرُّ، ويُقاسُ أثرُه لا نداؤه ─────────────────────────────────────────

test('R6-A-09: الملكُ بأمرٍ ملكيٍّ وتسبيبٍ يرفعُ الحفظَ، ويُقيَّدُ القرارُ بأمرِه', async () => {
  const { catalog, log } = setup();
  const asset = await registerAsset(catalog, { legalHold: true });
  const updated = await catalog.setLegalHold({
    id: asset.id,
    actor: king(),
    hold: false,
    justification: WHY,
    ...ROYAL,
  });
  assert.equal(updated.legalHold, false, 'الرفعُ المأذونُ لم ينفذْ — الحكمُ صارَ مانعاً للمشروعِ');
  const after = await catalog.get(asset.id);
  assert.equal(after?.legalHold, false, 'الأثرُ لم يُثبَّتْ في المستودعِ');
  const changed = log.events.filter((event) => event.type === 'data.legal-hold.changed');
  assert.equal(changed.length, 1);
  assert.equal(changed[0]?.payload['royalCommandId'], ROYAL.royalCommandId);
  assert.equal(changed[0]?.payload['from'], true);
  assert.equal(changed[0]?.payload['to'], false);
  assert.equal(changed[0]?.payload['justification'], WHY);
});

test('R6-A-09: والتعيينُ المأذونُ ينفذُ كذلك — التضييقُ لم يُغلقِ المسارَ المشروعَ', async () => {
  const { catalog } = setup();
  const asset = await registerAsset(catalog);
  const updated = await catalog.setLegalHold({
    id: asset.id,
    actor: king(),
    hold: true,
    justification: WHY,
    ...ROYAL,
  });
  assert.equal(updated.legalHold, true);
});
