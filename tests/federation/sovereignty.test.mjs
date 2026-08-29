// اختبارُ قبولِ الخطوة M8.08: **السيادةُ قابلةٌ للسحب، والسحبُ ينفذ خلال مهلةٍ
// معلَنةٍ ومُقاسة**.
//
// والمعيارُ يُقاس بأثرٍ لا بادّعاء، بثلاثةِ أشقّاء:
//   ١. **التفويضُ وسحبُه أمرٌ ملكيّ:** لا يقعان بمقارنةِ اسمِ دورٍ بالنصّ، بل
//      بأمرٍ موقَّعٍ يمرّ ببوابة التاج. فتوقيعٌ مُختلَقٌ يُردّ، وأمرٌ يُعاد
//      إرسالُه يُردّ، وأمرٌ على فعلٍ آخرَ أو ترابٍ آخرَ يُردّ ولو صحّ توقيعُه،
//      ودولةٌ موقوفةٌ لا يُفوَّض فيها ترابٌ ولا يُسحب.
//   ٢. **المهلةُ مُقاسةٌ لا موصوفة:** زمنُ نفاذِ السحبِ محفوظٌ في السجلِّ مشتقّاً
//      من وقتِ إصدارِ الأمرِ ووقتِ نفاذه، والحكمُ عليه محسوبٌ من المهلةِ
//      المُعلَنة. وأمرٌ انقضت مهلتُه **لا يُطبَّق** ويُسجَّل رفضُه، وسحبٌ نفَذ
//      متجاوِزاً يُكتب متجاوِزاً وتُنشر له حادثة — لا يُخفى ولا تُخضَّر مهلتُه.
//   ٣. **النافذُ الآن يُقرأ من السجلِّ مقابَلاً بالصفوف:** وتباعدُ الاثنين يُكشف
//      برمزٍ مقروء لا يُقرأ أحدُهما وحدَه.
//
// والساعةُ **مُجمَّدةٌ** وبوابةُ التاجِ تقرؤها نفسَها: فأيُّ زمنٍ يُقاس هنا زمنٌ
// مصنوعٌ بالطلبِ لا بمرورِ وقتٍ حقيقيٍّ في آلةِ الاختبار — ولو قِيس بساعةِ الجهازِ
// لصار الاختبارُ يخضرّ أو يحمرّ بحسبِ حِمْلِ الآلة.
//
// **حدٌّ معلَن:** المستودعاتُ ذاكريةٌ لا PostgreSQL، فقيودُ الهجرة 0017 لا تُقاس
// هنا؛ وتطابقُ أسمائها مع ثوابتِ المواصفةِ محروسٌ في البوابة 24
// (`scripts/guard-sovereignty.mjs`)، وثوابتُ المواصفةِ نفسُها تُقاس هنا بمحاولةِ
// كتابةِ صفٍّ يخالفها.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  CertificateAuthority,
  CrownGateway,
  EventLog,
  KingIdentity,
  createRoyalCommand,
} from '../../src/root-of-trust/index.mjs';
import {
  DelegationRegister,
  FEDERATION_ERRORS,
  FEDERATION_EVENTS,
  REGISTER_EFFECTS,
  RegionalDelegation,
  loadDelegationPolicy,
} from '../../src/federation/index.mjs';
import {
  FEDERATION_ACT_SPEC,
  FEDERATION_DELEGATION_SPEC,
  FEDERATION_REFUSAL_SPEC,
  FEDERATION_REGISTER_SPEC,
} from '../../src/persistence/entities.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';

/** وثيقةُ التفويضِ النافذة، مقروءةً لا مُختلقة. */
const POLICY = loadDelegationPolicy({
  dir: path.join(process.cwd(), 'config'),
  seedDir: path.join(process.cwd(), 'seed'),
});

const REGION_KEY = POLICY.region.regionKey;
const PROVINCE_KEY = POLICY.region.provinceKey;
const MUNICIPALITY_KEY = POLICY.region.municipalityKey;
const KING = POLICY.acts.activate;
const REVOKER = POLICY.acts.revoke;
const GRANT_ACTION = POLICY.sovereignty.commands.activate;
const REVOKE_ACTION = POLICY.sovereignty.commands.revoke;
const DEADLINE_MS = POLICY.sovereignty.revocation.deadlineMs;
const REASON = 'مراجعةُ سلطةِ الترابِ بعد ملاحظاتِ التدقيق السيادي';

/**
 * @param {unknown} source
 * @param {string} key
 * @returns {unknown}
 */
