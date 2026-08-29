// اختبارُ قبولِ الخطوة M8.07: **الإقليمُ يعمل مستقلاً، وسحبُ التفويضِ يُوقفه فوراً**.
//
// والشقّان يُقاسان بأثرٍ لا بادّعاء:
//   ١. الاستقلالُ: فعلٌ بلديٌّ يُنفَّذ **بدورِ مستواه** ويُكتب صفُّه، بلا إذنٍ
//      مركزيٍّ لكلِّ فعل — والقياسُ أنّ دورَ التاجِ نفسِه يُرفض إن مارس، فالسلطةُ
//      انتقلت فعلاً ولم تبقَ في المركز بلبوسٍ محليّ.
//   ٢. النفاذُ الفوريُّ للسحب: الساعةُ **مُجمَّدةٌ**، فيُسحب التفويضُ ثم يُطلب
//      الفعلُ التالي **بلا تقديمِ وقتٍ ولا نافذةِ سماح**؛ فيُرفض، ولا يُكتب صفُّ
//      فعلٍ، ويُكتب صفُّ رفضٍ، وتبقى سلسلةُ السجل سليمة. ولو كان النفاذُ مؤجَّلاً
//      لَمرَّ الفعلُ في اللحظة نفسِها ولَبقي الاختبارُ أخضر.
//
// وكلُّ مفتاحٍ ودورٍ وصلاحيةٍ ونوعِ فعلٍ في الملف **مقروءٌ من
// `config/federation-delegation.yaml`** لا مكتوبٌ حرفاً: حرفٌ مكتوبٌ يبقى أخضرَ
// بعد تغيُّرِ الوثيقة فيقيس ما لم يبقَ.
//
// **حدٌّ معلَن:** المستودعاتُ ذاكريةٌ لا PostgreSQL، فقيودُ الهجرة 0016 لا تُقاس
// هنا؛ وتطابقُ أسمائها مع ثوابتِ المواصفات محروسٌ في البوابة 23
// (`scripts/guard-federation.mjs`).

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
  RegionalDelegation,
  loadDelegationPolicy,
} from '../../src/federation/index.mjs';
import {
  FEDERATION_ACT_SPEC,
  FEDERATION_DELEGATION_SPEC,
  FEDERATION_MIN_REASON_LENGTH,
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

/**
 * قراءةُ حقلٍ من كائنٍ مجهولِ النوع بلا `any`.
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
 * مستوىً مُعلَنٌ بمفتاحه.
 * @param {string} key
 * @returns {import('../../src/federation/delegation.mjs').DelegationLevel}
 */
function levelOf(key) {
  const found = POLICY.levels.find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`لا مستوى بالمفتاح ${key} في الوثيقة`);
  return found;
}

/**
 * أولُ نوعِ فعلٍ مُعلَنٍ لمستوىً بمفتاحه.
 * @param {string} key
 * @returns {{ kind: string, power: string }}
 */
function actOf(key) {
  const [act] = levelOf(key).acts;
  if (act === undefined) throw new Error(`المستوى ${key} بلا فعلٍ مُعلَن`);
  return act;
}

/** موضوعٌ يبلغ الحدَّ المُعلَنَ للطول، مبنيّاً من الحدِّ نفسِه لا من عدٍّ محفوظ. */
function subject(label = 'موضوعُ فعلٍ ترابيٍّ مُعلَنٍ للمراجعة') {
  return label.length >= FEDERATION_MIN_REASON_LENGTH
    ? label
    : label.padEnd(FEDERATION_MIN_REASON_LENGTH, 'ـ');
}

/** سببٌ يبلغ الحدَّ المُعلَن. */
const REASON = subject('مراجعةُ سلطةِ الترابِ بعد ملاحظاتِ التدقيق');

/**
 * دولةٌ مصغَّرةٌ بساعةٍ **مُجمَّدةٍ افتراضاً**: الزمنُ لا يتقدّم إلا بطلبٍ صريح،
 * فأيُّ نفاذٍ يُقاس هنا نفاذٌ في اللحظةِ نفسِها لا بمرورِ وقت.
 * @param {object} [options]
 * @param {import('../../src/federation/delegation.mjs').DelegationPolicy} [options.policy]
 */
