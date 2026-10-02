// @ts-nocheck
// WL-304 — `LIVE-25`: المسارُ التنفيذيُّ الإنتاجيُّ كاملاً على السجلِّ المختومِ والدفترِ الموقَّع:
// أمرٌ ملكيٌّ موقَّعٌ ⇒ تفويضٌ عندَ نقطةِ الإنفاذ ⇒ تذكرة ⇒ `CrownGateway.commandAsync`
// (‏ختمُ القبولِ ثمّ `commitSigned`) ⇒ `kernel.submit` ⇒ المُعالِج — والمُعالِجُ لا يُنادى قبلَ الختم.
//
// (‏التجهيزُ منسوخٌ من `wl-303-sovereign-authorization.test.mjs` كي يبقى كلُّ ملفٍّ قائماً بنفسِه.)
//
// كلُّ اختبارٍ هنا يبني النظامَ الإنتاجيَّ بـ`createProductionSystem` (‏HSM محقونٌ
// بمفاتيحِ الاختبارِ، بيانٌ مختومٌ، سجلٌّ مختومٌ، دفترٌ، ساعةٌ مُبرهَنة) ويطلبُ
// التفويضَ من `system.chain.enforcementPoint` نفسِها — النقطةِ التي تتسلّمُها
// النواةُ في الإنتاج — لا من مُساعِدٍ ولا من `HaltSwitch`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as softwareSign,
} from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import { createProductionSystem } from '../../src/production/entrypoint.mjs';
import { InMemoryFreshnessSocket, fingerprint } from '../../src/root-of-trust/index.mjs';
import { royalCommandDigest } from '../../src/root-of-trust/crown.mjs';
import { ExecutionKernel } from '../../src/core/execution-kernel.mjs';
import { sealedAudit } from '../../src/root-of-trust/sealed-audit.mjs';
import { registerTestKing, royalKeyEnv } from '../helpers/royal-halt-command.mjs';

/** `LIVE-24`: مفتاحٌ ملكيٌّ مستقلٌّ عن مفتاحِ المرساةِ في التوكن. */
const ROYAL_KEY = royalKeyEnv();

/** مقبسُ حداثةٍ للاختبارِ بلا علامةِ testFixture — يَلفُّ InMemoryFreshnessSocket. */
class TestFreshnessSocket {
  constructor(initial = 0n, anchorPrefix = 'test') {
    this.inner = new InMemoryFreshnessSocket(initial, anchorPrefix);
  }
  read() {
    return this.inner.read();
  }
  bump() {
    return this.inner.bump();
  }
  advance() {
    return this.inner.advance();
  }
  failNext() {
    return this.inner.failNext();
  }
}

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

function fixedKeys() {
  return {
    king: registerTestKing(generateKeyPairSync('ed25519')),
    aeadKey: randomBytes(32),
    ledgerPair: registerTestKing(generateKeyPairSync('ed25519')),
  };
}

function rig({ freshnessSocket = null, keys, env: extraEnv = {} } = {}) {
  const k = keys ?? fixedKeys();
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
    ...extraEnv,
  };
  const testClock = {
    now: () => Date.now(),
    assertTrusted: () => undefined,
    attestation: () => ({
      atMs: Date.now(),
      radiusMs: 1000,
      ageMs: 0,
      sources: ['ci-test'],
      localSkewMs: 0,
    }),
  };
  const boot = (root) =>
    createProductionSystem(
      env,
      { root, freshnessSocket, clock: testClock },
      {
        openSource: async () => ({
          source: stableToken(k.king, k.aeadKey, k.ledgerPair),
          close: async () => undefined,
        }),
      },
    );
  return { boot, keys: k, env };
}

function tmpRoot() {
  return registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-wl303-')));
}

/** أمرٌ سياديٌّ موقَّعٌ بمفتاحِ الملكِ في التوكن (‏`06`) بصيغةِ `CrownGateway`. */
function signedCommand(pair, fields = {}) {
  const command = {
    id: fields.id ?? 'cmd:' + randomUUID(),
    action: fields.action ?? 'stop-state',
    target: fields.target ?? 'state:sovereign',
    payload: fields.payload ?? { reason: 'إيقافٌ سياديٌّ مقيس' },
    issuedAt: fields.issuedAt ?? new Date().toISOString(),
  };
  const signature = softwareSign(
    null,
    Buffer.from(JSON.stringify(command)),
    pair.privateKey,
  ).toString('base64url');
  return { command, signature };
}