function field(source, key) {
  return source !== null && typeof source === 'object'
    ? /** @type {Record<string, unknown>} */ (source)[key]
    : undefined;
}

/**
 * دولةٌ مصغَّرةٌ بساعةٍ مُجمَّدةٍ تقرؤها بوابةُ التاجِ نفسَها.
 * @param {object} [options]
 * @param {boolean} [options.withCrown] بلا بوابةٍ يُقاس أنّ السيادةَ تسقط لا أنّها تُفترَض.
 * @param {{ assertOperational: () => void } | null} [options.haltSwitch]
 */
function state(options = {}) {
  const log = new EventLog();
  const delegations = createMemoryRepository(FEDERATION_DELEGATION_SPEC);
  const acts = createMemoryRepository(FEDERATION_ACT_SPEC);
  const refusals = createMemoryRepository(FEDERATION_REFUSAL_SPEC);
  const registerRepo = createMemoryRepository(FEDERATION_REGISTER_SPEC);
  let clock = new Date('2026-01-01T00:00:00.000Z');
  const king = new KingIdentity();
  const crown = new CrownGateway(king, new CertificateAuthority(king), log, {
    clock: /** @type {never} */ ({ now: () => clock.getTime() }),
    haltSwitch: /** @type {never} */ (options.haltSwitch ?? null),
  });
  const register = new DelegationRegister({ repository: registerRepo, log });
  const federation = new RegionalDelegation({
    policy: POLICY,
    log,
    delegations,
    acts,
    refusals,
    register,
    crown: options.withCrown === false ? null : crown,
    now: () => clock,
  });
  return {
    log,
    delegations,
    acts,
    refusals,
    registerRepo,
    register,
    king,
    crown,
    federation,
    /**
     * @param {string} action
     * @param {string} target
     */
    order: (action, target) => {
      const command = { ...createRoyalCommand(action, target), issuedAt: clock.toISOString() };
      return { command, signature: king.sign(command) };
    },
    /** @param {number} ms */
    advance: (ms) => {
      clock = new Date(clock.getTime() + ms);
    },
    now: () => clock,
  };
}

/**
 * يُفعِّل سلسلةَ التفويضِ الثلاثةَ بأوامرَ ملكيةٍ موقَّعة.
 * @param {ReturnType<typeof state>} s
 */
async function delegateAll(s) {
  for (const key of [REGION_KEY, PROVINCE_KEY, MUNICIPALITY_KEY]) {
    await s.federation.activate({
      territoryKey: key,
      actorRole: KING,
      ...s.order(GRANT_ACTION, key),
    });
  }
}

/**
 * @param {ReturnType<typeof state>} s
 * @returns {Array<unknown>}
 */
function types(s) {
  return s.log.snapshot().map((/** @type {unknown} */ entry) => field(entry, 'type'));
}

test('معيارُ القبول: سحبُ التفويضِ ينفّذ خلال مهلةٍ معلَنةٍ ومُقاسةٍ في السجل', async () => {
  const s = state();
  await delegateAll(s);

  const at = s.now();
  const order = s.order(REVOKE_ACTION, MUNICIPALITY_KEY);
  const revoked = await s.federation.revoke({
    territoryKey: MUNICIPALITY_KEY,
    actorRole: REVOKER,
    reason: REASON,
    ...order,
  });
  assert.deepEqual(field(revoked, 'revokedAt'), at);

  // ١. صفُّ السجلِّ أثرُ **هذا الأمرِ** بعينه: معرّفُه محفوظٌ لا مُختلَق.
  const rows = await s.register.entries({ territoryKey: MUNICIPALITY_KEY });
  const revokeRow = rows.find((row) => row['effect'] === REGISTER_EFFECTS.REVOKE);
  assert.ok(revokeRow, 'لا صفَّ سحبٍ في السجل');
  assert.equal(field(revokeRow, 'commandId'), order.command.id);
  assert.equal(field(revokeRow, 'action'), REVOKE_ACTION);
  assert.equal(field(revokeRow, 'actorRole'), REVOKER);

  // ٢. والمهلةُ **مقيسةٌ**: الزمنُ مشتقٌّ من وقتين محفوظين، والحكمُ منه لا استقلالاً.
  const latency = Number(field(revokeRow, 'latencyMs'));
  const issued = field(revokeRow, 'issuedAt');
  const effective = field(revokeRow, 'effectiveAt');
  assert.ok(issued instanceof Date && effective instanceof Date);
  assert.equal(latency, effective.getTime() - issued.getTime());
  assert.equal(field(revokeRow, 'deadlineMs'), DEADLINE_MS);
  assert.equal(field(revokeRow, 'withinDeadline'), latency <= DEADLINE_MS);
  assert.equal(field(revokeRow, 'withinDeadline'), true, 'السحبُ لم ينفذ في مهلته المُعلَنة');
  assert.ok(latency >= 0);

  // ٣. وحادثةُ التسجيلِ منشورةٌ ولا حادثةَ تجاوزٍ، والسلسلةُ سليمة.
  const seen = types(s);
  assert.ok(seen.includes(FEDERATION_EVENTS.REGISTERED));
  assert.ok(!seen.includes(FEDERATION_EVENTS.OVERDUE));
  assert.equal(s.log.verifyChain().ok, true);
});

