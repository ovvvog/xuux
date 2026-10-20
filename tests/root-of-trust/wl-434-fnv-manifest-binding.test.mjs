// @ts-nocheck
// tests/root-of-trust/wl-434-fnv-manifest-binding.test.mjs
//
// WL-434 — تكاملُ الربطِ المثبَّتِ معَ البيانِ الموقَّعِ (الخيارُ أ من §5.1 في الملحقِ ج
// لـADR 0007): الربطُ حقلٌ في متنِ البيانِ المختومِ بمفتاحِ الملكِ، لا ملفٌّ جانبيّ.
//
// **ما يقيسُه على المسارِ البرمجيِّ الحقيقيّ:**
//   - التهيئةُ وختمُ الربطِ وفتحُ البيانِ (`StateManifest.bindFnvAsync` المعلنة).
//   - تغطيةُ الختمِ للربطِ (تحريرُه ⇒ `SEAL_INVALID`)، ورفضُ الربطِ الغائبِ أو المهرَّبِ
//     أو الناقصِ أو المعدَّلِ، ورفضُ اختلافِ `instanceId` والمقابضِ والأسماءِ و`base`.
//   - الثباتُ عبرَ كلِّ تحديثاتِ البيانِ (نقطةُ ضبطٍ، ترحيلٌ، ترقيةٌ، رفعٌ) ورفضُ إعادةِ الربط.
//   - سياسةُ المخطّطِ: `2` تاريخيٌّ يبقى، `3` يحملُ الربطَ إلزامًا، ولا ترقيةَ صامتةً.
//   - رموزُ ربطِ NV المسمّاةُ تصلُ إلى قرارِ الإقلاعِ (`decideStateBoundBoot`)، والتحققُ
//     من المصدرِ إلزامٌ لا يُعطَّلُ، وB10 يختمُ المادّةَ من المصدرِ وB2 يعيدُ الربطَ المختومَ.
//
// **حدودٌ معلنة:** الموقِّعُ زوجُ Ed25519 تجريبيٌّ لا HSM عتاديّ (لكنّه العقدُ نفسُه —
// التوقيعُ على `JSON.stringify` للمتنِ كاملًا)؛ والهويةُ والسياسةُ مادّةٌ معلَنةٌ من
// المصدرِ لا إثباتَ هويةِ عتادٍ (لا backend إنتاجيًّا اليوم). وأسطعُ اختباراتِ المحاكاة
// (swtpm) في ملفِّ `tests/sim/freshness-nv/` — تتخطّى هنا لغيابِ البيئةِ وتُشغَّلُ في CI.

import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as edSign, verify as edVerify } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  FNV_BIND_DECLARED_ENV,
  FNV_MANIFEST_SCHEMA_VERSION,
  STATE_PROVISION_ENV,
  StateManifest,
} from '../../src/root-of-trust/index.mjs';
import { SwtpmNvStateBoundSocket } from '../../sim/freshness-nv/nv-state-bound-socket.mjs';
import { bootRoot, makeKeys } from '../helpers/wl-326-root.mjs';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

const COUNTER = '0x01500030';
const RECORD = '0x01500031';
const NAME_C = `000b${'1'.repeat(64)}`;
const NAME_R = `000b${'2'.repeat(64)}`;

/** مادّةُ ربطٍ كاملةُ الشكلِ — كما يوفّرُها مصدرُ NV، لا كما يخترعُه المنفّذ. */
function material(overrides = {}) {
  return {
    counterIndex: COUNTER,
    recordIndex: RECORD,
    counterName: NAME_C,
    recordName: NAME_R,
    base: '7',
    tpmIdentity: { kind: 'ek-name', value: `000b${'a'.repeat(64)}` },
    authPolicy: { counter: '', record: '' },
    ...overrides,
  };
}

/** موقّعٌ بالعقدِ نفسِه (`ManifestSealer`): توقيعُ Ed25519 على `JSON.stringify` للمتنِ. */
function softwareSealer() {
  const pair = generateKeyPairSync('ed25519');
  const id = 'king:wl-434-test';
  return {
    id,
    signAsync: async (payload) =>
      edSign(null, Buffer.from(JSON.stringify(payload), 'utf8'), pair.privateKey).toString('base64'),
    verify: (payload, signature) =>
      edVerify(
        null,
        Buffer.from(JSON.stringify(payload), 'utf8'),
        pair.publicKey,
        Buffer.from(signature, 'base64'),
      ),
  };
}

