// @ts-nocheck
// WL-309 — `LIVE-27` / `R10-F-04`: المُبلِّغونَ الستّةُ على حاجبِ الحجرِ الإنتاجيّ.
//
// بعدَ `WL-306` صارَ `QuarantineWarden.report` المتزامنُ يُرَدُّ على السجلِّ المختومِ
// (‏`QUARANTINE_REPORT_REQUIRES_SEALED`) والمسارُ الإنتاجيُّ `reportSealed`. وبقيَ ستّةُ مُبلِّغينَ
// في الشفرةِ ينادونَ `report` المتزامنَ: `egress-gate` و`access-gate` و`memory-store` و`isolation`
// و`model-registry` و`inference-gate`. فمتى رُكِّبَ أحدُهم على حاجبِ `createProductionSystem`:
//   - إمّا صارَ الردُّ استثناءً يحلُّ محلَّ الرفضِ الأصليِّ (‏`egress`، `model-registry`، `inference`)،
//   - وإمّا ابتُلِعَ فلا يُعزَلُ أحدٌ ولا يُرى شيء (‏`access-gate`، `memory-store`)،
//   - وإمّا رُميَ داخلَ مستمعِ `close` لعمليّةٍ فرعيّةٍ فصارَ استثناءً غيرَ ملتقَطٍ (‏`isolation`).
//
// المقيسُ هنا لكلِّ مُبلِّغ: يُدفَعُ الشذوذُ إلى عتبتِه عبرَ البوابةِ نفسِها على الحاجبِ الإنتاجيّ،
// ثمّ «تموتُ» العمليّةُ بعدَ رجوعِ البوابةِ مباشرةً (‏التوكنُ يكفُّ عن الختم)، ثمّ يُقلَعُ من جديد:
// الرفضُ الأصليُّ برمزِه، والموضوعُ محجورٌ بعدَ الإقلاع.
//
// (‏التجهيزُ منسوخٌ من `wl-306-quarantine-report-sealed.test.mjs`.)

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
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import { createProductionSystem } from '../../src/production/entrypoint.mjs';
import { InMemoryFreshnessSocket, fingerprint } from '../../src/root-of-trust/index.mjs';
import { registerTestKing, royalKeyEnv } from '../helpers/royal-halt-command.mjs';
import { EGRESS_ERRORS, createEgressGate } from '../../src/egress/egress-gate.mjs';
import { ACCESS_ERRORS, DataAccessGate } from '../../src/data/access-gate.mjs';
import { loadClassificationLattice } from '../../src/data/classification.mjs';
import { AgentMemoryStore } from '../../src/data/memory-store.mjs';
import { MEMORY_LIMIT_ERRORS, loadMemoryPolicy } from '../../src/data/memory-limits.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { ModelRegistry, ModelState } from '../../src/models/model-registry.mjs';
import { createWeightStore } from '../../src/models/weight-store.mjs';
import { INFERENCE_ERRORS, createInferenceGate } from '../../src/inference/inference-gate.mjs';
import { ISOLATION_ERRORS, probeIsolation, runIsolated } from '../../src/execution/isolation.mjs';
import { QuarantineWarden } from '../../src/governance/quarantine.mjs';
import { IncidentRegister } from '../../src/identity/incident-register.mjs';

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

/** مفتاحُ «الوفاة»: إذا رُفِعَ كفَّ التوكنُ عن الختم (‏كما لو ماتت العمليّةُ أو انتُزِعَ التوكن). */
const DEATH = { dead: false };

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
          if (DEATH.dead) throw new Error('TOKEN_GONE');
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
  return registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-wl309-')));
}

/** سجلُّ أحداثٍ صغيرٌ لسجلِّ البوابةِ نفسِها؛ المقيسُ هو سجلُّ الحاجبِ المختوم. */
function memoryLog() {
  const events = [];
  return {
    events,
    append(type, actor, payload) {
      events.push({ type, actor, payload });
    },
  };
}

/** إقلاعٌ ⇒ فعلٌ ⇒ «وفاةٌ» بعدَ رجوعِه ⇒ إغلاقٌ ⇒ إقلاعٌ جديدٌ يُعادُ عليه الفحص. */
async function crashAfter(act, check) {
  const root = tmpRoot();
  const socket = new TestFreshnessSocket(0n, 'wl309');
  const { boot } = rig({ freshnessSocket: socket });
  DEATH.dead = false;
  const shared = {};
  try {
    const first = await boot(root);
    try {
      await act(first, shared);
    } finally {
      DEATH.dead = true;
      await first.close().catch((error) => {
        shared.closeError = error;
      });
      DEATH.dead = false;
    }
    const second = await boot(root);
    try {
      await check(second, shared);
    } finally {
      await second.close();
    }
  } finally {
    DEATH.dead = false;
    rmSync(root, { recursive: true, force: true });
  }
}

