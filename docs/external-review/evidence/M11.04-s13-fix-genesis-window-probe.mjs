// مجسُّ قياسِ نافذةِ التهيئةِ الأُولى الشرعيّةِ — قبلَ كتابةِ حارسٍ واحدٍ.
// السؤالُ المقيسُ: هل يوجدُ مسارٌ **شرعيٌّ** يُنتِجُ بياناً مختوماً على القرصِ
// بلا سجلِّ وقائعَ؟ وما الحقلُ الذي يفصلُ ذلكَ المسارَ عن هجومِ `S13`؟
// لا يكتبُ في المستودعِ. ينظِّفُ ما يُنشئُه.
import { Buffer } from 'node:buffer';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  sign as softwareSign,
} from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// مسارٌ نسبيٌّ محسوبٌ من موضعِ الملفِّ — لا مسارٌ مُطلَقٌ مُثبَّتٌ (‏`R6-CS-02`/`R6-LU-01`).
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const {
  SEAL_IV_BYTES,
  createProductionRootOfTrust,
  fingerprint,
  inspectEventLog,
  openProductionSigners,
  StateManifest,
  stateManifestPath,
  stateManifestBinding,
} = await import(join(REPO, 'src/root-of-trust/index.mjs'));

const MANIFEST = 'root-of-trust.manifest.json';
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
  const anchorKeyId = '06';
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
  return {
    boot,
    env,
    anchorKeyId,
    token: () => stableToken(king, aeadKey, ledgerPair),
    body: (root) => JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')).body,
  };
}

/** يَقرأُ الحالةَ على القرصِ بلا قفلٍ ولا كتابةٍ — كما يفعلُ حارسُ إقلاعٍ. */
function snapshot(root) {
  const manifestPath = join(root, MANIFEST);
  const manifestExists = existsSync(manifestPath);
  const body = manifestExists ? JSON.parse(readFileSync(manifestPath, 'utf8')).body : null;
  const inspection = inspectEventLog(join(root, EVENTS));
  return {
    manifestExists,
    sequence: body ? body.sequence : null,
    anchoredCount: body ? body.anchoredCount : null,
    haltEpoch: body ? body.haltEpoch : null,
    ledgerCommitted: body ? body.ledgerCommitted : null,
    logExists: inspection.exists,
    logCount: inspection.count,
    headPresent: inspection.head !== null,
    headCount: inspection.head ? inspection.head.count : null,
    headAgrees: inspection.headAgrees,
    problem: inspection.problem ?? null,
  };
}

const rows = [];
function record(state, kind, snap, bootOutcome) {
  rows.push({ state, kind, ...snap, bootOutcome });
  console.log(
    `[${kind}] ${state} :: seq=${snap.sequence} anchored=${snap.anchoredCount} ` +
      `halt=${snap.haltEpoch} ledger=${snap.ledgerCommitted} | log=${snap.logExists} ` +
      `logCount=${snap.logCount} head=${snap.headPresent} headCount=${snap.headCount} ` +
      `| boot=${bootOutcome}`,
  );
}

async function tryBoot(boot, root) {
  try {
    const rt = await boot(root);
    rt.log.close?.();
    return 'BOOT_OK';
  } catch (error) {
    return `REJECTED:${error.code ?? error.name}:${error.message.slice(0, 60)}`;
  }
}

async function driveToHaltedState(boot, body, root, commandId) {
  const rt = await boot(root);
  rt.ledger.begin({ id: commandId });
  await rt.ledger.commitSigned({ id: commandId }, 'تمّ');
  const directive = await rt.haltSwitch.haltAsync('إيقافٌ سياديّ', { id: 'test-cmd' });
  rt.log.close?.();
  return { directive, body: body(root) };
}

