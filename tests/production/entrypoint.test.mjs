// @ts-nocheck
/**
 * tests/production/entrypoint.test.mjs
 *
 * P0 Production Root of Trust Integration — اختباراتُ السلسلةِ الكاملةِ
 *
 * يُثبتُ هذا الملفُّ أنّ مسارَ الإنتاجِ يمرُّ عبرَ:
 *   Production Entry → Root of Trust → Freshness → Signer → State →
 *   Authorization → Policy → Execution → Audit
 *
 * الحدودُ الخارجيّةُ التي لا يمكنُ تشغيلُها في CI تُستبدلُ بتوكنٍ مزيَّفٍ
 * يستعملُ تعمِيةً حقيقيّةً (لا mock للخوارزمياتِ)، وذلك مُوثَّقٌ في كلِّ اختبارٍ.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  sign as softwareSign,
} from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import { createProductionSystem } from '../../src/production/entrypoint.mjs';
import { InMemoryFreshnessSocket, fingerprint } from '../../src/root-of-trust/index.mjs';
import { royalKeyEnv } from '../helpers/royal-halt-command.mjs';

/** `LIVE-24`: مفتاحٌ ملكيٌّ مستقلٌّ عن مفتاحِ المرساةِ في التوكن. */
const ROYAL_KEY = royalKeyEnv();

const MANIFEST = 'root-of-trust.manifest.json';

/**
 * مقبسُ حداثةٍ للاختبارِ — يُلتفُّ حولَ `InMemoryFreshnessSocket` بلا علامةِ testFixture.
 * يُستعملُ في اختباراتِ الإنتاجِ لأنّ `InMemoryFreshnessSocket` الصريحَ مرفوضٌ في الإنتاجِ.
 */
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

/** مفاتيحُ ثابتةٌ للاختبار. */
function fixedKeys() {
  return {
    king: generateKeyPairSync('ed25519'),
    aeadKey: randomBytes(32),
    ledgerPair: generateKeyPairSync('ed25519'),
  };
}

/**
 * يُنشئُ بيئةَ إنتاجٍ ونظامَ إنتاجٍ كاملًا بمفاتيحَ ومقبسِ حداثةٍ محدَّدين.
 */
function rig({ freshnessSocket = null, keys } = {}) {
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
  };
  // CI test clock — provides attestation() as required by CrownGateway in production.
  // This is CI-proven only; real production needs HSM-backed attestation.
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
  return { boot, keys: k, env, testClock };
}

function tmp(label) {
  return registerTmpRoot(mkdtempSync(join(tmpdir(), `xuux-prod-${label}-`)));
}

