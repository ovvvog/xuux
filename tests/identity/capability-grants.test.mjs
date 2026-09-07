import test from 'node:test';
import assert from 'node:assert/strict';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import { loadCapabilityCatalog } from '../../src/identity/capability-catalog.mjs';
import { CapabilityGrantLedger } from '../../src/identity/capability-grants.mjs';
import { IncidentRegister } from '../../src/identity/incident-register.mjs';

// الساعة تُمرَّر ولا تُقرأ من النظام: اختبارُ انتهاء مدة بـ`setTimeout` يقيس
// المُجدوِل لا القاعدة، ويصير بطيئاً ومتقلّباً. فالزمن هنا متغيّرٌ نُقدّمه.
function setup() {
  let nowMs = Date.UTC(2026, 7, 24, 9, 0, 0);
  const log = new EventLog();
  const incidents = new IncidentRegister({ log, now: () => new Date(nowMs) });
  const ledger = new CapabilityGrantLedger({
    catalog: loadCapabilityCatalog(),
    log,
    incidents,
    now: () => new Date(nowMs),
  });
  return {
    ledger,
    log,
    incidents,
    advance: (/** @type {number} */ seconds) => (nowMs += seconds * 1000),
  };
}

const base = {
  agentId: 'agent:worker',
  capability: 'action:read-registry',
  reason: 'تدقيق حادثة رقم 7',
  principal: { id: 'agent:minister', role: 'role:minister', state: 'active' },
  ttlSeconds: 3600,
};

test('a grant carries capability, reason, grantor and an expiry', () => {
  const { ledger } = setup();
  const grant = ledger.grant(base);
  assert.equal(grant.capability, 'action:read-registry');
  assert.equal(grant.reason, 'تدقيق حادثة رقم 7');
  assert.equal(grant.grantedBy, 'agent:minister');
  assert.equal(
    Date.parse(grant.expiresAt) - Date.parse(grant.grantedAt),
    3600 * 1000,
    'المدة المسجَّلة يجب أن تطابق المدة المطلوبة بالثانية',
  );
  assert.deepEqual([...ledger.capabilitiesOf('agent:worker')], ['action:read-registry']);
});

test('expiry drops the capability with no intervention at all', () => {
  const { ledger, advance } = setup();
  ledger.grant({ ...base, ttlSeconds: 60 });
  assert.equal(ledger.capabilitiesOf('agent:worker').size, 1);
  advance(59);
  assert.equal(ledger.capabilitiesOf('agent:worker').size, 1, 'قبل الانتهاء تبقى القدرة');
  advance(2);
  assert.equal(
    ledger.capabilitiesOf('agent:worker').size,
    0,
    'انتهاء المدة يُسقط القدرة بلا حاصدٍ ولا تنظيف',
  );
  // والتنظيف بعد ذلك تفريغُ ذاكرة لا إنفاذ سياسة: النتيجة نفسها قبله وبعده.
  assert.equal(ledger.prune(), 1);
  assert.equal(ledger.capabilitiesOf('agent:worker').size, 0);
});

test('a forbidden capability is rejected and logged as an incident', () => {
  const { ledger, incidents, log } = setup();
  assert.throws(
    () => ledger.grant({ ...base, capability: 'sovereign:root' }),
    /FORBIDDEN_CAPABILITY/,
  );
  const opened = incidents.list({ type: 'forbidden-capability', state: 'open' });
  assert.equal(opened.length, 1, 'محاولة منح محرَّم تُفتح بها حادثة، لا تُرفض بصمت');
  const incident = opened[0];
  assert.ok(incident);
  assert.equal(incident.subject, 'agent:minister');
  assert.equal(incident.severity, 'critical');
  assert.equal(incident.detail['capability'], 'sovereign:root');
  assert.equal(
    log.events.some((e) => e.type === 'capability.grant.forbidden'),
    true,
  );
  assert.equal(ledger.capabilitiesOf('agent:worker').size, 0);
});

test('a capability outside the catalog cannot be granted at all', () => {
  const { ledger } = setup();
  assert.throws(
    () => ledger.grant({ ...base, capability: 'action:invent-power' }),
    /CAPABILITY_NOT_GRANTABLE/,
  );
});

test('the duration ceiling comes from data, not from the caller', () => {
  const { ledger } = setup();
  // سقف `action:external-egress` ساعةٌ واحدة في `config/capabilities.yaml`.
  assert.throws(
    () =>
      ledger.grant({
        ...base,
        capability: 'action:external-egress',
        principal: { id: 'agent:king', role: 'role:king', state: 'active' },
        ttlSeconds: 3601,
      }),
    /CAPABILITY_GRANT_TTL_ABOVE_MAX/,
  );
  assert.throws(() => ledger.grant({ ...base, ttlSeconds: 0 }), /CAPABILITY_GRANT_TTL_INVALID/);
  assert.throws(() => ledger.grant({ ...base, ttlSeconds: 1.5 }), /CAPABILITY_GRANT_TTL_INVALID/);
});

