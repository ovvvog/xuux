// اختبار قنوات الأحداث — معيار قبول `M7.07`.
//
// المعيار المعلَن: «مُنتِج ومستهلك عبر كل قناة، مع رفض رسالة تخالف العقد».
// و«كل قناة» تُقاس هنا **عدّاً من السياسة نفسها** لا بقائمةٍ مكتوبة في الاختبار:
// قناةٌ تُضاف غداً تدخل الحلقة تلقائياً، وقائمةٌ مكتوبة كانت ستُنسى فيمرّ
// الاختبار وهو لا يقيس القناة الجديدة.

import assert from 'node:assert/strict';
import test from 'node:test';

import { loadClassificationLattice } from '../../src/data/classification.mjs';
import {
  EVENT_ERRORS,
  EVENT_GENESIS,
  EventBus,
  loadEventsPolicy,
} from '../../src/events/index.mjs';
import { EventLog } from '../../src/root-of-trust/event-log.mjs';
import { createMemoryRepositories } from '../../src/persistence/composition.mjs';

const policy = loadEventsPolicy();
const lattice = loadClassificationLattice();

/**
 * ناقلٌ نظيفٌ لكل اختبار: مستودعاتُ الذاكرة تُمحى بإعادة الإنشاء، فلا يتسرّب
 * ترقيمُ اختبارٍ إلى اختبار.
 * @returns {EventBus}
 */
function makeBus() {
  const repositories = createMemoryRepositories();
  return new EventBus({
    policy,
    lattice,
    messages: repositories.eventMessages,
    offsets: repositories.eventOffsets,
  });
}

/**
 * حِمْلٌ مُصطنعٌ من عقد النوع: كل حقلٍ إلزاميٍّ يُملأ بقيمةٍ نصّية. والعقودُ تضمن
 * **حضورَ** الحقول لا أنواعَ قيمها (حدٌّ معلَن في `docs/EVENTS.md`).
 * @param {import('../../src/events/contracts.mjs').EventTypeContract} contract
 * @returns {Record<string, unknown>}
 */
function payloadFor(contract) {
  /** @type {Record<string, unknown>} */
  const payload = {};
  for (const field of contract.required) payload[field] = `قيمة:${field}`;
  return payload;
}

/**
 * @param {import('../../src/events/contracts.mjs').EventChannel} channel
 * @returns {{ id: string, role: string, clearance: string }}
 */
function readerFor(channel) {
  return {
    id: `consumer:${channel.id}`,
    role: /** @type {string} */ (channel.consumers[0]),
    clearance: channel.classification,
  };
}

test('كل قناة معلَنة لها مُنتِجٌ ومستهلكٌ يقرأ ما نُشر فيها', async () => {
  assert.ok(policy.channels.length > 0, 'سياسةٌ بلا قنوات لا تُقاس');
  for (const channel of policy.channels) {
    const bus = makeBus();
    const producer = { id: `producer:${channel.id}`, role: channel.producers[0] ?? '' };
    assert.ok(channel.types.length > 0, `قناة «${channel.id}» بلا أنواع`);
    for (const contract of channel.types) {
      await bus.publish({ type: contract.type, actor: producer, payload: payloadFor(contract) });
    }
    const read = await bus.consume({
      channel: channel.id,
      group: 'قياس',
      consumer: readerFor(channel),
    });
    assert.equal(
      read.messages.length,
      channel.types.length,
      `قناة «${channel.id}»: نُشر ${channel.types.length} وقُرئ ${read.messages.length}`,
    );
    assert.equal(read.fromSeq, 0);
    assert.equal(read.headSeq, channel.types.length);
    // الترقيمُ يبدأ من 1 **داخل القناة**: هذا ما يجعل فحصَ قناةٍ ممكناً بلا
    // قراءة غيرها.
    assert.equal(Number(read.messages[0]?.['seq']), 1);
    assert.equal(String(read.messages[0]?.['prevHash']), EVENT_GENESIS);
    const verified = await bus.verifyChannel(channel.id);
    assert.deepEqual(verified, { ok: true, count: channel.types.length });
  }
});

