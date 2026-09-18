import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
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
  CommandLedger,
  EncryptedKeyStore,
} from '../../src/root-of-trust/index.mjs';

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
