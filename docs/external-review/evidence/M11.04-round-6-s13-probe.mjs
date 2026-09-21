// مجسّاتُ S13 وضوابطُها — خارجَ المستودعِ، على مُخرَجِ بناءِ `main@1648d450`.
// لا تكتبُ في المستودعِ ولا تعدِّلُ ملفَّه. تنظِّفُ ما تُنشئه.
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
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SEAL_IV_BYTES,
  createProductionRootOfTrust,
  fingerprint,
} from '/home/user/workspace/xuux/src/root-of-trust/index.mjs';

const REPO = '/home/user/workspace/xuux';
const MANIFEST = 'root-of-trust.manifest.json';
const JOURNAL = 'root-of-trust.manifest.journal';
const LEDGER = 'commands.ledger';
const CLAIMS = 'commands.ledger.claims';
const EVENTS = 'events.log';
const EVENTS_HEAD = 'events.log.head';

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

function rig() {
  const king = generateKeyPairSync('ed25519');
  const aeadKey = randomBytes(32);
  const ledgerPair = generateKeyPairSync('ed25519');
  const env = {
    NODE_ENV: 'production',
    XUUX_ROOT_OF_TRUST_MODE: 'hsm',
    XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
    XUUX_PKCS11_TOKEN: 'xuux-test',
    XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
    XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
    XUUX_PKCS11_PIN: 'unused-by-injected-source', // secret-scan:allow
    XUUX_KING_ID: 'king:' + fingerprint(king.publicKey).slice(0, 24),
    XUUX_ROOT_OF_TRUST_PROVISION: '1',
  };
  const boot = (root) =>
    createProductionRootOfTrust(
      env,
      { root, fsync: false, royalCommandVerifier: () => true },
      {
        openSource: async () => ({
          source: stableToken(king, aeadKey, ledgerPair),
          close: async () => undefined,
        }),
      },
    );
  return { boot, body: (root) => JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')).body };
}

const results = [];
function record(name, verdict, detail) {
  results.push({ name, verdict, detail });
  console.log(`[${verdict}] ${name} :: ${detail}`);
}

async function driveToHaltedState(boot, body, root, commandId) {
  const rt = await boot(root);
  rt.ledger.begin({ id: commandId });
  await rt.ledger.commitSigned({ id: commandId }, 'تمّ');
  const directive = await rt.haltSwitch.haltAsync('إيقافٌ سياديّ', { id: 'test-cmd' });
  rt.log.close?.();
  return { directive, body: body(root) };
}

// ————————————————————————————————————————————————
// S13: بيانٌ أقدمُ صحيحُ الخاتَمِ + محوُ السجلِّ + دفترٌ يُستحدَثُ فارغاً
// ————————————————————————————————————————————————
async function s13() {
  const { boot, body } = rig();
  const root = mkdtempSync(join(tmpdir(), 's13-probe-'));
  try {
    const first = await boot(root);
    first.log.close?.();
    const genesisManifest = readFileSync(join(root, MANIFEST)); // بيانٌ مختومٌ أقدمُ
    const genesisBody = body(root);

    const second = await boot(root);
    second.log.close?.();
    const before = body(root);
    const driven = await driveToHaltedState(boot, body, root, 'repeat-me');
    const advanced = driven.body;
    const okHalt =
      driven.directive.state === 'halted' &&
      advanced.haltEpoch >= 1 &&
      advanced.ledgerCommitted >= 1;
    if (!okHalt) throw new Error('precondition failed: halt/ledger state not established');

    // الخصمُ: يستعيدُ البيانَ الأقدمَ، يمحو السجلَّ ورأسَه ودفترَ الرفعِ،
    // ويُنشئُ دفتراً فارغاً ومجلَّدَ حجوزاتٍ فارغاً.
    writeFileSync(join(root, MANIFEST), genesisManifest);
    rmSync(join(root, JOURNAL), { force: true });
    rmSync(join(root, EVENTS), { force: true });
    rmSync(join(root, EVENTS_HEAD), { force: true });
    rmSync(join(root, LEDGER), { force: true });
    rmSync(join(root, CLAIMS), { recursive: true, force: true });
    mkdirSync(join(root, CLAIMS), { recursive: true });
    writeFileSync(join(root, LEDGER), '', 'utf8');

    let third = null;
    try {
      third = await boot(root);
    } catch (err) {
      record('S13', 'BLOCKED', `الإقلاعُ رُفِضَ: ${err.code ?? err.message}`);
      third?.log?.close?.();
      return;
    }
    try {
      const b = body(root);
      const haltState = third.haltSwitch.read();
      let replay = 'REJECTED';
      try {
        third.ledger.begin({ id: 'repeat-me' });
        await third.ledger.commitSigned({ id: 'repeat-me' }, 'إعادةُ تنفيذٍ');
        replay = 'ACCEPTED_NO_THROW';
      } catch (err) {
        replay = `THROWN:${err.code ?? err.message}`;
      }
      const detail =
        `BOOT_OK; halt=${haltState.state}/epoch=${String(haltState.epoch)}; ` +
        `seq ${String(advanced.sequence)}→${String(b.sequence)}; ` +
        `ledgerCommitted ${String(advanced.ledgerCommitted)}→${String(b.ledgerCommitted)}; ` +
        `replay=${replay}`;
      const viable =
        haltState.state === 'running' &&
        haltState.epoch === 0 &&
        b.sequence < advanced.sequence &&
        b.ledgerCommitted === 0 &&
        replay === 'ACCEPTED_NO_THROW';
      record('S13', viable ? 'VIABLE' : 'BLOCKED', detail);
    } finally {
      third.log.close?.();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ————————————————————————————————————————————————
// S13b: بيانٌ أقدمُ + محوُ السجلِّ + دفترٌ فارغٌ + محوُ halt/ كاملٌ
// (الوصفةُ الكاملةُ في تقريرِ التدقيقِ: halted/عهد 1 ⟶ running/عهد 0)
// ————————————————————————————————————————————————
async function s13b() {
  const { boot, body } = rig();
  const root = mkdtempSync(join(tmpdir(), 's13b-probe-'));
  try {
    const first = await boot(root);
    first.log.close?.();
    const genesisManifest = readFileSync(join(root, MANIFEST));

    const driven = await driveToHaltedState(boot, body, root, 'repeat-me');
    const advanced = driven.body;
    if (driven.directive.state !== 'halted') throw new Error('precondition failed');

    // الخصمُ: كلُّ الشهودِ خارجَ البيانِ تُمحى.
    writeFileSync(join(root, MANIFEST), genesisManifest);
    rmSync(join(root, JOURNAL), { force: true });
    rmSync(join(root, EVENTS), { force: true });
    rmSync(join(root, EVENTS_HEAD), { force: true });
    rmSync(join(root, LEDGER), { force: true });
    rmSync(join(root, CLAIMS), { recursive: true, force: true });
    rmSync(join(root, 'halt'), { recursive: true, force: true });
    mkdirSync(join(root, CLAIMS), { recursive: true });
    writeFileSync(join(root, LEDGER), '', 'utf8');

    let third = null;
    try {
      third = await boot(root);
    } catch (err) {
      record('S13b-full-wipe', 'BLOCKED', `الإقلاعُ رُفِضَ: ${err.code ?? err.message}`);
      third?.log?.close?.();
      return;
    }
    try {
      const b = body(root);
      const haltState = third.haltSwitch.read();
      let replay = 'REJECTED';
      try {
        third.ledger.begin({ id: 'repeat-me' });
        await third.ledger.commitSigned({ id: 'repeat-me' }, 'إعادةُ تنفيذٍ');
        replay = 'ACCEPTED_NO_THROW';
      } catch (err) {
        replay = `THROWN:${err.code ?? err.message}`;
      }
      const detail =
        `BOOT_OK; halt=${haltState.state}/epoch=${String(haltState.epoch)}; ` +
        `seq ${String(advanced.sequence)}→${String(b.sequence)}; ` +
        `ledgerCommitted ${String(advanced.ledgerCommitted)}→${String(b.ledgerCommitted)}; ` +
        `replay=${replay}`;
      const viable =
        haltState.state === 'running' &&
        haltState.epoch === 0 &&
        b.sequence < advanced.sequence &&
        b.ledgerCommitted === 0 &&
        replay === 'ACCEPTED_NO_THROW';
      record('S13b-full-wipe', viable ? 'VIABLE' : 'NOT-AS-DESCRIBED', detail);
    } finally {
      third.log.close?.();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ————————————————————————————————————————————————
// الضابطُ C1: بيانٌ **حاليٌّ** + تفريغُ الدفترِ (السجلُّ باقٍ)
// ————————————————————————————————————————————————
async function controlC1() {
  const { boot, body } = rig();
  const root = mkdtempSync(join(tmpdir(), 's13-c1-'));
  try {
    const first = await boot(root);
    first.log.close?.();
    await driveToHaltedState(boot, body, root, 'repeat-me');
    // الخصمُ: يُفرِّغُ الدفترَ فقط. البيانُ والسجلُّ باقيان.
    rmSync(join(root, LEDGER), { force: true });
    writeFileSync(join(root, LEDGER), '', 'utf8');
    try {
      const third = await boot(root);
      third.log.close?.();
      record('C1-current-manifest-empty-ledger', 'UNEXPECTED-BOOT', 'أقلعَ بلا رفضٍ');
    } catch (err) {
      record('C1-current-manifest-empty-ledger', 'BLOCKED', err.code ?? err.message);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ————————————————————————————————————————————————
// الضابطُ C2: بيانٌ أقدمُ + تفريغُ الدفترِ + **السجلُّ باقٍ**
// ————————————————————————————————————————————————
async function controlC2() {
  const { boot, body } = rig();
  const root = mkdtempSync(join(tmpdir(), 's13-c2-'));
  try {
    const first = await boot(root);
    first.log.close?.();
    const genesisManifest = readFileSync(join(root, MANIFEST));
    await driveToHaltedState(boot, body, root, 'repeat-me');
    // الخصمُ: بيانٌ أقدمُ + دفترٌ فارغٌ، لكنَّه يتركُ السجلَّ المختومَ.
    writeFileSync(join(root, MANIFEST), genesisManifest);
    rmSync(join(root, JOURNAL), { force: true });
    rmSync(join(root, LEDGER), { force: true });
    writeFileSync(join(root, LEDGER), '', 'utf8');
    try {
      const third = await boot(root);
      third.log.close?.();
      record('C2-old-manifest-empty-ledger-log-kept', 'UNEXPECTED-BOOT', 'أقلعَ بلا رفضٍ');
    } catch (err) {
      record('C2-old-manifest-empty-ledger-log-kept', 'BLOCKED', err.code ?? err.message);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ————————————————————————————————————————————————
// الضابطُ C3: بيانٌ **حاليٌّ** + محوُ السجلِّ وحدَه
// ————————————————————————————————————————————————
async function controlC3() {
  const { boot, body } = rig();
  const root = mkdtempSync(join(tmpdir(), 's13-c3-'));
  try {
    const first = await boot(root);
    first.log.close?.();
    await driveToHaltedState(boot, body, root, 'repeat-me');
    // الخصمُ: يمحو السجلَّ ورأسَه فقط، والباقي سليم.
    rmSync(join(root, EVENTS), { force: true });
    rmSync(join(root, EVENTS_HEAD), { force: true });
    try {
      const third = await boot(root);
      try {
        const haltState = third.haltSwitch.read();
        record(
          'C3-current-manifest-log-wiped',
          'BOOTED',
          `أقلعَ بلا رمزِ غيابِ سجلٍّ؛ halt=${haltState.state}/epoch=${String(haltState.epoch)}`,
        );
      } finally {
        third.log.close?.();
      }
    } catch (err) {
      record('C3-current-manifest-log-wiped', 'BLOCKED', err.code ?? err.message);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const scenario = process.argv[2] ?? 'all';
if (scenario === 'all' || scenario === 's13') await s13();
if (scenario === 'all' || scenario === 's13b') await s13b();
if (scenario === 'all' || scenario === 'c1') await controlC1();
if (scenario === 'all' || scenario === 'c2') await controlC2();
if (scenario === 'all' || scenario === 'c3') await controlC3();
console.log('---SUMMARY---');
for (const r of results) console.log(`${r.verdict}\t${r.name}\t${r.detail}`);