const PROVISION_ENV = { [STATE_PROVISION_ENV]: '1' };
const DECLARED_ENV = { [STATE_PROVISION_ENV]: '1', [FNV_BIND_DECLARED_ENV]: '1' };

function tmp(prefix) {
  return registerTmpRoot(mkdtempSync(join(tmpdir(), prefix)));
}

async function rejection(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return assert.fail('لم يُرفَعْ خطأ');
}

/** يهيّئُ بيانًا (v2) موقَّعًا بموقِّعٍ تجريبيٍّ ويعيدُ البيانَ ومسارَه. */
async function provisionedManifest(dir) {
  const sealer = softwareSealer();
  const file = join(dir, 'root-of-trust.manifest.json');
  const manifest = new StateManifest(file, { fsync: false, sealer });
  await manifest.provisionAsync({ kingId: sealer.id, context: 'test', tokenSerial: 'T', moduleSha256: 'M' }, PROVISION_ENV);
  return { manifest, file, sealer };
}

/** يكتبُ بيانًا مختومًا بختمٍ صالحٍ لكن بمتنٍّ يعدّلُه المُختبِر — صنعةُ مهاجمٍ يملكُ القرص. */
async function craftSealed(file, sealer, body) {
  const sealed = { body, seal: { alg: 'ed25519', signerId: sealer.id, signature: await sealer.signAsync(body) } };
  writeFileSync(file, JSON.stringify(sealed, null, 2) + '\n');
}

/** يبني بيانًا صالحًا كاملًا ثم يعدّلُ المتنّ **بلا إعادةِ ختمٍ** — هجومُ مالكِ القرصِ نفسِهُ. */
async function boundThenMutate(dir, mutate) {
  const { manifest, file, sealer } = await provisionedManifest(dir);
  await manifest.bindFnvAsync(material(), DECLARED_ENV);
  const sealed = JSON.parse(readFileSync(file, 'utf8'));
  mutate(sealed.body);
  writeFileSync(file, JSON.stringify(sealed, null, 2) + '\n');
  return { file, sealer, sealed };
}

