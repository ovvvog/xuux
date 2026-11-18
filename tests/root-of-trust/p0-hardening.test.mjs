import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import {
  KingIdentity,
  CertificateAuthority,
  EventLog,
  CrownGateway,
  createRoyalCommand,
  PolicyEngine,
  PersistentEventLog,
} from '../../src/root-of-trust/index.mjs';
import { readFileSync } from 'node:fs';
import { CommandLedger, EncryptedKeyStore } from '../../src/root-of-trust/index.mjs';

test('crown rejects replayed commands', () => {
  const k = new KingIdentity(),
    l = new EventLog(),
    c = new CrownGateway(k, new CertificateAuthority(k), l);
  const x = createRoyalCommand('inspect', 'agent:one'),
    s = k.sign(x);
  c.command(x, s);
  assert.throws(() => c.command(x, s), /REPLAYED_COMMAND/);
});
test('crown rejects expired commands', () => {
  const k = new KingIdentity(),
    l = new EventLog(),
    c = new CrownGateway(k, new CertificateAuthority(k), l, { maxCommandAgeMs: 1 });
  const x = {
    ...createRoyalCommand('inspect', 'agent:one'),
    issuedAt: new Date(Date.now() - 1000).toISOString(),
  };
  assert.throws(() => c.command(x, k.sign(x)), /EXPIRED_COMMAND/);
});
test('policy engine limits sensitive actions', () => {
  const p = new PolicyEngine();
  p.setRole('observer', ['action:inspect']);
  const cert = { role: 'observer' };
  assert.equal(p.authorize(cert, 'inspect'), true);
  assert.throws(() => p.authorize(cert, 'change-policy'), /POLICY_DENIED/);
});
test('persistent event log reloads and verifies', () => {
  const dir = registerTmpRoot(mkdtempSync(join(tmpdir(), 'state-log-'))),
    file = join(dir, 'events.jsonl');
  const a = new PersistentEventLog(file);
  a.append('boot', 'system', {});
  // M2.05: صار السجل يقبل كاتباً واحداً، فلا يُفتح ثانٍ قبل إغلاق الأول — وفتحُ
  // نسختين على ملف واحد كان بعينه ما يهدم السلسلة (لكل نسخة آخرُ تجزئةٍ عندها).
  assert.throws(() => new PersistentEventLog(file), /LOG_ALREADY_LOCKED/);
  a.close();
  const b = new PersistentEventLog(file);
  assert.equal(b.events.length, 1);
  assert.equal(b.verify(), true);
  b.close();
  rmSync(dir, { recursive: true, force: true });
});

// WL-560 (G1): دُمِجَ هنا حرفياً tests/root-of-trust/p0-persistence.test.mjs (‏توحيدُ الاستيرادِ فقط).
test('command ledger survives process restart', () => {
  const d = registerTmpRoot(mkdtempSync(join(tmpdir(), 'ledger-'))),
    f = join(d, 'commands.jsonl'),
    k = new KingIdentity(),
    l = new EventLog(),
    ledger = new CommandLedger(f),
    c = new CrownGateway(k, new CertificateAuthority(k), l, { commandLedger: ledger }),
    x = createRoyalCommand('inspect', 'agent:one'),
    s = k.sign(x);
  c.command(x, s);
  const after = new CrownGateway(k, c.ca, new EventLog(), { commandLedger: new CommandLedger(f) });
  assert.throws(() => after.command(x, s), /REPLAYED_COMMAND/);
  rmSync(d, { recursive: true, force: true });
});
test('encrypted key store does not store plaintext', () => {
  const d = registerTmpRoot(mkdtempSync(join(tmpdir(), 'keys-'))),
    f = join(d, 'king.key'),
    store = new EncryptedKeyStore(f, 'a-secure-master-key');
  store.save('king', 'private-key-material');
  assert.equal(store.load('king'), 'private-key-material');
  assert.notEqual(readFileSync(f, 'utf8').includes('private-key-material'), true);
  rmSync(d, { recursive: true, force: true });
});
test('crown delegates sensitive authorization to policy', () => {
  const k = new KingIdentity(),
    ca = new CertificateAuthority(k),
    policy = new PolicyEngine();
  policy.setRole('observer', ['action:inspect']);
  const cert = ca.issue('agent:one', 'observer', ['action:inspect']);
  const c = new CrownGateway(k, ca, new EventLog(), { policy });
  const x = { ...createRoyalCommand('change-policy', 'state'), certificate: cert };
  assert.throws(() => c.command(x, k.sign(x)), /POLICY_DENIED/);
});
