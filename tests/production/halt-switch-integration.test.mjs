// @ts-nocheck
/**
 * tests/production/halt-switch-integration.test.mjs
 *
 * P0-A integration — اختباراتُ التكاملِ تُثبتُ أنّ `royalCommandVerifier`
 * وصلَ إلى `HaltSwitch` عندَ إنشائِه داخلَ `createProductionRootOfTrust`،
 * وأنّ halt/resume يَفشلانِ مغلقاً بلا تفويضٍ تشفيريٍّ.
 *
 * هذا مختلفٌ عن `royal-command-verifier.test.mjs` الذي يَختبرُ الدالةَ منفردةً.
 * هنا نَختبرُ `system.rootOfTrust.haltSwitch` الفعليَّ.
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
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import { createProductionSystem } from '../../src/production/entrypoint.mjs';
import { InMemoryFreshnessSocket, fingerprint } from '../../src/root-of-trust/index.mjs';
import { canonicalRoyalCommand } from '../../src/root-of-trust/royal-command.mjs';

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
    king: generateKeyPairSync('ed25519'),
    aeadKey: randomBytes(32),
    ledgerPair: generateKeyPairSync('ed25519'),
  };
}

function royalCommand(keys, operation, opts = {}) {
  const kingId = 'king:' + fingerprint(keys.king.publicKey).slice(0, 24);
  const body = {
    operation,
    signerId: kingId,
    reason: opts.reason ?? 'test halt',
    at: opts.at ?? new Date().toISOString(),
  };
  const signature = softwareSign(
    null,
    Buffer.from(canonicalRoyalCommand(body)),
    keys.king.privateKey,
  ).toString('base64url');
  return { ...body, signature };
}

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
    XUUX_ROOT_OF_TRUST_PROVISION: '1',
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

function tmp(label) {
  return registerTmpRoot(mkdtempSync(join(tmpdir(), `xuux-halt-${label}-`)));
}

describe('P0-A Integration — HaltSwitch مع royalCommandVerifier موصول', () => {
  test('H1 — halt بلا أمرٍ ملكيٍّ يُرفَضُ مغلقاً', async () => {
    const root = tmp('no-command');
    try {
      const socket = new InMemoryFreshnessSocket(0n, 'test');
      const { boot } = rig({ freshnessSocket: socket });
      const system = await boot(root);
      try {
        await assert.rejects(
          () => system.rootOfTrust.haltSwitch.haltAsync('test'),
          /HALT_ROYAL_COMMAND_REQUIRED/,
          'Halt without royal command must fail closed',
        );
      } finally {
        await system.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('H2 — halt بأمرٍ مزوَّرٍ (بلا توقيعٍ) يُرفَضُ', async () => {
    const root = tmp('forged');
    try {
      const socket = new InMemoryFreshnessSocket(0n, 'test');
      const { boot } = rig({ freshnessSocket: socket });
      const system = await boot(root);
      try {
        await assert.rejects(
          () => system.rootOfTrust.haltSwitch.haltAsync('test', { operation: 'halt' }),
          /HALT_ROYAL_COMMAND_REQUIRED/,
          'Halt with unsigned command must fail closed',
        );
      } finally {
        await system.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('H3 — halt بأمرٍ موقَّعٍ صحيحٍ يُقبَلُ', async () => {
    const root = tmp('valid-halt');
    try {
      const socket = new InMemoryFreshnessSocket(0n, 'test');
      const { boot, keys } = rig({ freshnessSocket: socket });
      const system = await boot(root);
      try {
        const cmd = royalCommand(keys, 'halt');
        const directive = await system.rootOfTrust.haltSwitch.haltAsync('test halt', cmd);
        assert.ok(directive, 'Halt with valid royal command must succeed');
        assert.strictEqual(directive.state, 'halted');
      } finally {
        await system.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('H4 — توقيعُ halt لا يقبلُ resume', async () => {
    const root = tmp('cross-halt-resume');
    try {
      const socket = new InMemoryFreshnessSocket(0n, 'test');
      const { boot, keys } = rig({ freshnessSocket: socket });
      const system = await boot(root);
      try {
        const haltCmd = royalCommand(keys, 'halt');
        // First halt succeeds
        await system.rootOfTrust.haltSwitch.haltAsync('test halt', haltCmd);
        // Try to resume with halt signature — must fail
        const resumeWithHaltSig = { ...haltCmd, operation: 'resume' };
        await assert.rejects(
          () => system.rootOfTrust.haltSwitch.resumeAsync('test resume', resumeWithHaltSig),
          /HALT_ROYAL_COMMAND_REQUIRED/,
          'Halt signature must not accept resume',
        );
      } finally {
        await system.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('H5 — resume بأمرٍ موقَّعٍ صحيحٍ بعد halt يُقبَلُ', async () => {
    const root = tmp('valid-resume');
    try {
      const socket = new InMemoryFreshnessSocket(0n, 'test');
      const { boot, keys } = rig({ freshnessSocket: socket });
      const system = await boot(root);
      try {
        const haltCmd = royalCommand(keys, 'halt');
        await system.rootOfTrust.haltSwitch.haltAsync('test halt', haltCmd);
        // Resume with correctly signed resume command
        const resumeCmd = royalCommand(keys, 'resume', { reason: 'test resume' });
        const directive = await system.rootOfTrust.haltSwitch.resumeAsync('test resume', resumeCmd);
        assert.ok(directive, 'Resume with valid royal command must succeed');
      } finally {
        await system.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