test('رسالةٌ تفقد حقلاً يضمنه عقدُها تُرفض ولا تُكتب', async () => {
  const bus = makeBus();
  const contract = policy.channels
    .flatMap((channel) => channel.types)
    .find((entry) => !entry.open && entry.required.length > 0);
  assert.ok(contract !== undefined, 'لا عقدَ مغلقاً بحقولٍ إلزامية يُقاس عليه');
  const channel = /** @type {import('../../src/events/contracts.mjs').EventChannel} */ (
    policy.channelFor(contract.channel)
  );
  const payload = payloadFor(contract);
  delete payload[/** @type {string} */ (contract.required[0])];
  await assert.rejects(
    () =>
      bus.publish({
        type: contract.type,
        actor: { id: 'a', role: channel.producers[0] ?? '' },
        payload,
      }),
    (error) => /** @type {{ code: string }} */ (error).code === EVENT_ERRORS.CONTRACT_VIOLATION,
  );
  const head = await bus.head(channel.id);
  assert.equal(head.seq, 0, 'رسالةٌ مرفوضةٌ لا تُقدّم ترقيمَ القناة');
});

test('حقلٌ لا يعلنه عقدٌ مغلقٌ يُرفض، والعقدُ المفتوح يقبله', async () => {
  const bus = makeBus();
  const closed = policy.channels.flatMap((channel) => channel.types).find((entry) => !entry.open);
  const open = policy.channels.flatMap((channel) => channel.types).find((entry) => entry.open);
  assert.ok(closed !== undefined && open !== undefined);
  const closedChannel = /** @type {import('../../src/events/contracts.mjs').EventChannel} */ (
    policy.channelFor(closed.channel)
  );
  await assert.rejects(
    () =>
      bus.publish({
        type: closed.type,
        actor: { id: 'a', role: closedChannel.producers[0] ?? '' },
        payload: { ...payloadFor(closed), حقلٌ_لم_يُعلن: 1 },
      }),
    (error) => /** @type {{ code: string }} */ (error).code === EVENT_ERRORS.CONTRACT_VIOLATION,
  );
  const openChannel = /** @type {import('../../src/events/contracts.mjs').EventChannel} */ (
    policy.channelFor(open.channel)
  );
  const message = await bus.publish({
    type: open.type,
    actor: { id: 'a', role: openChannel.producers[0] ?? '' },
    payload: { ...payloadFor(open), زائدٌ: 1 },
  });
  assert.equal(String(message['type']), open.type);
});

test('نوعٌ غير معلَن يُرفض ولا يُنشر في قناةٍ مُخمَّنة', async () => {
  const bus = makeBus();
  await assert.rejects(
    () =>
      bus.publish({
        type: 'agent.نوعٌ-مخترع',
        actor: { id: 'a', role: 'role:king' },
        payload: {},
      }),
    (error) => /** @type {{ code: string }} */ (error).code === EVENT_ERRORS.TYPE_UNKNOWN,
  );
  await assert.rejects(
    () =>
      bus.publish({
        type: 'مجالٌ.لا-قناةَ-له',
        actor: { id: 'a', role: 'role:king' },
        payload: {},
      }),
    (error) => /** @type {{ code: string }} */ (error).code === EVENT_ERRORS.TYPE_UNKNOWN,
  );
});

test('حقلٌ محرَّمٌ في الحِمْل يُرفض حتى في عقدٍ مفتوح', async () => {
  const bus = makeBus();
  const open = policy.channels.flatMap((channel) => channel.types).find((entry) => entry.open);
  assert.ok(open !== undefined);
  const channel = /** @type {import('../../src/events/contracts.mjs').EventChannel} */ (
    policy.channelFor(open.channel)
  );
  await assert.rejects(
    () =>
      bus.publish({
        type: open.type,
        actor: { id: 'a', role: channel.producers[0] ?? '' },
        payload: { ...payloadFor(open), [policy.forbiddenPayloadKeys[0] ?? 'secret']: 'مادّة' },
      }),
    (error) => /** @type {{ code: string }} */ (error).code === EVENT_ERRORS.FORBIDDEN_FIELD,
  );
});

test('دورٌ ليس من منتِجي القناة يُرفض نشرُه', async () => {
  const bus = makeBus();
  const channel = policy.channels.find((entry) => entry.producers.length < 6);
  assert.ok(channel !== undefined);
  const contract = /** @type {import('../../src/events/contracts.mjs').EventTypeContract} */ (
    channel.types[0]
  );
  await assert.rejects(
    () =>
      bus.publish({
        type: contract.type,
        actor: { id: 'a', role: 'role:agent-غيرُ-منتِج' },
        payload: payloadFor(contract),
      }),
    (error) => /** @type {{ code: string }} */ (error).code === EVENT_ERRORS.PUBLISH_REFUSED,
  );
});

