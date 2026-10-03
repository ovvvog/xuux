// WL-322 — مجسُّ مذكّرةِ القرارِ في `LIVE-28` × `R10-F-01`. لا يكتبُ في المستودعِ، ويُنظِّفُ ما يُنشئُه.
//
// يُحَلُّ من موضعِ الملفِّ نفسِه (‏`import.meta.url`) فيقيسُ الشجرةَ التي هو فيها، ويطبعُ الجذرَ
// المقيسَ ورأسَه في أوّلِ سطرَين. يتطلّبُ بناءً قائماً (‏`npx tsc -p tsconfig.build.json`).
//
//   W1 — نافذةُ العهدِ الواحد: لقطةٌ باردةٌ بعدَ تمامِ الإقلاعِ (‏العهدُ مختومٌ) وقبلَ أيِّ أمرٍ،
//        ثمَّ أمرٌ يُثبَّت، ثمَّ تُستعادُ اللقطةُ ويُعادُ الأمر.
//   W2 — لقطةُ `R10-F-01` (‏لحظةَ أوّلِ `bump()`)، ثمَّ أمرٌ يُثبَّت، ثمَّ تُستعادُ والمرجعُ `1`.
//   W3 — لقطةُ `R10-F-01` نفسُها، ثمَّ إقلاعٌ ثانٍ (‏المرجعُ `2`)، ثمَّ تُستعاد.
//   W4 — اللقطةُ لحظةَ `bump()` في الإقلاعِ **الثاني** (‏الدفترُ قائمٌ)، ثمَّ أمرٌ يُثبَّتُ في
//        العهدِ `2`، ثمَّ تُستعادُ والمرجعُ `2`.
//   ولكلٍّ يُطبَعُ متنُ البيانِ على القرصِ بعدَ المحاولة (‏`after{…}`) — فيُرى إن خُتِمَ شيءٌ
//   قبلَ الرفض.
//
// الخروجُ: `0` إن قِيسَت الثلاثةُ (‏أيّاً كانت النتيجةُ — المجسُّ يقيسُ ولا يحكم)، و`2` إن سقطَ
// شرطٌ مسبقٌ فلم يُقَسْ شيء. وقفلُ السجلِّ يُسقَطُ من اللقطةِ لأنَّ مالكَه عمليّةُ المجسِّ الحيّةُ
// (‏استعادةٌ باردة؛ حارسُ القفلِ ينتزعُ قفلَ عمليّةٍ ميتةٍ) — مُصرَّحٌ به كما في تقريرِ المجلس.

import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  sign as softwareSign,
} from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
let head = 'غيرُ معروف';
try {
  head = execFileSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
} catch {
  /* خارجَ git */
}
console.log(`ROOT ${REPO}`);
console.log(`HEAD ${head}`);

let rot;
let helpers;
try {
  rot = await import(new URL('src/root-of-trust/index.mjs', 'file://' + REPO).href);
  helpers = await import(new URL('tests/helpers/royal-halt-command.mjs', 'file://' + REPO).href);
} catch (err) {
  console.log(`PRECONDITION_FAILED ${err.message}`);
  process.exit(2);
}
const { createProductionRootOfTrust, fingerprint, InMemoryFreshnessSocket } = rot;
const { registerTestKing, royalKeyEnv } = helpers;
const ROYAL_KEY = royalKeyEnv();
const MANIFEST = 'root-of-trust.manifest.json';

/** توكنٌ مزيَّفٌ ثابتُ المفاتيحِ عبرَ الإقلاعاتِ. */
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
          const iv = randomBytes(12);
          const cipher = createCipheriv('aes-256-gcm', aeadKey, iv);
          cipher.setAAD(aad);
          return {
            ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]),
            iv,
            tag: cipher.getAuthTag(),
          };
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

function rig(socket) {
  const k = {
    king: registerTestKing(generateKeyPairSync('ed25519')),
    aeadKey: randomBytes(32),
    ledgerPair: registerTestKing(generateKeyPairSync('ed25519')),
  };
  const env = {
    NODE_ENV: 'production',
    STATE_ENV: 'production',
    XUUX_ROOT_OF_TRUST_MODE: 'hsm',
    XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
    XUUX_PKCS11_TOKEN: 'xuux-test',
    XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
    XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
    XUUX_PKCS11_PIN: 'unused-by-injected-source',
    XUUX_KING_ID: 'king:' + fingerprint(k.king.publicKey).slice(0, 24),
    ...ROYAL_KEY.env,
    XUUX_ROOT_OF_TRUST_PROVISION: '1',
  };
  return (root) =>
    createProductionRootOfTrust(
      env,
      { root, fsync: false, freshnessSocket: socket },
      {
        openSource: async () => ({
          source: stableToken(k.king, k.aeadKey, k.ledgerPair),
          close: async () => undefined,
        }),
      },
    );
}