/** بعدَ الإقلاعِ: الموضوعُ محجورٌ، وقيدا الإشارةِ والعزلِ مختومانِ في السجلّ. */
function assertQuarantinedAfterRestart(system, subject) {
  assert.equal(
    system.chain.quarantine.isQuarantined(subject),
    true,
    `${subject} محجورٌ بعدَ الإقلاع`,
  );
  const types = system.auditLog.events
    .filter((e) => e.actor === subject && e.type.startsWith('quarantine.'))
    .map((e) => e.type);
  assert.ok(types.includes('quarantine.isolated'), `قيدُ العزلِ مختومٌ: ${types.join(',')}`);
  assert.equal(types.at(-1), 'quarantine.restored');
}

/** @param {string} code */
function codeIs(code) {
  return (error) => {
    assert.equal(error?.code ?? error?.message, code);
    return true;
  };
}

describe('WL-309 — LIVE-27/R10-F-04: كلُّ مُبلِّغٍ ينتظرُ ختمَ إشارتِه على الحاجبِ الإنتاجيّ', () => {
  test('E1 — egress-gate: الرفضُ برمزِه، والفاعلُ محجورٌ بعدَ «الوفاةِ» والإقلاع', async () => {
    const actorId = 'agent:wl309-egress';
    await crashAfter(
      async (system) => {
        const gate = createEgressGate({
          enforcementPoint: {
            authorize: async () => {
              throw new Error('UNREACHED');
            },
            verify: () => {
              throw new Error('UNREACHED');
            },
          },
          log: memoryLog(),
          destinations: [],
          quarantine: system.chain.quarantine,
          classifier: { classificationOf: () => 'internal' },
          env: {},
          transport: async () => ({ status: 202 }),
        });
        for (let i = 0; i < 3; i += 1) {
          await assert.rejects(
            gate.send({
              actor: { id: actorId, role: 'role:agent' },
              destination: 'x:nowhere',
              payload: 'x',
            }),
            codeIs(EGRESS_ERRORS.DESTINATION_UNKNOWN),
          );
        }
      },
      async (system) => assertQuarantinedAfterRestart(system, actorId),
    );
  });

  test('A1 — access-gate: رفضُ الكتابةِ إلى الأسفلِ برمزِه، والفاعلُ محجورٌ بعدَ الإقلاع', async () => {
    const actor = { id: 'agent:wl309-access', role: 'role:king' };
    await crashAfter(
      async (system) => {
        const gate = new DataAccessGate({
          log: memoryLog(),
          catalog: { get: async () => null },
          lattice: loadClassificationLattice(),
          quarantine: system.chain.quarantine,
        });
        for (let i = 0; i < 3; i += 1) {
          await assert.rejects(
            async () => gate.assertNoWriteDown(actor, 'public'),
            codeIs(ACCESS_ERRORS.WRITE_DOWN_REFUSED),
          );
        }
      },
      async (system) => assertQuarantinedAfterRestart(system, actor.id),
    );
  });

  test('M1 — memory-store: عبورُ ذاكرةِ وكيلٍ آخرَ عندَ العتبةِ يحجرُ العابرَ ويبقى بعدَ الإقلاع', async () => {
    const actor = {
      id: 'agent:wl309-beta',
      role: 'role:agent',
      kind: 'agent',
      state: 'active',
      capabilities: [],
    };
    const threshold = loadMemoryPolicy().anomaly.crossAgentAttemptsBeforeSignal;
    await crashAfter(
      async (system) => {
        const memory = new AgentMemoryStore({
          catalog: {},
          log: memoryLog(),
          repository: createMemoryRepository(AgentMemoryStore.spec),
          quarantine: system.chain.quarantine,
        });
        for (let i = 0; i < threshold; i += 1) {
          await assert.rejects(
            memory.list({ actor, agentId: 'agent:wl309-alpha' }),
            codeIs(MEMORY_LIMIT_ERRORS.ISOLATION_REFUSED),
          );
        }
      },
      async (system) => assertQuarantinedAfterRestart(system, actor.id),
    );
  });

  test('M2 — LIVE-29: نوعُ إشارةِ المخزنِ (‏`config/memory.yaml`) معلَنٌ للحاجبِ الحقيقيّ — العابرُ يُحجَرُ عندَ العتبة', async () => {
    const log = memoryLog();
    const warden = new QuarantineWarden({ incidents: new IncidentRegister({}), log });
    const memory = new AgentMemoryStore({
      catalog: {},
      log,
      repository: createMemoryRepository(AgentMemoryStore.spec),
      quarantine: warden,
    });
    const actor = { id: 'agent:wl309-gamma', role: 'role:agent', kind: 'agent', state: 'active' };
    const threshold = loadMemoryPolicy().anomaly.crossAgentAttemptsBeforeSignal;
    for (let i = 1; i < threshold; i += 1) {
      await assert.rejects(memory.list({ actor, agentId: 'agent:wl309-alpha' }));
    }
    assert.equal(warden.isQuarantined(actor.id), false, 'دونَ العتبةِ لا حجر');
    await assert.rejects(memory.list({ actor, agentId: 'agent:wl309-alpha' }));
    assert.equal(warden.isQuarantined(actor.id), true, 'عندَ العتبةِ يُحجَرُ العابر');
    assert.equal(log.events.filter((e) => e.type === 'quarantine.isolated').length, 1);
  });

  test('R1 — model-registry: تبدّلُ البصمةِ يُرفَضُ برمزِه، والنموذجُ محجورٌ بعدَ الإقلاع', async () => {
    const weightsRoot = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-wl309-weights-')));
    const shared = {};
    try {
      await crashAfter(
        async (system) => {
          const log = memoryLog();
          const weightStore = createWeightStore({ root: weightsRoot });
          const registry = new ModelRegistry({
            log,
            repository: createMemoryRepository(ModelRegistry.spec),
            weightStore,
            quarantine: system.chain.quarantine,
          });
          const model = await registry.register({
            name: 'wl309',
            modelVersion: '1.0.0',
            purpose: 'triage',
            provider: 'داخلي',
            weights: 'أوزان أصلية',
          });
          shared.id = model.id;
          await registry.transition(model.id, ModelState.SANDBOXED, 'اختبار');
          await registry.transition(model.id, ModelState.APPROVED, 'اعتماد');
          const target = weightStore.pathFor(model.fingerprint);
          const bytes = readFileSync(target);
          bytes[0] = (bytes[0] ?? 0) === 0 ? 1 : (bytes[0] ?? 1) - 1;
          writeFileSync(target, bytes);
          await assert.rejects(() => registry.activate(model.id), /MODEL_FINGERPRINT_MISMATCH/u);
        },
        async (system) => assertQuarantinedAfterRestart(system, shared.id),
      );
    } finally {
      rmSync(weightsRoot, { recursive: true, force: true });
    }
  });

  test('I1 — inference-gate: تجاوزُ الميزانيةِ برمزِه، والفاعلُ محجورٌ بعدَ الإقلاع', async () => {
    const actorId = 'agent:wl309-inference';
    await crashAfter(
      async (system) => {
        const gate = createInferenceGate({
          modelRegistry: { getActive: async (purpose) => ({ id: 'model:wl309', purpose }) },
          enforcementPoint: {
            authorize: async () => {
              throw new Error('UNREACHED');
            },
            verify: () => {
              throw new Error('UNREACHED');
            },
          },
          log: memoryLog(),
          execute: async () => {
            throw new Error('UNREACHED');
          },
          quarantine: system.chain.quarantine,
          tokensPerWindow: 5,
          budgetWindowMs: 60_000,
          budgetStore: { load: () => [], save: () => undefined },
          costLedger: { record: () => undefined },
          costInstitution: 'institution:digital-administration',
        });
        for (let i = 0; i < 3; i += 1) {
          await assert.rejects(
            gate.infer({
              actor: { id: actorId, role: 'role:minister' },
              purpose: 'planning',
              input: 'x',
              estimatedInputTokens: 6,
            }),
            codeIs(INFERENCE_ERRORS.BUDGET_EXCEEDED),
          );
        }
      },
      async (system) => assertQuarantinedAfterRestart(system, actorId),
    );
  });

  const capability = probeIsolation();
  test(
    'S1 — isolation: محاولةُ هروبٍ محجوبةٌ برمزِها، والفاعلُ محجورٌ بعدَ الإقلاع (‏لا استثناءَ في مستمعِ close)',
    { skip: capability.available ? false : `تخطٍّ معلن: ${capability.reason}` },
    async () => {
      const actor = 'agent:wl309-isolation';
      const helper = join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        'execution',
        'helpers',
        'isolation-network-escape.mjs',
      );
      const workdirs = [];
      try {
        await crashAfter(
          async (system) => {
            for (let i = 0; i < 3; i += 1) {
              const workdir = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-wl309-iso-')));
              workdirs.push(workdir);
              const writableDir = join(workdir, 'output');
              mkdirSync(writableDir);
              copyFileSync(helper, join(workdir, 'payload.mjs'));
              const result = await runIsolated({
                command: process.execPath,
                args: [join(workdir, 'payload.mjs')],
                workdir,
                writableDir,
                timeoutMs: 5_000,
                memoryLimitMb: 1_024,
                maxFileSizeMb: 4,
                processLimit: 32,
                actor,
                log: memoryLog(),
                quarantine: system.chain.quarantine,
              });
              assert.equal(result.code, ISOLATION_ERRORS.ESCAPE_BLOCKED);
            }
          },
          async (system) => assertQuarantinedAfterRestart(system, actor),
        );
      } finally {
        for (const dir of workdirs) rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