function state(options = {}) {
  const log = new EventLog();
  const delegations = createMemoryRepository(FEDERATION_DELEGATION_SPEC);
  const acts = createMemoryRepository(FEDERATION_ACT_SPEC);
  const refusals = createMemoryRepository(FEDERATION_REFUSAL_SPEC);
  const registerRepo = createMemoryRepository(FEDERATION_REGISTER_SPEC);
  let clock = new Date('2026-01-01T00:00:00.000Z');
  // وبوابةُ التاجِ تقرأ **الساعةَ المجمَّدةَ نفسَها** (الخطوة `M8.08`): بوابةٌ
  // بساعةِ الجهازِ وأمرٌ بوقتِ الساعةِ المجمَّدةِ يُقرأ أمراً من المستقبل، فيصير
  // الاختبارُ يقيس فارقَ ساعتين لا سلطةَ أمرٍ ملكيّ.
  const king = new KingIdentity();
  const crown = new CrownGateway(king, new CertificateAuthority(king), log, {
    clock: /** @type {never} */ ({ now: () => clock.getTime() }),
  });
  const register = new DelegationRegister({ repository: registerRepo, log });
  const federation = new RegionalDelegation({
    policy: options.policy ?? POLICY,
    log,
    delegations,
    acts,
    refusals,
    register,
    crown,
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
     * أمرٌ ملكيٌّ موقَّعٌ فعلاً بوقتِ الساعةِ المجمَّدة.
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
 * يُفعِّل سلسلةَ التفويضِ الثلاثةَ بالترتيب: الأصلُ قبل فرعه.
 * @param {ReturnType<typeof state>} s
 */
async function delegateAll(s) {
  for (const key of [REGION_KEY, PROVINCE_KEY, MUNICIPALITY_KEY]) {
    await s.federation.activate({
      territoryKey: key,
      actorRole: KING,
      ...s.order(POLICY.sovereignty.commands.activate, key),
    });
  }
}

/**
 * أنواعُ الحوادثِ المنشورةِ في السجل.
 * @param {ReturnType<typeof state>} s
 * @returns {Array<unknown>}
 */
function types(s) {
  return s.log.snapshot().map((/** @type {unknown} */ entry) => field(entry, 'type'));
}

test('معيارُ القبول ١: البلديةُ تعمل بدورِ مستواها بلا إذنٍ مركزيٍّ لكلِّ فعل', async () => {
  const s = state();
  await delegateAll(s);
  const level = levelOf(MUNICIPALITY_KEY);
  const act = actOf(MUNICIPALITY_KEY);

  const row = await s.federation.exercise({
    id: 'act:local-1',
    territoryKey: MUNICIPALITY_KEY,
    kind: act.kind,
    subject: subject(),
    actorRole: level.exercisedBy,
  });

  // ١. الفعلُ وقع بدورِ المستوى نفسِه، لا بدورِ التاج.
  assert.equal(field(row, 'exercisedBy'), level.exercisedBy);
  assert.notEqual(level.exercisedBy, KING);
  assert.equal(field(row, 'territoryKey'), MUNICIPALITY_KEY);
  assert.equal(field(row, 'actingKey'), MUNICIPALITY_KEY);
  assert.equal(field(row, 'power'), act.power);
  assert.equal(field(row, 'level'), level.level);

  // ٢. وصفُّه محفوظٌ: فعلٌ بلا صفٍّ لا يُقاس استقلالٌ به.
  assert.equal(await s.acts.count({}), 1);
  // ٣. ولا رفضَ سُجِّل: العملُ مضى بلا مراجعةٍ مركزيةٍ لكلِّ فعل.
  assert.equal(await s.refusals.count({}), 0);
  // ٤. والحادثةُ منشورةٌ في سجلٍّ سليمِ السلسلة.
  assert.ok(types(s).includes(FEDERATION_EVENTS.EXERCISED));
  assert.equal(s.log.verify(), true);
  assert.equal(s.log.verifyChain().ok, true);
});

test('معيارُ القبول ٢: سحبُ التفويضِ يُوقف العملَ **في اللحظة نفسِها** بلا تقديمِ ساعة', async () => {
  const s = state();
  await delegateAll(s);
  const level = levelOf(MUNICIPALITY_KEY);
  const act = actOf(MUNICIPALITY_KEY);

  await s.federation.exercise({
    id: 'act:before',
    territoryKey: MUNICIPALITY_KEY,
    kind: act.kind,
    subject: subject(),
    actorRole: level.exercisedBy,
  });
  assert.equal(await s.acts.count({}), 1);

  const at = s.now();
  const revoked = await s.federation.revoke({
    territoryKey: MUNICIPALITY_KEY,
    actorRole: POLICY.acts.revoke,
    reason: REASON,
    ...s.order(POLICY.sovereignty.commands.revoke, MUNICIPALITY_KEY),
  });
  assert.equal(field(revoked, 'revokedBy'), POLICY.acts.revoke);
  assert.deepEqual(field(revoked, 'revokedAt'), at);

  // والساعةُ **لم تتقدّم**: أولُ فعلٍ بعد السحبِ يُرفض في اللحظةِ نفسِها.
  await assert.rejects(
    () =>
      s.federation.exercise({
        id: 'act:after',
        territoryKey: MUNICIPALITY_KEY,
        kind: act.kind,
        subject: subject('فعلٌ تالٍ في اللحظةِ نفسِها بعد سحبِ التفويض'),
        actorRole: level.exercisedBy,
      }),
    (error) => field(error, 'code') === FEDERATION_ERRORS.DELEGATION_REVOKED,
  );
  assert.equal(s.now().getTime(), at.getTime(), 'الساعةُ تقدّمت فلم يُقَس النفاذُ الفوريّ');

  // ١. لا صفَّ فعلٍ جديدٍ فُتح: المنعُ وقع قبل الكتابة.
  assert.equal(await s.acts.count({}), 1);
  // ٢. وصفُّ الرفضِ محفوظٌ بسببٍ يبلغ الحدَّ المُعلَن.
  const refusals = await s.refusals.list({
    filter: { code: FEDERATION_ERRORS.DELEGATION_REVOKED },
  });
  assert.equal(refusals.length, 1);
  const [refusal] = refusals;
  assert.equal(field(refusal, 'requestedTerritoryKey'), MUNICIPALITY_KEY);
  assert.equal(field(refusal, 'actorRole'), level.exercisedBy);
  assert.ok(String(field(refusal, 'reason')).length >= FEDERATION_MIN_REASON_LENGTH);
  assert.ok(field(refusal, 'refusedAt') instanceof Date);
  // ٣. والسحبُ والرفضُ منشوران في سجلٍّ سليمِ السلسلة.
  const seen = types(s);
  assert.ok(seen.includes(FEDERATION_EVENTS.REVOKED));
  assert.ok(seen.includes(FEDERATION_EVENTS.REFUSED));
  assert.equal(s.log.verifyChain().ok, true);
});

test('سحبُ تفويضِ الإقليمِ يقطع سلسلةَ فرعِه: البلديةُ تتوقّف ولو بقي تفويضُها نافذاً', async () => {
  const s = state();
  await delegateAll(s);
  const level = levelOf(MUNICIPALITY_KEY);
  const act = actOf(MUNICIPALITY_KEY);

  await s.federation.revoke({
    territoryKey: REGION_KEY,
    actorRole: POLICY.acts.revoke,
    reason: REASON,
    ...s.order(POLICY.sovereignty.commands.revoke, REGION_KEY),
  });

  await assert.rejects(
    () =>
      s.federation.exercise({
        id: 'act:orphan',
        territoryKey: MUNICIPALITY_KEY,
        kind: act.kind,
        subject: subject('فعلٌ بلديٌّ بعد سحبِ تفويضِ الإقليمِ الأعلى'),
        actorRole: level.exercisedBy,
      }),
    (error) => field(error, 'code') === FEDERATION_ERRORS.CHAIN_BROKEN,
  );

  // وتفويضُ البلديةِ **نافذٌ** في صفِّه: التوقّفُ من انكسارِ السلسلةِ لا من سحبها.
  const own = await s.federation.status(MUNICIPALITY_KEY);
  assert.equal(field(own, 'state'), 'active');
  assert.equal(await s.acts.count({}), 0);
  assert.equal(await s.refusals.count({}), 1);
});

test('الولايةُ لا تعمل في ترابِ ولايةٍ أخرى من الإقليمِ نفسِه', async () => {
  const s = state();
  await delegateAll(s);
  const province = levelOf(PROVINCE_KEY);
  const act = actOf(PROVINCE_KEY);
  // مفتاحٌ في الإقليمِ نفسِه وفي ولايةٍ أخرى: يُبنى من مفتاحِ الإقليمِ لا حرفاً.
  const digits = PROVINCE_KEY.slice(-2);
  const other = `${PROVINCE_KEY.slice(0, -2)}${String(Number(digits) + 1).padStart(2, '0')}-001`;

  await assert.rejects(
    () =>
      s.federation.exercise({
        id: 'act:outside',
        territoryKey: other,
        kind: act.kind,
        subject: subject('فعلٌ في ترابِ ولايةٍ أخرى من الإقليمِ نفسِه'),
        actorRole: province.exercisedBy,
        actingKey: PROVINCE_KEY,
      }),
    (error) => field(error, 'code') === FEDERATION_ERRORS.OUT_OF_TERRITORY,
  );
  assert.equal(await s.acts.count({}), 0);
  const [refusal] = await s.refusals.list({ filter: {} });
  assert.equal(field(refusal, 'requestedTerritoryKey'), other);
  assert.equal(field(refusal, 'territoryKey'), PROVINCE_KEY);
});

test('ترابٌ غيرُ مُفوَّضٍ في الوثيقةِ يُرفض ويُسجَّل بلا مستوىً مُنتحَل', async () => {
  const s = state();
  await delegateAll(s);
  const region = levelOf(REGION_KEY);
  const act = actOf(REGION_KEY);
  const stranger = `R${String(Number(REGION_KEY.slice(1)) + 1).padStart(3, '0')}`;

  await assert.rejects(
    () =>
      s.federation.exercise({
        id: 'act:stranger',
        territoryKey: stranger,
        kind: act.kind,
        subject: subject('فعلٌ في إقليمٍ لم يُفوَّض في هذه الخطوة'),
        actorRole: region.exercisedBy,
      }),
    (error) => field(error, 'code') === FEDERATION_ERRORS.TERRITORY_UNKNOWN,
  );
  const [refusal] = await s.refusals.list({ filter: {} });
  assert.equal(field(refusal, 'requestedTerritoryKey'), stranger);
  assert.equal(field(refusal, 'territoryKey'), null);
  assert.equal(field(refusal, 'level'), null);
});

test('دورُ التاجِ لا يمارِس الفعلَ المحليَّ: السلطةُ انتقلت ولم تبقَ في المركزِ بلبوسٍ محليّ', async () => {
  const s = state();
  await delegateAll(s);
  const act = actOf(MUNICIPALITY_KEY);

  await assert.rejects(
    () =>
      s.federation.exercise({
        id: 'act:king',
        territoryKey: MUNICIPALITY_KEY,
        kind: act.kind,
        subject: subject('فعلٌ بلديٌّ يمارسه المركزُ لا البلدية'),
        actorRole: KING,
      }),
    (error) => field(error, 'code') === FEDERATION_ERRORS.ROLE_NOT_PERMITTED,
  );
  assert.equal(await s.acts.count({}), 0);
});

test('الصفُّ سندُ السلطةِ لا الوثيقةُ الحاضرة: صلاحيةٌ نُقلت في وثيقةٍ أحدثَ لا تُمارَس بصفٍّ قديم', async () => {
  // الوثيقةُ تُجيز فعلاً لمستوىً، والصفُّ المحفوظُ من تفويضٍ أقدمَ لا يحمل
  // صلاحيتَه: فلو قُرئت السلطةُ من الوثيقةِ الحاضرةِ لمضى الفعلُ بصلاحيةٍ لم
  // تُفوَّض في سندها. وهذا هو موضعُ `FEDERATION_POWER_NOT_DELEGATED`.
  const s = state();
  await delegateAll(s);
  const municipality = levelOf(MUNICIPALITY_KEY);
  const provinceAct = actOf(PROVINCE_KEY);
  assert.ok(
    !municipality.powers.includes(provinceAct.power),
    'الوثيقةُ تُفوّض صلاحيةَ الولايةِ للبلديةِ فلا يُقاس بها المنع',
  );

  // وثيقةٌ أحدثُ تنقل إلى البلديةِ فعلَ الولايةِ وصلاحيتَه، والصفُّ المحفوظُ من
  // الوثيقةِ الأولى باقٍ بصلاحياتها.
  const later = {
    ...POLICY,
    version: POLICY.version + 1,
    levels: POLICY.levels.map((level) =>
      level.key === MUNICIPALITY_KEY
        ? { ...level, powers: [provinceAct.power], acts: [provinceAct] }
        : level,
    ),
  };
  const federation = new RegionalDelegation({
    policy: later,
    log: s.log,
    delegations: s.delegations,
    acts: s.acts,
    refusals: s.refusals,
    register: s.register,
    crown: s.crown,
    now: s.now,
  });

  await assert.rejects(
    () =>
      federation.exercise({
        id: 'act:not-in-row',
        territoryKey: MUNICIPALITY_KEY,
        kind: provinceAct.kind,
        subject: subject('فعلٌ بصلاحيةٍ ليست في سندِ التفويضِ المحفوظ'),
        actorRole: municipality.exercisedBy,
      }),
    (error) => field(error, 'code') === FEDERATION_ERRORS.POWER_NOT_DELEGATED,
  );
  assert.equal(await s.acts.count({}), 0);
  assert.equal(await s.refusals.count({}), 1);
});

test('نوعُ فعلٍ غيرُ معروفٍ في المستوى يُرفض ويُسجَّل', async () => {
  const s = state();
  await delegateAll(s);
  const level = levelOf(MUNICIPALITY_KEY);

  await assert.rejects(
    () =>
      s.federation.exercise({
        id: 'act:unknown',
        territoryKey: MUNICIPALITY_KEY,
        kind: 'unknown-local-act',
        subject: subject('فعلٌ بنوعٍ غيرِ مُعلَنٍ في وثيقةِ التفويض'),
        actorRole: level.exercisedBy,
      }),
    (error) => field(error, 'code') === FEDERATION_ERRORS.ACT_UNKNOWN,
  );
  assert.equal(await s.acts.count({}), 0);
  assert.equal(await s.refusals.count({}), 1);
});

test('فعلٌ في ترابٍ لم يُفعَّل تفويضُه بعدُ يُرفض: التفويضُ سندٌ لا افتراض', async () => {
  const s = state();
  await s.federation.activate({
    territoryKey: REGION_KEY,
    actorRole: KING,
    ...s.order(POLICY.sovereignty.commands.activate, REGION_KEY),
  });
  const level = levelOf(PROVINCE_KEY);
  const act = actOf(PROVINCE_KEY);

  await assert.rejects(
    () =>
      s.federation.exercise({
        id: 'act:not-yet',
        territoryKey: PROVINCE_KEY,
        kind: act.kind,
        subject: subject('فعلُ ولايةٍ قبل تفعيلِ تفويضِها'),
        actorRole: level.exercisedBy,
      }),
    (error) => field(error, 'code') === FEDERATION_ERRORS.NOT_ACTIVATED,
  );
  assert.equal(await s.acts.count({}), 0);
});

test('سحبٌ بلا سببٍ يبلغ الحدَّ المُعلَنَ يُرفض: قرارٌ لا يُراجَع ليس قراراً', async () => {
  const s = state();
  await delegateAll(s);

  await assert.rejects(
    () =>
      s.federation.revoke({
        territoryKey: MUNICIPALITY_KEY,
        actorRole: POLICY.acts.revoke,
        reason: 'قصير',
        ...s.order(POLICY.sovereignty.commands.revoke, MUNICIPALITY_KEY),
      }),
    (error) => field(error, 'code') === FEDERATION_ERRORS.REVOCATION_REASON_REQUIRED,
  );

  // والتفويضُ باقٍ نافذاً: سحبٌ مرفوضٌ لا يُنصَّف.
  assert.equal(field(await s.federation.status(MUNICIPALITY_KEY), 'state'), 'active');
});

test('التفويضُ لا يُفعَّل مرّتين ولا يُسحب مرّتين', async () => {
  const s = state();
  await delegateAll(s);

  await assert.rejects(
    () =>
      s.federation.activate({
        territoryKey: REGION_KEY,
        actorRole: KING,
        ...s.order(POLICY.sovereignty.commands.activate, REGION_KEY),
      }),
    (error) => field(error, 'code') === FEDERATION_ERRORS.ALREADY_ACTIVATED,
  );
  await s.federation.revoke({
    territoryKey: MUNICIPALITY_KEY,
    actorRole: POLICY.acts.revoke,
    reason: REASON,
    ...s.order(POLICY.sovereignty.commands.revoke, MUNICIPALITY_KEY),
  });
  await assert.rejects(
    () =>
      s.federation.revoke({
        territoryKey: MUNICIPALITY_KEY,
        actorRole: POLICY.acts.revoke,
        reason: REASON,
        ...s.order(POLICY.sovereignty.commands.revoke, MUNICIPALITY_KEY),
      }),
    (error) => field(error, 'code') === FEDERATION_ERRORS.ALREADY_REVOKED,
  );
});

test('الفرعُ لا يُفعَّل قبل أصلِه: سلسلةٌ مقطوعةٌ من أولها تُرفض', async () => {
  const s = state();
  await assert.rejects(
    () =>
      s.federation.activate({
        territoryKey: MUNICIPALITY_KEY,
        actorRole: KING,
        ...s.order(POLICY.sovereignty.commands.activate, MUNICIPALITY_KEY),
      }),
    (error) =>
      field(error, 'code') === FEDERATION_ERRORS.CHAIN_BROKEN ||
      field(error, 'code') === FEDERATION_ERRORS.NOT_ACTIVATED,
  );
  assert.equal(await s.delegations.count({}), 0);
});

test('التفويضُ والسحبُ فعلان ملكيّان: دورٌ آخرُ لا يمنحهما ولا يسحبهما', async () => {
  const s = state();
  const other = levelOf(MUNICIPALITY_KEY).exercisedBy;
  await assert.rejects(
    () =>
      s.federation.activate({
        territoryKey: REGION_KEY,
        actorRole: other,
        ...s.order(POLICY.sovereignty.commands.activate, REGION_KEY),
      }),
    (error) => field(error, 'code') === FEDERATION_ERRORS.ROLE_NOT_PERMITTED,
  );
  await delegateAll(s);
  await assert.rejects(
    () =>
      s.federation.revoke({
        territoryKey: REGION_KEY,
        actorRole: other,
        reason: REASON,
        ...s.order(POLICY.sovereignty.commands.revoke, REGION_KEY),
      }),
    (error) => field(error, 'code') === FEDERATION_ERRORS.ROLE_NOT_PERMITTED,
  );
  assert.equal(field(await s.federation.status(REGION_KEY), 'state'), 'active');
});

test('صلاحيةٌ محجوزةٌ للمركزِ لا تُفوَّض ولو أُعلنت في الوثيقة', () => {
  for (const level of POLICY.levels) {
    for (const power of level.powers) {
      assert.ok(
        !POLICY.reserved.powers.includes(power),
        `الصلاحية ${power} محجوزةٌ ومفوَّضةٌ معاً في ${level.key}`,
      );
    }
  }
  assert.ok(POLICY.reserved.powers.length >= 1);
});