// ══════════════════════════════════════════════════════════════
// L1 — انقطاعُ التهيئةِ الأُولى: البيانُ كُتِبَ ثمَّ سقطتِ العمليةُ قبلَ
// إنشاءِ السجلِّ. يُعادُ بنفسِ واجهةِ البيانِ التي يستعملُها المصنعُ لا بتزييفٍ.
// ══════════════════════════════════════════════════════════════
async function l1InterruptedGenesis() {
  const { boot, env, token } = rig();
  const root = mkdtempSync(join(tmpdir(), 'gw-l1-'));
  try {
    // نُعيدُ **خطواتِ المصنعِ نفسَها** إلى ما قبلَ إنشاءِ السجلِّ بالضبطِ
    // (‏`production-runtime.mts`: الأسطرُ 352–397 ثمَّ التوقُّفُ قبلَ السطرِ 400)،
    // بموقّعٍ حقيقيٍّ من نفسِ دالّةِ فتحِ الموقّعينَ لا بكائنٍ مُصطنَعٍ.
    const signers = await openProductionSigners(
      env,
      {
        openSource: async () => ({ source: token(), close: async () => undefined }),
      },
      {},
    );
    let created = 'PROVISIONED';
    try {
      const manifest = new StateManifest(stateManifestPath(root), {
        fsync: false,
        sealer: signers.anchorSigner,
        env,
      });
      await manifest.provisionAsync(stateManifestBinding(signers.anchorSigner.id, env), env);
      manifest.assertKing(signers.anchorSigner.id);
      await manifest.initJournalKey();
      // ← هنا تسقطُ العمليةُ: لا سجلَّ وقائعَ قطُّ.
    } catch (error) {
      created = `PROVISION_FAILED:${error.code ?? error.name}:${error.message.slice(0, 40)}`;
    }
    await signers.close();
    const snap = snapshot(root);
    record(
      `L1 انقطاعُ التهيئةِ قبلَ السجلِّ (${created})`,
      'شرعيّ',
      snap,
      await tryBoot(boot, root),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ══════════════════════════════════════════════════════════════
// L1b — الطريقُ الأوثقُ لنفسِ النافذةِ: إقلاعٌ أوّلُ كاملٌ ثمَّ محوُ السجلِّ
// **مع** إرجاعِ البيانِ إلى أوّلِ صورةٍ له على القرصِ (أي حالةُ «ما بعدَ
// التهيئةِ وقبلَ السجلِّ» كما تُلتقَطُ فعلاً من القرصِ لا كما تُخمَّن).
// ══════════════════════════════════════════════════════════════
async function l1bFirstManifestNoLog() {
  const { boot, body } = rig();
  const root = mkdtempSync(join(tmpdir(), 'gw-l1b-'));
  try {
    const first = await boot(root);
    first.log.close?.();
    const afterGenesis = snapshot(root);
    record('L2 إقلاعٌ أوّلُ كاملٌ', 'شرعيّ', afterGenesis, 'BOOT_OK (مُقاسٌ سلفاً)');

    const second = await boot(root);
    second.log.close?.();
    record('L3 إقلاعٌ ثانٍ', 'شرعيّ', snapshot(root), 'BOOT_OK (مُقاسٌ سلفاً)');

    const driven = await driveToHaltedState(boot, body, root, 'gw-cmd');
    if (driven.directive.state !== 'halted') throw new Error('precondition failed');
    record('L4 بعدَ تثبيتِ أمرٍ وإيقافٍ', 'شرعيّ', snapshot(root), 'BOOT_OK (مُقاسٌ سلفاً)');
    return { root, keep: true };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ══════════════════════════════════════════════════════════════
// A — هجومُ `S13b` بثلاثِ صيغٍ: محوُ السجلِّ، وتركُ سجلٍّ فارغٍ،
// وتركُ سجلٍّ فارغٍ برأسٍ مُصطنَعٍ عدُّهُ صفرٌ.
// ══════════════════════════════════════════════════════════════
async function attackVariants() {
  for (const variant of ['محوٌ كاملٌ', 'سجلٌّ فارغٌ', 'سجلٌّ فارغٌ + رأسٌ بعدٍّ صفرٍ']) {
    const { boot, body } = rig();
    const root = mkdtempSync(join(tmpdir(), 'gw-a-'));
    try {
      const first = await boot(root);
      first.log.close?.();
      const genesisManifest = readFileSync(join(root, MANIFEST));

      const driven = await driveToHaltedState(boot, body, root, 'repeat-me');
      if (
        driven.directive.state !== 'halted' ||
        driven.body.haltEpoch < 1 ||
        driven.body.ledgerCommitted < 1
      ) {
        throw new Error('precondition failed');
      }

      // الخصمُ يملكُ القرصَ.
      writeFileSync(join(root, MANIFEST), genesisManifest);
      rmSync(join(root, EVENTS), { force: true });
      rmSync(join(root, EVENTS_HEAD), { force: true });
      rmSync(join(root, LEDGER), { force: true });
      rmSync(join(root, CLAIMS), { recursive: true, force: true });
      rmSync(join(root, 'halt'), { recursive: true, force: true });
      writeFileSync(join(root, LEDGER), '');
      mkdirSync(join(root, CLAIMS), { recursive: true });
      if (variant !== 'محوٌ كاملٌ') writeFileSync(join(root, EVENTS), '');
      if (variant === 'سجلٌّ فارغٌ + رأسٌ بعدٍّ صفرٍ') {
        writeFileSync(
          join(root, EVENTS_HEAD),
          JSON.stringify({ count: 0, lastHash: '', updatedAt: new Date().toISOString() }),
        );
      }

      const snap = snapshot(root);
      record(`A ${variant}`, 'هجومٌ', snap, await tryBoot(boot, root));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

// انتقاءُ سيناريو بوسيطٍ لتشخيصٍ معزولٍ: `node <المجسّ> l1|life|attack`.
const only = process.argv[2] ?? 'all';
if (only === 'all' || only === 'l1') await l1InterruptedGenesis();
if (only === 'all' || only === 'life') await l1bFirstManifestNoLog();
if (only === 'all' || only === 'attack') await attackVariants();

console.log('\n── جدولُ الفصلِ ──');
for (const row of rows) {
  console.log(
    `${row.kind}\t${row.state}\tseq=${row.sequence}\tlog=${row.logExists}\tlogCount=${row.logCount}\thead=${row.headPresent}\t${row.bootOutcome}`,
  );
}