function requestFor(actorId, signed, overrides = {}) {
  const [type, id] = (overrides.target ?? signed?.command.target ?? 'state:sovereign').split(':');
  return {
    actor: { id: actorId, kind: 'service', role: 'role:king', state: 'active', capabilities: [] },
    action: overrides.action ?? signed?.command.action ?? 'stop-state',
    resource: { type, id },
    context: {},
    royalCommandId: overrides.royalCommandId ?? signed?.command.id ?? 'cmd:none',
    royalCommandDigest:
      overrides.royalCommandDigest ??
      (signed ? royalCommandDigest(signed.command) : 'a'.repeat(64)),
    ...(overrides.noCommand
      ? {}
      : signed
        ? { royalCommand: overrides.royalCommand ?? signed }
        : {}),
  };
}

async function withSystem(fn, { keys } = {}) {
  const root = tmpRoot();
  const socket = new TestFreshnessSocket(0n, 'wl303');
  const { boot, keys: k } = rig({ freshnessSocket: socket, keys });
  const system = await boot(root);
  const actor = await system.chain.registry.register({ name: 'royal-operator', role: 'role:king' });
  try {
    await fn({ system, keys: k, actorId: actor.id, root, socket, boot });
  } finally {
    await system.close();
    rmSync(root, { recursive: true, force: true });
  }
}

/** أمرٌ سياديٌّ موقَّعٌ يحملُ شهادةَ الوكيلِ، وتذكرتُه من نقطةِ الإنفاذِ الإنتاجيّة. */
async function authorizedCommand(system, agent, pair = ROYAL_KEY.pair, fields = {}) {
  const command = {
    id: fields.id ?? 'cmd:' + randomUUID(),
    action: 'stop-state',
    target: 'state:sovereign',
    payload: { reason: 'تنفيذٌ سياديٌّ مقيس' },
    issuedAt: new Date().toISOString(),
    certificate: agent.certificate,
  };
  const signature = softwareSign(
    null,
    Buffer.from(JSON.stringify(command)),
    pair.privateKey,
  ).toString('base64url');
  const { decision, token } = await system.chain.enforcementPoint.authorize(
    requestFor(agent.id, { command, signature }),
  );
  return { command, signature, decision, token };
}

