// @ts-nocheck
// WL-303 — `R6-A-07`: حدُّ السلطةِ الملكيّةِ عندَ نقطةِ الإنفاذِ الإنتاجيّةِ الفعليّة.
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
import { EnforcementPoint } from '../../src/policy/enforcement-point.mjs';
import { createPolicyDecisionPoint } from '../../src/policy/index.mjs';
import {
  kingIdOfPublicKey,
  registerTestKing,
  royalKeyEnv,
  signRoyalCommand,
} from '../helpers/royal-halt-command.mjs';

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

function sealedTypes(system) {
  return system.auditLog.events.map((e) => e.type);
}

describe('WL-303 — R6-A-07: التفويضُ الملكيُّ عندَ نقطةِ الإنفاذِ الإنتاجيّة', () => {
  test('A1 — الحدُّ موصولٌ بالنقطةِ الفعليّةِ نفسِها ومبنيٌّ على المفتاحِ الملكيِّ المُثبَّت', async () => {
    await withSystem(async ({ system }) => {
      const verifier = system.chain.enforcementPoint.royalCommandVerifier;
      assert.equal(typeof verifier, 'function');
      assert.strictEqual(system.kernel.enforcement, system.chain.enforcementPoint);
      const { trustedRoyalAuthorizationKeyId } =
        await import('../../src/root-of-trust/royal-authorization.mjs');
      assert.equal(trustedRoyalAuthorizationKeyId(verifier), ROYAL_KEY.env.XUUX_ROYAL_KEY_ID);
      assert.notEqual(trustedRoyalAuthorizationKeyId(verifier), system.rootOfTrust.anchorSigner.id);
    });
  });

  test('A2 — أمرٌ صحيحُ التوقيعِ مربوطٌ بالفعلِ والموردِ ⇒ تذكرة، وقبولُه في السجلِّ المختوم', async () => {
    await withSystem(async ({ system, actorId }) => {
      const signed = signedCommand(ROYAL_KEY.pair);
      const { decision, token } = await system.chain.enforcementPoint.authorize(
        requestFor(actorId, signed),
      );
      assert.equal(decision.allowed, true, decision.reason);
      assert.equal(typeof token, 'string');
      assert.ok(sealedTypes(system).includes('crown.authorization.accepted'));
    });
  });

  test('A3 — فعلٌ سياديٌّ بلا أمرٍ موقَّعٍ (معرّفٌ وملخّصٌ وحدَهما) ⇒ رفض', async () => {
    await withSystem(async ({ system, actorId }) => {
      const signed = signedCommand(ROYAL_KEY.pair);
      const { decision, token } = await system.chain.enforcementPoint.authorize(
        requestFor(actorId, signed, { noCommand: true }),
      );
      assert.equal(decision.allowed, false);
      assert.equal(token, null);
      assert.match(decision.reason, /ROYAL_AUTH_COMMAND_MISSING/);
    });
  });

  test('A4 — توقيعٌ مزوَّرٌ أو بمفتاحٍ آخرَ (ولو مفتاحُ الدفترِ في التوكنِ نفسِه) ⇒ رفض', async () => {
    await withSystem(async ({ system, keys, actorId }) => {
      const signed = signedCommand(ROYAL_KEY.pair);
      const forged = { ...signed, signature: 'A'.repeat(86) };
      const r1 = await system.chain.enforcementPoint.authorize(
        requestFor(actorId, signed, { royalCommand: forged }),
      );
      assert.match(r1.decision.reason, /ROYAL_AUTH_SIGNATURE_INVALID/);
      const byLedgerKey = signedCommand(keys.ledgerPair);
      const r2 = await system.chain.enforcementPoint.authorize(requestFor(actorId, byLedgerKey));
      assert.match(r2.decision.reason, /ROYAL_AUTH_SIGNATURE_INVALID/);
      const intruder = signedCommand(generateKeyPairSync('ed25519'));
      const r3 = await system.chain.enforcementPoint.authorize(requestFor(actorId, intruder));
      assert.match(r3.decision.reason, /ROYAL_AUTH_SIGNATURE_INVALID/);
    });
  });

  test('A5 — أمرٌ موقَّعٌ للفعلِ A يُقدَّمُ للفعلِ B، أو لموردٍ آخر ⇒ رفض', async () => {
    await withSystem(async ({ system, actorId }) => {
      const forResume = signedCommand(ROYAL_KEY.pair, { action: 'resume-state' });
      const r1 = await system.chain.enforcementPoint.authorize(
        requestFor(actorId, forResume, { action: 'stop-state' }),
      );
      assert.equal(r1.decision.allowed, false);
      assert.match(r1.decision.reason, /ROYAL_AUTH_BINDING_MISMATCH/);
      const signed = signedCommand(ROYAL_KEY.pair);
      const r2 = await system.chain.enforcementPoint.authorize(
        requestFor(actorId, signed, { target: 'state:other' }),
      );
      assert.equal(r2.decision.allowed, false);
      assert.match(r2.decision.reason, /ROYAL_AUTH_BINDING_MISMATCH/);
    });
  });

  test('A6 — أمرٌ صحيحُ التوقيعِ لفعلٍ خارجَ العتبةِ السياديّةِ لا يُجيزُ شيئاً', async () => {
    await withSystem(async ({ system }) => {
      const verifier = system.chain.enforcementPoint.royalCommandVerifier;
      const signed = signedCommand(ROYAL_KEY.pair, { action: 'read-dashboard', target: 'dash:x' });
      const verdict = await verifier({
        id: signed.command.id,
        digest: royalCommandDigest(signed.command),
        action: 'read-dashboard',
        resource: 'dash:x',
        ...signed,
      });
      assert.deepEqual(verdict, { ok: false, code: 'ROYAL_AUTH_ACTION_NOT_SOVEREIGN' });
    });
  });

  test('A7 — أمرٌ قديمٌ وأمرٌ من المستقبلِ ⇒ رفض', async () => {
    await withSystem(async ({ system, actorId }) => {
      const old = signedCommand(ROYAL_KEY.pair, { issuedAt: '2020-01-01T00:00:00.000Z' });
      const r1 = await system.chain.enforcementPoint.authorize(requestFor(actorId, old));
      assert.match(r1.decision.reason, /ROYAL_AUTH_EXPIRED/);
      const future = signedCommand(ROYAL_KEY.pair, {
        issuedAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      const r2 = await system.chain.enforcementPoint.authorize(requestFor(actorId, future));
      assert.match(r2.decision.reason, /ROYAL_AUTH_FROM_FUTURE/);
    });
  });

  test('A8 — الأمرُ نفسُه يُقدَّمُ مرّتين ⇒ الثانيةُ رفض', async () => {
    await withSystem(async ({ system, actorId }) => {
      const signed = signedCommand(ROYAL_KEY.pair);
      const first = await system.chain.enforcementPoint.authorize(requestFor(actorId, signed));
      assert.equal(first.decision.allowed, true, first.decision.reason);
      const second = await system.chain.enforcementPoint.authorize(requestFor(actorId, signed));
      assert.equal(second.decision.allowed, false);
      assert.match(second.decision.reason, /ROYAL_AUTH_REPLAYED/);
    });
  });

  test('A9 — أمرٌ ثُبِّتَ في الدفترِ الدائمِ يُعادُ بعدَ إعادةِ التشغيلِ ⇒ رفض', async () => {
    const root = tmpRoot();
    const socket = new TestFreshnessSocket(0n, 'wl303');
    const { boot } = rig({ freshnessSocket: socket });
    const signed = signedCommand(ROYAL_KEY.pair);
    let system = await boot(root);
    try {
      // التثبيتُ في الدفترِ الدائمِ بمسارِه الإنتاجيِّ (‏موقَّعاً بمفتاحِ `07`).
      system.rootOfTrust.ledger.begin(signed.command);
      await system.rootOfTrust.ledger.commitSigned(signed.command, 'ok');
    } finally {
      await system.close();
    }
    system = await boot(root);
    try {
      const actor = await system.chain.registry.register({
        name: 'after-restart',
        role: 'role:king',
      });
      const r = await system.chain.enforcementPoint.authorize(requestFor(actor.id, signed));
      assert.equal(r.decision.allowed, false);
      assert.match(r.decision.reason, /ROYAL_AUTH_REPLAYED/);
    } finally {
      await system.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('A10 — نصُّ فاعلٍ `crown` ودورٌ مُدَّعى بلا شهادةٍ ولا أمرٍ ⇒ رفض', async () => {
    await withSystem(async ({ system }) => {
      const r = await system.chain.enforcementPoint.authorize({
        actor: {
          id: 'crown',
          kind: 'service',
          role: 'role:king',
          state: 'active',
          capabilities: [],
        },
        action: 'stop-state',
        resource: { type: 'state', id: 'sovereign' },
        context: {},
        royalCommandId: 'cmd:crown',
        royalCommandDigest: 'a'.repeat(64),
      });
      assert.equal(r.decision.allowed, false);
      assert.equal(r.token, null);
    });
  });

  test('A11 — الرفضُ في السجلِّ المختومِ بلا توقيعٍ ولا مادّةِ مفتاح', async () => {
    await withSystem(async ({ system, actorId }) => {
      const signed = signedCommand(ROYAL_KEY.pair);
      const forged = { ...signed, signature: 'B'.repeat(86) };
      await system.chain.enforcementPoint.authorize(
        requestFor(actorId, signed, { royalCommand: forged }),
      );
      const rejected = system.auditLog.events.filter(
        (e) => e.type === 'crown.authorization.rejected',
      );
      assert.ok(rejected.length >= 1);
      const text = JSON.stringify(rejected);
      assert.equal(text.includes('B'.repeat(86)), false, 'التوقيعُ لا يُسرَّب');
      assert.equal(text.includes('PRIVATE'), false);
    });
  });

  test('A12 — مسارٌ جانبيٌّ: نقطةُ إنفاذٍ إنتاجيّةٌ بمُحقِّقٍ مُرتجَلٍ تُرَدُّ عندَ البناء', () => {
    assert.throws(
      () =>
        new EnforcementPoint({
          decisionPoint: createPolicyDecisionPoint(),
          log: { append: () => undefined },
          identityGate: { verify: async () => ({ ok: true, actor: null }) },
          royalCommandVerifier: () => true,
          env: { NODE_ENV: 'production', STATE_ENV: 'production' },
        }),
      /ENFORCEMENT_ROYAL_AUTHORIZATION_UNTRUSTED/,
    );
  });

  test('A13 — حدُّ التنفيذِ: التذكرةُ الصحيحةُ تُشغِّلُ المُعالِجَ مرّةً على السجلِّ المختوم (‏`LIVE-25`، `WL-304`)', async () => {
    // كانَ الحكمُ قبلَ `WL-304` فشلاً مغلقاً (‏`SEALED_LOG_REQUIRES_ASYNC_APPEND` في
    // `ExecutionKernel.assertAuthorized`) والمُعالِجُ لا يُنادى. بعدَ الإصلاحِ: المسارُ يكتمل.
    await withSystem(async ({ system }) => {
      const agent = await system.chain.registry.register({ name: 'e2e', role: 'role:king' });
      const command = {
        id: 'cmd:' + randomUUID(),
        action: 'stop-state',
        target: 'state:sovereign',
        payload: { reason: 'e2e' },
        issuedAt: new Date().toISOString(),
        certificate: agent.certificate,
      };
      const signature = softwareSign(
        null,
        Buffer.from(JSON.stringify(command)),
        ROYAL_KEY.pair.privateKey,
      ).toString('base64url');
      const { decision, token } = await system.chain.enforcementPoint.authorize(
        requestFor(agent.id, { command, signature }),
      );
      assert.equal(decision.allowed, true, decision.reason);
      let ran = 0;
      const task = await system.kernel.submit(command, signature, async () => (ran += 1), {
        decisionToken: token,
      });
      assert.equal(ran, 1);
      assert.equal(task.state, 'succeeded');
      assert.equal(system.rootOfTrust.ledger.state(command.id), 'committed');
    });
  });
});

describe('WL-303 — LIVE-24: المفتاحُ الملكيُّ غيرُ مفتاحِ المرساة', () => {
  test('L1 — المعرّفاتُ الثلاثةُ مختلفةٌ، ومُحقِّقُ الإيقافِ على المفتاحِ الملكيِّ لا على `06`', async () => {
    await withSystem(async ({ system }) => {
      const royal = ROYAL_KEY.env.XUUX_ROYAL_KEY_ID;
      const anchor = system.rootOfTrust.anchorSigner.id;
      const ledger = system.rootOfTrust.ledgerSigner.id;
      assert.equal(new Set([royal, anchor, ledger.replace(/^ledger:/, 'king:')]).size, 3);
      assert.equal(system.rootOfTrust.haltSwitch.royalKeyId, royal);
      assert.equal(system.rootOfTrust.haltSwitch.king.id, anchor);
    });
  });

  test('L2 — أمرٌ سياديٌّ موقَّعٌ بمفتاحِ المرساةِ (‏`06`) يُرفَضُ عندَ نقطةِ الإنفاذ', async () => {
    await withSystem(async ({ system, keys, actorId }) => {
      const byAnchor = signedCommand(keys.king);
      const r = await system.chain.enforcementPoint.authorize(requestFor(actorId, byAnchor));
      assert.equal(r.decision.allowed, false);
      assert.match(r.decision.reason, /ROYAL_AUTH_SIGNATURE_INVALID/);
    });
  });

  test('L3 — أمرُ إيقافٍ موقَّعٌ بمفتاحِ المرساةِ يُرفَضُ، وبالمفتاحِ الملكيِّ يُقبَل', async () => {
    await withSystem(async ({ system, keys }) => {
      registerTestKing(keys.king);
      const halt = system.rootOfTrust.haltSwitch;
      const forged = signRoyalCommand(keys.king, {
        operation: 'halt',
        targetEpoch: halt.read().epoch,
        reason: 'مفتاحُ العُقدة',
      });
      await assert.rejects(
        () => halt.haltAsync('مفتاحُ العُقدة', forged),
        /HALT_ROYAL_COMMAND_REQUIRED/,
      );
      const genuine = signRoyalCommand(ROYAL_KEY.pair, {
        operation: 'halt',
        targetEpoch: halt.read().epoch,
        reason: 'أمرُ الملك',
      });
      await halt.haltAsync('أمرُ الملك', genuine);
      assert.equal(halt.isHalted(), true);
    });
  });

  test('L4 — توقيعُ المفتاحِ الملكيِّ لا يُقبَلُ توقيعَ مرساةٍ أو توجيه', async () => {
    await withSystem(async ({ system }) => {
      const payload = { kind: 'anchor', at: new Date().toISOString() };
      const byRoyal = softwareSign(
        null,
        Buffer.from(JSON.stringify(payload)),
        ROYAL_KEY.pair.privateKey,
      ).toString('base64url');
      assert.equal(system.rootOfTrust.anchorSigner.verify(payload, byRoyal), false);
    });
  });

  test('L5 — الإقلاعُ يُرَدُّ إن كانَ المفتاحُ الملكيُّ مفتاحَ المرساةِ أو الدفترِ أو غابَ أو خالفَ تثبيتَه', async () => {
    const keys = fixedKeys();
    const pemOf = (pair) => pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const cases = [
      [
        {
          XUUX_ROYAL_PUBLIC_KEY_PEM: pemOf(keys.king),
          XUUX_ROYAL_KEY_ID: kingIdOfPublicKey(keys.king.publicKey),
        },
        /ROYAL_KEY_NOT_SEPARATED/,
      ],
      [
        {
          XUUX_ROYAL_PUBLIC_KEY_PEM: pemOf(keys.ledgerPair),
          XUUX_ROYAL_KEY_ID: kingIdOfPublicKey(keys.ledgerPair.publicKey),
        },
        /ROYAL_KEY_NOT_SEPARATED/,
      ],
      [
        { XUUX_ROYAL_PUBLIC_KEY_PEM: '', XUUX_ROYAL_KEY_ID: '' },
        /ROYAL_KEY_REQUIRED_IN_PRODUCTION/,
      ],
      [{ XUUX_ROYAL_KEY_ID: 'king:' + '0'.repeat(24) }, /ROYAL_KEY_PIN_MISMATCH/],
    ];
    for (const [env, expected] of cases) {
      const root = tmpRoot();
      try {
        const { boot } = rig({ freshnessSocket: new TestFreshnessSocket(0n, 'wl303'), keys, env });
        await assert.rejects(() => boot(root), expected);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});
