// @ts-nocheck
// tests/root-of-trust/wl-326-commit-barrier.test.mjs
//
// `WL-326` — `LIVE-28` الخيار (ب) بعدَ حسمِ `D6` (‏كاتبٌ إنتاجيٌّ واحد) و`D3` (‏لا `ACK` قبلَ الدوام).
// كلُّ ما هنا على **جذرِ الثقةِ الإنتاجيِّ الحقيقيّ** (‏`createProductionRootOfTrust`): الحاجزُ
// والبيانُ المختومُ والسجلُّ المختومُ والدفترُ الموقَّعُ ومفتاحُ الإيقاف. البديلانِ الوحيدانِ:
// توكنٌ برمجيٌّ بعقدِ `HsmKeySource`، ومرجعُ حداثةٍ مربوطٌ بالحالةِ `testFixture` (‏يرفضُه المدخلُ
// الإنتاجيّ). فهذه أدلّةُ سلوكٍ للشفرة، لا أدلّةٌ على عتادٍ أو مرجعٍ خارجيٍّ (‏`D2` غيرُ محسوم).
//
// الأقسام:
//   D6   كاتبٌ واحدٌ لـ`P8`/`P9` (‏`nodes/`، `acks/`) وللمخزن؛ القصودُ المُصادَقة؛ كشفُ الكاتبِ الأجنبيّ.
//   D3   ترتيبُ المراحل: لا `ACK` قبلَ الكتابةِ والتقدُّمِ والترقية، والحالُ على القرصِ عندَ `ACK`.
//   C    مصفوفةُ الانهيار C0–C12 بـ`SIGKILL` حقيقيٍّ في عمليّةٍ فرعيّة.
//   B    حكمُ الإقلاع: تشعُّبُ العهدِ نفسِه، واسترجاعُ الحالةِ الحاليّةِ بالضبط، والبصمة.
//   R    نتيجةُ تقدُّمٍ مجهولةٌ وإعادةُ المحاولة.
//   L    `LOG_ALREADY_LOCKED` لا يحجبُ الاستعادة؛ و`LIVE-35`/`LIVE-36`.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import fs, {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { constants as osConstants, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  HALT_EPOCH_SUFFIX,
  HALT_HISTORY_SUFFIX,
  HaltSwitch,
  InMemoryStateBoundFreshnessSocket,
  computeStateDigest,
  haltAckPayload,
  productionStateLayout,
  registerPossessionPayload,
  signHaltAck,
  stateManifestPath,
  submitRootIntent,
} from '../../src/root-of-trust/index.mjs';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import { FileStateBoundSocket, bootRoot, makeKeys, royalCommand } from '../helpers/wl-326-root.mjs';

const CHILD = fileURLToPath(new URL('../helpers/wl-326-crash-child.mjs', import.meta.url));

/** مجلدٌ مؤقّتٌ فيه الجذرُ وملفُّ المرجعِ خارجَه. */
function workspace() {
  const base = registerTmpRoot(mkdtempSync(join(tmpdir(), 'wl326-')));
  return {
    base,
    root: join(base, 'root'),
    socketFile: join(base, 'freshness.json'),
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

/** متنُ البيانِ على القرص. */
const manifestBody = (root) => JSON.parse(readFileSync(stateManifestPath(root), 'utf8')).body;

/** يمسكُ خطأً غيرَ متزامن. */
async function rejection(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return assert.fail('لم يُرفَعْ خطأ');
}

/** يمسكُ خطأً متزامناً. */
function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail('لم يُرفَعْ خطأ');
}

/** أمرٌ يُثبَّتُ عبرَ الحاجزِ كما يفعلُ التاج (‏حجزٌ + تثبيتٌ موقَّعٌ في معاملةٍ واحدة). */
async function commitCommand(runtime, id) {
  await runtime.ledger.transactAsync('crown.command', async () => {
    runtime.ledger.begin({ id });
    await runtime.ledger.commitSigned({ id });
  });
}

describe('D6 — كاتبٌ إنتاجيٌّ واحدٌ لـP8/P9 والمخزن (WL-326)', () => {
  test('مفتاحُ إيقافٍ إنتاجيٌّ بلا حاجزِ الجذرِ يُرَدُّ عندَ التركيب، والقارئُ لا يكتب', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const runtime = await bootRoot(ws.root, keys, new FileStateBoundSocket(ws.socketFile));
      const env = { NODE_ENV: 'production', STATE_ENV: 'production' };
      const file = join(ws.root, 'halt', 'directive.json');
      // كاتبٌ ثانٍ يحملُ كلَّ ما كانَ يكفيه قبلَ `WL-326` (‏حدٌّ وسجلٌّ مختوم) — يُرَدّ.
      const error = thrown(
        () =>
          new HaltSwitch(file, runtime.anchorSigner, {
            env,
            epochFloor: { read: () => 0, raise: () => undefined },
            logAsync: { appendSealed: async () => undefined },
          }),
      );
      assert.equal(error.code, 'HALT_SECONDARY_WRITER_FORBIDDEN');
      // والقارئُ يقرأُ ولا يكتب: كلُّ تبديلٍ يُرَدُّ قبلَ أيِّ كتابة.
      const reader = new HaltSwitch(file, runtime.anchorSigner, { env, readOnly: true });
      assert.equal(reader.read().state, 'running');
      const before = computeStateDigest(
        productionStateLayout(ws.root, join(ws.root, 'anchors.jsonl')),
      );
      assert.equal(thrown(() => reader.registerNode('n1')).code, 'HALT_READ_ONLY');
      assert.equal(
        (await rejection(() => reader.confirmHaltAsync('n1', 'x'))).code,
        'HALT_READ_ONLY',
      );
      assert.equal(
        computeStateDigest(productionStateLayout(ws.root, join(ws.root, 'anchors.jsonl'))),
        before,
        'لا أثرَ على الحالة',
      );
      await runtime.close();
    } finally {
      ws.cleanup();
    }
  });

  test('في عمليةِ الجذرِ: P8/P9 خارجَ الحاجزِ يُرَدّ، وعبرَه يدخلُ البصمةَ ويتقدّمُ المرجع', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      const runtime = await bootRoot(ws.root, keys, socket);
      const node = generateKeyPairSync('ed25519');
      const nodeKey = {
        publicKeyPem: node.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        sign: (payload) =>
          signHaltAck(node.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), payload),
      };
      // P8 متزامناً خارجَ الحاجز: رفضٌ قبلَ أيِّ كتابة.
      assert.equal(
        thrown(() => runtime.haltSwitch.registerNode('node-a', { nodeKey })).code,
        'STATE_WRITE_OUTSIDE_BARRIER',
      );
      assert.equal(existsSync(join(ws.root, 'halt', 'directive.json.nodes', 'node-a.json')), false);
      const epochBefore = socket.current().epoch;
      const digestBefore = manifestBody(ws.root).stateDigest;
      await runtime.haltSwitch.registerNodeAsync('node-a', { nodeKey });
      const afterRegister = manifestBody(ws.root);
      assert.equal(socket.current().epoch, epochBefore + 1n, 'P8 تقدّمَ بالمرجع');
      assert.notEqual(afterRegister.stateDigest, digestBefore, 'nodes/ داخلَ البصمة');
      assert.equal(afterRegister.freshnessAnchor, socket.current().anchor);

      // P9: إيقافٌ ثمَّ إقرارٌ موقَّع — خارجَ الحاجزِ مرفوض، وعبرَه يدخلُ البصمة.
      const reading = runtime.haltSwitch.read();
      await runtime.haltSwitch.haltAsync(
        'تمرين',
        royalCommand(keys, 'halt', 'تمرين', reading.epoch),
      );
      const halted = runtime.haltSwitch.read();
      const proof = nodeKey.sign(haltAckPayload(halted.directive.hash, halted.epoch, 'node-a'));
      assert.equal(
        thrown(() => runtime.haltSwitch.confirmHalt('node-a', proof)).code,
        'STATE_WRITE_OUTSIDE_BARRIER',
      );
      const digestBeforeAck = manifestBody(ws.root).stateDigest;
      await runtime.haltSwitch.confirmHaltAsync('node-a', proof);
      assert.notEqual(manifestBody(ws.root).stateDigest, digestBeforeAck, 'acks/ داخلَ البصمة');
      assert.deepEqual(runtime.haltSwitch.describe().confirmed, ['node-a']);
      await runtime.close();
    } finally {
      ws.cleanup();
    }
  });

  test('القصودُ المُصادَقة: تسجيلٌ بإثباتِ حيازة، وإقرارٌ موقَّع، وتثبيتٌ بـ06 — والمزوَّرُ يُرَدّ', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      const runtime = await bootRoot(ws.root, keys, socket);
      const node = generateKeyPairSync('ed25519');
      const privatePem = node.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      const publicPem = node.publicKey.export({ type: 'spki', format: 'pem' }).toString();
      const other = generateKeyPairSync('ed25519');
      const otherPem = other.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      // إثباتُ حيازةٍ بمفتاحٍ آخرَ ⇒ ROOT_INTENT_UNAUTHENTICATED، ولا أثر.
      const forged = submitRootIntent(
        ws.root,
        'register',
        {
          nodeId: 'node-b',
          publicKeyPem: publicPem,
          possession: signHaltAck(otherPem, registerPossessionPayload('node-b', publicPem)),
        },
        { fsync: false },
      );
      const genuine = submitRootIntent(
        ws.root,
        'register',
        {
          nodeId: 'node-b',
          publicKeyPem: publicPem,
          possession: signHaltAck(privatePem, registerPossessionPayload('node-b', publicPem)),
        },
        { fsync: false },
      );
      assert.equal(await runtime.drainIntentsAsync(), 2);
      const results = join(ws.root, 'root-of-trust.intents', 'results');
      const outcome = (id) => JSON.parse(readFileSync(join(results, `${id}.json`), 'utf8'));
      assert.equal(outcome(forged.id).ok, false);
      assert.equal(outcome(forged.id).code, 'ROOT_INTENT_UNAUTHENTICATED');
      assert.equal(outcome(genuine.id).ok, true);
      assert.equal(runtime.haltSwitch.nodes()[0].nodeKeyPem, publicPem);

      // تثبيتٌ موقَّعٌ بغيرِ 06 يُرَدّ؛ وبـ06 يُثبِّتُ الجذرُ عبرَ الحاجزِ ويرفعُ الشاهد.
      await commitCommand(runtime, 'cmd-intent-anchor');
      const { anchorIntentSigningBody, newRootIntentId } =
        await import('../../src/root-of-trust/index.mjs');
      const badId = newRootIntentId();
      const at = new Date().toISOString();
      const fakeSigner = { signAsync: async () => signHaltAck(otherPem, { x: 1 }) };
      submitRootIntent(
        ws.root,
        'anchor',
        { force: true, intervalMs: 60_000, signature: await fakeSigner.signAsync() },
        { id: badId, at, fsync: false },
      );
      const goodId = newRootIntentId();
      submitRootIntent(
        ws.root,
        'anchor',
        {
          force: true,
          intervalMs: 60_000,
          signature: await runtime.anchorSigner.signAsync(
            anchorIntentSigningBody({ id: goodId, at, force: true, intervalMs: 60_000 }),
          ),
        },
        { id: goodId, at, fsync: false },
      );
      await runtime.drainIntentsAsync();
      assert.equal(outcome(badId).code, 'ROOT_INTENT_UNAUTHENTICATED');
      assert.equal(outcome(goodId).ok, true);
      assert.ok(manifestBody(ws.root).anchoredCount > 0, 'الشاهدُ ارتفعَ في المعاملةِ نفسِها');
      assert.equal(manifestBody(ws.root).freshnessAnchor, socket.current().anchor);
      await runtime.close();
    } finally {
      ws.cleanup();
    }
  });

  test('كاتبٌ أجنبيٌّ في nodes/ يُكشَفُ: المعاملةُ التاليةُ تُسيَّج، والإقلاعُ يُرَدّ (B8)', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      const runtime = await bootRoot(ws.root, keys, socket);
      await commitCommand(runtime, 'cmd-before-foreign');
      // ما كانت تفعلُه أداةُ الإيقافِ قبلَ `WL-326`: كتابةٌ مباشرةٌ في `nodes/`.
      writeFileSync(
        join(ws.root, 'halt', 'directive.json.nodes', 'rogue.json'),
        JSON.stringify({ nodeId: 'rogue', pid: 1, at: 'x' }) + '\n',
      );
      const error = await rejection(() => commitCommand(runtime, 'cmd-after-foreign'));
      assert.equal(error.code, 'STATE_FOREIGN_WRITE_DETECTED');
      const fenced = await rejection(() => commitCommand(runtime, 'cmd-fenced'));
      assert.equal(fenced.code, 'COMMIT_BARRIER_FENCED');
      await runtime.close();
      const boot = await rejection(() => bootRoot(ws.root, keys, socket));
      assert.equal(boot.code, 'FRESHNESS_STATE_DIGEST_MISMATCH');
    } finally {
      ws.cleanup();
    }
  });
});

