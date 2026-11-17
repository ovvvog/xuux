import test from 'node:test';
import assert from 'node:assert/strict';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import { loadCapabilityCatalog } from '../../src/identity/capability-catalog.mjs';
import { CapabilityGrantLedger } from '../../src/identity/capability-grants.mjs';
import { IncidentRegister } from '../../src/identity/incident-register.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import { isForbidden, partitionCapabilities } from '../../src/identity/capability-catalog.mjs';

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

// ── WL-550: دُمِجَ هنا `tests/identity/capability-catalog.test.mjs` حرفيّاً (‏أجسامُ الاختباراتِ ومساعداتُها كما هي؛ أُضيفت استيراداتُه الجديدةُ وحدَها) لتوفيرِ ملفٍّ تحتَ G1. ──

// الكتالوج بياناتٌ يتحقّق منها مخطَّط، فاختباره يجب أن يجرّب **بياناتٍ فاسدة**
// لا أن يقرأ الملف الصحيح ويطمئن: قيمة الطبقة الصلبة في أنها ترفض، لا في أنها
// تُحمّل. ومجلدٌ مؤقّت بلا `schemas/` يُقاس بمخطَّط المشروع نفسه (نفس قاعدة
// محمّل السياسات) كي لا يكتب الاختبار مخطَّطاً متساهلاً يُثبت به ما يشتهي.
/**
 * @param {string} body
 * @returns {string}
 */
function writeCatalog(body) {
  const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'caps-')));
  fs.writeFileSync(path.join(dir, 'capabilities.yaml'), body, 'utf8');
  return dir;
}

test('loads the shipped catalog and freezes it', () => {
  const catalog = loadCapabilityCatalog();
  assert.equal(catalog.version >= 1, true);
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(catalog.forbidden.size > 0, true, 'كتالوج بلا محرَّمات يعني السماح بكل شيء');
  assert.equal(isForbidden(catalog, 'sovereign:root'), true);
  assert.equal(isForbidden(catalog, 'action:read-registry'), false);
  for (const [id, entry] of catalog.forbidden) {
    assert.equal(entry.id, id);
    assert.equal(entry.reason.length >= 8, true, `المحرَّم ${id} بلا سبب مقروء`);
  }
  for (const [id, entry] of catalog.grantable) {
    assert.equal(entry.maxDurationSeconds > 0, true, `القدرة ${id} بلا سقف مدة`);
    assert.equal(entry.grantorRoles.size > 0, true, `القدرة ${id} بلا مانحٍ معلن`);
  }
});

test('every grantable capability names roles that exist in roles.yaml', () => {
  const catalog = loadCapabilityCatalog();
  const roles = fs.readFileSync(new URL('../../config/roles.yaml', import.meta.url), 'utf8');
  for (const entry of catalog.grantable.values()) {
    for (const role of entry.grantorRoles) {
      assert.equal(
        roles.includes(role),
        true,
        `القدرة ${entry.id} تسمّي مانحاً غير موجود في الأدوار: ${role}`,
      );
    }
  }
});

test('a missing file fails closed instead of loading an empty catalog', () => {
  const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'caps-empty-')));
  assert.throws(() => loadCapabilityCatalog({ dir }), /CAPABILITY_CONFIG_MISSING/);
});

test('schema violations are rejected with every problem named', () => {
  const dir = writeCatalog(
    ['version: 1', 'owner: crown', 'forbidden: []', 'grantable: []'].join('\n') + '\n',
  );
  assert.throws(() => loadCapabilityCatalog({ dir }), /CAPABILITY_CONFIG_INVALID/);

  const bad = writeCatalog(
    [
      'version: 1',
      'owner: crown',
      'forbidden:',
      '  - id: sovereign:root',
      '    reason: صلاحية مطلقة لا تُمنح',
      'grantable:',
      '  - id: action:read-registry',
      '    maxDurationSeconds: 0',
      '    grantorRoles: [role:king]',
      '    reason: قراءة السجل للتشخيص',
    ].join('\n') + '\n',
  );
  assert.throws(() => loadCapabilityCatalog({ dir: bad }), /CAPABILITY_CONFIG_INVALID/);
});

test('a capability declared forbidden and grantable at once is incoherent', () => {
  const dir = writeCatalog(
    [
      'version: 1',
      'owner: crown',
      'forbidden:',
      '  - id: key:export',
      '    reason: تصدير المفاتيح يُفقد جذر الثقة',
      'grantable:',
      '  - id: key:export',
      '    maxDurationSeconds: 60',
      '    grantorRoles: [role:king]',
      '    reason: محاولة فتح باب خلفي',
    ].join('\n') + '\n',
  );
  assert.throws(() => loadCapabilityCatalog({ dir }), /CAPABILITY_CATALOG_INCOHERENT/);
});

test('a role that carries a forbidden capability is incoherent', () => {
  const dir = writeCatalog(
    [
      'version: 1',
      'owner: crown',
      'forbidden:',
      '  - id: policy:self-modify',
      '    reason: تعديل السياسة على النفس ينقض الفصل',
      'grantable:',
      '  - id: action:read-memory',
      '    maxDurationSeconds: 60',
      '    grantorRoles: [role:king]',
      '    reason: قراءة الذاكرة للتشخيص',
    ].join('\n') + '\n',
  );
  fs.writeFileSync(
    path.join(dir, 'roles.yaml'),
    ['version: 1', 'roles:', '  - id: role:rogue', '    capabilities: [policy:self-modify]'].join(
      '\n',
    ) + '\n',
    'utf8',
  );
  assert.throws(() => loadCapabilityCatalog({ dir }), /CAPABILITY_CATALOG_INCOHERENT/);
});

test('unparsable yaml is named as unparsable, not as invalid', () => {
  const dir = writeCatalog('version: 1\n  owner: [crown\n');
  assert.throws(() => loadCapabilityCatalog({ dir }), /CAPABILITY_CONFIG_UNPARSABLE/);
});

test('partitionCapabilities reports every forbidden entry, not the first', () => {
  const catalog = loadCapabilityCatalog();
  const { allowed, forbidden } = partitionCapabilities(catalog, [
    'action:read-memory',
    'sovereign:root',
    'key:export',
  ]);
  assert.deepEqual(allowed, ['action:read-memory']);
  assert.deepEqual(forbidden, ['sovereign:root', 'key:export']);
});