describe('WL-304 — LIVE-25: المسارُ التنفيذيُّ الإنتاجيُّ على السجلِّ المختوم', () => {
  test('E1 — أمرٌ موقَّعٌ ⇒ مُجاز ⇒ قيودٌ مختومةٌ قبلَ المُعالِج ⇒ المُعالِجُ مرّةً ⇒ نجاحٌ مختوم', async () => {
    await withSystem(async ({ system }) => {
      const agent = await system.chain.registry.register({ name: 'e1', role: 'role:king' });
      const { command, signature, decision, token } = await authorizedCommand(system, agent);
      assert.equal(decision.allowed, true, decision.reason);
      const before = system.auditLog.events.length;
      let seenAtHandler = null;
      let calls = 0;
      const task = await system.kernel.submit(
        command,
        signature,
        async (accepted) => {
          calls += 1;
          assert.equal(accepted.id, command.id);
          // ما خُتِمَ قبلَ أن يعملَ المُعالِج — يُقرأُ من السجلِّ المختومِ نفسِه لحظتَها.
          seenAtHandler = system.auditLog.events.slice(before).map((e) => e.type);
          assert.equal(system.rootOfTrust.ledger.state(command.id), 'committed');
          return 'done';
        },
        { decisionToken: token },
      );
      assert.equal(calls, 1);
      assert.equal(task.state, 'succeeded');
      assert.equal(task.result, 'done');
      assert.deepEqual(seenAtHandler, [
        'kernel.authorization.verified',
        'crown.command.accepted',
        'ledger.committed',
        'kernel.task.queued',
        'kernel.task.started',
      ]);
      const after = system.auditLog.events.slice(before).map((e) => e.type);
      assert.equal(after.at(-1), 'kernel.task.succeeded');
      // الختمُ حقيقيٌّ: السجلُّ يتحقّقُ بسلسلتِه بعدَ المسار.
      assert.equal(typeof system.auditLog.appendSealed, 'function');
    });
  });

  test('E2 — التذكرةُ لا تُعادُ، والأمرُ لا يُعادُ بتذكرةٍ جديدة، والمُعالِجُ لا يُنادى ثانيةً', async () => {
    await withSystem(async ({ system }) => {
      const agent = await system.chain.registry.register({ name: 'e2', role: 'role:king' });
      const first = await authorizedCommand(system, agent);
      let calls = 0;
      const handler = async () => (calls += 1);
      await system.kernel.submit(first.command, first.signature, handler, {
        decisionToken: first.token,
      });
      await assert.rejects(
        () =>
          system.kernel.submit(first.command, first.signature, handler, {
            decisionToken: first.token,
          }),
        /AUTHORIZATION_DECISION_REUSED/,
      );
      const again = await system.chain.enforcementPoint.authorize(
        requestFor(agent.id, { command: first.command, signature: first.signature }),
      );
      assert.equal(again.decision.allowed, false);
      assert.match(again.decision.reason, /ROYAL_AUTH_REPLAYED/);
      assert.equal(calls, 1);
    });
  });

  test('E3 — أمرٌ نُفِّذَ يُعادُ بعدَ إعادةِ التشغيلِ ⇒ رفضٌ عندَ نقطةِ الإنفاذ ولا تنفيذ', async () => {
    const root = tmpRoot();
    const socket = new TestFreshnessSocket(0n, 'wl304');
    const { boot } = rig({ freshnessSocket: socket });
    let system = await boot(root);
    let replay;
    try {
      const agent = await system.chain.registry.register({ name: 'e3', role: 'role:king' });
      replay = await authorizedCommand(system, agent);
      await system.kernel.submit(replay.command, replay.signature, async () => 'ok', {
        decisionToken: replay.token,
      });
    } finally {
      await system.close();
    }
    system = await boot(root);
    try {
      const agent = await system.chain.registry.register({ name: 'e3b', role: 'role:king' });
      const r = await system.chain.enforcementPoint.authorize(
        requestFor(agent.id, { command: replay.command, signature: replay.signature }),
      );
      assert.equal(r.decision.allowed, false);
      assert.match(r.decision.reason, /ROYAL_AUTH_REPLAYED/);
      assert.equal(system.rootOfTrust.ledger.state(replay.command.id), 'committed');
    } finally {
      await system.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('E4 — المسارُ المتزامنُ في الإنتاجِ يُرَدُّ قبلَ الحجز، فلا يبقى معرّفٌ معلَّقاً', async () => {
    await withSystem(async ({ system }) => {
      const signed = signedCommand(ROYAL_KEY.pair);
      assert.throws(
        () => system.crown.command(signed.command, signed.signature),
        /CROWN_COMMAND_REQUIRES_ASYNC_IN_PRODUCTION/,
      );
      assert.equal(system.rootOfTrust.ledger.state(signed.command.id), 'unknown');
    });
  });

  test('E5 — التاجُ يتحقّقُ بالمفتاحِ الملكيِّ: توقيعُ المرساةِ (‏`06`) يُرَدُّ ولا يُحجَزُ معرّفُه', async () => {
    await withSystem(async ({ system, keys }) => {
      const signed = signedCommand(keys.king);
      await assert.rejects(
        () => system.crown.commandAsync(signed.command, signed.signature),
        /INVALID_ROYAL_SIGNATURE/,
      );
      assert.equal(system.rootOfTrust.ledger.state(signed.command.id), 'unknown');
    });
  });

  test('E6 — فشلُ الختمِ قبلَ المُعالِجِ ⇒ لا يُنادى المُعالِجُ والخطأُ يُرفَع', async () => {
    // سجلٌّ مختومٌ يرفضُ الكتابةَ — عبرَ المُحوِّلِ نفسِه الذي يركّبُه الإنتاج.
    const failing = sealedAudit({
      appendSealed: async () => {
        throw new Error('SEAL_WRITE_FAILED');
      },
    });
    const accepted = { id: 'cmd:x', action: 'read-dashboard', target: 'dash:x', payload: {} };
    const kernel = new ExecutionKernel({
      crown: { commandAsync: async () => accepted, command: () => accepted },
      log: /** @type {never} */ (failing),
    });
    let ran = false;
    await assert.rejects(
      () => kernel.submit(accepted, 'sig', async () => (ran = true)),
      /SEAL_WRITE_FAILED/,
    );
    assert.equal(ran, false);
  });
});