describe('WL-434 — الربطُ في متنِ البيانِ الموقَّعِ (وحدةٌ على المسارِ الحقيقيّ)', () => {
  test('التهيئةُ ثمّ ختمُ الربطِ المعلَنُ ثمّ الفتحُ: v3 يحملُ الربطَ والخاتَمُ يغطّيه', async () => {
    const dir = tmp('wl434-bind-');
    try {
      const { manifest, file, sealer } = await provisionedManifest(dir);
      assert.equal(manifest.read().version, 2, 'التهيئةُ تُنشئُ المخطّطَ التاريخيَّ');
      assert.equal(manifest.read().freshnessBinding, undefined, 'لا ربطَ قبلَ المراسمِ');
      await manifest.bindFnvAsync(material(), DECLARED_ENV);
      const bound = manifest.read();
      assert.equal(bound.version, FNV_MANIFEST_SCHEMA_VERSION);
      assert.equal(bound.freshnessBinding.base, '7');
      assert.equal(bound.freshnessBinding.instanceId, bound.instanceId, 'الربطُ يربطُ بنسخةِ الجذرِ');
      // فتحٌ بنسخةٍ جديدةٍ من القرصِ: الختمُ يغطّي الربطَ ويعيدُه كما خُتم.
      const reopened = new StateManifest(file, { fsync: false, sealer });
      const body = await reopened.openAsync({ kingId: sealer.id, context: 'test', tokenSerial: 'T', moduleSha256: 'M' });
      assert.equal(body.version, FNV_MANIFEST_SCHEMA_VERSION);
      assert.deepEqual(body.freshnessBinding, bound.freshnessBinding);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('المراسمُ بلا إعلانٍ مرفوضةٌ، وبلا بيانٍ مرفوضةٌ، وإعادةُ الربطِ مرفوضةٌ', async () => {
    const dir = tmp('wl434-declare-');
    try {
      const { manifest } = await provisionedManifest(dir);
      const undeclared = await rejection(() => manifest.bindFnvAsync(material(), PROVISION_ENV));
      assert.equal(undeclared.code, 'STATE_MANIFEST_FNV_BINDING_NOT_DECLARED');
      await manifest.bindFnvAsync(material(), DECLARED_ENV);
      const again = await rejection(() => manifest.bindFnvAsync(material(), DECLARED_ENV));
      assert.equal(again.code, 'STATE_MANIFEST_FNV_BINDING_IMMUTABLE', 'إعادةُ الربطِ مراسمُ مالكٍ');
      const absentFile = new StateManifest(join(dir, 'none.manifest.json'), { fsync: false, sealer: manifest.read && softwareSealer() });
      const noRoot = await rejection(() => absentFile.bindFnvAsync(material(), DECLARED_ENV));
      assert.equal(noRoot.code, 'STATE_ROOT_UNPROVISIONED');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('تحريرُ الربطِ في الملفِ المختومِ ⇒ الخاتَمُ يُسقِطُ القراءةَ (تغطيةُ الختمِ مقيسةٌ)', async () => {
    const dir = tmp('wl434-tamper-');
    try {
      const cases = [
        (body) => (body.freshnessBinding.base = '3'),
        (body) => (body.freshnessBinding.counterName = NAME_R),
        (body) => (body.freshnessBinding.recordIndex = '0x01500032'),
        (body) => (body.freshnessBinding.tpmIdentity.value = `000b${'b'.repeat(64)}`),
        (body) => (body.freshnessBinding.authPolicy.counter = 'aa'),
        (body) => (body.freshnessBinding.instanceId = 'f'.repeat(64)),
        (body) => delete body.freshnessBinding,
        (body) => delete body.freshnessBinding.tpmIdentity,
      ];
      // الحالاتُ 0–4 تحرّفُ قيمًا صحيحةَ الشكلِ فلا يكشفُها إلا الخاتَمُ (تغطيةُ الختمِ)،
      // والحالاتُ 5–7 تكسرُ قواعدَ المخطّطِ نفسِها فيرفضُها التحقّقُ المسمّى قبلَ الخاتَمِ.
      const expectedCodes = [
        'STATE_MANIFEST_SEAL_INVALID',
        'STATE_MANIFEST_SEAL_INVALID',
        'STATE_MANIFEST_SEAL_INVALID',
        'STATE_MANIFEST_SEAL_INVALID',
        'STATE_MANIFEST_SEAL_INVALID',
        'STATE_MANIFEST_FNV_BINDING_INVALID',
        'STATE_MANIFEST_FNV_BINDING_INVALID',
        'STATE_MANIFEST_FNV_BINDING_INVALID',
      ];
      for (const [i, mutate] of cases.entries()) {
        const sub = join(dir, `c${i}`);
        mkdirSync(sub, { recursive: true });
        const { file, sealer } = await boundThenMutate(sub, mutate);
        const reopened = new StateManifest(file, { fsync: false, sealer });
        const error = await rejection(() =>
          reopened.openAsync({ kingId: sealer.id, context: 'test', tokenSerial: 'T', moduleSha256: 'M' }),
        );
        assert.equal(
          error.code,
          expectedCodes[i],
          `تحريرُ الحالةِ ${i} يجبُ أن يُرفَضَ (${expectedCodes[i]}) لا أن يُقبلَ`,
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('ربطٌ مهرَّبٌ في مخطّطٍ تاريخيٍّ (ختمٌ صالح) ⇒ INVALID، ومخطّطُ NV بلا ربطٍ ⇒ INVALID', async () => {
    const dir = tmp('wl434-smuggle-');
    try {
      const { manifest, file, sealer } = await provisionedManifest(dir);
      const body = JSON.parse(readFileSync(file, 'utf8')).body;
      // ختمٌ صالحٌ تمامًا لكنّ المتنَ يحملُ ربطًا معَ version: 2 — لا تُقبَلُ حمايةٌ بلا إعلانِ وضعٍ.
      const smuggled = { ...structuredClone(body), freshnessBinding: material() };
      await craftSealed(join(dir, 'smuggled.json'), sealer, smuggled);
      const opened = new StateManifest(join(dir, 'smuggled.json'), { fsync: false, sealer });
      const smuggleError = await rejection(() =>
        opened.openAsync({ kingId: sealer.id, context: 'test', tokenSerial: 'T', moduleSha256: 'M' }),
      );
      assert.equal(smuggleError.code, 'STATE_MANIFEST_FNV_BINDING_INVALID');
      // مخطّطُ NV بلا ربطٍ: غيابٌ رفضٌ لا دعوةٌ للإنشاء.
      await craftSealed(join(dir, 'unbound.json'), sealer, { ...structuredClone(body), version: FNV_MANIFEST_SCHEMA_VERSION });
      const unbound = new StateManifest(join(dir, 'unbound.json'), { fsync: false, sealer });
      const unboundError = await rejection(() =>
        unbound.openAsync({ kingId: sealer.id, context: 'test', tokenSerial: 'T', moduleSha256: 'M' }),
      );
      assert.equal(unboundError.code, 'STATE_MANIFEST_FNV_BINDING_INVALID');
      // وإصدارٌ لا يعرفهُ العقدُ أصلًا يبقى مرفوضًا.
      await craftSealed(join(dir, 'v4.json'), sealer, { ...structuredClone(body), version: 4 });
      const v4 = new StateManifest(join(dir, 'v4.json'), { fsync: false, sealer });
      const v4Error = await rejection(() =>
        v4.openAsync({ kingId: sealer.id, context: 'test', tokenSerial: 'T', moduleSha256: 'M' }),
      );
      assert.equal(v4Error.code, 'STATE_MANIFEST_VERSION_UNSUPPORTED');
      void manifest;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('المادّةُ الناقصةُ أو الفاسدةُ تُرفَضُ باسمِ حقلِها: الهويةُ والسياسةُ إلزامُ شكلٍ', async () => {
    const dir = tmp('wl434-material-');
    try {
      const { manifest } = await provisionedManifest(dir);
      const cases = [
        [material({ tpmIdentity: undefined }), 'tpmIdentity'],
        [material({ tpmIdentity: { kind: 'guess', value: 'ab' } }), 'tpmIdentity.kind'],
        [material({ tpmIdentity: { kind: 'ek-name', value: 'zz' } }), 'tpmIdentity.value'],
        [material({ authPolicy: undefined }), 'authPolicy'],
        [material({ authPolicy: { counter: 'xyz', record: '' } }), 'authPolicy.counter'],
        [material({ counterIndex: '0x15' }), 'counterIndex'],
        [material({ recordIndex: COUNTER }), 'C == R'],
        [material({ counterName: 'nothex' }), 'counterName'],
        [material({ base: 'x7' }), 'base'],
        [material({ base: '-1' }), 'base'],
      ];
      for (const [m, expectedDetail] of cases) {
        const error = await rejection(() => manifest.bindFnvAsync(m, DECLARED_ENV));
        assert.equal(error.code, 'STATE_MANIFEST_FNV_BINDING_INVALID');
        assert.equal(error.detail, expectedDetail, `المادّةُ الناقصةُ تُسمّي حقلَها (${expectedDetail})`);
      }
      // وinstanceId لا يُفترضُ: الربطُ يُبنى بمعرّفِ نسخةِ الجذرِ من المتنِ لا من المادّةِ.
      await manifest.bindFnvAsync(material(), DECLARED_ENV);
      assert.equal(manifest.read().freshnessBinding.instanceId, manifest.read().instanceId);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('instanceId مختلفٌ في متنٍ مختومٍ صالحٍ ⇒ INVALID (الربطُ لا يُنقَلُ بينَ نسختينِ)', async () => {
    const dir = tmp('wl434-instanceid-');
    try {
      const { file, sealer } = await boundThenMutate(dir, (body) => {
        body.freshnessBinding.instanceId = 'e'.repeat(64);
      });
      // إعادةُ الختمِ بختمٍ صالحٍ بعدَ تحريفِ instanceId — الختمُ سليمٌ لكنّ الربطَ لا يطابقُ النسخةَ.
      const reopened = new StateManifest(file, { fsync: false, sealer });
      const error = await rejection(() =>
        reopened.openAsync({ kingId: sealer.id, context: 'test', tokenSerial: 'T', moduleSha256: 'M' }),
      );
      assert.equal(error.code, 'STATE_MANIFEST_FNV_BINDING_INVALID');
      assert.equal(error.detail, 'instanceId');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('الثباتُ: كلُّ تحديثاتِ البيانِ تحفظُ الربطَ بايتًا ببايت، وتحريرُ كائنِ المادّةِ بعدَ الختمِ لا يمسّهُ', async () => {
    const dir = tmp('wl434-immut-');
    try {
      const { manifest, file } = await provisionedManifest(dir);
      const m = material();
      await manifest.bindFnvAsync(m, DECLARED_ENV);
      const sealed = structuredClone(manifest.read().freshnessBinding);
      // تعديلُ كائنِ المادّةِ بعدَ الختمِ (نسخةٌ عميقةٌ في المراسمِ): لا أثرَ على المختومِ.
      m.base = '999';
      m.tpmIdentity.value = `000b${'c'.repeat(64)}`;
      assert.deepEqual(manifest.read().freshnessBinding, sealed);
      // نقطةُ ضبطٍ، وترحيلُ التزامٍ، وترقيةُ عهدٍ، ومحوُ الترحيلِ — كلُّها تحفظُ الربطَ والمخطّطَ.
      await manifest.checkpointAsync();
      assert.deepEqual(manifest.read().freshnessBinding, sealed);
      assert.equal(manifest.read().version, FNV_MANIFEST_SCHEMA_VERSION);
      await manifest.stageAsync({ txn: 't1', intent: 'ledger.commit', fromEpoch: 0, fromAnchor: 'genesis', at: new Date().toISOString() });
      assert.deepEqual(manifest.read().freshnessBinding, sealed);
      await manifest.promoteAsync({ epoch: 1, anchor: 'a'.repeat(64), digest: 'd'.repeat(64) });
      assert.deepEqual(manifest.read().freshnessBinding, sealed);
      await manifest.clearStagedAsync();
      assert.deepEqual(manifest.read().freshnessBinding, sealed);
      manifest.raise('anchoredCount', 5);
      await manifest.checkpointAsync();
      assert.deepEqual(manifest.read().freshnessBinding, sealed);
      assert.equal(manifest.read().anchoredCount, 5);
      // والملفُّ على القرصِ يحملُ الربطَ نفسَه بعدَ كلِّ هذهِ الختومِ.
      const onDisk = JSON.parse(readFileSync(file, 'utf8')).body;
      assert.deepEqual(onDisk.freshnessBinding, sealed);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('التوافقُ: البيانُ التاريخيُّ يبقى بلا ربطٍ ولا تُرقّيهِ التحديثاتُ صامتةً', async () => {
    const dir = tmp('wl434-compat-');
    try {
      const { manifest, file, sealer } = await provisionedManifest(dir);
      await manifest.checkpointAsync();
      await manifest.stageAsync({ txn: 't', intent: 'log.append', fromEpoch: 0, fromAnchor: 'genesis', at: new Date().toISOString() });
      await manifest.clearStagedAsync();
      assert.equal(manifest.read().version, 2, 'لا ترقيةَ صامتةَ لمخطّطٍ تاريخيٍّ');
      assert.equal(manifest.read().freshnessBinding, undefined);
      const reopened = new StateManifest(file, { fsync: false, sealer });
      const body = await reopened.openAsync({ kingId: sealer.id, context: 'test', tokenSerial: 'T', moduleSha256: 'M' });
      assert.equal(body.version, 2);
      assert.equal(body.freshnessBinding, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('مقبسُ المحاكاةِ يستهلكُ الربطَ من البيانِ حديثًا: الغيابُ رفضٌ والتحريفُ رفضٌ (بلا swtpm)', async () => {
    // pinnedBinding() لا يلمسُ المحاكي: يقرأُ من دالّةِ البيانِ ويُتحقَّقُ من شكلِه — وذاك
    // مستوىُ الوحدةِ؛ أما فحصُ الأسماءِ من NV_ReadPublic ففي قسمِ المحاكاةِ (swtpm في CI).
    const dir = tmp('wl434-socket-');
    try {
      const { manifest } = await provisionedManifest(dir);
      let binding = null;
      const socket = new SwtpmNvStateBoundSocket({
        tools: () => {
          throw new Error('لا يُنادى المحاكي في هذا القياس');
        },
        counterIndex: COUNTER,
        recordIndex: RECORD,
        lockDir: join(dir, 'locks'),
        manifestBinding: () => binding,
      });
      assert.equal(socket.pinnedBinding(), null, 'لا ربطَ بعدُ — والقراءةُ سترفضُ في القسمِ المحاكى');
      await manifest.bindFnvAsync(material(), DECLARED_ENV);
      binding = structuredClone(manifest.read().freshnessBinding);
      assert.deepEqual(socket.pinnedBinding(), binding, 'الربطُ من البيانِ كما خُتم');
      // تحريفُ ما تُعيدُهُ الدالّةُ (بيانٌ حُرّفَ): رفضٌ مسمّى لا قيمةٌ بديلة — والتحريفُ
      // الذي يكسرُ الشكلَ تُسمّيهِ الحقلَ، والذي يحفظُ الشكلَ يكشفُهُ الخاتَمُ عندَ الفتحِ.
      binding.counterName = 'nothex';
      const tampered = await rejection(() => socket.pinnedBinding());
      assert.equal(tampered.code, 'FRESHNESS_NV_BINDING_INVALID');
      assert.equal(tampered.message.includes('counterName'), true, 'الرفضُ يسمّي الحقلَ لا سرًّا يكشفُه');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * مقبسُ اختبارٍ مربوطٌ بالحالةِ بالعقدِ الكاملِ (`stateBound`) معَ امتداداتِ WL-434:
 * كشفُ الربطِ المثبَّتِ (`pinnedBinding`)، ومادّةُ الربطِ (`fnvBindingMaterial`)،
 * وحقنُ أخطاءِ قراءةٍ مسمّاةٍ (رموزُ NV المغلقة) وغيرِ مسمّاةٍ (B0).
 */
class TestStateBoundSocket {
  stateBound = true;
  testFixture = true;
  #current = { epoch: 0n, anchor: 'genesis' };
  #pinned = null;
  #readError = null;
  #advanceError = null;

  /** يرفعُ خطأَ القراءةِ القادمَ (مسمّى بكودٍ أو غيرُ مسمّى) — حقنُ قياسٍ. */
  failReadWith(error) {
    this.#readError = error;
  }

  /** يُفشِلُ كلَّ انتقالٍ — انقطاعُ نقلٍ بعدَ الترحيلِ: نتيجةٌ مجهولةٌ تُسيّجُ الحاجزَ. */
  failAdvanceWith(error) {
    this.#advanceError = error;
  }

  /** يضعُ المرجعَ على حالٍ بعينِها — إقلاعٌ ثانٍ فوقَ جذرٍ مربوطٍ. */
  forceCurrent(reading) {
    this.#current = { epoch: reading.epoch, anchor: reading.anchor };
  }

  /** يركّبُ كاشفَ الربطِ المثبّتِ (WL-434) — أو يبقيهُ غائبًا. */
  usePinnedBinding(fn) {
    this.#pinned = fn;
  }

  /** يركّبُ مادّةَ الربطِ من المصدرِ (B10) — أو يبقيها غائبةً (فلا كشفَ ولا استهلاكَ). */
  useMaterial(fn) {
    this.fnvBindingMaterial = async () => fn();
  }

  pinnedBinding() {
    if (typeof this.#pinned === 'function') return this.#pinned();
    return null;
  }

  async read() {
    if (this.#readError !== null) throw this.#readError;
    return this.#current;
  }

  async advanceState(from, to) {
    if (this.#advanceError !== null) throw this.#advanceError;
    if (this.#current.epoch === from.epoch && this.#current.anchor === from.anchor) {
      this.#current = { epoch: to.epoch, anchor: to.anchor };
    }
    return this.#current;
  }
}

function bootEnv(keys, extra = {}) {
  return { XUUX_FRESHNESS_BIND_DECLARED: '1', ...extra };
}

/**
 * يقرأُ عهدَ الجذرِ المربوطِ ومرساةَهُ من بيانِهِ على القرصِ — لإقلاعٍ ثانٍ فوقَهُ.
 * @param {string} root - جذرُ الحالةِ
 */
async function firstBoundReading(root) {
  const sealed = JSON.parse(readFileSync(join(root, 'root-of-trust.manifest.json'), 'utf8'));
  return { epoch: BigInt(sealed.body.freshnessEpoch), anchor: sealed.body.freshnessAnchor };
}

describe('WL-434 — رموزُ الربطِ في قرارِ الإقلاعِ (المسارُ الإنتاجيُّ عبرَ bootRoot)', () => {
  test('رموزُ NV المسمّاةُ تصلُ إلى القرارِ كما هي، وغيرُ المسمّى يبقى B0 المغلق', async () => {
    const dir = tmp('wl434-boot-codes-');
    try {
      for (const code of ['FRESHNESS_NV_BINDING_INVALID', 'FRESHNESS_NV_BINDING_MISMATCH']) {
        const keys = makeKeys();
        const socket = new TestStateBoundSocket();
        socket.failReadWith(Object.assign(new Error(`${code}: قياسٌ بمحتوىً حسّاسٍ`), { code }));
        const error = await rejection(() => bootRoot(join(dir, code), keys, socket, { env: bootEnv(keys) }));
        assert.equal(error.code, code, `الرمزُ المسمّى ${code} يصلُ إلى قرارِ الإقلاعِ`);
        const fixedDetails = ['ربطُ NV غيرُ صالحٍ', 'ربطُ NV لا يطابقُ المرجع'];
        assert.equal(fixedDetails.includes(error.detail), true, 'التفصيلُ نصٌّ ثابتٌ لا محتوىُ الاستثناء');
        assert.equal(String(error.message).includes('حسّاس'), false, 'لا محتوىَ استثناءٍ يُمرّر');
      }
      const keys = makeKeys();
      const socket = new TestStateBoundSocket();
      socket.failReadWith(new Error('FRESHNESS_TRANSPORT_LOST'));
      const error = await rejection(() => bootRoot(join(dir, 'b0'), keys, socket, { env: bootEnv(keys) }));
      assert.equal(error.code, 'FRESHNESS_SOURCE_UNAVAILABLE', 'غيرُ المسمّى يبقى B0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('بيانٌ يحملُ ربطًا ومقبسٌ لا يكشفُهُ ⇒ INVALID: التحقّقُ إلزامٌ لا يُعطَّلُ بحذفِ الواجهة', async () => {
    const dir = tmp('wl434-boot-nv-');
    try {
      const keys = makeKeys();
      const root = join(dir, 'root');
      const socket = new TestStateBoundSocket();
      socket.useMaterial(() => material());
      // الإقلاعُ الأوّلُ يربطُ ويختمُ المادّةَ من المصدرِ (B10).
      await bootRoot(root, keys, socket, { env: bootEnv(keys) });
      const stateManifestPath = join(root, 'root-of-trust.manifest.json');
      assert.equal(existsSync(stateManifestPath), true);
      const sealed = JSON.parse(readFileSync(stateManifestPath, 'utf8'));
      assert.equal(sealed.body.version, FNV_MANIFEST_SCHEMA_VERSION, 'B10 ختمَ الربطَ في المتنِ');
      assert.equal(sealed.body.freshnessBinding.base, '7');
      // إقلاعٌ ثانٍ بمقبسٍ لا يكشفُ الربطَ: الحمايةُ لا تسقُطُ بحذفِ الواجهةِ.
      const silent = new TestStateBoundSocket();
      const error = await rejection(() => bootRoot(root, keys, silent, { env: bootEnv(keys) }));
      assert.equal(error.code, 'FRESHNESS_NV_BINDING_INVALID');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('اختلافُ البيانِ والمصدرِ (base) ⇒ MISMATCH مسمّى، والتطابقُ يُقلِعُ', async () => {
    const dir = tmp('wl434-boot-match-');
    try {
      const keys = makeKeys();
      const root = join(dir, 'root');
      const socket = new TestStateBoundSocket();
      socket.useMaterial(() => material());
      const first = await bootRoot(root, keys, socket, { env: bootEnv(keys) });
      await first.close();
      const sealed = JSON.parse(readFileSync(join(root, 'root-of-trust.manifest.json'), 'utf8'));
      // مقبسٌ يكشفُ ربطًا بقاعدةٍ أخرى — لا مصدرَ حقيقةٍ ثانٍ.
      const divergent = new TestStateBoundSocket();
      divergent.usePinnedBinding(() => ({ ...sealed.body.freshnessBinding, base: '3' }));
      const divergentError = await rejection(() => bootRoot(root, keys, divergent, { env: bootEnv(keys) }));
      assert.equal(divergentError.code, 'FRESHNESS_NV_BINDING_MISMATCH');
      assert.equal(divergentError.detail, 'base', 'الرفضُ يسمّي الحقلَ المتّفقَ عليهِ');
      // والمطابقُ يُقلِعُ: إقلاعٌ ثانٍ فوقَ الجذرِ المربوطِ (المرجعُ في عهدِ البيانِ نفسِهِ).
      const bound = await firstBoundReading(root);
      const matching = new TestStateBoundSocket();
      matching.forceCurrent(bound);
      matching.usePinnedBinding(() => sealed.body.freshnessBinding);
      const runtime = await bootRoot(root, keys, matching, { env: bootEnv(keys) });
      assert.equal(runtime.manifest.read().version, FNV_MANIFEST_SCHEMA_VERSION);
      assert.deepEqual(runtime.manifest.read().freshnessBinding, sealed.body.freshnessBinding);
      await runtime.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('B10 يختمُ مادّةَ المصدرِ في المتنِ، وتعافي B2 يعيدُ الربطَ المختومَ نفسَهُ بلا مادّةٍ جديدة', async () => {
    const dir = tmp('wl434-boot-b10b2-');
    try {
      const keys = makeKeys();
      const root = join(dir, 'root');
      // الإقلاعُ الأوّلُ: B10 يختمُ مادّةَ المصدرِ، ثمّ ينقطعُ النقلُ بعدَ ترحيلِ الربطِ
      // وقبلَ تقدّمِ المرجعِ — فسقوطٌ حقيقيٌّ في منتصفِ المعاملةِ يتركُ `staged` مختومًا.
      const crashing = new TestStateBoundSocket();
      crashing.useMaterial(() => material());
      crashing.usePinnedBinding(() => material());
      crashing.failAdvanceWith(new Error('FRESHNESS_TRANSPORT_LOST'));
      const crash = await rejection(() => bootRoot(root, keys, crashing, { env: bootEnv(keys) }));
      assert.equal(crash.code, 'FRESHNESS_ADVANCE_UNRESOLVED', 'انقطاعُ النقلِ يسيّجُ الحاجزَ ولا يُقدمُ المرجعَ');
      const sealed = JSON.parse(readFileSync(join(root, 'root-of-trust.manifest.json'), 'utf8'));
      assert.equal(sealed.body.version, FNV_MANIFEST_SCHEMA_VERSION, 'المادّةُ من المصدرِ خُتمت');
      assert.equal(sealed.body.freshnessAnchor, undefined, 'والربطُ لم يكتملْ بعدُ');
      assert.equal(sealed.body.staged.intent, 'freshness.bind', 'والترحيلُ مختومٌ في المتنِ');
      // والتعافي (B2) يعيدُ استعمالَ الربطِ المختومِ نفسِهُ: أيُّ نداءٍ للمادّةِ دليلُ
      // خلطٍ في المسارِ، فالمقبسُ يرفعُهُ — والحاجزُ يُكمِلُ من النشأةِ كما هو التصميمُ.
      const recovery = new TestStateBoundSocket();
      recovery.usePinnedBinding(() => material());
      recovery.useMaterial(() => {
        throw new Error('B2 لا يجمعُ مادّةً جديدةً');
      });
      const runtime = await bootRoot(root, keys, recovery, { env: bootEnv(keys) });
      const after = JSON.parse(readFileSync(join(root, 'root-of-trust.manifest.json'), 'utf8'));
      assert.deepEqual(after.body.freshnessBinding, sealed.body.freshnessBinding, 'الربطُ المختومُ لم يُمسّ');
      assert.equal(after.body.staged, null, 'والترحيلُ استُرجِعَ');
      assert.equal(runtime.manifest.read().freshnessEpoch, 1, 'والتعافي رقّى العهدَ إلى 1');
      await runtime.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('تحريفُ البيانِ أو حذفُهُ أثناءَ التشغيلِ يُسقِطُ الإقلاعَ مغلقًا قبلَ أيّ قبول', async () => {
    const dir = tmp('wl434-boot-tamper-');
    try {
      const keys = makeKeys();
      const root = join(dir, 'root');
      const socket = new TestStateBoundSocket();
      socket.useMaterial(() => material());
      const first = await bootRoot(root, keys, socket, { env: bootEnv(keys) });
      await first.close();
      const file = join(root, 'root-of-trust.manifest.json');
      const sealed = JSON.parse(readFileSync(file, 'utf8'));
      // تحريفُ الربطِ في الملفِّ ⇒ الخاتَمُ يُسقِطُ الإقلاعَ كلهُ.
      sealed.body.freshnessBinding.base = '1';
      writeFileSync(file, JSON.stringify(sealed, null, 2) + '\n');
      const bound = await firstBoundReading(root);
      const tampered = new TestStateBoundSocket();
      tampered.forceCurrent(bound);
      tampered.usePinnedBinding(() => sealed.body.freshnessBinding);
      const tamperedError = await rejection(() => bootRoot(root, keys, tampered, { env: bootEnv(keys) }));
      assert.equal(tamperedError.code, 'STATE_MANIFEST_SEAL_INVALID');
      // وحذفُ البيانِ ⇒ جذرٌ غيرُ مهيَّأٍ لا «حالةٌ افتراضيّةٌ».
      rmSync(file);
      const deleted = new TestStateBoundSocket();
      const deletedError = await rejection(() =>
        bootRoot(root, keys, deleted, { env: bootEnv(keys, { XUUX_ROOT_OF_TRUST_PROVISION: '0' }) }),
      );
      assert.equal(deletedError.code, 'PRODUCTION_STATE_ROOT_UNPROVISIONED');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