test('أمرٌ انقضت مهلتُه لا يُطبَّق: يُردّ ويُسجَّل، والتفويضُ يبقى نافذاً بلا أثرٍ متأخِّر', async () => {
  const s = state();
  await delegateAll(s);

  const order = s.order(REVOKE_ACTION, MUNICIPALITY_KEY);
  // الزمنُ يتقدّم بعد إصدارِ الأمرِ وقبل تطبيقه حتى يتجاوز المهلةَ المُعلَنة.
  s.advance(DEADLINE_MS + 1);
  await assert.rejects(
    () =>
      s.federation.revoke({
        territoryKey: MUNICIPALITY_KEY,
        actorRole: REVOKER,
        reason: REASON,
        ...order,
      }),
    (error) => field(error, 'code') === FEDERATION_ERRORS.REVOCATION_DEADLINE_MISSED,
  );

  // ١. لا أثرَ متأخِّرٌ يُدَّعى أنّه وقع في المهلة: التفويضُ نافذٌ كما كان.
  assert.equal(field(await s.federation.status(MUNICIPALITY_KEY), 'state'), 'active');
  const rows = await s.register.entries({ territoryKey: MUNICIPALITY_KEY });
  assert.equal(rows.filter((row) => row['effect'] === REGISTER_EFFECTS.REVOKE).length, 0);
  // ٢. والردُّ مسجَّلٌ صفّاً: تأخُّرٌ لا يُقرأ في جدولٍ تأخُّرٌ لا يُراجَع.
  const refusals = await s.refusals.list({
    filter: { code: FEDERATION_ERRORS.REVOCATION_DEADLINE_MISSED },
  });
  assert.equal(refusals.length, 1);
  assert.equal(field(refusals[0], 'requestedTerritoryKey'), MUNICIPALITY_KEY);

  // ٣. وأمرٌ جديدٌ في مهلته ينفذ: الردُّ تأخُّرٌ لا تعطيلٌ للسيادة.
  await s.federation.revoke({
    territoryKey: MUNICIPALITY_KEY,
    actorRole: REVOKER,
    reason: REASON,
    ...s.order(REVOKE_ACTION, MUNICIPALITY_KEY),
  });
  assert.equal(field(await s.federation.status(MUNICIPALITY_KEY), 'state'), 'revoked');
});

test('تجاوزُ المهلةِ بعد التطبيقِ يُكتب متجاوِزاً وتُنشر له حادثة: لا تُخضَّر بحذفِ قياسها', async () => {
  // القياسُ يُؤخَذ **بعد** كتابةِ الصفّ. فساعةٌ تتقدّم بين الكتابةِ والقياسِ حالٌ
  // حقيقيةٌ (قاعدةٌ بطيئةٌ أو آلةٌ محمَّلة)، وحينها يُكتب الصفُّ متجاوِزاً ولا
  // يُحذف قياسُه — ولو خُفي لصار «السحبُ في مهلته» دعوىً لا قياساً.
  const s = state();
  await delegateAll(s);
  const registered = await s.register.record({
    commandId: 'cmd:slow-revocation',
    action: REVOKE_ACTION,
    effect: REGISTER_EFFECTS.REVOKE,
    territoryKey: MUNICIPALITY_KEY,
    level: 'municipality',
    actorRole: REVOKER,
    issuedAt: s.now(),
    acceptedAt: s.now(),
    effectiveAt: new Date(s.now().getTime() + DEADLINE_MS + 500),
    deadlineMs: DEADLINE_MS,
    reason: REASON,
  });
  assert.equal(field(registered, 'latencyMs'), DEADLINE_MS + 500);
  assert.equal(field(registered, 'withinDeadline'), false);
  assert.ok(types(s).includes(FEDERATION_EVENTS.OVERDUE), 'التجاوزُ لم يُنشر حادثةً');
  assert.equal(s.log.verifyChain().ok, true);
});

