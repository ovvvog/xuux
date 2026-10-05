// @ts-nocheck
// tests/root-of-trust/live-40-intent-box-limits.test.mjs
//
// `LIVE-40` — حدودُ صندوقِ القصودِ (‏اُكتُشِفَت في `WL-326`):
//
//   (أ) قصدُ تسجيلِ عقدةٍ قائمةٍ بمفتاحٍ جديدٍ كان يُرَدُّ دائماً بـ
//       `ROOT_INTENT_NODE_KEY_CONFLICT` — لا تدويرَ للعُقَد. الآن التدويرُ مُصادَقٌ
//       بالمفتاحَين: إثباتُ حيازةٍ بالجديدِ وإذنٌ موقَّعٌ بالقديمِ المسجَّل.
//   (ب) قصدُ التثبيتِ كان يأخذُ فترةَ الجذرِ الافتراضيّةَ لا فترةَ الأداة. الآن
//       فترةُ التثبيتِ جزءٌ من مادةِ القصدِ الموقَّعةِ فلا تُطبَّقَ فترةٌ لم تُوقَّعْ.
//
// الشقُّ (ج) — مساراتُ الأداتين خارجَ الإنتاجِ تكتبُ مباشرةً — حكمُه للمالكِ
// ولا يُنفَّذْ هنا.
//
// القياسُ على جذرِ ثقةٍ إنتاجيٍّ حقيقيٍّ (‏`bootRoot` من معينَ `WL-326`) لا على
// بدائل: القصودُ تُودَعُ في الصندوقِ ويُفرِّغُها الكاتبُ الواحدُ عبرَ الحاجز.

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  anchorIntentSigningBody,
  haltAckPayload,
  newRootIntentId,
  registerPossessionPayload,
  registerRotationPayload,
  signHaltAck,
  submitRootIntent,
} from '../../src/root-of-trust/index.mjs';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import { FileStateBoundSocket, bootRoot, makeKeys, royalCommand } from '../helpers/wl-326-root.mjs';

