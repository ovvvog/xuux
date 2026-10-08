// Probe for UF-01/03/07, M11.04-F07, R3-A-01, R4-K3-01 on commit 284f74d0.
// Writes only under /tmp. Imports the review tree; does not modify it.
import { Buffer } from 'node:buffer';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  sign as softwareSign,
} from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = '/home/user/workspace/xuux-review-284f74d0';
const {
  SEAL_IV_BYTES,
  createProductionRootOfTrust,
  fingerprint,
  InMemoryFreshnessSocket,
} = await import(new URL('src/root-of-trust/index.mjs', `file://${REPO}/`).href);
const { registerTestKing, royalCommandFor, royalKeyEnv } = await import(
  new URL('tests/helpers/royal-halt-command.mjs', `file://${REPO}/`).href
);

const MANIFEST = 'root-of-trust.manifest.json';
const ROYAL_KEY = royalKeyEnv();

function stableToken(king, aeadKey, ledgerPair) {
  const aad = Buffer.from('xuux-event');
  const ed = new Map([
    ['06', king],
    ['07', ledgerPair],
  ]);
  return {
    describe: () => ({ kind: 'pkcs11-hsm', canExport: false, tokenSerial: 'DEADBEEFCAFE0001' }),
    getAeadKey: async (keyId) => {
      if (keyId !== '05') throw new Error('KEY_NOT_FOUND');
      return {
        keyId,
        encrypt: async (plaintext) => {
          const iv = randomBytes(SEAL_IV_BYTES);
          const cipher = createCipheriv('aes-256-gcm', aeadKey, iv);
          cipher.setAAD(aad);
          const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
          return { ciphertext, iv, tag: cipher.getAuthTag() };
        },
        decrypt: async (ciphertext, iv, tag) => {
          const decipher = createDecipheriv('aes-256-gcm', aeadKey, iv);
          decipher.setAAD(aad);
          decipher.setAuthTag(tag);
          return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        },
      };
    },
    getSigningKey: async (keyId) => {
      const pair = ed.get(keyId);
      if (!pair) throw new Error('KEY_NOT_FOUND');
      return {
        keyId,
        sign: async (message) => softwareSign(null, message, pair.privateKey),
        exportPublicPem: async () => pair.publicKey.export({ type: 'spki', format: 'pem' }),
      };
    },
  };
}

function makeEnv(king) {
  return {
    NODE_ENV: 'production',
    STATE_ENV: 'production',
    XUUX_ROOT_OF_TRUST_MODE: 'hsm',
    XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
    XUUX_PKCS11_TOKEN: 'xuux-test',
    XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
    XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
    XUUX_PKCS11_PIN: 'unused-by-injected-source',
    XUUX_KING_ID: 'king:' + fingerprint(king.publicKey).slice(0, 24),
    ...ROYAL_KEY.env,
    XUUX_ROOT_OF_TRUST_PROVISION: '1',
  };
}

function openSource(king, aeadKey, ledgerPair) {
  return {
    openSource: async () => ({
      source: stableToken(king, aeadKey, ledgerPair),
      close: async () => undefined,
    }),
  };
}

function bodyOf(root) {
  return JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')).body;
}

async function advance(rt) {
  const command = { id: 'repeat-me' };
  await rt.ledger.beginAsync(command);
  await rt.ledger.commitSigned(command, 'تمّ');
  const directive = await rt.haltSwitch.haltAsync(
    'إيقافٌ سياديّ',
    royalCommandFor(rt.haltSwitch, 'halt', 'إيقافٌ سياديّ'),
  );
  return directive;
}

function codeOf(err) {
  return err?.code ?? err?.message ?? String(err);
}

const results = [];
function record(name, detail) {
  results.push({ name, detail });
  console.log(`[${name}] ${detail}`);
}