test('حكمُ المهلةِ محسوبٌ من القياسِ: صفٌّ يقول غيرَ ما يقيسه وقتاه يُردّ', async () => {
  const s = state();
  const at = s.now();
  await assert.rejects(
    () =>
      s.registerRepo.insert({
        id: 'register:cmd:hand-written',
        commandId: 'cmd:hand-written',
        action: REVOKE_ACTION,
        effect: REGISTER_EFFECTS.REVOKE,
        territoryKey: MUNICIPALITY_KEY,
        level: 'municipality',
        actorRole: REVOKER,
        issuedAt: at,
        acceptedAt: at,
        effectiveAt: new Date(at.getTime() + DEADLINE_MS * 4),
        // قياسٌ يُكتب باليد مخالفاً لوقتيه، وحكمٌ يُخضِّر مهلةً لم تُحترَم.
        latencyMs: 1,
        deadlineMs: DEADLINE_MS,
        withinDeadline: true,
        reason: REASON,
      }),
    /FEDERATION_REGISTER_LATENCY_MEASURED/,
  );
  assert.equal(await s.registerRepo.count({}), 0);
});

test('توقيعٌ مُختلَقٌ لا يُفوِّض ترابا ولا يسحبه، ولا يبقى منه أثر', async () => {
  const s = state();
  const forged = createRoyalCommand(GRANT_ACTION, REGION_KEY);
  await assert.rejects(
    () =>
      s.federation.activate({
        territoryKey: REGION_KEY,
        actorRole: KING,
        command: { ...forged, issuedAt: s.now().toISOString() },
        signature: 'ff'.repeat(32),
      }),
    /INVALID_ROYAL_SIGNATURE/,
  );
  assert.equal(await s.delegations.count({}), 0);
  assert.equal(await s.registerRepo.count({}), 0);
});

test('أمرٌ يُعاد إرسالُه لا يُقبل ثانياً: البوابةُ تحرق معرّفَ الأمرِ بأولِ قبول', async () => {
  // **حدٌّ معلَن في هذا الاختبار:** مسارُ التفويضِ نفسُه يفحص الحالةَ **قبل**
  // البوابة، فإعادةُ أمرِ تفعيلٍ على ترابٍ صار نافذاً تُردّ أوّلاً بـ
  // `ALREADY_ACTIVATED` أو `DELEGATION_REVOKED` لا بمنعِ الإعادة. ولذلك يُقاس
  // منعُ الإعادةِ على **الأمرِ الذي استهلكه التفويضُ فعلاً** بتقديمه إلى البوابةِ
  // ثانيةً: فلو لم يُحرَق معرّفُه لَقُبل الأمرُ نفسُه في أيِّ مسارٍ آخرَ يقبل
  // أوامرَ التاج.
  const s = state();
  const order = s.order(GRANT_ACTION, REGION_KEY);
  await s.federation.activate({ territoryKey: REGION_KEY, actorRole: KING, ...order });
  assert.throws(() => s.crown.command(order.command, order.signature), /REPLAYED_COMMAND/);

  // وأثرُ الأمرِ في السجلِّ صفٌّ واحدٌ لا صفّان.
  const rows = await s.register.entries({ commandId: order.command.id });
  assert.equal(rows.length, 1);
});

test('أمرٌ على فعلٍ آخرَ أو ترابٍ آخرَ يُردّ ولو صحّ توقيعُه', async () => {
  const s = state();
  await delegateAll(s);

  // فعلُ المنحِ لا يصلح للسحبِ: أمرٌ يُقبل على غير فعلِه أمرٌ يُنقل بتوقيعٍ صحيح.
  await assert.rejects(
    () =>
      s.federation.revoke({
        territoryKey: MUNICIPALITY_KEY,
        actorRole: REVOKER,
        reason: REASON,
        ...s.order(GRANT_ACTION, MUNICIPALITY_KEY),
      }),
    (error) => field(error, 'code') === FEDERATION_ERRORS.COMMAND_ACTION_UNKNOWN,
  );

  // وأمرٌ على البلديةِ لا يسحب تفويضَ الولاية.
  await assert.rejects(
    () =>
      s.federation.revoke({
        territoryKey: PROVINCE_KEY,
        actorRole: REVOKER,
        reason: REASON,
        ...s.order(REVOKE_ACTION, MUNICIPALITY_KEY),
      }),
    (error) => field(error, 'code') === FEDERATION_ERRORS.COMMAND_TARGET_MISMATCH,
  );

  // ولا شيءَ من ذلك ترك أثراً: التفويضان نافذان والسجلُّ ثلاثةُ مِنَحٍ لا أكثر.
  assert.equal(field(await s.federation.status(MUNICIPALITY_KEY), 'state'), 'active');
  assert.equal(field(await s.federation.status(PROVINCE_KEY), 'state'), 'active');
  assert.equal((await s.register.entries()).length, 3);
});