describe('D3 — لا ACK قبلَ الدوام (WL-326)', () => {
  test('الترتيب: كتابةٌ ← تقدُّمُ المرجع ← ترقيةُ البيان ← ACK، والحالُ على القرصِ عندَ ACK هي المُقَرّ', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      const runtime = await bootRoot(ws.root, keys, socket);
      const layout = productionStateLayout(ws.root, join(ws.root, 'anchors.jsonl'));
      const trace = [];
      const originalAdvance = socket.advanceState.bind(socket);
      socket.advanceState = async (from, to) => {
        trace.push('advance');
        return originalAdvance(from, to);
      };
      let atAck = null;
      runtime.commitBarrier.onStage = (stage) => {
        trace.push(stage);
        if (stage === 'ACK') {
          const body = manifestBody(ws.root);
          atAck = {
            staged: body.staged,
            epoch: body.freshnessEpoch,
            anchor: body.freshnessAnchor,
            digest: body.stateDigest,
            disk: computeStateDigest(layout),
            reference: socket.current(),
            committed: runtime.ledger.state('cmd-ack'),
          };
        }
      };
      await commitCommand(runtime, 'cmd-ack');
      trace.push('returned');
      assert.deepEqual(trace, ['S2', 'S3', 'advance', 'S4', 'S5', 'ACK', 'returned']);
      assert.equal(atAck.staged, null, 'لا ترحيلَ قائماً عندَ ACK');
      assert.equal(atAck.digest, atAck.disk, 'البصمةُ المختومةُ = الحالُ على القرص');
      assert.equal(BigInt(atAck.epoch), atAck.reference.epoch, 'المرجعُ تقدّمَ قبلَ ACK');
      assert.equal(atAck.anchor, atAck.reference.anchor);
      assert.equal(atAck.committed, 'committed');
      // والإيقافُ كذلك: لا يُرجَعُ التوجيهُ قبلَ ACK.
      trace.length = 0;
      const directive = await runtime.haltSwitch.haltAsync(
        'ترتيب',
        royalCommand(keys, 'halt', 'ترتيب', runtime.haltSwitch.read().epoch),
      );
      trace.push('returned');
      assert.equal(directive.state, 'halted');
      assert.deepEqual(trace.slice(-2), ['ACK', 'returned']);
      await runtime.close();
    } finally {
      ws.cleanup();
    }
  });
});

/**
 * يُشغِّلُ العمليّةَ الفرعيّةَ ويُعيدُ إشارةَ خروجِها ومخرجَها.
 * @param {object} config - الإعداد
 * @returns {{signal: string|null, status: number|null, stdout: string, stderr: string}} النتيجة
 */