const dirs = [];
const tmp = (label) => {
  const d = mkdtempSync(join(tmpdir(), `xuux-wl322-${label}-`));
  dirs.push(d);
  return d;
};
const body = (root) => JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')).body;
const restore = (snap, root) => {
  rmSync(join(snap, 'events.log.lock'), { force: true });
  rmSync(root, { recursive: true, force: true });
  cpSync(snap, root, { recursive: true });
};
const describeSnap = (snap) => {
  const b = body(snap);
  return `epoch=${b.freshnessEpoch} reserved=${b.freshnessReserved ?? 'absent'}`;
};

/** يُعيدُ `ACCEPTED` أو `REJECTED <code>` ثمَّ نتيجةَ إعادةِ الأمرِ إن أقلع. */
async function attempt(boot, root, cmdId) {
  let sys;
  try {
    sys = await boot(root);
  } catch (err) {
    return { restore: `REJECTED ${err.code ?? err.message}`, replay: 'NOT_REACHED' };
  }
  let replay;
  try {
    sys.ledger.begin({ id: cmdId });
    await sys.ledger.commitSigned({ id: cmdId }, 'ok');
    replay = 'ACCEPTED';
  } catch (err) {
    replay = `REJECTED ${err.code ?? err.message}`;
  }
  sys.log.close?.();
  return { restore: 'ACCEPTED', replay };
}

function capturingSocket(inner, snap, root) {
  let captured = false;
  return {
    read: () => inner.read(),
    bump: async () => {
      if (!captured) {
        captured = true;
        cpSync(root, snap, { recursive: true });
      }
      return inner.bump();
    },
  };
}

try {
  // W1
  {
    const inner = new InMemoryFreshnessSocket(0n, 'w1');
    const root = join(tmp('w1'), 'root');
    const snap = join(tmp('w1s'), 'snap');
    const boot = rig(inner);
    const first = await boot(root);
    cpSync(root, snap, { recursive: true });
    first.ledger.begin({ id: 'cmd' });
    await first.ledger.commitSigned({ id: 'cmd' }, 'ok');
    first.log.close?.();
    const ext = String((await inner.read()).epoch);
    restore(snap, root);
    const r = await attempt(boot, root, 'cmd');
    console.log(
      `W1 snapshot{${describeSnap(snap)}} external=${ext} RESTORE_SAME_EPOCH: ${r.restore} REPLAY_OF_cmd: ${r.replay} after{${describeSnap(root)}}`,
    );
  }
  // W2 + W3
  for (const [label, secondBoot] of [
    ['W2', false],
    ['W3', true],
  ]) {
    const inner = new InMemoryFreshnessSocket(0n, label);
    const root = join(tmp(label), 'root');
    const snap = join(tmp(label + 's'), 'snap');
    const boot = rig(capturingSocket(inner, snap, root));
    const first = await boot(root);
    first.ledger.begin({ id: 'r10-cmd' });
    await first.ledger.commitSigned({ id: 'r10-cmd' }, 'ok');
    first.log.close?.();
    if (secondBoot) {
      rmSync(join(root, 'events.log.lock'), { force: true });
      const second = await boot(root);
      second.log.close?.();
    }
    const ext = String((await inner.read()).epoch);
    restore(snap, root);
    const r = await attempt(boot, root, 'r10-cmd');
    console.log(
      `${label} snapshot{${describeSnap(snap)}} external=${ext} RESTORE: ${r.restore} REPLAY_OF_r10-cmd: ${r.replay} after{${describeSnap(root)}}`,
    );
  }
  // W4
  {
    const inner = new InMemoryFreshnessSocket(0n, 'w4');
    const root = join(tmp('w4'), 'root');
    const snap = join(tmp('w4s'), 'snap');
    let armed = false;
    let captured = false;
    const socket = {
      read: () => inner.read(),
      bump: async () => {
        if (armed && !captured) {
          captured = true;
          cpSync(root, snap, { recursive: true });
        }
        return inner.bump();
      },
    };
    const boot = rig(socket);
    const first = await boot(root);
    first.log.close?.();
    rmSync(join(root, 'events.log.lock'), { force: true });
    armed = true;
    const second = await boot(root);
    second.ledger.begin({ id: 'w4-cmd' });
    await second.ledger.commitSigned({ id: 'w4-cmd' }, 'ok');
    second.log.close?.();
    const ext = String((await inner.read()).epoch);
    restore(snap, root);
    const r = await attempt(boot, root, 'w4-cmd');
    console.log(
      `W4 snapshot{${describeSnap(snap)}} external=${ext} RESTORE: ${r.restore} REPLAY_OF_w4-cmd: ${r.replay} after{${describeSnap(root)}}`,
    );
  }
} catch (err) {
  console.log(`PRECONDITION_FAILED ${err.code ?? ''} ${err.message}`);
  process.exitCode = 2;
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