test('بلا بوابةِ تاجٍ لا سيادة: التفويضُ يسقط ولا يقع بمقارنةِ اسمِ دور', async () => {
  const s = state({ withCrown: false });
  await assert.rejects(
    () =>
      s.federation.activate({
        territoryKey: REGION_KEY,
        actorRole: KING,
        ...s.order(GRANT_ACTION, REGION_KEY),
      }),
    (error) => field(error, 'code') === FEDERATION_ERRORS.ROYAL_COMMAND_REQUIRED,
  );
  // ونداءٌ بلا أمرٍ أصلاً يسقط كذلك ولو كانت البوابةُ مركَّبة.
  const withCrown = state();
  await assert.rejects(
    () => withCrown.federation.activate({ territoryKey: REGION_KEY, actorRole: KING }),
    (error) => field(error, 'code') === FEDERATION_ERRORS.ROYAL_COMMAND_REQUIRED,
  );
  assert.equal(await s.delegations.count({}), 0);
  assert.equal(await withCrown.delegations.count({}), 0);
});

test('دولةٌ موقوفةٌ لا يُفوَّض فيها ترابٌ ولا يُسحب: الإيقافُ سابقٌ لكلِّ أثر', async () => {
  const s = state({
    haltSwitch: {
      assertOperational: () => {
        throw new Error('HALT_ACTIVE');
      },
    },
  });
  await assert.rejects(
    () =>
      s.federation.activate({
        territoryKey: REGION_KEY,
        actorRole: KING,
        ...s.order(GRANT_ACTION, REGION_KEY),
      }),
    /HALT_ACTIVE/,
  );
  assert.equal(await s.delegations.count({}), 0);
  assert.equal(await s.registerRepo.count({}), 0);
});

test('النافذُ الآن يُقرأ من السجلِّ مقابَلاً بالصفوف، وتباعدُ الاثنين يُكشف', async () => {
  const s = state();
  await delegateAll(s);

  const effective = await s.federation.effective();
  assert.deepEqual(
    [...effective.keys()].sort(),
    [REGION_KEY, PROVINCE_KEY, MUNICIPALITY_KEY].sort(),
  );

  await s.federation.revoke({
    territoryKey: MUNICIPALITY_KEY,
    actorRole: REVOKER,
    reason: REASON,
    ...s.order(REVOKE_ACTION, MUNICIPALITY_KEY),
  });
  const afterRevoke = await s.federation.effective();
  assert.equal(afterRevoke.has(MUNICIPALITY_KEY), false, 'السجلُّ يقرأ سحباً لم يُقرأ');
  assert.equal(afterRevoke.size, 2);

  // وصفُّ تفويضٍ يُكتب مباشرةً في القاعدة بلا أمرٍ ملكيٍّ يُكشف تباعداً: سلطةٌ
  // نشأت بلا أمرٍ لا تُقرأ سلطةً لأنّها في الجدول.
  const level = POLICY.levels.find((entry) => entry.key === MUNICIPALITY_KEY);
  assert.ok(level);
  await s.delegations.insert({
    id: 'delegation:smuggled',
    territoryKey: 'P001-01-002',
    level: 'municipality',
    parentKey: PROVINCE_KEY,
    exercisedBy: level.exercisedBy,
    powers: [...level.powers],
    kinds: level.acts.map((entry) => entry.kind),
    modelVersion: POLICY.version,
    activatedAt: s.now(),
    activatedBy: KING,
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
  });
  await assert.rejects(
    () => s.federation.effective(),
    (error) => field(error, 'code') === FEDERATION_ERRORS.REGISTER_DIVERGED,
  );
});

test('معرّفُ الأمرِ لا يتكرّر في السجل: أمرٌ واحدٌ أثرٌ واحد', async () => {
  const s = state();
  const row = {
    commandId: 'cmd:once',
    action: GRANT_ACTION,
    effect: REGISTER_EFFECTS.GRANT,
    territoryKey: REGION_KEY,
    level: 'region',
    actorRole: KING,
    issuedAt: s.now(),
    acceptedAt: s.now(),
    effectiveAt: s.now(),
    deadlineMs: null,
    reason: null,
  };
  await s.register.record(row);
  await assert.rejects(() => s.register.record(row), /مسجَّل/);
  assert.equal(await s.registerRepo.count({}), 1);
});