async function scenarioNoSocket() {
  const king = registerTestKing(generateKeyPairSync('ed25519'));
  const aeadKey = randomBytes(32);
  const ledgerPair = registerTestKing(generateKeyPairSync('ed25519'));
  const env = makeEnv(king);
  const root = mkdtempSync(join(tmpdir(), 'grok-nosock-'));
  try {
    const rt = await createProductionRootOfTrust(env, { root, fsync: false }, openSource(king, aeadKey, ledgerPair));
    rt.log.close?.();
    record('no-socket-first-boot', 'BOOT_OK unexpected');
  } catch (err) {
    record('no-socket-first-boot', `REJECT ${codeOf(err)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function scenarioSharedSocketRollback() {
  const king = registerTestKing(generateKeyPairSync('ed25519'));
  const aeadKey = randomBytes(32);
  const ledgerPair = registerTestKing(generateKeyPairSync('ed25519'));
  const env = makeEnv(king);
  const socket = new InMemoryFreshnessSocket(0n, 'shared');
  const root = mkdtempSync(join(tmpdir(), 'grok-shared-'));
  const snap = mkdtempSync(join(tmpdir(), 'grok-shared-snap-'));
  const boot = (r) =>
    createProductionRootOfTrust(env, { root: r, fsync: false, freshnessSocket: socket }, openSource(king, aeadKey, ledgerPair));
  try {
    const first = await boot(root);
    first.log.close?.();
    rmSync(snap, { recursive: true, force: true });
    cpSync(root, snap, { recursive: true });
    const snapEpoch = bodyOf(root).freshnessEpoch;
    const second = await boot(root);
    const directive = await advance(second);
    const advanced = bodyOf(root);
    second.log.close?.();
    rmSync(root, { recursive: true, force: true });
    cpSync(snap, root, { recursive: true });
    try {
      const third = await boot(root);
      const halt = third.haltSwitch.read();
      let replay = 'NOT_TRIED';
      try {
        await third.ledger.beginAsync({ id: 'repeat-me' });
        await third.ledger.commitSigned({ id: 'repeat-me' }, 'إعادة');
        replay = 'ACCEPTED_NO_THROW';
      } catch (err) {
        replay = `THROWN:${codeOf(err)}`;
      }
      third.log.close?.();
      record(
        'shared-socket-full-snapshot',
        `BOOT_OK halt=${halt.state}/epoch=${halt.epoch} snapEpoch=${snapEpoch} advancedEpoch=${advanced.freshnessEpoch} seq ${advanced.sequence}→${bodyOf(root).sequence} replay=${replay} priorHalt=${directive.state}`,
      );
    } catch (err) {
      record('shared-socket-full-snapshot', `REJECT ${codeOf(err)} snapEpoch=${snapEpoch} advancedFresh=${advanced.freshnessEpoch} haltWas=${directive.state}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(snap, { recursive: true, force: true });
  }
}

async function scenarioRestartSocketMatchesSnapshot() {
  // Disk owner restores a consistent snapshot AND a freshness counter that lives
  // with the process and is reset to the snapshot epoch (no durable external reference).
  const king = registerTestKing(generateKeyPairSync('ed25519'));
  const aeadKey = randomBytes(32);
  const ledgerPair = registerTestKing(generateKeyPairSync('ed25519'));
  const env = makeEnv(king);
  const root = mkdtempSync(join(tmpdir(), 'grok-rewind-'));
  const snap = mkdtempSync(join(tmpdir(), 'grok-rewind-snap-'));
  let snapEpoch = 0;
  const bootWith = (epoch) => {
    const socket = new InMemoryFreshnessSocket(BigInt(epoch), 'rewind');
    return createProductionRootOfTrust(
      env,
      { root, fsync: false, freshnessSocket: socket },
      openSource(king, aeadKey, ledgerPair),
    );
  };
  try {
    const first = await bootWith(0);
    first.log.close?.();
    snapEpoch = bodyOf(root).freshnessEpoch;
    rmSync(snap, { recursive: true, force: true });
    cpSync(root, snap, { recursive: true });
    const second = await bootWith(snapEpoch);
    const directive = await advance(second);
    const advanced = bodyOf(root);
    second.log.close?.();
    rmSync(root, { recursive: true, force: true });
    cpSync(snap, root, { recursive: true });
    try {
      const third = await bootWith(snapEpoch);
      const halt = third.haltSwitch.read();
      let replay = 'NOT_TRIED';
      try {
        await third.ledger.beginAsync({ id: 'repeat-me' });
        await third.ledger.commitSigned({ id: 'repeat-me' }, 'إعادة');
        replay = 'ACCEPTED_NO_THROW';
      } catch (err) {
        replay = `THROWN:${codeOf(err)}`;
      }
      const after = bodyOf(root);
      third.log.close?.();
      record(
        'rewound-socket-full-snapshot',
        `BOOT_OK halt=${halt.state}/epoch=${halt.epoch} snapFresh=${snapEpoch} advancedFresh=${advanced.freshnessEpoch} seq ${advanced.sequence}→${after.sequence} ledger ${advanced.ledgerCommitted}→${after.ledgerCommitted} replay=${replay} priorHalt=${directive.state}`,
      );
    } catch (err) {
      record('rewound-socket-full-snapshot', `REJECT ${codeOf(err)}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(snap, { recursive: true, force: true });
  }
}

async function scenarioFreshSocketOnAdvancedDisk() {
  const king = registerTestKing(generateKeyPairSync('ed25519'));
  const aeadKey = randomBytes(32);
  const ledgerPair = registerTestKing(generateKeyPairSync('ed25519'));
  const env = makeEnv(king);
  const root = mkdtempSync(join(tmpdir(), 'grok-fresh-'));
  try {
    const first = await createProductionRootOfTrust(
      env,
      { root, fsync: false, freshnessSocket: new InMemoryFreshnessSocket(0n, 'a') },
      openSource(king, aeadKey, ledgerPair),
    );
    await advance(first);
    const sealed = bodyOf(root).freshnessEpoch;
    first.log.close?.();
    try {
      const second = await createProductionRootOfTrust(
        env,
        { root, fsync: false, freshnessSocket: new InMemoryFreshnessSocket(0n, 'b') },
        openSource(king, aeadKey, ledgerPair),
      );
      second.log.close?.();
      record('fresh-socket-on-advanced-disk', `BOOT_OK sealedFresh=${sealed}`);
    } catch (err) {
      record('fresh-socket-on-advanced-disk', `REJECT ${codeOf(err)} sealedFresh=${sealed}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function scenarioPartialLower() {
  const king = registerTestKing(generateKeyPairSync('ed25519'));
  const aeadKey = randomBytes(32);
  const ledgerPair = registerTestKing(generateKeyPairSync('ed25519'));
  const env = makeEnv(king);
  const socket = new InMemoryFreshnessSocket(0n, 'partial');
  const root = mkdtempSync(join(tmpdir(), 'grok-partial-'));
  const boot = () =>
    createProductionRootOfTrust(env, { root, fsync: false, freshnessSocket: socket }, openSource(king, aeadKey, ledgerPair));
  try {
    const first = await boot();
    await advance(first);
    first.log.close?.();
    const raw = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'));
    raw.body.anchoredCount = 0;
    raw.body.haltEpoch = 0;
    raw.body.ledgerCommitted = 0;
    writeFileSync(join(root, MANIFEST), JSON.stringify(raw));
    try {
      const second = await boot();
      second.log.close?.();
      record('partial-lower-counters', 'BOOT_OK unexpected');
    } catch (err) {
      record('partial-lower-counters', `REJECT ${codeOf(err)}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await scenarioNoSocket();
await scenarioSharedSocketRollback();
await scenarioRestartSocketMatchesSnapshot();
await scenarioFreshSocketOnAdvancedDisk();
await scenarioPartialLower();
console.log('---DONE---');
for (const r of results) console.log(`${r.name}\t${r.detail}`);