/** مجلدٌ مؤقّتٌ فيه الجذرُ وملفُّ المرجعِ خارجَه. */
function workspace() {
  const base = registerTmpRoot(mkdtempSync(join(tmpdir(), 'live40-')));
  return {
    base,
    root: join(base, 'root'),
    socketFile: join(base, 'freshness.json'),
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

/** نتيجةُ قصدٍ من صندوقِ النتائج. */
const outcome = (root, id) =>
  JSON.parse(readFileSync(join(root, 'root-of-trust.intents', 'results', `${id}.json`), 'utf8'));

/** زوجُ مفاتيحِ عقدةٍ بصيغةِ PEM. */
function nodePair() {
  const pair = generateKeyPairSync('ed25519');
  return {
    privatePem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

test('LIVE-40 (أ): تسجيلُ عقدةٍ قائمةٍ بمفتاحٍ جديدٍ بلا إذنِ القديمِ يُرَدُّ — ولا تدويرَ بمفتاحٍ واحد', async () => {
  const ws = workspace();
  try {
    const keys = makeKeys();
    const socket = new FileStateBoundSocket(ws.socketFile);
    const runtime = await bootRoot(ws.root, keys, socket);
    const first = nodePair();
    const second = nodePair();

    // العقدةُ قائمةٌ بمفتاحِها الأولِ عبرَ قصدٍ مُصادَق.
    const initial = submitRootIntent(
      ws.root,
      'register',
      {
        nodeId: 'node-live40',
        publicKeyPem: first.publicPem,
        possession: signHaltAck(
          first.privatePem,
          registerPossessionPayload('node-live40', first.publicPem),
        ),
      },
      { fsync: false },
    );
    // نُسجّلُ العقدةَ الأولى صراحةً قبلَ تقديمِ القصدِ الثاني — صندوقُ القصودِ لا يضمنُ ترتيبَ المعالجةِ.
    assert.equal(await runtime.drainIntentsAsync(), 1);
    assert.equal(outcome(ws.root, initial.id).ok, true);
    assert.equal(
      runtime.haltSwitch.nodes()[0].nodeKeyPem,
      first.publicPem,
      'العقدةُ قائمةٌ بالمفتاحِ الأول',
    );
    // مفتاحٌ جديدٌ بإثباتِ حيازةٍ صحيحٍ لكن بلا إذنِ القديم.
    const noConsent = submitRootIntent(
      ws.root,
      'register',
      {
        nodeId: 'node-live40',
        publicKeyPem: second.publicPem,
        possession: signHaltAck(
          second.privatePem,
          registerPossessionPayload('node-live40', second.publicPem),
        ),
      },
      { fsync: false },
    );
    await runtime.drainIntentsAsync();
    const rejected = outcome(ws.root, noConsent.id);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, 'ROOT_INTENT_NODE_KEY_CONFLICT');
    assert.equal(runtime.haltSwitch.nodes()[0].nodeKeyPem, first.publicPem, 'المفتاحُ لم يتغيّر');

    // إذنُ تدويرٍ موقَّعٌ بمفتاحٍ آخرَ غيرِ المسجَّلِ لا يُجدي: بقاءُ الرفض.
    const stranger = nodePair();
    const forgedConsent = submitRootIntent(
      ws.root,
      'register',
      {
        nodeId: 'node-live40',
        publicKeyPem: second.publicPem,
        possession: signHaltAck(
          second.privatePem,
          registerPossessionPayload('node-live40', second.publicPem),
        ),
        rotation: signHaltAck(
          stranger.privatePem,
          registerRotationPayload('node-live40', second.publicPem),
        ),
      },
      { fsync: false },
    );
    await runtime.drainIntentsAsync();
    const forged = outcome(ws.root, forgedConsent.id);
    assert.equal(forged.ok, false);
    assert.equal(forged.code, 'ROOT_INTENT_NODE_KEY_CONFLICT');
    assert.equal(runtime.haltSwitch.nodes()[0].nodeKeyPem, first.publicPem);
    await runtime.close();
  } finally {
    ws.cleanup();
  }
});

test('LIVE-40 (أ): تدويرٌ مُصادَقٌ بالمفتاحَين — حيازةُ الجديد وإذنُ القديم — يُقبَلُ ويستبدلُ المفتاح', async () => {
  const ws = workspace();
  try {
    const keys = makeKeys();
    const socket = new FileStateBoundSocket(ws.socketFile);
    const runtime = await bootRoot(ws.root, keys, socket);
    const first = nodePair();
    const second = nodePair();

    await runtime.haltSwitch.registerNodeAsync('node-live40', {
      nodeKey: {
        publicKeyPem: first.publicPem,
        sign: () => signHaltAck(first.privatePem, { x: 1 }),
      },
    });
    const rotation = submitRootIntent(
      ws.root,
      'register',
      {
        nodeId: 'node-live40',
        publicKeyPem: second.publicPem,
        possession: signHaltAck(
          second.privatePem,
          registerPossessionPayload('node-live40', second.publicPem),
        ),
        rotation: signHaltAck(
          first.privatePem,
          registerRotationPayload('node-live40', second.publicPem),
        ),
      },
      { fsync: false },
    );
    assert.equal(await runtime.drainIntentsAsync(), 1);
    const result = outcome(ws.root, rotation.id);
    assert.equal(result.ok, true);
    assert.equal(runtime.haltSwitch.nodes()[0].nodeKeyPem, second.publicPem, 'المفتاحُ دُوِّر');

    // بعدَ التدوير: الإقرارُ بالجديدِ يُقبَلُ، وبالقديمِ يُرَدُّ — فلا يبقى للمفتاحِ
    // المسلَّمِ سلطةٌ على عقدةٍ لم يعدَ مفتاحَها.
    const reading = runtime.haltSwitch.read();
    await runtime.haltSwitch.haltAsync(
      'تمرين التدوير',
      royalCommand(keys, 'halt', 'تمرين التدوير', reading.epoch),
    );
    const halted = runtime.haltSwitch.read();
    const oldProof = signHaltAck(
      first.privatePem,
      haltAckPayload(halted.directive.hash, halted.epoch, 'node-live40'),
    );
    const staleKey = submitRootIntent(
      ws.root,
      'confirm',
      { nodeId: 'node-live40', proof: oldProof, detail: 'مفتاحٌ مسلَّم' },
      { fsync: false },
    );
    const newProof = signHaltAck(
      second.privatePem,
      haltAckPayload(halted.directive.hash, halted.epoch, 'node-live40'),
    );
    const freshKey = submitRootIntent(
      ws.root,
      'confirm',
      { nodeId: 'node-live40', proof: newProof, detail: 'مفتاحٌ مدوَّر' },
      { fsync: false },
    );
    assert.equal(await runtime.drainIntentsAsync(), 2);
    assert.equal(outcome(ws.root, staleKey.id).ok, false);
    assert.equal(outcome(ws.root, staleKey.id).code, 'HALT_NODE_PROOF_INVALID');
    assert.equal(outcome(ws.root, freshKey.id).ok, true);
    assert.deepEqual(runtime.haltSwitch.describe().confirmed, ['node-live40']);
    await runtime.close();
  } finally {
    ws.cleanup();
  }
});

test('LIVE-40 (ب): فترةُ التثبيتِ جزءٌ من القصدِ الموقَّعِ — لا فترةَ بلا توقيعٍ ولا فترةَ مُبدَّلة', async () => {
  const ws = workspace();
  try {
    const keys = makeKeys();
    const socket = new FileStateBoundSocket(ws.socketFile);
    const runtime = await bootRoot(ws.root, keys, socket);
    await runtime.log.appendSealed('live40.anchor', 'مدقّق', { n: 1 });

    // قصدُ تثبيتٍ بلا فترة: يُرَدُّ قبلَ التوقيعِ — فالفترةُ ليست اختياراً ساقطاً.
    const bare = submitRootIntent(ws.root, 'anchor', { force: true }, { fsync: false });
    // قصدٌ فترتُه الموقَّعةُ 1ms والحمولةُ تقولُ غيرَها: توقيعُ الجسمِ المُعادِ بناؤُه
    // من الحمولةِ لا يطابقُ — فلا تُبدَّلَ فترةٌ بعدَ التوقيع.
    const tamperedId = newRootIntentId();
    const tamperedAt = new Date().toISOString();
    submitRootIntent(
      ws.root,
      'anchor',
      {
        force: false,
        intervalMs: 86_400_000,
        signature: await runtime.anchorSigner.signAsync(
          anchorIntentSigningBody({
            id: tamperedId,
            at: tamperedAt,
            force: false,
            intervalMs: 1,
          }),
        ),
      },
      { id: tamperedId, at: tamperedAt, fsync: false },
    );
    assert.equal(await runtime.drainIntentsAsync(), 2);
    assert.equal(outcome(ws.root, bare.id).code, 'ROOT_INTENT_INVALID');
    assert.equal(outcome(ws.root, tamperedId).code, 'ROOT_INTENT_UNAUTHENTICATED');
    assert.equal(existsSync(join(ws.root, 'anchors.jsonl')), false, 'لم يقعْ تثبيتٌ من قصدٍ مرفوض');
    await runtime.close();
  } finally {
    ws.cleanup();
  }
});

test('LIVE-40 (ب): الجذرُ يُطبّقُ فترةَ الأداةِ الموقَّعةَ لا فترتَهُ الافتراضيّة', async () => {
  const ws = workspace();
  try {
    const keys = makeKeys();
    const socket = new FileStateBoundSocket(ws.socketFile);
    const runtime = await bootRoot(ws.root, keys, socket);
    await runtime.log.appendSealed('live40.anchor', 'مدقّق', { n: 1 });

    /** يُودِعُ قصدَ تثبيتٍ موقَّعاً بفترةٍ مُعطاة. */
    const anchorIntent = async (intervalMs) => {
      const id = newRootIntentId();
      const at = new Date().toISOString();
      const intent = submitRootIntent(
        ws.root,
        'anchor',
        {
          force: false,
          intervalMs,
          signature: await runtime.anchorSigner.signAsync(
            anchorIntentSigningBody({ id, at, force: false, intervalMs }),
          ),
        },
        { id, at, fsync: false },
      );
      await runtime.drainIntentsAsync();
      return outcome(ws.root, intent.id);
    };

    // أولُ تثبيتٍ بفترةِ الأداةِ الموقَّعة (1ms): يقعُ فوراً.
    const first = await anchorIntent(1);
    assert.equal(first.ok, true);
    assert.ok(first.result, 'أوّلُ تثبيتٍ وقع');

    // ثاني تثبيتٍ غيرِ قسريٍّ بعدَ لحظة: فترةُ 1ms الموقَّعةُ انقضت فيقعُ. ولو
    // أخذَ الجذرُ فترتَهُ الافتراضيّة (ساعة) لَرُدَّ — فهذا هو الفارقُ المقيس.
    await new Promise((resolve) => setTimeout(resolve, 25));
    await runtime.log.appendSealed('live40.anchor', 'مدقّق', { n: 2 });
    const second = await anchorIntent(1);
    assert.equal(second.ok, true);
    assert.ok(second.result, 'ثاني تثبيتٍ وقعَ بفترةِ الأداةِ لا بفترةِ الجذرِ الافتراضيّة');

    // وفترةٌ موقَّعةٌ ضخمةٌ تُحترَمُ رفضاً: لا تثبيتَ قسريّاً بلا إذنِ القوة.
    await runtime.log.appendSealed('live40.anchor', 'مدقّق', { n: 3 });
    const deferred = await anchorIntent(86_400_000);
    assert.equal(deferred.ok, true);
    assert.equal(deferred.result, null, 'الفترةُ الموقَّعةُ الضخمةُ حُجِبَت كما وُقِّعت');
    await runtime.close();
  } finally {
    ws.cleanup();
  }
});
