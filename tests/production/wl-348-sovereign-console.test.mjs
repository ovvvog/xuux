// @ts-nocheck — حزامُ `WL-304` نفسُه (‏`wl-304-sealed-execution-path.test.mjs`) بلا أنواع.
// `WL-348`: الديوانُ الملكيُّ ومصادقةُ الملكِ القويّةُ في التركيبِ الإنتاجيّ.
//
// يُقلِعُ `createProductionSystem` نفسُه (‏بيئةُ إنتاج، سجلٌّ مختوم، دفترٌ موقَّعٌ في التوكن، مفتاحُ
// إيقافٍ يوقِّعُ في التوكن) بتوكنٍ محقونٍ وساعةِ اختبارٍ ومقبسِ حداثةٍ للاختبار — **وهو حزامُ
// `WL-304` نفسُه**. فما يُثبَتُ هنا تركيبُ الديوانِ على مكوّناتِ الإنتاج، لا مصدرُ حداثةٍ إنتاجيٌّ:
// `EXT-6`/`R3-A-01` مفتوحٌ، والمُشغِّلُ الإنتاجيُّ بلا مقبسٍ حقيقيٍّ لا يُقلِعُ أصلاً.

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
import { factorWitnessesFromSealedLog } from '../../src/production/sovereign-console.mjs';
import { InMemoryFreshnessSocket, fingerprint } from '../../src/root-of-trust/index.mjs';
import { factorCodeForStep, loadKingAuthPolicy } from '../../src/authn/index.mjs';
import { CONSOLE_ERRORS } from '../../src/console/index.mjs';
import { registerTestKing, royalKeyEnv, signRoyalCommand } from '../helpers/royal-halt-command.mjs';

const ROYAL_KEY = royalKeyEnv();
const AUTHN_POLICY = loadKingAuthPolicy();

/** مقبسُ حداثةٍ للاختبارِ بلا علامةِ testFixture — الحزامُ نفسُه في `WL-304`. */
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

/** خزنةُ أسرارِ العاملِ الثاني للاختبار — المصدرُ الإنتاجيُّ لها تبعيّةٌ مُعلَنةٌ لا مُنفَّذة. */
function testVault() {
  const secret = randomBytes(32).toString('hex');
  /** @type {Record<string, string>} */
  const vault = {};
  for (const device of AUTHN_POLICY.devices) vault[device.factorRef] = secret;
  return { secret, factorSecrets: { read: (/** @type {string} */ name) => vault[name] ?? null } };
}

function boot(root, { keys, factorSecrets = null }) {
  const env = {
    NODE_ENV: 'production',
    STATE_ENV: 'production',
    XUUX_ROOT_OF_TRUST_MODE: 'hsm',
    XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
    XUUX_PKCS11_TOKEN: 'xuux-test',
    XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
    XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
    XUUX_PKCS11_PIN: 'unused-by-injected-source',
    XUUX_KING_ID: 'king:' + fingerprint(keys.king.publicKey).slice(0, 24),
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
      sources: ['ci-test'],
      localSkewMs: 0,
    }),
  };
  return createProductionSystem(
    env,
    {
      root,
      freshnessSocket: keys.socket,
      clock: testClock,
      ...(factorSecrets === null ? {} : { factorSecrets }),
    },
    {
      openSource: async () => ({
        source: stableToken(keys.king, keys.aeadKey, keys.ledgerPair),
        close: async () => undefined,
      }),
    },
  );
}

function tmpRoot() {
  return registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-wl348-')));
}

/** أمرٌ ملكيٌّ بصيغةِ بوابةِ التاجِ موقَّعٌ بالمفتاحِ الملكيّ (‏`LIVE-24`). */
function crownCommand(fields) {
  const command = {
    // المعرّفُ مشتركٌ بينَ الأمرِ وسندِ مفتاحِ الإيقاف، فيلزمُه نمطُ السند (‏`[A-Za-z0-9_-]{16,128}`).
    id: fields.id ?? randomBytes(16).toString('hex'),
    action: fields.action,
    target: fields.target,
    payload: { reason: fields.reason },
    issuedAt: new Date().toISOString(),
  };
  const signature = softwareSign(
    null,
    Buffer.from(JSON.stringify(command)),
    ROYAL_KEY.pair.privateKey,
  ).toString('base64url');
  return { command, signature };
}