test('تخليصٌ لا يبلغ تصنيفَ القناة يُرفض قراءتُه', async () => {
  const bus = makeBus();
  const sovereign = policy.channels.find((entry) => entry.classification === 'sovereign');
  assert.ok(sovereign !== undefined, 'لا قناةَ سياديةً يُقاس عليها التخليص');
  await assert.rejects(
    () =>
      bus.consume({
        channel: sovereign.id,
        group: 'قياس',
        consumer: {
          id: 'c',
          role: /** @type {string} */ (sovereign.consumers[0]),
          clearance: 'internal',
        },
      }),
    (error) => /** @type {{ code: string }} */ (error).code === EVENT_ERRORS.CONSUME_REFUSED,
  );
});

test('دورٌ ليس من قُرّاء القناة يُرفض، وقناةٌ غير معلَنة كذلك', async () => {
  const bus = makeBus();
  const channel = policy.channels.find((entry) => !entry.consumers.includes('role:agent'));
  assert.ok(channel !== undefined);
  await assert.rejects(
    () =>
      bus.consume({
        channel: channel.id,
        group: 'قياس',
        consumer: { id: 'c', role: 'role:agent', clearance: 'sovereign' },
      }),
    (error) => /** @type {{ code: string }} */ (error).code === EVENT_ERRORS.CONSUME_REFUSED,
  );
  await assert.rejects(
    () =>
      bus.consume({
        channel: 'قناةٌ-لا-وجودَ-لها',
        group: 'قياس',
        consumer: { id: 'c', role: 'role:king', clearance: 'sovereign' },
      }),
    (error) => /** @type {{ code: string }} */ (error).code === EVENT_ERRORS.CONSUME_REFUSED,
  );
});

test('الموضعُ المثبَّت يُستأنف منه ولا يُعاد ما عُولج', async () => {
  const repositories = createMemoryRepositories();
  /** @returns {EventBus} */
  const make = () =>
    new EventBus({
      policy,
      lattice,
      messages: repositories.eventMessages,
      offsets: repositories.eventOffsets,
    });
  const channel = /** @type {import('../../src/events/contracts.mjs').EventChannel} */ (
    policy.channelFor('identity')
  );
  const contract = /** @type {import('../../src/events/contracts.mjs').EventTypeContract} */ (
    channel.types[0]
  );
  const bus = make();
  const producer = { id: 'p', role: /** @type {string} */ (channel.producers[0]) };
  for (let index = 0; index < 3; index += 1) {
    await bus.publish({ type: contract.type, actor: producer, payload: payloadFor(contract) });
  }
  const first = await bus.consume({
    channel: channel.id,
    group: 'مجموعةٌ',
    consumer: readerFor(channel),
    limit: 2,
  });
  assert.equal(first.messages.length, 2);
  assert.equal(first.lag, 3);
  await bus.commit({ channel: channel.id, group: 'مجموعةٌ', seq: 2 });
  // ناقلٌ جديد على نفس المستودعات = إعادةُ تشغيل: الموضعُ محفوظٌ لا في الذاكرة.
  const afterRestart = make();
  const second = await afterRestart.consume({
    channel: channel.id,
    group: 'مجموعةٌ',
    consumer: readerFor(channel),
  });
  assert.equal(second.fromSeq, 2);
  assert.equal(second.messages.length, 1);
  assert.equal(Number(second.messages[0]?.['seq']), 3);
  assert.equal(second.lag, 1);
  // مجموعةٌ أخرى موضعُها مستقل: هذا معنى «تدفّقٌ يُقرأ مرّاتٍ لا طابورٌ يُستهلك».
  const other = await afterRestart.consume({
    channel: channel.id,
    group: 'مجموعةٌ-أخرى',
    consumer: readerFor(channel),
  });
  assert.equal(other.messages.length, 3);
});

test('تراجعُ الموضع وتثبيتُه فوق الرأس مرفوضان', async () => {
  const bus = makeBus();
  const channel = /** @type {import('../../src/events/contracts.mjs').EventChannel} */ (
    policy.channelFor('identity')
  );
  const contract = /** @type {import('../../src/events/contracts.mjs').EventTypeContract} */ (
    channel.types[0]
  );
  await bus.publish({
    type: contract.type,
    actor: { id: 'p', role: /** @type {string} */ (channel.producers[0]) },
    payload: payloadFor(contract),
  });
  await assert.rejects(
    () => bus.commit({ channel: channel.id, group: 'g', seq: 9 }),
    (error) => /** @type {{ code: string }} */ (error).code === EVENT_ERRORS.OFFSET_INVALID,
  );
  await bus.commit({ channel: channel.id, group: 'g', seq: 1 });
  await assert.rejects(
    () => bus.commit({ channel: channel.id, group: 'g', seq: 0 }),
    (error) => /** @type {{ code: string }} */ (error).code === EVENT_ERRORS.OFFSET_INVALID,
  );
});