function runChild(config, base) {
  const file = join(base, `child-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(config));
  const result = spawnSync(process.execPath, [CHILD, file], { encoding: 'utf8', timeout: 60_000 });
  return {
    signal: result.signal,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/**
 * جذرٌ مُهيَّأٌ مربوطٌ (‏B10) في عمليّةٍ فرعيّة، ثمَّ حالةٌ حاضرةٌ (‏أمرٌ مُثبَّت).
 * @returns {Promise<object>} السياق
 */
async function provisioned() {
  const ws = workspace();
  const keys = makeKeys();
  const boot = runChild(
    { root: ws.root, keys, socketFile: ws.socketFile, op: 'provision' },
    ws.base,
  );
  assert.equal(boot.status, 0, boot.stderr);
  const runtime = await bootRoot(ws.root, keys, new FileStateBoundSocket(ws.socketFile));
  await commitCommand(runtime, 'cmd-pre');
  await runtime.close();
  return { ...ws, keys };
}

/** جدولُ §8.1: النقطة ⇐ حكمُ الإقلاعِ والأثرُ المتوقَّعُ للأمر. */
const MATRIX = [
  {
    name: 'C0 قبلَ S2',
    kill: { stage: 'BEFORE_TXN' },
    boot: 'B1',
    state: 'unknown',
    advanced: false,
  },
  {
    name: 'C1 في أثناءِ ختمِ S2',
    kill: { armAtStart: true, renameMatch: 'root-of-trust.manifest.json' },
    boot: ['B1', 'B2'],
    state: 'unknown',
    advanced: false,
  },
  { name: 'C2 بعدَ S2', kill: { stage: 'S2' }, boot: 'B2', state: 'unknown', advanced: false },
  {
    name: 'C3 كتابةٌ ممزّقةٌ في S3',
    kill: { inFn: true },
    boot: 'B2',
    state: 'unknown',
    advanced: false,
  },
  { name: 'C4 بعدَ S3', kill: { stage: 'S3' }, boot: 'B2', state: 'unknown', advanced: false },
  {
    name: 'C5 في S4 قبلَ التطبيق',
    kill: { socket: 'kill-before-apply' },
    boot: 'B2',
    state: 'unknown',
    advanced: false,
  },
  {
    name: 'C6 في S4 طُبِّقَ وضاعَ الردّ',
    kill: { socket: 'kill-after-apply' },
    boot: 'B3',
    state: 'committed',
    advanced: true,
  },
  { name: 'C7 بعدَ S4', kill: { stage: 'S4' }, boot: 'B3', state: 'committed', advanced: true },
  {
    name: 'C8 في أثناءِ ختمِ S5',
    kill: { renameAfterStage: 'S4', renameMatch: 'root-of-trust.manifest.json' },
    boot: ['B1', 'B3'],
    state: 'committed',
    advanced: true,
  },
  {
    name: 'C9 بعدَ S5 وقبلَ ACK',
    kill: { stage: 'S5' },
    boot: 'B1',
    state: 'committed',
    advanced: true,
  },
  {
    name: 'C10 بعدَ ACK',
    kill: { stage: 'AFTER_ACK' },
    boot: 'B1',
    state: 'committed',
    advanced: true,
  },
];

describe('C0–C12 — مصفوفةُ الانهيارِ بـSIGKILL حقيقيٍّ على الجذرِ الإنتاجيّ (WL-326)', () => {
  for (const row of MATRIX) {
    test(row.name, async () => {
      const ctx = await provisioned();
      try {
        const socket = new FileStateBoundSocket(ctx.socketFile);
        const before = socket.current();
        const child = runChild(
          {
            root: ctx.root,
            keys: ctx.keys,
            socketFile: ctx.socketFile,
            op: 'command',
            id: 'cmd-crash',
            kill: row.kill,
          },
          ctx.base,
        );
        assert.equal(child.signal, 'SIGKILL', `العمليّةُ قُتِلَت: ${child.stderr}`);
        assert.equal(
          child.stdout.includes('ACK'),
          row.name.startsWith('C10'),
          'لا ACK إلا بعدَ S5',
        );
        const after = socket.current();
        assert.equal(after.epoch === before.epoch + 1n, row.advanced, 'المرجع');
        const runtime = await bootRoot(ctx.root, ctx.keys, socket);
        try {
          const expected = Array.isArray(row.boot) ? row.boot : [row.boot];
          assert.ok(
            expected.includes(runtime.freshnessBoot),
            `حكمُ الإقلاع ${runtime.freshnessBoot}`,
          );
          assert.equal(runtime.ledger.state('cmd-crash'), row.state);
          assert.equal(runtime.ledger.state('cmd-pre'), 'committed', 'ما قبلَه باقٍ');
          assert.equal(manifestBody(ctx.root).staged, null, 'لا ترحيلَ بعدَ الحكم');
          // والجذرُ يعملُ بعدَ الاستعادة — لا تعطيلَ (‏`LIVE-28`).
          await commitCommand(runtime, 'cmd-after-recovery');
          assert.equal(runtime.ledger.state('cmd-after-recovery'), 'committed');
        } finally {
          await runtime.close();
        }
      } finally {
        ctx.cleanup();
      }
    });
  }

  test('C11 التهيئة: سقوطٌ بعدَ advance الأوّلِ وقبلَ الترقية ⇒ B3 لا تعطيل (نظيرُ R10-F-01)', () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const child = runChild(
        {
          root: ws.root,
          keys,
          socketFile: ws.socketFile,
          op: 'provision',
          kill: { socket: 'kill-after-apply' },
        },
        ws.base,
      );
      assert.equal(child.signal, 'SIGKILL', child.stderr);
      const socket = new FileStateBoundSocket(ws.socketFile);
      assert.equal(socket.current().epoch, 1n, 'المرجعُ تقدّمَ إلى (1, A_1)');
      assert.notEqual(manifestBody(ws.root).staged, null, 'والبيانُ مُرحَّلٌ لم يُرقَّ');
      return bootRoot(ws.root, keys, socket).then(async (runtime) => {
        assert.equal(runtime.freshnessBoot, 'B3');
        assert.equal(manifestBody(ws.root).freshnessEpoch, 1);
        await runtime.close();
        ws.cleanup();
      });
    } catch (error) {
      ws.cleanup();
      throw error;
    }
  });

  test('C12 advance يرفضُ برمزٍ مسمّى: الأثرُ يبقى على القرصِ مُرحَّلاً، والحاجزُ يُسيَّج، والإقلاعُ يحكمُ صراحةً', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      const runtime = await bootRoot(ws.root, keys, socket);
      await commitCommand(runtime, 'cmd-pre');
      const committed = socket.current();
      const ledgerBefore = readFileSync(join(ws.root, 'commands.ledger'), 'utf8');
      // كاتبٌ آخرُ تقدّمَ بالمرجعِ في العهدِ نفسِه بمرساةٍ أخرى (‏انشقاق).
      socket.force({ epoch: committed.epoch + 1n, anchor: 'f'.repeat(64) });
      const error = await rejection(() => commitCommand(runtime, 'cmd-rejected'));
      assert.equal(error.code, 'FRESHNESS_STALE_TRANSITION');
      // ليس «بلا أثر» (‏افتراضُ `WL-325` السادس): الدفترُ على القرصِ يحملُ الأمر، والبيانُ مُرحَّل.
      assert.notEqual(readFileSync(join(ws.root, 'commands.ledger'), 'utf8'), ledgerBefore);
      assert.notEqual(manifestBody(ws.root).staged, null);
      assert.equal(
        (await rejection(() => commitCommand(runtime, 'x'))).code,
        'COMMIT_BARRIER_FENCED',
      );
      await runtime.close();
      // الإقلاعُ: المرجعُ في e+1 بمرساةٍ لا تشهدُ على ما على القرص ⇒ B4 تشعُّبٌ مسمّى.
      assert.equal(
        (await rejection(() => bootRoot(ws.root, keys, socket))).code,
        'FRESHNESS_SAME_EPOCH_FORK',
      );
      // وإن أُعيدَ المرجعُ إلى نقطةِ الترحيلِ (‏قرارُ مشغِّل) ⇒ B2: استرجاعٌ دقيقٌ إلى ما قبلَ المعاملة.
      socket.force(committed);
      const recovered = await bootRoot(ws.root, keys, socket);
      assert.equal(recovered.freshnessBoot, 'B2');
      assert.equal(readFileSync(join(ws.root, 'commands.ledger'), 'utf8'), ledgerBefore);
      assert.equal(recovered.ledger.state('cmd-rejected'), 'unknown');
      await recovered.close();
    } finally {
      ws.cleanup();
    }
  });
});

describe('B — حكمُ الإقلاع: تشعُّبُ العهدِ نفسِه والحالةُ الحاليّةُ بالضبط (WL-326)', () => {
  test('B6: العهدُ نفسُه بمرساتين ⇒ FRESHNESS_SAME_EPOCH_FORK', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      const runtime = await bootRoot(ws.root, keys, socket);
      await commitCommand(runtime, 'cmd-1');
      await runtime.close();
      socket.force({ epoch: socket.current().epoch, anchor: '0'.repeat(64) });
      assert.equal(
        (await rejection(() => bootRoot(ws.root, keys, socket))).code,
        'FRESHNESS_SAME_EPOCH_FORK',
      );
    } finally {
      ws.cleanup();
    }
  });

  test('لقطةٌ أقدمُ متّسقةٌ تُرفَض (B5)، ولقطةُ الحالةِ الحاليّةِ بالضبطِ تُقبَل (B1)', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      let runtime = await bootRoot(ws.root, keys, socket);
      await commitCommand(runtime, 'cmd-1');
      await runtime.close();
      const old = join(ws.base, 'snapshot-old');
      cpSync(ws.root, old, { recursive: true });
      runtime = await bootRoot(ws.root, keys, socket);
      await commitCommand(runtime, 'cmd-2');
      await runtime.close();
      const current = join(ws.base, 'snapshot-current');
      cpSync(ws.root, current, { recursive: true });
      // استرجاعُ القديمةِ بعدَ أمرٍ تالٍ ⇒ رفض.
      rmSync(ws.root, { recursive: true, force: true });
      cpSync(old, ws.root, { recursive: true });
      assert.equal(
        (await rejection(() => bootRoot(ws.root, keys, socket))).code,
        'STALE_MANIFEST_EPOCH',
      );
      // واسترجاعُ الحاليّةِ بالضبطِ ⇒ قبولٌ والأمرانِ مُثبَّتان.
      rmSync(ws.root, { recursive: true, force: true });
      cpSync(current, ws.root, { recursive: true });
      runtime = await bootRoot(ws.root, keys, socket);
      assert.equal(runtime.freshnessBoot, 'B1');
      assert.equal(runtime.ledger.state('cmd-2'), 'committed');
      await runtime.close();
      // وحالةٌ حاليّةٌ عُدِّلَ ملفٌّ منها خارجَ الكاتب ⇒ B8.
      appendFileSync(join(ws.root, 'revoked.jsonl'), '{"x":1}\n');
      assert.equal(
        (await rejection(() => bootRoot(ws.root, keys, socket))).code,
        'FRESHNESS_STATE_DIGEST_MISMATCH',
      );
    } finally {
      ws.cleanup();
    }
  });

  test('B10: ربطُ جذرٍ قائمٍ غيرِ مربوطٍ مُعلَنٌ لا مُستنبَط', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      // جذرٌ قائمٌ على المسارِ القديمِ (‏مقبسُ bump) ثمَّ يُوصَلُ مرجعٌ مربوط.
      const { InMemoryFreshnessSocket } = await import('../../src/root-of-trust/index.mjs');
      const legacy = await bootRoot(ws.root, keys, new InMemoryFreshnessSocket(0n, 'legacy'));
      await legacy.close();
      const socket = new FileStateBoundSocket(ws.socketFile);
      const undeclared = await rejection(() =>
        bootRoot(ws.root, keys, socket, { env: { XUUX_ROOT_OF_TRUST_PROVISION: '' } }),
      );
      assert.equal(undeclared.code, 'FRESHNESS_BINDING_UNDECLARED');
      const bound = await bootRoot(ws.root, keys, socket, {
        env: { XUUX_ROOT_OF_TRUST_PROVISION: '', XUUX_FRESHNESS_BIND_DECLARED: '1' },
      });
      assert.equal(bound.freshnessBoot, 'B10');
      assert.equal(socket.current().epoch, 1n);
      await bound.close();
    } finally {
      ws.cleanup();
    }
  });
});

describe('R — نتيجةُ تقدُّمٍ مجهولةٌ وإعادةُ المحاولة (WL-326)', () => {
  test('ضياعُ الردِّ بعدَ التطبيقِ يُحسَمُ بالقراءة؛ وفشلُ النقلِ قبلَه يُعادُ بالحُجَجِ نفسِها', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new InMemoryStateBoundFreshnessSocket();
      const runtime = await bootRoot(ws.root, keys, socket);
      const base = socket.applied;
      socket.failAfterApply(1);
      await commitCommand(runtime, 'cmd-after');
      assert.equal(socket.applied, base + 1, 'طُبِّقَ مرّةً واحدةً لا مرّتين');
      socket.failBeforeApply(2);
      await commitCommand(runtime, 'cmd-before');
      assert.equal(socket.applied, base + 2);
      assert.equal(runtime.ledger.state('cmd-before'), 'committed');
      await runtime.close();
    } finally {
      ws.cleanup();
    }
  });

  test('نتيجةٌ لا تُحسَم ⇒ FRESHNESS_ADVANCE_UNRESOLVED وتسييج؛ والإقلاعُ يحسمُها B2 أو B3', async () => {
    for (const fault of ['before', 'after']) {
      const ws = workspace();
      try {
        const keys = makeKeys();
        const socket = new InMemoryStateBoundFreshnessSocket();
        const runtime = await bootRoot(ws.root, keys, socket);
        // ‏'after': طُبِّقَ وضاعَ الردّ، ثمَّ كلُّ إعادةٍ تضيعُ قبلَ الوصول، والقراءةُ منقطعة.
        if (fault === 'after') socket.failAfterApply(1);
        socket.failBeforeApply(10);
        socket.failReads(10);
        const error = await rejection(() => commitCommand(runtime, 'cmd-unknown'));
        assert.equal(error.code, 'FRESHNESS_ADVANCE_UNRESOLVED');
        assert.equal(
          (await rejection(() => commitCommand(runtime, 'x'))).code,
          'COMMIT_BARRIER_FENCED',
        );
        await runtime.close();
        // والمرجعُ ما زالَ لا يُقرأ: الإقلاعُ يُرَدُّ مغلقاً (‏`B0`) لا يُخمِّن — حتى يعودَ المرجع.
        let rebooted = null;
        for (let attempt = 0; attempt < 20 && rebooted === null; attempt += 1) {
          try {
            rebooted = await bootRoot(ws.root, keys, socket);
          } catch (error) {
            assert.equal(error.code, 'FRESHNESS_SOURCE_UNAVAILABLE');
          }
        }
        assert.ok(rebooted, 'الإقلاعُ يحسمُ بعدَ عودةِ المرجع');
        assert.equal(rebooted.freshnessBoot, fault === 'before' ? 'B2' : 'B3');
        assert.equal(
          rebooted.ledger.state('cmd-unknown'),
          fault === 'before' ? 'unknown' : 'committed',
        );
        await rebooted.close();
      } finally {
        ws.cleanup();
      }
    }
  });
});

describe('L — القفلُ والختمُ والشاهد (WL-326: LOG_ALREADY_LOCKED، LIVE-35، LIVE-36)', () => {
  test('قفلُ سجلٍّ برقمِ عمليّتِنا لم تأخذْه هذه العمليّةُ (‏إعادةُ رقمٍ في حاوية) لا يحجبُ الاستعادة', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      let runtime = await bootRoot(ws.root, keys, socket);
      await commitCommand(runtime, 'cmd-1');
      await runtime.close();
      writeFileSync(
        join(ws.root, 'events.log.lock'),
        JSON.stringify({ pid: process.pid, at: 'stale-after-crash' }),
      );
      runtime = await bootRoot(ws.root, keys, socket);
      assert.equal(runtime.ledger.state('cmd-1'), 'committed');
      await runtime.close();
    } finally {
      ws.cleanup();
    }
  });

  test('وقفلٌ لعمليّةٍ حيّةٍ أخرى بلحظةِ بدئِها يبقى مانعاً (LOG_ALREADY_LOCKED)', async () => {
    const ws = workspace();
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']);
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      const runtime = await bootRoot(ws.root, keys, socket);
      await runtime.close();
      const { processStartTicks } = await import('../../src/root-of-trust/persistent-log.mjs');
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      writeFileSync(
        join(ws.root, 'events.log.lock'),
        JSON.stringify({ pid: holder.pid, start: processStartTicks(holder.pid), at: 'live' }),
      );
      const error = await rejection(() => bootRoot(ws.root, keys, socket));
      assert.equal(error.code, 'LOG_ALREADY_LOCKED');
    } finally {
      holder.kill('SIGKILL');
      ws.cleanup();
    }
  });

  test('LIVE-35: سقوطٌ بينَ نقلِ دفترِ الرفعِ إلى ملفِّ الختمِ والختم ⇒ لا ضياعَ لرفعٍ مُقَرّ', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      const runtime = await bootRoot(ws.root, keys, socket);
      await commitCommand(runtime, 'cmd-1');
      const committed = manifestBody(ws.root).ledgerCommitted;
      await runtime.close();
      // أثرُ السقوط: ملفُّ ختمٍ معلَّقٌ (‏`journal.sealing-*`) يحملُ سطرَ الدفترِ الحاليَّ إن وُجد.
      const journal = join(ws.root, 'root-of-trust.manifest.journal');
      const seq = manifestBody(ws.root).seq ?? 0;
      if (existsSync(journal)) {
        cpSync(journal, `${journal}.sealing-${seq + 1}`);
        rmSync(journal);
      } else {
        writeFileSync(`${journal}.sealing-${seq + 1}`, '');
      }
      const rebooted = await bootRoot(ws.root, keys, socket);
      assert.equal(rebooted.manifest.read().ledgerCommitted, committed);
      assert.equal(
        readdirSync(ws.root).some((name) => name.includes('.sealing-')),
        false,
        'ملفُّ الختمِ يُطوى ثمَّ يُزال',
      );
      await rebooted.close();
    } finally {
      ws.cleanup();
    }
  });

  test('LIVE-36: دفترٌ أمامَ شاهدِه بعدَ سقوطٍ مُرحَّلٍ يُسترجَعُ (B2) لا يُعطِّل', async () => {
    const ws = workspace();
    try {
      const ctx = await provisioned();
      ws.cleanup();
      try {
        // سقوطٌ بعدَ أن كُتِبَ الدفترُ (‏S3) وقبلَ أن يرتفعَ الشاهدُ ويتقدّمَ المرجع.
        const child = runChild(
          {
            root: ctx.root,
            keys: ctx.keys,
            socketFile: ctx.socketFile,
            op: 'command',
            id: 'cmd-36',
            kill: { stage: 'S3' },
          },
          ctx.base,
        );
        assert.equal(child.signal, 'SIGKILL');
        const runtime = await bootRoot(
          ctx.root,
          ctx.keys,
          new FileStateBoundSocket(ctx.socketFile),
        );
        assert.equal(runtime.freshnessBoot, 'B2');
        assert.equal(runtime.ledger.state('cmd-36'), 'unknown');
        assert.equal(runtime.ledger.state('cmd-pre'), 'committed');
        await runtime.close();
      } finally {
        ctx.cleanup();
      }
    } finally {
      ws.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `LIVE-65` (‏`D3` على خطأِ القرص): مزامنةُ المجلّدِ لا تُبتلَع، ولا `ACK` بعدَ فشلِها.
//
// حقنُ العطلِ بلا خطّافٍ في الإنتاج: تُستبدَلُ `openSync`/`fsyncSync`/`closeSync` في `node:fs`
// ثمَّ `syncBuiltinESMExports()` فتراها الاستيراداتُ المسمّاةُ في الوحداتِ المصرَّفة. يُسجَّلُ لكلِّ
// مقبضٍ مسارُه، فيُحقَنُ الخطأُ على مجلّدٍ بعينِه (‏أو ملفٍّ بعينِه) بعدَ مرحلةٍ بعينِها. والمواضعُ:
//   S1 `syncDir` في `commit-barrier.mts` (‏فتحُ سجلِّ التراجعِ، واسترجاعُ `B2`)
//   S2 `fsyncDirectory` في `state-manifest.mts` (‏ترقيةُ البيانِ في `S5`)
//   S3 `#fsyncDir` في `command-ledger.mts` (‏نشرُ اسمِ الحجزِ في `begin`)
// ─────────────────────────────────────────────────────────────────────────────

/** خطأٌ بشكلِ أخطاءِ `node:fs` (‏`code` و`errno` و`syscall`). */
function errnoError(code, syscall) {
  const errno = osConstants.errno[code];
  return Object.assign(new Error(`${code}: محقونٌ (LIVE-65), ${syscall}`), {
    code,
    errno: typeof errno === 'number' ? -errno : -1,
    syscall,
  });
}

/**
 * حاقنُ أعطالٍ في `node:fs`. القاعدةُ `{ op, dir, match, code, when }`: `op` ∈ open|fsync|close،
 * و`dir` نوعُ الهدف، و`match(path, stack)` يحصرُه، و`when()` يُسلِّحُه.
 * @returns {object} الحاقن
 */
function fsFaults() {
  const original = { openSync: fs.openSync, fsyncSync: fs.fsyncSync, closeSync: fs.closeSync };
  const paths = new Map();
  const rules = [];
  const events = [];
  const fire = (op, fd, path) => {
    let isDir;
    try {
      isDir = fd !== null ? fs.fstatSync(fd).isDirectory() : fs.statSync(path).isDirectory();
    } catch {
      isDir = false;
    }
    const stack = new Error().stack ?? '';
    for (const rule of rules) {
      if (rule.op !== op || rule.dir !== isDir) continue;
      if (rule.when && !rule.when()) continue;
      if (rule.match && !rule.match(path, stack)) continue;
      rule.hits += 1;
      events.push({ op, path, isDir, injected: rule.code });
      throw errnoError(rule.code, op);
    }
    events.push({ op, path, isDir, injected: null });
  };
  fs.openSync = function openSync(path, ...rest) {
    if (rules.some((r) => r.op === 'open')) fire('open', null, resolve(String(path)));
    const fd = original.openSync.call(this, path, ...rest);
    paths.set(fd, resolve(String(path)));
    return fd;
  };
  fs.fsyncSync = function fsyncSync(fd) {
    fire('fsync', fd, paths.get(fd) ?? null);
    return original.fsyncSync.call(this, fd);
  };
  fs.closeSync = function closeSync(fd) {
    const path = paths.get(fd) ?? null;
    paths.delete(fd);
    const result = original.closeSync.call(this, fd);
    if (rules.some((r) => r.op === 'close')) fire('close', null, path);
    return result;
  };
  syncBuiltinESMExports();
  return {
    events,
    fail(rule) {
      const full = { hits: 0, ...rule };
      rules.push(full);
      return full;
    },
    restore() {
      Object.assign(fs, original);
      syncBuiltinESMExports();
    },
  };
}

/**
 * جذرٌ إنتاجيٌّ مُقلَعٌ وحاقنٌ ومتتبِّعُ مراحل؛ ثمَّ يُنفِّذُ `body` ويُنظِّف.
 * @param {(ctx: object) => Promise<void>} body - الاختبار
 */
async function withFaultyRoot(body) {
  const ws = workspace();
  let faults = null;
  let runtime = null;
  try {
    const keys = makeKeys();
    const socket = new FileStateBoundSocket(ws.socketFile);
    runtime = await bootRoot(ws.root, keys, socket, DURABLE);
    await commitCommand(runtime, 'cmd-warm');
    const trace = [];
    const stage = { current: null };
    runtime.commitBarrier.onStage = (name) => {
      stage.current = name;
      trace.push(name);
    };
    faults = fsFaults();
    await body({ ws, keys, socket, runtime, trace, stage, faults });
  } finally {
    faults?.restore();
    await runtime?.close().catch(() => {});
    ws.cleanup();
  }
}

/** المزامنةُ مفعّلةٌ كما في المدخلِ الإنتاجيّ (‏`src/production/entrypoint.mjs`: `fsync: true`). */
const DURABLE = { fsync: true };

/**
 * الأمرُ ليس مُثبَّتاً: إمّا حالةٌ غيرُ `committed`، وإمّا رفضٌ مسمّىً للقراءة (‏دفترٌ أمامَ شاهدِه
 * بعدَ ختمٍ لم يتمّ) — وكلاهما ليس إقراراً.
 */
function assertNotCommitted(runtime, id) {
  let state;
  try {
    state = runtime.ledger.state(id);
  } catch (error) {
    assert.ok(typeof error.code === 'string' && error.code.length > 0, 'رفضٌ مسمّى');
    return;
  }
  assert.notEqual(state, 'committed');
}

const manifestDir = (root) => resolve(dirname(stateManifestPath(root)));

/**
 * يحصرُ الحقنَ في موضعٍ واحدٍ من الثلاثة. الجذرُ هو مجلّدُ البيانِ أيضاً، فيُعزَلُ S1 بمكدّسِ
 * `#openUndo` (‏ختمُ الترحيلِ في S2 يُزامِنُ المجلّدَ نفسَه قبلَ نداءِ `S2`)، ويُعزَلُ S2 بالمرحلة
 * (‏ترقيةُ البيانِ بعدَ `S4`)، وS3 بمجلّدِ الحجوزات.
 * @returns {{when?: Function, match: Function}} القاعدة
 */
function siteRule(site, ws, runtime, stage) {
  if (site === 'S1') {
    return { match: (p, stack) => p === resolve(ws.root) && stack.includes('openUndo') };
  }
  if (site === 'S2') {
    return { when: () => stage.current === 'S4', match: (p) => p === manifestDir(ws.root) };
  }
  const claims = resolve(runtime.ledger.claimsDir);
  return { match: (p) => p === claims };
}

describe('LIVE-65 — مزامنةُ المجلّدِ تفشلُ مغلقةً ولا ACK بعدَ فشلِها', () => {
  test('النجاح: كلُّ مزامنةِ مجلّدٍ لازمةٍ تقعُ قبلَ ACK، والترتيبُ ملفٌّ ثمَّ مجلّدُه', async () => {
    await withFaultyRoot(async ({ ws, runtime, trace, faults }) => {
      const claims = resolve(runtime.ledger.claimsDir);
      const root = resolve(ws.root);
      runtime.commitBarrier.onStage = (name) => {
        trace.push(name);
        faults.events.push({ op: 'stage', path: name });
      };
      await commitCommand(runtime, 'cmd-ok');
      assert.deepEqual(trace, ['S2', 'S3', 'S4', 'S5', 'ACK']);
      assert.equal(runtime.ledger.state('cmd-ok'), 'committed');
      const seq = faults.events;
      const ack = seq.findIndex((e) => e.op === 'stage' && e.path === 'ACK');
      const dirSyncs = seq.map((e, i) => ({ ...e, i })).filter((e) => e.op === 'fsync' && e.isDir);
      // S1: سجلُّ التراجعِ في الجذر — قبلَ S2.
      const s2 = seq.findIndex((e) => e.op === 'stage' && e.path === 'S2');
      assert.ok(
        dirSyncs.some((e) => e.path === root && e.i < s2),
        'S1 قبلَ S2',
      );
      // S3: مجلّدُ الحجوزات — بعدَ S2 وقبلَ ACK.
      assert.ok(
        dirSyncs.some((e) => e.path === claims && e.i > s2 && e.i < ack),
        'S3 قبلَ ACK',
      );
      // S2: مجلّدُ البيانِ بعدَ S4 وقبلَ S5 (‏ترقيةُ البيان)، ومسبوقٌ بمزامنةِ ملفِّه المؤقّت.
      const s4 = seq.findIndex((e) => e.op === 'stage' && e.path === 'S4');
      const s5 = seq.findIndex((e) => e.op === 'stage' && e.path === 'S5');
      const promoteDir = dirSyncs.find(
        (e) => e.path === manifestDir(ws.root) && e.i > s4 && e.i < s5,
      );
      assert.ok(promoteDir, 'مزامنةُ مجلّدِ البيانِ بينَ S4 وS5');
      const promoteFile = seq.findIndex(
        (e, i) =>
          e.op === 'fsync' &&
          !e.isDir &&
          i > s4 &&
          i < promoteDir.i &&
          String(e.path).includes('root-of-trust.manifest.json.tmp-'),
      );
      assert.ok(promoteFile > s4, 'الملفُّ يُزامَنُ قبلَ مجلّدِه');
      assert.ok(ack > promoteDir.i, 'ACK بعدَ مزامنةِ المجلّد');
      assert.equal(
        seq.filter((e) => e.injected !== null && e.injected !== undefined).length,
        0,
        'لا حقنَ في مسارِ النجاح',
      );
    });
  });

  test('S1 commit-barrier: EIO في مزامنةِ الجذرِ عندَ فتحِ سجلِّ التراجع ⇒ يُرفَعُ ولا S2 ولا ACK', async () => {
    await withFaultyRoot(async ({ ws, runtime, trace, stage, faults }) => {
      const rule = faults.fail({
        op: 'fsync',
        dir: true,
        code: 'EIO',
        ...siteRule('S1', ws, runtime, stage),
      });
      const error = await rejection(() => commitCommand(runtime, 'cmd-s1'));
      assert.equal(error.code, 'EIO');
      assert.ok(rule.hits >= 1, 'الحقنُ وقع');
      assert.ok(!trace.includes('S2'), 'لا ترحيلَ بلا سجلِّ تراجعٍ دائم');
      assert.ok(!trace.includes('ACK'));
      assert.notEqual(runtime.ledger.state('cmd-s1'), 'committed');
    });
  });

  test('S3 command-ledger: EIO في مزامنةِ مجلّدِ الحجوزاتِ بعدَ نشرِ الاسم ⇒ begin يُرفَعُ ولا ACK', async () => {
    await withFaultyRoot(async ({ runtime, trace, faults }) => {
      const claims = resolve(runtime.ledger.claimsDir);
      const rule = faults.fail({ op: 'fsync', dir: true, code: 'EIO', match: (p) => p === claims });
      let begun = null;
      const error = await rejection(() =>
        runtime.ledger.transactAsync('crown.command', async () => {
          begun = runtime.ledger.begin({ id: 'cmd-s3' });
          await runtime.ledger.commitSigned({ id: 'cmd-s3' });
        }),
      );
      assert.equal(error.code, 'EIO');
      assert.equal(rule.hits, 1);
      assert.equal(begun, null, 'begin لم يُقِرَّ بالحجز (لم يُرجِعْ رقمَ الحاجز)');
      assert.ok(trace.includes('S3') && !trace.includes('S4') && !trace.includes('ACK'));
      assert.notEqual(runtime.ledger.state('cmd-s3'), 'committed');
    });
  });

  test('S2 state-manifest: EIO في مزامنةِ مجلّدِ البيانِ عندَ الترقية ⇒ يُسيَّجُ ولا S5 ولا ACK', async () => {
    await withFaultyRoot(async ({ ws, runtime, trace, stage, faults }) => {
      const rule = faults.fail({
        op: 'fsync',
        dir: true,
        code: 'EIO',
        when: () => stage.current === 'S4',
        match: (p) => p === manifestDir(ws.root),
      });
      const error = await rejection(() => commitCommand(runtime, 'cmd-s2'));
      assert.equal(error.code, 'EIO');
      assert.equal(rule.hits, 1);
      assert.ok(trace.includes('S4') && !trace.includes('S5') && !trace.includes('ACK'));
      // الحاجزُ مُسيَّج: لا يُبنى فوقَ حالٍ لم يُضمَنْ دوامُها.
      const next = await rejection(() => commitCommand(runtime, 'cmd-after'));
      assert.equal(next.code, 'COMMIT_BARRIER_FENCED');
    });
  });

  test('فشلُ مزامنةِ الملفّ (‏لا المجلّد) في البيانِ وفي الحجز ⇒ لا ACK', async () => {
    for (const target of ['root-of-trust.manifest.json.tmp-', '.claiming-']) {
      await withFaultyRoot(async ({ runtime, trace, stage, faults }) => {
        const rule = faults.fail({
          op: 'fsync',
          dir: false,
          code: 'EIO',
          when: () => target === '.claiming-' || stage.current === 'S4',
          match: (p) => String(p).includes(target),
        });
        const error = await rejection(() => commitCommand(runtime, `cmd-file`));
        assert.equal(error.code, 'EIO', target);
        assert.equal(rule.hits, 1, target);
        assert.ok(!trace.includes('ACK'), target);
        assertNotCommitted(runtime, 'cmd-file');
      });
    }
  });

  test('أخطاءُ تخزينٍ أخرى في المواضعِ الثلاثة (ENOSPC/EROFS/EDQUOT/EBADF) لا تصيرُ نجاحاً', async () => {
    for (const code of ['ENOSPC', 'EROFS', 'EDQUOT', 'EBADF']) {
      for (const site of ['S1', 'S2', 'S3']) {
        await withFaultyRoot(async ({ ws, runtime, trace, stage, faults }) => {
          const rule = faults.fail({
            op: 'fsync',
            dir: true,
            code,
            ...siteRule(site, ws, runtime, stage),
          });
          const error = await rejection(() => commitCommand(runtime, 'cmd-x'));
          assert.equal(error.code, code, `${site}/${code}`);
          assert.ok(rule.hits >= 1, `${site}/${code}`);
          assert.ok(!trace.includes('ACK'), `${site}/${code}`);
        });
      }
    }
  });

  test('لا قائمةَ استثناء: EINVAL/ENOTSUP/EPERM/EISDIR («غيرُ مدعوم») تفشلُ مغلقةً أيضاً', async () => {
    // قرارُ التصميم (‏`fsyncDirectoryOrFail`): لا منصّةَ مدعومةٌ يُثبَتُ فيها أنّ رفضَ مزامنةِ
    // المجلّدِ «غيرُ مدعومٍ» لا «فشل» — فلا يُستثنى رمزٌ، وهذا الاختبارُ يُسقِطُ أيَّ استثناءٍ يُضاف.
    for (const code of ['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR']) {
      for (const site of ['S1', 'S2', 'S3']) {
        await withFaultyRoot(async ({ ws, runtime, trace, stage, faults }) => {
          faults.fail({
            op: 'fsync',
            dir: true,
            code,
            ...siteRule(site, ws, runtime, stage),
          });
          const error = await rejection(() => commitCommand(runtime, 'cmd-u'));
          assert.equal(error.code, code, `${site}/${code}`);
          assert.ok(!trace.includes('ACK'), `${site}/${code}`);
        });
      }
    }
  });

  test('فشلُ فتحِ المجلّدِ أو إغلاقِه (‏خطأٌ مؤجَّل) يُرفَعُ كذلك ولا ACK', async () => {
    for (const op of ['open', 'close']) {
      await withFaultyRoot(async ({ runtime, trace, faults }) => {
        const claims = resolve(runtime.ledger.claimsDir);
        const rule = faults.fail({ op, dir: true, code: 'EIO', match: (p) => p === claims });
        const error = await rejection(() => commitCommand(runtime, `cmd-${op}`));
        assert.equal(error.code, 'EIO', op);
        assert.ok(rule.hits >= 1, op);
        assert.ok(!trace.includes('ACK'), op);
      });
    }
  });

  test('S1 في الاسترجاع (B2): EIO في مزامنةِ المجلّدِ لا يُعلَنُ استرجاعاً، والإقلاعُ السليمُ بعدَه B2', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      // حالٌ مُرحَّلةٌ بأثرٍ على القرص.
      const runtime = await bootRoot(
        ws.root,
        keys,
        new FileStateBoundSocket(ws.socketFile),
        DURABLE,
      );
      await commitCommand(runtime, 'cmd-warm');
      let current = null;
      runtime.commitBarrier.onStage = (name) => {
        current = name;
      };
      // EIO في مزامنةِ ملفِّ الدفترِ داخلَ S3 بعدَ أن لُمِسَ (‏كتابةٌ ممزّقة) ⇒ تسييجٌ و`staged` باقٍ.
      const ledgerFile = resolve(runtime.ledger.file);
      let faults = fsFaults();
      faults.fail({
        op: 'fsync',
        dir: false,
        code: 'EIO',
        when: () => current === 'S2',
        match: (p) => p === ledgerFile,
      });
      await rejection(() => commitCommand(runtime, 'cmd-staged'));
      faults.restore();
      await runtime.close().catch(() => {});
      assert.ok(manifestBody(ws.root).staged, 'بقيَ staged');
      // إقلاعٌ تفشلُ فيه مزامنةُ المجلّدِ داخلَ `rollbackStagedAsync` وحدَه.
      faults = fsFaults();
      const rule = faults.fail({
        op: 'fsync',
        dir: true,
        code: 'EIO',
        match: (_p, stack) => stack.includes('rollbackStagedAsync'),
      });
      let failedBoot;
      try {
        failedBoot = await rejection(() =>
          bootRoot(ws.root, keys, new FileStateBoundSocket(ws.socketFile), DURABLE),
        );
      } finally {
        faults.restore();
      }
      assert.ok(rule.hits >= 1, 'الحقنُ وقعَ في الاسترجاع');
      assert.equal(failedBoot.code, 'EIO');
      assert.ok(manifestBody(ws.root).staged, 'لم يُمحَ staged بعدَ استرجاعٍ غيرِ دائم');
      const healthy = await bootRoot(
        ws.root,
        keys,
        new FileStateBoundSocket(ws.socketFile),
        DURABLE,
      );
      assert.equal(healthy.freshnessBoot, 'B2');
      assert.notEqual(healthy.ledger.state('cmd-staged'), 'committed');
      assert.equal(healthy.ledger.state('cmd-warm'), 'committed');
      await healthy.close();
    } finally {
      ws.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `WL-522` — `LIVE-74` (‏N7) في المختبرِ وحدَه: العبثُ بحالةِ الإيقافِ وقتَ التشغيلِ على
// الجذرِ الإنتاجيِّ الحقيقيِّ (‏بمقبسِ الاختبار). يثبّتُ اختبارانِ العيبَ القائم (‏الإيقافُ
// الملكيُّ يُسيَّجُ و`assertOperational` يمرُّ)، ويقيسُ ثالثٌ **قراءةً مغلقةً مختبريّةً**
// مُعرَّفةً هنا لا في `src/`: الحاجزُ مُسيَّجٌ، أو بصمةُ القرصِ ≠ بصمةِ البيانِ المختوم ⇒
// `halted`، بلا أيِّ كتابة. **ليست سلوكًا إنتاجيًّا**: إدخالُها `HaltSwitch`/`crown` قرارُ
// المالك (‏دلالةُ التحقّق)، والإصلاحُ يقلبُ تأكيداتِ التوصيفِ صراحةً.
// ─────────────────────────────────────────────────────────────────────────────

/** ملفُّ توجيهِ الإيقافِ في الجذر. */
const haltFile = (root) => join(root, 'halt', 'directive.json');

/** أسطرُ التاريخِ الخامُ بلا الفارغة. */
const historyLines = (root) =>
  readFileSync(haltFile(root) + HALT_HISTORY_SUFFIX, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);

/** يكتبُ أسطرَ التاريخِ كما هي. */
const putHistory = (root, lines) =>
  writeFileSync(haltFile(root) + HALT_HISTORY_SUFFIX, lines.map((line) => line + '\n').join(''));

/**
 * أربعةَ عشرَ عبثًا وقتَ التشغيلِ بملفّاتِ الإيقافِ ومجلّدِ العُقد — كاتبٌ أجنبيٌّ يملكُ القرص.
 * @type {Record<string, (root: string) => void>}
 */
const LIVE74_TAMPERS = {
  'history-empty': (root) => writeFileSync(haltFile(root) + HALT_HISTORY_SUFFIX, ''),
  'history-delete': (root) => unlinkSync(haltFile(root) + HALT_HISTORY_SUFFIX),
  'history-last-only': (root) => putHistory(root, historyLines(root).slice(-1)),
  'history-prefix': (root) => putHistory(root, historyLines(root).slice(0, -1)),
  'history-mid-delete': (root) => {
    const lines = historyLines(root);
    lines.splice(1, 1);
    putHistory(root, lines);
  },
  'history-mid-corrupt': (root) => {
    const lines = historyLines(root);
    lines.splice(1, 0, '{x');
    putHistory(root, lines);
  },
  'history-append-garbage': (root) => putHistory(root, [...historyLines(root), '{x']),
  'history-duplicate-last': (root) => {
    const lines = historyLines(root);
    putHistory(root, [...lines, lines.at(-1)]);
  },
  'epoch-down': (root) => writeFileSync(haltFile(root) + HALT_EPOCH_SUFFIX, '1\n'),
  'epoch-up': (root) => writeFileSync(haltFile(root) + HALT_EPOCH_SUFFIX, '99\n'),
  'epoch-delete': (root) => unlinkSync(haltFile(root) + HALT_EPOCH_SUFFIX),
  'directive-old': (root) => writeFileSync(haltFile(root), historyLines(root)[0] + '\n'),
  'directive-delete': (root) => unlinkSync(haltFile(root)),
  'node-foreign': (root) =>
    writeFileSync(
      join(root, 'halt', 'directive.json.nodes', 'rogue.json'),
      JSON.stringify({ nodeId: 'rogue' }) + '\n',
    ),
};

/** العبثُ الذي يمرُّ معه `assertOperational` اليومَ (‏مقيسٌ في `WL-522`). */
const LIVE74_ASSERT_PASSES = [
  'history-empty',
  'history-delete',
  'history-last-only',
  'history-mid-delete',
  'history-mid-corrupt',
  'history-append-garbage',
  'history-duplicate-last',
  'epoch-down',
  'epoch-delete',
  'node-foreign',
];

/**
 * القراءةُ المغلقةُ المختبريّة — **في الاختبارِ وحدَه**، لا تكتبُ شيئًا.
 * @param {object} runtime - الجذر
 * @param {string} root - جذرُ الحالة
 * @returns {{state: string, why: string|null}} الحكم
 */
function labClosedRead(runtime, root) {
  if (runtime.commitBarrier.fenced) return { state: 'halted', why: 'COMMIT_BARRIER_FENCED' };
  const disk = computeStateDigest(productionStateLayout(root, join(root, 'anchors.jsonl')));
  if (disk !== manifestBody(root).stateDigest)
    return { state: 'halted', why: 'STATE_DIGEST_MISMATCH' };
  return { state: runtime.haltSwitch.read().state, why: null };
}

/** إيقافٌ أو استئنافٌ بأمرٍ ملكيٍّ موقَّعٍ على العهدِ الحاضر. */
async function royal(runtime, keys, operation) {
  const epoch = runtime.haltSwitch.read().epoch;
  await runtime.haltSwitch[`${operation}Async`](
    operation,
    royalCommand(keys, operation, operation, epoch),
  );
}

/** جذرٌ مُقلِعٌ مرَّ بإيقافَين واستئنافَين ملكيّين — تاريخٌ من أربعةِ أسطر. */
async function bootedWithHistory() {
  const ws = workspace();
  const keys = makeKeys();
  const runtime = await bootRoot(ws.root, keys, new FileStateBoundSocket(ws.socketFile));
  for (const operation of ['halt', 'resume', 'halt', 'resume'])
    await royal(runtime, keys, operation);
  return { ws, keys, runtime };
}

describe('WL-522/LIVE-74 — العبثُ وقتَ التشغيلِ وقراءةٌ مغلقةٌ مختبريّة (‏N7، مختبرًا لا إنتاجًا)', () => {
  test('توصيف: بعدَ كلِّ عبثٍ من 14 يُسيَّجُ الإيقافُ الملكيّ، و`assertOperational` يمرُّ في 10 منها', async () => {
    const passes = [];
    for (const [name, tamper] of Object.entries(LIVE74_TAMPERS)) {
      const { ws, keys, runtime } = await bootedWithHistory();
      try {
        assert.equal(labClosedRead(runtime, ws.root).why, null, `${name}: لا إنذارَ قبلَ العبث`);
        tamper(ws.root);
        if (thrownOrNull(() => runtime.haltSwitch.assertOperational()) === null) passes.push(name);
        const halt = await rejection(() => royal(runtime, keys, 'halt'));
        assert.equal(
          halt.code,
          'STATE_FOREIGN_WRITE_DETECTED',
          `LIVE-74 مفتوح (${name}): الإيقافُ الملكيُّ يُسيَّجُ وقتَ التشغيل`,
        );
      } finally {
        await runtime.close().catch(() => undefined);
        ws.cleanup();
      }
    }
    assert.deepEqual(
      passes,
      LIVE74_ASSERT_PASSES,
      'LIVE-74 مفتوح: الحرمانُ من الإيقافِ حتّى الإقلاع',
    );
  });

  test('مختبر: القراءةُ المغلقةُ تُعيدُ `halted` بعدَ كلِّ عبثٍ من 14 — قبلَ محاولةِ الإيقافِ وبعدَها، بلا كتابة', async () => {
    for (const [name, tamper] of Object.entries(LIVE74_TAMPERS)) {
      const { ws, keys, runtime } = await bootedWithHistory();
      try {
        tamper(ws.root);
        const digestBefore = manifestBody(ws.root).stateDigest;
        assert.deepEqual(
          labClosedRead(runtime, ws.root),
          { state: 'halted', why: 'STATE_DIGEST_MISMATCH' },
          name,
        );
        await rejection(() => royal(runtime, keys, 'halt'));
        assert.deepEqual(
          labClosedRead(runtime, ws.root),
          { state: 'halted', why: 'COMMIT_BARRIER_FENCED' },
          name,
        );
        assert.equal(manifestBody(ws.root).stateDigest, digestBefore, `${name}: القراءةُ لا تكتب`);
      } finally {
        await runtime.close().catch(() => undefined);
        ws.cleanup();
      }
    }
  });

  test('مختبر: لا إنذارَ كاذبًا في 50 إيقافًا/استئنافًا ملكيًّا و20 أمرَ دفترٍ مشروعًا', async () => {
    const { ws, keys, runtime } = await bootedWithHistory();
    try {
      for (let index = 0; index < 50; index += 1) {
        await royal(
          runtime,
          keys,
          runtime.haltSwitch.read().state === 'halted' ? 'resume' : 'halt',
        );
        const verdict = labClosedRead(runtime, ws.root);
        assert.equal(verdict.why, null);
        assert.equal(verdict.state, runtime.haltSwitch.read().state);
      }
      if (runtime.haltSwitch.read().state === 'halted') await royal(runtime, keys, 'resume');
      for (let index = 0; index < 20; index += 1) {
        await commitCommand(runtime, `cmd-live74-${index}`);
        assert.deepEqual(labClosedRead(runtime, ws.root), { state: 'running', why: null });
      }
    } finally {
      await runtime.close();
      ws.cleanup();
    }
  });
});

/** يُرجعُ الخطأَ المتزامنَ أو `null`. */
function thrownOrNull(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}