/**
 * سندُ مفتاحِ الإيقافِ (‏R5-B-07) بالمفتاحِ الملكيِّ على العهدِ الحاضر — بلا لمسٍ لساعةِ المفتاح:
 * المفتاحُ الإنتاجيُّ موصولٌ بساعتِه الموثوقةِ من المُشغِّل (‏`useTrustedClock`).
 */
function haltAuthority(halt, operation, reason, commandId) {
  return signRoyalCommand(ROYAL_KEY.pair, {
    operation,
    reason,
    commandId,
    targetEpoch: halt.read().epoch,
  });
}

async function session(system, secret, stepOffset = 0) {
  const device = AUTHN_POLICY.devices[0];
  assert.ok(device !== undefined);
  const { stepSeconds, digits, algorithm } = AUTHN_POLICY.secondFactor;
  const step = Math.floor(Date.now() / 1000 / stepSeconds) + stepOffset;
  const factorCode = factorCodeForStep({ secret, step, digits, algorithm });
  return {
    factorCode,
    opened: await system.kingAuth.authenticate({
      actorId: system.crown.king.id,
      deviceId: device.id,
      factorCode,
    }),
  };
}

async function sealedTypes(system) {
  await system.rootOfTrust.log.flush?.();
  return system.auditLog.events.map((event) => event.type);
}