test('an unlisted grantor role grants nothing, however senior', () => {
  const { ledger } = setup();
  assert.throws(
    () =>
      ledger.grant({
        ...base,
        principal: { id: 'agent:operator', role: 'role:operator', state: 'active' },
      }),
    /CAPABILITY_GRANTOR_NOT_AUTHORIZED/,
  );
  assert.throws(
    () =>
      ledger.grant({
        ...base,
        capability: 'action:external-egress',
        principal: { id: 'agent:operator', role: 'role:operator', state: 'active' },
        ttlSeconds: 60,
      }),
    /CAPABILITY_GRANTOR_NOT_AUTHORIZED/,
  );
});

test('nobody grants themselves a capability', () => {
  const { ledger } = setup();
  assert.throws(
    () =>
      ledger.grant({
        ...base,
        principal: { id: 'agent:worker', role: 'role:minister', state: 'active' },
      }),
    /CAPABILITY_SELF_GRANT_FORBIDDEN/,
  );
});

test('every contract field is mandatory', () => {
  const { ledger } = setup();
  for (const field of ['agentId', 'capability', 'reason']) {
    assert.throws(
      () => ledger.grant({ ...base, [field]: '   ' }),
      new RegExp(`CAPABILITY_GRANT_FIELD_MISSING: ${field}`),
      `الحقل ${field} يجب أن يكون إلزامياً`,
    );
  }
});

test('GPT-F04: لا منحَ بلا مانحٍ موثَّق — الفشلُ مغلقٌ', () => {
  const { ledger } = setup();
  // ادّعاءُ المانحِ من الطالبِ غيرُ مقبولٍ بعدَ الآن.
  assert.throws(
    () =>
      ledger.grant({
        agentId: 'agent:worker',
        capability: 'action:read-registry',
        reason: 'سببٌ',
        grantedBy: 'agent:not-registered',
        grantorRole: 'role:minister',
        ttlSeconds: 3600,
      }),
    /CAPABILITY_GRANTOR_UNVERIFIED/,
    'لا منحَ بلا principal موثَّق — فانتحالُ المانحِ مُغلقٌ.',
  );
  assert.equal(ledger.capabilitiesOf('agent:worker').size, 0);
});

test('GPT-F04: مانحٌ موقوفٌ لا يمنحُ', () => {
  const { ledger } = setup();
  assert.throws(
    () =>
      ledger.grant({
        ...base,
        principal: { id: 'agent:minister', role: 'role:minister', state: 'suspended' },
      }),
    /CAPABILITY_GRANTOR_NOT_ACTIVE/,
    'المانحُ الموقوفُ لا تنفذُ منحُه.',
  );
});

test('GPT-F04: انتحالُ دورٍ أرفعَ يُرفضُ صراحةً', () => {
  const { ledger } = setup();
  // مشغّلٌ يمرّرُ principal موثَّقاً لكنّه يدّعي دورَ وزيرٍ مختلفًا.
  assert.throws(
    () =>
      ledger.grant({
        ...base,
        principal: { id: 'agent:operator', role: 'role:operator', state: 'active' },
        grantorRole: 'role:minister',
      }),
    /CAPABILITY_GRANTOR_MISMATCH/,
    'ادّعاءُ دورٍ مختلفٍ عمّا ثبتَ في المانحِ يُرفضُ — فلا انتحالَ.',
  );
});

test('GPT-F04: مانحٌ موثَّقٌ صحيحٌ يمنحُ', () => {
  const { ledger } = setup();
  const grant = ledger.grant(base);
  assert.equal(grant.grantedBy, 'agent:minister');
  assert.equal(grant.grantorRole, 'role:minister');
  assert.deepEqual([...ledger.capabilitiesOf('agent:worker')], ['action:read-registry']);
});

test('revocation is immediate and needs a recorded reason', () => {
  const { ledger, log } = setup();
  const grant = ledger.grant(base);
  assert.throws(() => ledger.revoke(grant.id, ''), /CAPABILITY_REVOKE_REASON_REQUIRED/);
  assert.throws(() => ledger.revoke('grant:none', 'x'), /CAPABILITY_GRANT_NOT_FOUND/);
  const revoked = ledger.revoke(grant.id, 'انتهت المهمة قبل موعدها');
  assert.equal(revoked.revokedReason, 'انتهت المهمة قبل موعدها');
  assert.equal(ledger.capabilitiesOf('agent:worker').size, 0);
  assert.equal(
    log.events.some((e) => e.type === 'capability.revoked'),
    true,
  );
});

test('revoking an agent sweeps all of its grants at once', () => {
  const { ledger } = setup();
  ledger.grant(base);
  ledger.grant({ ...base, capability: 'action:write-memory', ttlSeconds: 600 });
  ledger.grant({ ...base, agentId: 'agent:other' });
  assert.equal(ledger.revokeAllFor('agent:worker', 'إلغاء الهوية'), 2);
  assert.equal(ledger.capabilitiesOf('agent:worker').size, 0);
  assert.equal(ledger.capabilitiesOf('agent:other').size, 1, 'الكنس لا يتعدّى صاحبه');
});

test('the ledger refuses to exist without a catalog and a log', () => {
  assert.throws(() => new CapabilityGrantLedger({}), /CAPABILITY_LEDGER_DEPENDENCY_MISSING/);
});