test('تعديلُ رسالةٍ في المخزن يُكشف بفحص السلسلة', async () => {
  const repositories = createMemoryRepositories();
  const bus = new EventBus({
    policy,
    lattice,
    messages: repositories.eventMessages,
    offsets: repositories.eventOffsets,
  });
  const channel = /** @type {import('../../src/events/contracts.mjs').EventChannel} */ (
    policy.channelFor('identity')
  );
  const contract = /** @type {import('../../src/events/contracts.mjs').EventTypeContract} */ (
    channel.types[0]
  );
  const producer = { id: 'p', role: /** @type {string} */ (channel.producers[0]) };
  const first = await bus.publish({
    type: contract.type,
    actor: producer,
    payload: payloadFor(contract),
  });
  await bus.publish({ type: contract.type, actor: producer, payload: payloadFor(contract) });
  assert.equal((await bus.verifyChannel(channel.id)).ok, true);
  await repositories.eventMessages.update(String(first['id']), Number(first['version']), {
    actorId: 'فاعلٌ-بُدِّل',
  });
  const verified = await bus.verifyChannel(channel.id);
  assert.equal(verified.ok, false);
  assert.equal(verified.at, 1);
  assert.match(String(verified.fault), /تجزئة/);
});

test('النقلُ يحمل أحداثاً حقيقيةً من سجل جذر الثقة إلى قنواتها ويحفظ موضعَه', async () => {
  const repositories = createMemoryRepositories();
  const bus = new EventBus({
    policy,
    lattice,
    messages: repositories.eventMessages,
    offsets: repositories.eventOffsets,
  });
  const log = new EventLog();
  // أنواعٌ حقيقيةٌ من ثلاث قنواتٍ بتصنيفاتٍ مختلفة، بحمولاتٍ من عقودها.
  for (const type of ['identity.capability.stripped', 'law.enacted', 'crown.command.accepted']) {
    const contract = policy.contractFor(type);
    assert.ok(contract !== null, `النوع «${type}» غير معلَن`);
    log.append(type, 'crown', payloadFor(contract));
  }
  const relayer = { id: 'relay:1', role: /** @type {string} */ (policy.relayRoles[0]) };
  const report = await bus.relay({ events: log.snapshot(), actor: relayer });
  assert.equal(report.relayed, 3);
  assert.equal(report.fault, null);
  assert.equal(report.stoppedAt, null);
  assert.deepEqual(Object.keys(report.perChannel).sort(), ['crown', 'identity', 'law']);
  // الفاعلُ الأصلي محفوظٌ منفصلاً عن الناقل: نسبُ الفعل لا يُبدَّل بالنقل.
  const crown = await bus.entries('crown');
  assert.equal(String(crown[0]?.['authorId']), 'crown');
  assert.equal(String(crown[0]?.['actorId']), 'relay:1');
  assert.equal(crown[0]?.['relayed'], true);
  // النقلُ لا يُعيد ما نُقل: الموضعُ محفوظٌ في المستودع.
  const again = await bus.relay({ events: log.snapshot(), actor: relayer });
  assert.equal(again.relayed, 0);
  assert.equal(again.fromSeq, 3);
  assert.equal((await bus.verifyAll()).ok, true);
});

test('النقلُ يتوقّف مغلقاً عند أول حدثٍ يخالف عقده ولا يتجاوزه', async () => {
  const bus = makeBus();
  const log = new EventLog();
  const contract = /** @type {import('../../src/events/contracts.mjs').EventTypeContract} */ (
    policy.contractFor('identity.capability.stripped')
  );
  log.append('identity.capability.stripped', 'crown', payloadFor(contract));
  log.append('identity.نوعٌ-مخترع', 'crown', {});
  log.append('identity.capability.stripped', 'crown', payloadFor(contract));
  const report = await bus.relay({
    events: log.snapshot(),
    actor: { id: 'relay:1', role: /** @type {string} */ (policy.relayRoles[0]) },
  });
  assert.equal(report.relayed, 1);
  assert.equal(report.stoppedAt, 2);
  assert.equal(report.fault, EVENT_ERRORS.TYPE_UNKNOWN);
  assert.equal(report.toSeq, 1, 'الموضعُ لا يتجاوز آخرَ ما نُقل فعلاً');
});

test('دورٌ ليس من أدوار النقل يُرفض نقلُه', async () => {
  const bus = makeBus();
  await assert.rejects(
    () => bus.relay({ events: [], actor: { id: 'x', role: 'role:agent' } }),
    (error) => /** @type {{ code: string }} */ (error).code === EVENT_ERRORS.PUBLISH_REFUSED,
  );
});