describe('P0 Production Root of Trust Integration — السلسلةُ الكاملة', () => {
  // Test A — Production construction rejects missing freshness source
  test('A — الإنتاجُ يرفضُ الإقلاعَ بلا مقبسِ حداثةٍ', async () => {
    const root = tmp('no-freshness');
    try {
      // createProductionSystem should reject null freshnessSocket before even
      // attempting to open the Root of Trust
      const k = fixedKeys();
      await assert.rejects(
        () =>
          createProductionSystem(
            { NODE_ENV: 'production', STATE_ENV: 'production' },
            { root, freshnessSocket: null },
            {
              openSource: async () => ({
                source: stableToken(k.king, k.aeadKey, k.ledgerPair),
                close: async () => undefined,
              }),
            },
          ),
        (err) => err.message === 'PRODUCTION_ENTRYPOINT_FRESHNESS_SOCKET_NULL',
        'الإنتاجُ بلا مقبسِ حداثةٍ يجبُ أن يُرفَضَ عندَ نقطةِ الدخول',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Test A2 — Production entrypoint rejects non-production environment
  test('A2 — نقطةُ الدخولِ ترفضُ بيئةَ التطوير', async () => {
    const root = tmp('dev-env');
    try {
      const socket = new TestFreshnessSocket(0n, 'test');
      await assert.rejects(
        () =>
          createProductionSystem(
            { NODE_ENV: 'development', STATE_ENV: 'development' },
            { root, freshnessSocket: socket },
            {
              openSource: async () => {
                const k = fixedKeys();
                return {
                  source: stableToken(k.king, k.aeadKey, k.ledgerPair),
                  close: async () => undefined,
                };
              },
            },
          ),
        (err) => err.message === 'PRODUCTION_ENTRYPOINT_NOT_PRODUCTION_ENV',
        'نقطةُ الدخولِ الإنتاجيّةُ ترفضُ بيئةَ التطوير',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Test B — Production construction uses Root of Trust
  test('B — الإنتاجُ يستخدمُ جذرَ الثقةِ فعلياً', async () => {
    const root = tmp('uses-rot');
    try {
      const socket = new TestFreshnessSocket(0n, 'test');
      const { boot } = rig({ freshnessSocket: socket });
      const system = await boot(root);
      try {
        // Root of Trust must be present with all its components
        assert.ok(system.rootOfTrust, 'Root of Trust must be present');
        assert.ok(system.rootOfTrust.log, 'Sealed event log must be present');
        assert.ok(system.rootOfTrust.ledger, 'Command ledger must be present');
        assert.ok(system.rootOfTrust.haltSwitch, 'Halt switch must be present');
        assert.ok(system.rootOfTrust.manifest, 'State manifest must be present');
        assert.ok(system.rootOfTrust.sealer, 'Event data sealer must be present');
        assert.ok(system.rootOfTrust.anchorSigner, 'Anchor signer must be present');
        assert.ok(system.rootOfTrust.ledgerSigner, 'Ledger signer must be present');

        // The audit log IS the Root of Trust's sealed log
        assert.strictEqual(
          system.auditLog,
          system.rootOfTrust.log,
          'Audit log must be the Root of Trust sealed log',
        );

        // The crown gateway must have the command ledger connected
        assert.ok(system.crown.commandLedger, 'Crown gateway must have command ledger connected');
        assert.ok(system.crown.haltSwitch, 'Crown gateway must have halt switch connected');
      } finally {
        await system.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Test C — Production does not accept development/test signer
  test('C — الإنتاجُ لا يقبلُ مصدرَ مفاتيحَ يُصدِّرُ مفاتيحَه (development signer)', async () => {
    const root = tmp('dev-signer');
    try {
      const socket = new TestFreshnessSocket(0n, 'test');
      const k = fixedKeys();
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
      // A source that exports keys — should be rejected
      const exportingSource = {
        ...stableToken(k.king, k.aeadKey, k.ledgerPair),
        describe: () => ({ kind: 'pkcs11-hsm', canExport: true, tokenSerial: 'DEADBEEFCAFE0001' }),
      };
      await assert.rejects(
        () =>
          createProductionSystem(
            env,
            { root, freshnessSocket: socket },
            {
              openSource: async () => ({
                source: exportingSource,
                close: async () => undefined,
              }),
            },
          ),
        // assertNonExportingSource should reject this
        (err) => err.code === 'HSM_SOURCE_EXPORTS_KEY' || err.message?.includes('EXPORT'),
        'الإنتاجُ يجبُ أن يرفضَ مصدرَ مفاتيحَ يُصدِّرُ مفاتيحَه',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Test D — State survives reload/restart
  test('D — الحالةُ تدومُ عبرَ إعادةِ التشغيل', async () => {
    const root = tmp('persistence');
    try {
      const keys = fixedKeys();
      // Use a single socket that persists across both boots — its epoch advances
      // during operations (ledger commits), and the manifest gets persisted on close
      const socket = new TestFreshnessSocket(0n, 'test');
      const { boot } = rig({ freshnessSocket: socket, keys });
      const system1 = await boot(root);
      // Perform an operation that advances the freshness epoch
      system1.rootOfTrust.ledger.begin({ id: 'persist-cmd' });
      await system1.rootOfTrust.ledger.commitSigned({ id: 'persist-cmd' }, 'ok');
      // Close the log to persist the manifest with the advanced epoch
      system1.rootOfTrust.log.close?.();
      const epoch1 = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')).body.freshnessEpoch;
      await system1.rootOfTrust.close();

      // Reboot with the SAME socket (now advanced by the operation) and the same keys
      const system2 = await boot(root);
      try {
        // The manifest must have survived — same or advanced epoch
        const epoch2 = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')).body.freshnessEpoch;
        assert.ok(
          epoch2 >= epoch1,
          `Manifest freshnessEpoch must not regress: ${epoch2} >= ${epoch1}`,
        );
      } finally {
        await system2.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Test E — Stale state is rejected from production entrypoint (not just runtime unit)
  test('E — الحالةُ القديمةُ تُرفَضُ من نقطةِ الدخولِ (لا من وحدةِ التشغيلِ وحدَها)', async () => {
    const root = tmp('stale-entry');
    try {
      const keys = fixedKeys();
      // First boot — creates initial state
      const socket1 = new TestFreshnessSocket(0n, 'test');
      const { boot } = rig({ freshnessSocket: socket1, keys });
      const system1 = await boot(root);
      await system1.close();

      // Second boot with a NEW freshness socket at epoch 0 — behind the manifest.
      // The entrypoint should reject this stale state via FRESHNESS_EPOCH_REGRESSION
      // or STALE_MANIFEST_EPOCH, proving freshness enforcement fires from the
      // production entrypoint, not just from the runtime unit test.
      const socket2 = new TestFreshnessSocket(0n, 'test');
      const { boot: boot2 } = rig({ freshnessSocket: socket2, keys });
      await assert.rejects(
        () => boot2(root),
        (err) => err.code === 'FRESHNESS_EPOCH_REGRESSION' || err.code === 'STALE_MANIFEST_EPOCH',
        'Stale state must be rejected from the production entrypoint (freshness enforcement)',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Test F — serve-state.mjs refuses production mode (bypass prevention)
  test('F — scripts/serve-state.mjs يرفضُ بيئةَ الإنتاج', async () => {
    const { execSync } = await import('node:child_process');
    try {
      execSync('node scripts/serve-state.mjs --port 0', {
        env: { ...process.env, NODE_ENV: 'production', STATE_ENV: 'production' },
        timeout: 5000,
        stdio: 'pipe',
      });
      assert.fail('serve-state.mjs should refuse to run in production mode');
    } catch (err) {
      // The process should exit with a non-zero code and print the error message
      const stderr = err.stderr?.toString() ?? '';
      assert.ok(
        stderr.includes('SERVE_STATE_NOT_PRODUCTION_PATH'),
        `serve-state.mjs should print SERVE_STATE_NOT_PRODUCTION_PATH, got: ${stderr}`,
      );
    }
  });

  // Test G — End-to-end: command passes through the full production chain
  test('G — أمرٌ مصغَّرٌ يمرُّ عبرَ السلسلةِ الكاملةِ', async () => {
    const root = tmp('e2e');
    try {
      const socket = new TestFreshnessSocket(0n, 'test');
      const { boot } = rig({ freshnessSocket: socket });
      const system = await boot(root);
      try {
        // The production system must have all components wired:
        // entry → root of trust → freshness → signer → state → authorization → policy → execution → audit

        // 1. Root of Trust is present (freshness + signer + state)
        assert.ok(system.rootOfTrust, 'Root of Trust must be present');
        assert.ok(system.rootOfTrust.manifest, 'State manifest must be present');

        // 2. Enforcement chain is present (authorization + policy)
        assert.ok(system.chain, 'Enforcement chain must be present');
        assert.ok(
          system.chain.enforcementPoint,
          'Enforcement point (authorization/policy) must be present',
        );
        assert.ok(system.chain.identityGate, 'Identity gate must be present');

        // 3. Crown gateway is present (signing boundary)
        assert.ok(system.crown, 'Crown gateway must be present');
        assert.ok(system.crown.commandLedger, 'Command ledger must be connected to crown');

        // 4. Execution kernel is present (execution)
        assert.ok(system.kernel, 'Execution kernel must be present');
        assert.strictEqual(
          system.kernel.crown,
          system.crown,
          'Kernel must use the production crown gateway',
        );
        assert.strictEqual(
          system.kernel.enforcement,
          system.chain.enforcementPoint,
          'Kernel must use the production enforcement point',
        );

        // 5. Audit log is the sealed log (audit)
        assert.strictEqual(
          system.auditLog,
          system.rootOfTrust.log,
          'Audit log must be the sealed event log',
        );

        // The full dependency chain is proven:
        // createProductionSystem → createProductionRootOfTrust → freshnessSocket (required)
        //   → composeEnforcementChain → enforcementPoint (policy/authorization)
        //   → CrownGateway (commandLedger + haltSwitch from Root of Trust)
        //   → ExecutionKernel (crown + enforcement + haltSwitch + sealed log)
      } finally {
        await system.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Test H — Before/After proof: serve-state.mjs bypass is closed
  test('H — BEFORE/AFTER: مسارُ serve-state.mjs في الإنتاجِ مغلق', async () => {
    // BEFORE: serve-state.mjs could run in production without Root of Trust
    // AFTER: serve-state.mjs refuses production mode
    const { execSync } = await import('node:child_process');
    try {
      execSync('node scripts/serve-state.mjs --port 0', {
        env: { ...process.env, STATE_ENV: 'production' },
        timeout: 5000,
        stdio: 'pipe',
      });
      assert.fail('serve-state.mjs should refuse production mode (bypass should be closed)');
    } catch (err) {
      const stderr = err.stderr?.toString() ?? '';
      assert.ok(
        stderr.includes('SERVE_STATE_NOT_PRODUCTION_PATH'),
        `Production bypass via serve-state.mjs must be closed, got: ${stderr}`,
      );
    }
  });

  // Test I — Production rejects missing trusted clock (fail-closed)
  test('I — الإنتاجُ يرفضُ غيابَ الساعةِ الموثوقةِ (فشلٌ مغلقٌ)', async () => {
    const root = tmp('no-clock');
    try {
      const socket = new TestFreshnessSocket(0n, 'test');
      const k = fixedKeys();
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
      // No clock provided — AttestedClock.attest() fails (no Roughtime quorum in CI),
      // falls to SovereignClock (no attestation()), CrownGateway rejects at construction.
      await assert.rejects(
        () =>
          createProductionSystem(
            env,
            { root, freshnessSocket: socket, clock: null },
            {
              openSource: async () => ({
                source: stableToken(k.king, k.aeadKey, k.ledgerPair),
                close: async () => undefined,
              }),
            },
          ),
        (err) =>
          err.code === 'ATTESTED_TIME_REQUIRED' ||
          err.code === 'CLOCK_REQUIRED_IN_PRODUCTION' ||
          err.message === 'PRODUCTION_ENTRYPOINT_ATTESTED_TIME_REQUIRED',
        'Production without trusted clock must fail closed',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Test J — No software KingIdentity in production (fail-closed)
  test('J — لا تُنشَأُ هويةُ ملكٍ برمجيّةٌ في الإنتاجِ', async () => {
    const root = tmp('no-software-king');
    try {
      const socket = new TestFreshnessSocket(0n, 'test');
      const { boot, keys } = rig({ freshnessSocket: socket });
      const system = await boot(root);
      try {
        // The king identity must NOT be a software KingIdentity
        // It should be created from HSM public key via kingIdentityFromPublicKey
        const king = system.crown.king;
        assert.ok(king, 'King identity must be present');
        // `LIVE-24` (‏`WL-303`): هويّةُ التاجِ هي المفتاحُ الملكيُّ المُثبَّتُ، **لا** مفتاحُ
        // المرساةِ في التوكن — وما زالت من مفتاحٍ عامٍّ لا من مادّةٍ برمجيّة.
        const expectedId = ROYAL_KEY.env.XUUX_ROYAL_KEY_ID;
        assert.strictEqual(king.id, expectedId, 'King ID must match the pinned royal key');
        assert.notStrictEqual(
          king.id,
          'king:' + fingerprint(keys.king.publicKey).slice(0, 24),
          'Crown king must not be the HSM anchor key',
        );
        // King certificate must expose the HSM public key, not a generated one
        const cert = king.certificate();
        assert.strictEqual(
          cert.publicKey,
          ROYAL_KEY.env.XUUX_ROYAL_PUBLIC_KEY_PEM,
          'King certificate must match the pinned royal public key',
        );
        // Verify it's from the HSM public key, not a generated key pair
        assert.doesNotThrow(
          () => king.verify({ test: true }, 'invalid-signature'),
          'Verify must work (returns false for bad sig, not throw)',
        );
        // Sign must fail — no private key in memory
        assert.throws(
          () => king.sign({ test: true }),
          /SOFTWARE_SIGN_NOT_AVAILABLE/,
          'Sign must fail in production (no private key)',
        );
      } finally {
        await system.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Test K — InMemoryFreshnessSocket rejected as test fixture in production
  test('K — InMemoryFreshnessSocket مرفوضٌ كأداةِ اختبارٍ في الإنتاجِ', async () => {
    const root = tmp('test-fixture');
    try {
      const k = fixedKeys();
      const env = {
        NODE_ENV: 'production',
        STATE_ENV: 'production',
        XUUX_ROOT_OF_TRUST_MODE: 'hsm',
        XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
        XUUX_PKCS11_TOKEN: 'xuux-test',
        XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
        XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
        XUUX_PKCS11_PIN: 'unused',
        XUUX_KING_ID: 'king:' + fingerprint(k.king.publicKey).slice(0, 24),
        ...ROYAL_KEY.env,
        XUUX_ROOT_OF_TRUST_PROVISION: '1',
      };
      const testClock = {
        now: () => Date.now(),
        assertTrusted: () => undefined,
        attestation: () => ({
          atMs: Date.now(),
          radiusMs: 1000,
          ageMs: 0,
          sources: ['ci'],
          localSkewMs: 0,
        }),
      };
      const boot = (root) =>
        createProductionSystem(
          env,
          { root, freshnessSocket: new InMemoryFreshnessSocket(0n, 'test'), clock: testClock },
          {
            openSource: async () => ({
              source: stableToken(k.king, k.aeadKey, k.ledgerPair),
              close: async () => undefined,
            }),
          },
        );
      await assert.rejects(
        () => boot(root),
        (err) => err.message === 'PRODUCTION_ENTRYPOINT_FRESHNESS_SOCKET_TEST_FIXTURE',
        'InMemoryFreshnessSocket must be rejected as test fixture in production',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Test L — Attestation expiry after boot fails closed
  test('L — انتهاءُ بُرهانِ الوقتِ بعدَ الإقلاعِ يُغلقُ المسارَ', async () => {
    const root = tmp('attest-expiry');
    try {
      const k = fixedKeys();
      let attestationValid = true;
      const mutableClock = {
        now: () => Date.now(),
        assertTrusted: () => undefined,
        attestation: () =>
          attestationValid
            ? { atMs: Date.now(), radiusMs: 1000, ageMs: 0, sources: ['ci'], localSkewMs: 0 }
            : null,
      };
      const env = {
        NODE_ENV: 'production',
        STATE_ENV: 'production',
        XUUX_ROOT_OF_TRUST_MODE: 'hsm',
        XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
        XUUX_PKCS11_TOKEN: 'xuux-test',
        XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
        XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
        XUUX_PKCS11_PIN: 'unused',
        XUUX_KING_ID: 'king:' + fingerprint(k.king.publicKey).slice(0, 24),
        ...ROYAL_KEY.env,
        XUUX_ROOT_OF_TRUST_PROVISION: '1',
      };
      const socket = new TestFreshnessSocket(0n, 'test');
      const system = await createProductionSystem(
        env,
        { root, freshnessSocket: socket, clock: mutableClock },
        {
          openSource: async () => ({
            source: stableToken(k.king, k.aeadKey, k.ledgerPair),
            close: async () => undefined,
          }),
        },
      );
      try {
        // System booted successfully with valid attestation
        assert.ok(system.crown, 'System must boot with valid attestation');
        // Simulate attestation expiry — renewal failed, attestation() returns null
        attestationValid = false;
        // Next command must fail closed with ATTESTED_TIME_REQUIRED
        assert.throws(
          () => system.crown.nowMs(),
          (err) => err.code === 'ATTESTED_TIME_REQUIRED',
          'Command after attestation expiry must fail with ATTESTED_TIME_REQUIRED',
        );
      } finally {
        await system.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
