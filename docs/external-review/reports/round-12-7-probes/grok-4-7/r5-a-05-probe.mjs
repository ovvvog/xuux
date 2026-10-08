import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';

const REPO = '/home/user/workspace/xuux-review-284f74d0';
const identity = await import(new URL('src/root-of-trust/identity.mjs', `file://${REPO}/`).href);
const entry = (await import('node:fs')).readFileSync(`${REPO}/src/production/entrypoint.mjs`, 'utf8');
const runtime = (await import('node:fs')).readFileSync(`${REPO}/src/root-of-trust/production-runtime.mts`, 'utf8');

const wired =
  entry.includes('revocationStore: rootOfTrust.revocationStore') &&
  entry.includes('new CertificateAuthority');
const built = runtime.includes('new FileRevocationStore');
const consumed = (await import('node:fs')).readFileSync(`${REPO}/src/root-of-trust/identity.mts`, 'utf8').includes('this.revoked.isRevoked');

const pair = generateKeyPairSync('ed25519');
const king = new identity.KingIdentity(pair);
const root = mkdtempSync(join(tmpdir(), 'grok-revoc-'));
const store = new identity.FileRevocationStore(join(root, 'revoked.jsonl'), { fsync: false });
const ca = new identity.CertificateAuthority(king, {
  revocationStore: store,
  env: { NODE_ENV: 'test' },
});
const cert = ca.issue({ subject: 'agent:probe', role: 'role:agent', capabilities: ['action:read-data'] });
const before = ca.isValid(cert);
ca.revoke(cert.id, 'probe');
const after = ca.isValid(cert);
const store2 = new identity.FileRevocationStore(join(root, 'revoked.jsonl'), { fsync: false });
const ca2 = new identity.CertificateAuthority(king, { revocationStore: store2, env: { NODE_ENV: 'test' } });
const reloaded = ca2.isValid(cert);
rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify({ wired, built, consumed, before, after, reloaded, durability: store.durability }, null, 2));