describe('WL-348 — الديوانُ الملكيُّ في التركيبِ الإنتاجيّ', () => {
  test('C1 — الديوانُ ومصادقةُ الملكِ مركَّبانِ، وبلا أسرارِ العاملِ الثاني يُرَدُّ كلُّ أمرٍ مغلقاً', async () => {
    const root = tmpRoot();
    const keys = { ...fixedKeys(), socket: new TestFreshnessSocket(0n, 'wl348') };
    const system = await boot(root, { keys });
    try {
      assert.ok(system.royalConsole, 'لا ديوانَ في التركيبِ الإنتاجيّ.');
      assert.ok(system.kingAuth, 'لا مصادقةَ ملكٍ في التركيبِ الإنتاجيّ.');
      const device = AUTHN_POLICY.devices[0];
      await assert.rejects(
        system.kingAuth.authenticate({
          actorId: system.crown.king.id,
          deviceId: device?.id,
          factorCode: '0'.repeat(AUTHN_POLICY.secondFactor.digits),
        }),
        (error) => /SECRET_MISSING/.test(String(error.code)),
      );
      const signed = crownCommand({
        action: 'stop-state',
        target: 'state:sovereign',
        reason: 'بلا جلسة',
      });
      await assert.rejects(
        system.royalConsole.issue({
          command: 'cmd:halt',
          royalCommand: signed.command,
          signature: signed.signature,
        }),
        (error) => error.code === CONSOLE_ERRORS.AUTHENTICATION_REQUIRED,
      );
      assert.equal(system.rootOfTrust.ledger.state(signed.command.id), 'unknown');
      assert.equal(system.rootOfTrust.haltSwitch.read().state, 'running');
    } finally {
      await system.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('C2 — إيقافٌ بمسارِ التاجِ ثمّ استئنافٌ بمسارِ التعافي على الدفترِ الموقَّعِ والسجلِّ المختوم', async () => {
    const root = tmpRoot();
    const keys = { ...fixedKeys(), socket: new TestFreshnessSocket(0n, 'wl348') };
    const { secret, factorSecrets } = testVault();
    const system = await boot(root, { keys, factorSecrets });
    try {
      const { opened } = await session(system, secret);
      const halt = system.rootOfTrust.haltSwitch;

      const reason = 'إيقافٌ سياديٌّ من الديوانِ — WL-348';
      const stop = crownCommand({ action: 'stop-state', target: 'state:sovereign', reason });
      const stopAuthority = haltAuthority(halt, 'halt', reason, stop.command.id);
      const stopped = await system.royalConsole.issue({
        command: 'cmd:halt',
        royalCommand: stop.command,
        signature: stop.signature,
        sovereignSession: opened.token,
        haltCommand: stopAuthority,
      });
      assert.equal(stopped.status, 'executed');
      assert.equal(stopped.path, 'crown');
      assert.equal(halt.read().state, 'halted', 'التوجيهُ على القرصِ لم يصِر «موقوفاً».');
      assert.equal(system.rootOfTrust.ledger.state(stop.command.id), 'committed');

      const resumeReason = 'استئنافٌ سياديٌّ من الديوانِ — WL-348';
      const resume = crownCommand({
        action: 'resume-state',
        target: 'state:sovereign',
        reason: resumeReason,
      });
      const resumeAuthority = haltAuthority(halt, 'resume', resumeReason, resume.command.id);
      const resumed = await system.royalConsole.issue({
        command: 'cmd:resume',
        royalCommand: resume.command,
        signature: resume.signature,
        sovereignSession: opened.token,
        haltCommand: resumeAuthority,
      });
      assert.equal(resumed.status, 'executed');
      assert.equal(resumed.path, 'sovereign-recovery');
      assert.equal(halt.read().state, 'running');
      // مسارُ التعافي ثبَّتَ الحجزَ موقَّعاً في الدفترِ الإنتاجيّ — لا `commit` متزامنٌ مرفوض.
      assert.equal(system.rootOfTrust.ledger.state(resume.command.id), 'committed');

      const types = await sealedTypes(system);
      const consolePolicy = system.royalConsole.policy.audit;
      for (const expected of [
        AUTHN_POLICY.audit.factorConsumedEvent,
        AUTHN_POLICY.audit.sessionOpenedEvent,
        'crown.command.accepted',
        consolePolicy.recoveryEvent,
        consolePolicy.commandExecutedEvent,
      ]) {
        assert.ok(types.includes(expected), `قيدُ «${expected}» غائبٌ عن السجلِّ المختوم.`);
      }
      assert.equal(
        types.filter((t) => t === consolePolicy.commandExecutedEvent).length,
        2,
        'قيدا التنفيذِ ليسا اثنين في السجلِّ المختوم.',
      );
      assert.ok(system.auditLog.sealed, 'السجلُّ الإنتاجيُّ غيرُ مختوم.');
    } finally {
      await system.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('C3 — سندٌ غائبٌ أو غيرُ مربوطٍ يُرَدُّ قبلَ القبول، فلا يُحرَقُ المعرّف', async () => {
    const root = tmpRoot();
    const keys = { ...fixedKeys(), socket: new TestFreshnessSocket(0n, 'wl348') };
    const { secret, factorSecrets } = testVault();
    const system = await boot(root, { keys, factorSecrets });
    try {
      const { opened } = await session(system, secret);
      const halt = system.rootOfTrust.haltSwitch;
      const reason = 'إيقافٌ بلا سند';
      const bare = crownCommand({ action: 'stop-state', target: 'state:sovereign', reason });
      await assert.rejects(
        system.royalConsole.issue({
          command: 'cmd:halt',
          royalCommand: bare.command,
          signature: bare.signature,
          sovereignSession: opened.token,
        }),
        (error) =>
          error.code === CONSOLE_ERRORS.COMMAND_REJECTED && /haltCommand/.test(error.message),
      );
      assert.equal(system.rootOfTrust.ledger.state(bare.command.id), 'unknown');

      const other = crownCommand({ action: 'stop-state', target: 'state:sovereign', reason });
      const foreign = haltAuthority(halt, 'halt', reason, randomBytes(16).toString('hex')); // معرّفٌ آخر
      await assert.rejects(
        system.royalConsole.issue({
          command: 'cmd:halt',
          royalCommand: other.command,
          signature: other.signature,
          sovereignSession: opened.token,
          haltCommand: foreign,
        }),
        (error) => error.code === CONSOLE_ERRORS.COMMAND_REJECTED,
      );
      assert.equal(system.rootOfTrust.ledger.state(other.command.id), 'unknown');
      assert.equal(halt.read().state, 'running');
    } finally {
      await system.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('C4 — بعدَ إعادةِ التشغيل: الأمرانِ المنفَّذانِ لا يُعادانِ، ورمزُ العاملِ المستهلَكُ لا يفتحُ جلسةً ثانية', async () => {
    const root = tmpRoot();
    const keys = { ...fixedKeys(), socket: new TestFreshnessSocket(0n, 'wl348') };
    const { secret, factorSecrets } = testVault();
    const first = await boot(root, { keys, factorSecrets });
    const stopReason = 'إيقافٌ قبلَ إعادةِ التشغيل';
    const resumeReason = 'استئنافٌ قبلَ إعادةِ التشغيل';
    const stop = crownCommand({
      action: 'stop-state',
      target: 'state:sovereign',
      reason: stopReason,
    });
    const resume = crownCommand({
      action: 'resume-state',
      target: 'state:sovereign',
      reason: resumeReason,
    });
    /** @type {Record<string, unknown>} */ let stopAuthority;
    /** @type {Record<string, unknown>} */ let resumeAuthority;
    let factorCode;
    try {
      const opened = await session(first, secret);
      factorCode = opened.factorCode;
      const halt = first.rootOfTrust.haltSwitch;
      stopAuthority = haltAuthority(halt, 'halt', stopReason, stop.command.id);
      const stopped = await first.royalConsole.issue({
        command: 'cmd:halt',
        royalCommand: stop.command,
        signature: stop.signature,
        sovereignSession: opened.opened.token,
        haltCommand: stopAuthority,
      });
      assert.equal(stopped.status, 'executed');
      resumeAuthority = haltAuthority(halt, 'resume', resumeReason, resume.command.id);
      const resumed = await first.royalConsole.issue({
        command: 'cmd:resume',
        royalCommand: resume.command,
        signature: resume.signature,
        sovereignSession: opened.opened.token,
        haltCommand: resumeAuthority,
      });
      assert.equal(resumed.status, 'executed');
    } finally {
      await first.close();
    }
    const second = await boot(root, { keys, factorSecrets });
    try {
      // شهودُ الاستهلاكِ مختومةٌ على القرص، وتُفتَحُ عندَ الإقلاعِ لا تُقرأُ نصّاً مُشفَّراً.
      const witnesses = await factorWitnessesFromSealedLog(
        second.auditLog,
        AUTHN_POLICY.audit.factorConsumedEvent,
      );
      assert.equal(witnesses.length, 1);
      assert.equal(typeof witnesses[0]?.data.step, 'number');
      const device = AUTHN_POLICY.devices[0];
      await assert.rejects(
        second.kingAuth.authenticate({
          actorId: second.crown.king.id,
          deviceId: device?.id,
          factorCode,
        }),
        (error) => /FACTOR_REPLAYED/.test(String(error.code)),
        'رمزُ العاملِ نفسُه فتحَ جلسةً بعدَ إعادةِ التشغيل.',
      );
      assert.equal(second.rootOfTrust.haltSwitch.read().state, 'running');
      // جلسةٌ بعاملٍ جديدٍ (‏الخطوةُ التالية) ثمّ إعادةُ الأمرينِ المنفَّذين ⇐ مرفوضانِ من الدفترِ الدائم.
      const fresh = await session(second, secret, 1);
      await assert.rejects(
        second.royalConsole.issue({
          command: 'cmd:halt',
          royalCommand: stop.command,
          signature: stop.signature,
          sovereignSession: fresh.opened.token,
          haltCommand: stopAuthority,
        }),
        (error) => error.code === CONSOLE_ERRORS.REPLAYED_COMMAND,
      );
      await assert.rejects(
        second.royalConsole.issue({
          command: 'cmd:resume',
          royalCommand: resume.command,
          signature: resume.signature,
          sovereignSession: fresh.opened.token,
          haltCommand: resumeAuthority,
        }),
        (error) => error.code === CONSOLE_ERRORS.REPLAYED_COMMAND,
      );
      assert.equal(second.rootOfTrust.haltSwitch.read().state, 'running');
    } finally {
      await second.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('C5 — الجلسةُ لا تُسلَّمُ قبلَ أن يُختَمَ شاهدُ استهلاكِ العامل (‏بلا تفريغٍ للطابور)', async () => {
    const root = tmpRoot();
    const keys = { ...fixedKeys(), socket: new TestFreshnessSocket(0n, 'wl348') };
    const { secret, factorSecrets } = testVault();
    const system = await boot(root, { keys, factorSecrets });
    try {
      const before = system.auditLog.events.length;
      await session(system, secret);
      // يُقرأُ السجلُّ المختومُ الخامُ مباشرةً — لا `flush` ولا انتظار: ما في الطابورِ لا يُعَدّ.
      const sealedNow = system.auditLog.events.slice(before).map((event) => event.type);
      assert.ok(
        sealedNow.includes(AUTHN_POLICY.audit.factorConsumedEvent),
        'سُلِّمت الجلسةُ وشاهدُ استهلاكِ العاملِ ما زالَ في الطابورِ غيرَ مختوم.',
      );
      assert.ok(sealedNow.includes(AUTHN_POLICY.audit.sessionOpenedEvent));
    } finally {
      await system.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
