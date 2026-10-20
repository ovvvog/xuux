// @ts-nocheck
// tests/sim/freshness-nv/swtpm-nv-pinned-binding.test.mjs
//
// WL-433 — معالجةُ T7 (‏قرارُ المالكِ D1-أ في WL-432): `base` واسما الفهرسَينِ ومقبضاهما مثبَّتةٌ في
// ربطٍ مختومٍ **خارجَ `R`**، فاسترجاعُ لقطةِ التطبيقِ وحدَها لا يُقبَلُ أيًّا كان ما يكتبُه كاتبُ `R`.
//
// قسمان:
//   - **وحدةٌ** (‏تعملُ دائمًا، بلا swtpm): ختمُ الربطِ وفتحُه ورفضُ كلِّ تحريرٍ أو مفتاحٍ آخر.
//   - **محاكاةٌ** (‏`XUUX_TPM_SIM=1` معَ swtpm): على **جذرِ الثقةِ الحقيقيّ** (‏`createProductionRootOfTrust`
//     عبرَ `tests/helpers/wl-326-root.mjs`) فرموزُ الرفضِ من مسارِ `decideStateBoundBoot` نفسِه.
//
// **حدودٌ معلنة:** محاكاةٌ لا عتاد؛ الموقِّعُ زوجُ Ed25519 في الاختبارِ لا HSM؛ والربطُ ملفٌّ يقرؤه
// المجسُّ لا حقلٌ في البيانِ المختومِ الحقيقيّ. واسترجاعُ لقطةِ التطبيقِ **ولقطةِ حالةِ المحاكي** معًا
// يبقى مقبولًا (‏T6) — لا يعالجُه الربطُ ولا يُدَّعى.

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as edSign } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { FRESHNESS_GENESIS_ANCHOR, StateManifest, fingerprint } from '../../../src/root-of-trust/index.mjs';
import { createPublicKey, verify as edVerify } from 'node:crypto';
import {
  BINDING_CODES,
  BINDING_SCHEMA,
  bindingBytes,
  openBindingFile,
  parseNvName,
  sealBindingFile,
} from '../../../sim/freshness-nv/pinned-binding.mjs';
import { SwtpmInstance, toolsAvailable } from '../../../sim/freshness-nv/swtpm-harness.mjs';
import {
  NV_PROBE_CODES,
  SwtpmNvStateBoundSocket,
  encodeRecord,
} from '../../../sim/freshness-nv/nv-state-bound-socket.mjs';
import { registerTmpRoot } from '../../helpers/tmp-roots.mjs';
import { bootRoot, makeKeys, pairOf } from '../../helpers/wl-326-root.mjs';

const COUNTER = '0x01500030';
const RECORD = '0x01500031';
const NAME_C = `000b${'1'.repeat(64)}`;
const NAME_R = `000b${'2'.repeat(64)}`;

const enabled = process.env.XUUX_TPM_SIM === '1' && (await toolsAvailable());
const skip = enabled ? false : 'يتطلّبُ XUUX_TPM_SIM=1 معَ swtpm وtpm2-tools (‏scripts/tpm-sim-ci.sh)';

function signerPair() {
  const pair = generateKeyPairSync('ed25519');
  return { publicKey: pair.publicKey, sign: async (bytes) => edSign(null, bytes, pair.privateKey) };
}

async function rejection(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return assert.fail('لم يُرفَعْ خطأ');
}

function tmp(prefix) {
  return registerTmpRoot(mkdtempSync(join(tmpdir(), prefix)));
}

describe('WL-433 — الربطُ المختومُ خارجَ R (وحدة، بلا swtpm)', () => {
  test('الختمُ ثمّ الفتحُ يعيدُ المتنَ نفسَه، والصيغةُ موحّدة', async () => {
    const dir = tmp('wl433-unit-');
    try {
      const s = signerPair();
      const file = join(dir, 'b.json');
      await sealBindingFile(file, { counterIndex: '0x1500030', recordIndex: RECORD, counterName: NAME_C, recordName: NAME_R, base: 7n }, s.sign);
      const b = openBindingFile(file, s.publicKey);
      assert.equal(b.schema, BINDING_SCHEMA);
      assert.equal(b.counterIndex, COUNTER);
      assert.equal(b.base, 7n);
      // لا كتابةَ فوقَ ربطٍ قائم: الختمُ الثاني يُرفَضُ والأوّلُ باقٍ بايتًا ببايت، ولا ملفَّ مؤقّتًا يتيمًا.
      const before = readFileSync(file);
      const again = await rejection(() =>
        sealBindingFile(file, { counterIndex: COUNTER, recordIndex: RECORD, counterName: NAME_C, recordName: NAME_R, base: 1n }, s.sign),
      );
      assert.equal(again.code, BINDING_CODES.INVALID);
      assert.deepEqual(readFileSync(file), before);
      assert.equal(existsSync(`${file}.tmp`), false);
      // ملفٌّ مؤقّتٌ متبقٍّ من سقوطٍ سابق ⇒ يُرفَضُ ولا يُكتَبُ فوقَه.
      rmSync(file);
      writeFileSync(`${file}.tmp`, 'x');
      await assert.rejects(
        sealBindingFile(file, { counterIndex: COUNTER, recordIndex: RECORD, counterName: NAME_C, recordName: NAME_R, base: 1n }, s.sign),
        /EEXIST/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('كلُّ تحريرٍ أو مفتاحٍ آخرَ أو ملفٍّ غائبٍ ⇒ FRESHNESS_NV_BINDING_INVALID', async () => {
    const dir = tmp('wl433-unit-');
    try {
      const s = signerPair();
      const other = signerPair();
      const file = join(dir, 'b.json');
      await sealBindingFile(file, { counterIndex: COUNTER, recordIndex: RECORD, counterName: NAME_C, recordName: NAME_R, base: 9n }, s.sign);
      const env = JSON.parse(readFileSync(file, 'utf8'));
      const variant = (mut) => {
        const f = join(dir, `v-${Math.random().toString(16).slice(2)}.json`);
        const copy = structuredClone(env);
        mut(copy);
        writeFileSync(f, JSON.stringify(copy));
        return f;
      };
      const cases = [
        variant((e) => (e.body.base = '3')), // base أقدم بلا توقيع
        variant((e) => (e.body.counterName = NAME_R)),
        variant((e) => (e.body.recordIndex = '0x01500032')),
        variant((e) => (e.body.schema = 'xuux.fnv-binding/0')),
        variant((e) => (e.alg = 'none')),
        variant((e) => (e.sig = Buffer.alloc(64).toString('base64'))),
        variant((e) => (e.body.counterIndex = e.body.recordIndex)),
        join(dir, 'absent.json'),
      ];
      for (const f of cases) {
        assert.equal((await rejection(() => openBindingFile(f, s.publicKey))).code, BINDING_CODES.INVALID, f);
      }
      writeFileSync(join(dir, 'junk.json'), '{');
      assert.equal((await rejection(() => openBindingFile(join(dir, 'junk.json'), s.publicKey))).code, BINDING_CODES.INVALID);
      assert.equal((await rejection(() => openBindingFile(file, other.publicKey))).code, BINDING_CODES.INVALID);
      // التوقيعُ على سابقةِ مجالٍ وترتيبٍ ثابت: لا يصلحُ توقيعٌ على JSON المتنِ الخامِّ نفسِه.
      const raw = Buffer.from(JSON.stringify(env.body));
      assert.notDeepEqual(bindingBytes({ ...env.body, base: 9n }), raw);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('اسمُ NV يُقرأُ من مخرجِ tpm2_nvreadpublic، وغيرُ المقروءِ رفض', () => {
    assert.equal(parseNvName(`0x1500030:\n  name: ${NAME_C}\n  size: 8\n`), NAME_C);
    assert.equal((() => {
      try {
        parseNvName('0x1500030:\n  size: 8\n');
      } catch (e) {
        return e.code;
      }
      return null;
    })(), BINDING_CODES.MISMATCH);
  });
});

const anchorOf = (label) => createHash('sha256').update(`wl-433:${label}`).digest('hex');

/** بيئةٌ معزولة: swtpm بحالةٍ خاصّة، وجذرُ تطبيقٍ يحملُ ملفَّ الربط، ومفتاحُ ختمٍ يملكُه الاختبار. */
async function lab() {
  const base = tmp('wl433-fnv-');
  const sw = new SwtpmInstance({ stateDir: join(base, 'swtpm-state') });
  mkdirSync(sw.stateDir, { recursive: true });
  await sw.start();
  const root = join(base, 'app-root');
  mkdirSync(root, { recursive: true });
  const signer = signerPair();
  const bindingFile = join(root, 'freshness-nv.binding.json');
  const socket = (opts = {}) =>
    new SwtpmNvStateBoundSocket({
      tools: () => sw.tools(),
      counterIndex: COUNTER,
      recordIndex: RECORD,
      lockDir: join(base, 'locks'),
      binding: { file: bindingFile, publicKey: signer.publicKey },
      ...opts,
    });
  return {
    base,
    sw,
    root,
    signer,
    bindingFile,
    socket,
    cleanup: async () => {
      await sw.dispose();
      rmSync(base, { recursive: true, force: true });
    },
  };
}

async function commitCommand(runtime, id) {
  await runtime.ledger.transactAsync('crown.command', async () => {
    runtime.ledger.begin({ id });
    await runtime.ledger.commitSigned({ id });
  });
}

function restoreApp(env, snapshot) {
  rmSync(env.root, { recursive: true, force: true });
  cpSync(snapshot, env.root, { recursive: true });
}

/** يبني سجلًّا: e0 ⇒ cmd-1 ⇒ (لقطةٌ قديمة) ⇒ cmd-2. يُرجعُ المراسي المعروفةَ وقيمةَ C. */
async function history(env) {
  const { base } = await env.socket().provision({ sign: env.signer.sign });
  const keys = makeKeys();
  const anchors = [FRESHNESS_GENESIS_ANCHOR];
  let runtime = await bootRoot(env.root, keys, env.socket());
  await commitCommand(runtime, 'cmd-1');
  await runtime.close();
  const old = await env.socket().inspect();
  anchors.push(old.reference.anchor);
  const appOld = join(env.base, 'app-old');
  cpSync(env.root, appOld, { recursive: true });
  runtime = await bootRoot(env.root, keys, env.socket());
  await commitCommand(runtime, 'cmd-2');
  await runtime.close();
  const now = await env.socket().inspect();
  anchors.push(now.reference.anchor);
  const appNow = join(env.base, 'app-now');
  cpSync(env.root, appNow, { recursive: true });
  return { base, keys, anchors, old, now, appOld, appNow };
}

describe('WL-433 — معالجةُ T7 بربطٍ مختومٍ خارجَ R (محاكاةٌ لا عتاد)', { skip }, () => {
  test('B1 — هجومُ T7 نفسُه (إزاحةُ base في R + لقطةُ التطبيقِ القديمة) يُرفَضُ برمزِه، والرفضُ لا يُتلفُ الحالةَ الحاليّة', async () => {
    const env = await lab();
    try {
      const h = await history(env);
      assert.ok(h.now.reference.epoch > h.old.reference.epoch);
      const good = encodeRecord(h.now.record);
      await env.socket().writeRawRecordForTest(
        encodeRecord({ phase: 0, base: h.now.counter - h.old.reference.epoch, epoch: h.old.reference.epoch, cur: h.old.reference.anchor }),
      );
      restoreApp(env, h.appOld);
      // ربطُ اللقطةِ القديمةِ بايتًا ببايتٍ هو الحاليّ: المتنُ ثابتٌ منذُ التهيئة.
      assert.deepEqual(readFileSync(env.bindingFile), readFileSync(join(h.appNow, 'freshness-nv.binding.json')));
      assert.equal((await rejection(() => env.socket().read())).code, BINDING_CODES.MISMATCH);
      assert.equal((await rejection(() => bootRoot(env.root, h.keys, env.socket()))).code, 'FRESHNESS_SOURCE_UNAVAILABLE');
      // الضابطُ: بلا ربطٍ (‏سلوكُ WL-431) يُقبَلُ الهجومُ نفسُه — فالرفضُ أعلاه من الربطِ لا من غيره.
      const unbound = await bootRoot(env.root, h.keys, env.socket({ binding: null }));
      assert.equal(unbound.freshnessBoot, 'B1');
      assert.notEqual(unbound.ledger.state('cmd-2'), 'committed');
      await unbound.close();
      // استعادةُ السجلِّ الصحيحِ والتطبيقِ الحاليِّ ⇒ B1 و`cmd-2` ملتزَم: الرفضُ لم يكتبْ شيئًا.
      await env.socket().writeRawRecordForTest(good);
      restoreApp(env, h.appNow);
      const back = await bootRoot(env.root, h.keys, env.socket());
      assert.equal(back.freshnessBoot, 'B1');
      assert.equal(back.ledger.state('cmd-2'), 'committed');
      await back.close();
    } finally {
      await env.cleanup();
    }
  });

  test('B2 — كلُّ ما يكتبُه كاتبُ R (base مثبَّتٌ أو مزاح، عهدٌ ومرساةٌ قديمان أو حاليّان أو مزوّران، قصدٌ أو التزام): العهدُ المقروءُ = C − base أو رفض، ولقطةُ التطبيقِ القديمةُ لا تُقبَلُ أبدًا', async () => {
    const env = await lab();
    try {
      const h = await history(env);
      const C = h.now.counter;
      const eNow = h.now.reference.epoch;
      const anchors = [...h.anchors, anchorOf('forged')];
      const bases = [h.base, h.base - 1n, h.base + 1n, C - h.old.reference.epoch, C];
      const epochs = [0n, h.old.reference.epoch, eNow, eNow + 1n];
      let reads = 0;
      let boots = 0;
      for (const base of bases) {
        if (base < 0n) continue;
        for (const epoch of epochs) {
          for (const phase of [0, 1]) {
            for (const cur of anchors) {
              for (const next of phase === 1 ? anchors : [undefined]) {
                await env.socket().writeRawRecordForTest(encodeRecord({ phase, base, epoch, cur, next }));
                let reading = null;
                try {
                  reading = await env.socket().read();
                } catch (error) {
                  assert.ok(
                    [BINDING_CODES.MISMATCH, NV_PROBE_CODES.INCONSISTENT].includes(error.code),
                    `رمزٌ غيرُ متوقّع ${error.code}`,
                  );
                }
                if (reading === null) continue;
                reads += 1;
                // الثابتُ الحاسم: العهدُ من C والـbase المثبَّتِ وحدَهما — لا من R.
                assert.equal(reading.epoch, C - h.base, `phase=${phase} base=${base} epoch=${epoch}`);
                assert.equal(base, h.base);
                restoreApp(env, h.appOld);
                const error = await rejection(() => bootRoot(env.root, h.keys, env.socket()));
                boots += 1;
                assert.equal(error.code, 'STALE_MANIFEST_EPOCH', `لقطةٌ قديمةٌ قُبلت أو رُفضت بغيرِ رمزِها: ${error.code}`);
              }
            }
          }
        }
      }
      assert.ok(reads > 0 && boots === reads, `قراءاتٌ ${reads} وإقلاعاتٌ ${boots}`);
      // والتطبيقُ الحاليُّ يُقبَلُ فقط بالمرساةِ الحقيقيّة: مرساةٌ مزوّرةٌ في العهدِ نفسِه ⇒ انشقاق.
      restoreApp(env, h.appNow);
      await env.socket().writeRawRecordForTest(encodeRecord({ phase: 0, base: h.base, epoch: eNow, cur: anchorOf('forged') }));
      assert.equal((await rejection(() => bootRoot(env.root, h.keys, env.socket()))).code, 'FRESHNESS_SAME_EPOCH_FORK');
      await env.socket().writeRawRecordForTest(encodeRecord(h.now.record));
      const ok = await bootRoot(env.root, h.keys, env.socket());
      assert.equal(ok.freshnessBoot, 'B1');
      assert.equal(ok.ledger.state('cmd-2'), 'committed');
      await ok.close();
    } finally {
      await env.cleanup();
    }
  });

  test('B3 — الربطُ نفسُه: غيابُه أو تحريرُه أو ختمُه بمفتاحٍ آخرَ أو ربطٌ لمقابضَ أخرى ⇒ رفضٌ مغلقٌ في القراءةِ والإقلاع', async () => {
    const env = await lab();
    try {
      const h = await history(env);
      const original = readFileSync(env.bindingFile);
      const parsed = JSON.parse(original);
      const tryAll = async (expect) => {
        assert.equal((await rejection(() => env.socket().read())).code, expect);
        assert.equal((await rejection(() => bootRoot(env.root, h.keys, env.socket()))).code, 'FRESHNESS_SOURCE_UNAVAILABLE');
      };
      rmSync(env.bindingFile);
      await tryAll(BINDING_CODES.INVALID);
      writeFileSync(env.bindingFile, JSON.stringify({ ...parsed, body: { ...parsed.body, base: String(h.base - 1n) } }));
      await tryAll(BINDING_CODES.INVALID);
      // ربطٌ صحيحُ الختمِ لكن بمفتاحٍ لا يثقُ به المرجع (‏مثلًا من نشرٍ آخر).
      rmSync(env.bindingFile);
      const foreign = signerPair();
      await sealBindingFile(env.bindingFile, { ...parsed.body, base: h.base }, foreign.sign);
      await tryAll(BINDING_CODES.INVALID);
      // ربطٌ مختومٌ بالمفتاحِ الموثوقِ لكن لمقبضَين آخرَين ⇒ عدمُ تطابق.
      rmSync(env.bindingFile);
      await sealBindingFile(env.bindingFile, { ...parsed.body, counterIndex: '0x01500040', recordIndex: '0x01500041', base: h.base }, env.signer.sign);
      await tryAll(BINDING_CODES.MISMATCH);
      // ربطٌ موثوقٌ بـbase أقدم ⇒ عهدٌ أكبرُ من الحقيقيّ ⇒ لا يُقبَلُ أيُّ بيان (‏حرمانٌ لا استرجاع).
      rmSync(env.bindingFile);
      await sealBindingFile(env.bindingFile, { ...parsed.body, base: h.base - 1n }, env.signer.sign);
      assert.equal((await rejection(() => env.socket().read())).code, BINDING_CODES.MISMATCH);
      writeFileSync(env.bindingFile, original);
      const ok = await bootRoot(env.root, h.keys, env.socket());
      assert.equal(ok.freshnessBoot, 'B1');
      await ok.close();
    } finally {
      await env.cleanup();
    }
  });

  test('B4 — اسما NV: إعادةُ تعريفِ R بسماتٍ أخرى ⇒ رفضٌ بالاسم؛ وإعادةُ تعريفِ C وR مطابقةً (الاسمُ نفسُه) ⇒ العدّادُ يقفزُ فوقَ أقصاه فالعهدُ يرتفعُ ويُرفَضُ كلُّ بيان — حرمانٌ لا استرجاع', async () => {
    const env = await lab();
    try {
      const h = await history(env);
      const tools = () => env.sw.tools();
      // (أ) R بسماتٍ أخرى (‏يُضافُ authread/authwrite: كاتبٌ بلا تفويضِ المالك) ⇒ اسمٌ آخر.
      await tools().exec('tpm2_nvundefine', ['-C', 'o', RECORD]);
      await tools().exec('tpm2_nvdefine', ['-C', 'o', '-s', '128', '-a', 'ownerread|ownerwrite|authread|authwrite', RECORD]);
      await env.socket({ binding: null }).writeRawRecordForTest(encodeRecord(h.now.record));
      assert.equal((await rejection(() => env.socket().read())).code, BINDING_CODES.MISMATCH);
      assert.match((await rejection(() => env.socket().read())).message, /record NV name/);
      // (ب) إعادةُ تعريفٍ مطابقةٍ للاثنَين بتفويضِ المالك، وR يُكتَبُ بأقدمِ ما يُفيدُ المهاجم.
      await tools().exec('tpm2_nvundefine', ['-C', 'o', RECORD]);
      await tools().exec('tpm2_nvundefine', ['-C', 'o', COUNTER]);
      await tools().exec('tpm2_nvdefine', ['-C', 'o', '-s', '8', '-a', 'ownerread|ownerwrite|nt=counter', COUNTER]);
      await tools().exec('tpm2_nvdefine', ['-C', 'o', '-s', '128', '-a', 'ownerread|ownerwrite', RECORD]);
      await tools().exec('tpm2_nvincrement', ['-C', 'o', COUNTER]);
      const raw = await tools().exec('tpm2_nvread', ['-C', 'o', '-s', '8', COUNTER]);
      const c2 = raw.readBigUInt64BE(0);
      assert.ok(c2 > h.now.counter, `العدّادُ المعادُ تعريفُه ${c2} لم يتجاوزْ ${h.now.counter}`);
      const attempts = [
        { phase: 0, base: h.base, epoch: h.old.reference.epoch, cur: h.old.reference.anchor },
        { phase: 0, base: h.base, epoch: c2 - h.base, cur: h.old.reference.anchor },
        { phase: 0, base: c2 - h.old.reference.epoch, epoch: h.old.reference.epoch, cur: h.old.reference.anchor },
      ];
      for (const rec of attempts) {
        await env.socket({ binding: null }).writeRawRecordForTest(encodeRecord(rec));
        for (const snap of [h.appOld, h.appNow]) {
          restoreApp(env, snap);
          const error = await rejection(() => bootRoot(env.root, h.keys, env.socket()));
          assert.ok(
            ['FRESHNESS_SOURCE_UNAVAILABLE', 'STALE_MANIFEST_EPOCH'].includes(error.code),
            `قُبِلت حالةٌ بعدَ إعادةِ التعريف: ${error.code}`,
          );
        }
      }
    } finally {
      await env.cleanup();
    }
  });

  test('B6 — المسارُ الحقيقيّ (CommitCoordinator): ربطٌ يُحذَفُ أثناءَ التشغيلِ ⇒ نتيجةٌ مجهولةٌ ثمّ FRESHNESS_ADVANCE_UNRESOLVED وتسييجٌ، بلا زيادةٍ لـC؛ وبعدَ إعادتِه الإقلاعُ B2 والأمرُ غيرُ ملتزَم', async () => {
    const env = await lab();
    try {
      const h = await history(env);
      const original = readFileSync(env.bindingFile);
      const runtime = await bootRoot(env.root, h.keys, env.socket());
      rmSync(env.bindingFile);
      const error = await rejection(() => commitCommand(runtime, 'cmd-3'));
      assert.equal(error.code, 'FRESHNESS_ADVANCE_UNRESOLVED');
      assert.equal((await rejection(() => commitCommand(runtime, 'cmd-4'))).code, 'COMMIT_BARRIER_FENCED');
      await runtime.close();
      assert.equal((await rejection(() => bootRoot(env.root, h.keys, env.socket()))).code, 'FRESHNESS_SOURCE_UNAVAILABLE');
      writeFileSync(env.bindingFile, original);
      const after = await env.socket().inspect();
      assert.equal(after.counter, h.now.counter, 'لا زيادةَ بلا ربطٍ موثوق');
      const back = await bootRoot(env.root, h.keys, env.socket());
      assert.equal(back.freshnessBoot, 'B2');
      assert.notEqual(back.ledger.state('cmd-3'), 'committed');
      assert.equal(back.ledger.state('cmd-2'), 'committed');
      await back.close();
    } finally {
      await env.cleanup();
    }
  });

  test('B5 — نافذةُ التهيئة: سقوطٌ بعدَ كتابةِ R وقبلَ ختمِ الربطِ ⇒ لا ربطَ ⇒ رفضٌ مغلق، والتهيئةُ لا تُعادُ صامتةً', async () => {
    const env = await lab();
    try {
      const failing = async () => {
        throw new Error('SIGNER_LOST');
      };
      await assert.rejects(env.socket().provision({ sign: failing }), /SIGNER_LOST/);
      assert.equal((await rejection(() => env.socket().read())).code, BINDING_CODES.INVALID);
      const again = await rejection(() => env.socket().provision({ sign: env.signer.sign }));
      assert.equal(again.code, NV_PROBE_CODES.SOURCE_UNAVAILABLE, 'إعادةُ التهيئةِ فوقَ فهرسَينِ قائمَين تُرفَض');
      // وبلا موقِّعٍ أصلًا لمقبسٍ له ربطٌ ⇒ رفضٌ قبلَ أيِّ ادّعاء (‏على swtpm جديد).
      const fresh = new SwtpmNvStateBoundSocket({
        tools: () => env.sw.tools(),
        counterIndex: '0x01500050',
        recordIndex: '0x01500051',
        lockDir: join(env.base, 'locks'),
        binding: { file: join(env.base, 'other.binding.json'), publicKey: env.signer.publicKey },
      });
      assert.equal((await rejection(() => fresh.provision())).code, BINDING_CODES.INVALID);
    } finally {
      await env.cleanup();
    }
  });
});

describe('WL-434 — الربطُ داخلَ متنِ البيانِ المختومِ لا ملفًّا جانبيًّا (محاكاةٌ لا عتاد)', { skip }, () => {
  /** موقّعُ بيانٍ بعقدِ `ManifestSealer` من مفاتيحِ الإقلاعِ نفسِها — لقراءةٍ مُتحقَّقٍ من الختمِ. */
  function manifestSealerOf(keys) {
    const pub = createPublicKey(keys.anchor.pub);
    const pair = pairOf(keys.anchor);
    const id = 'king:' + fingerprint(pub).slice(0, 24);
    return {
      id,
      signAsync: async (payload) => edSign(null, Buffer.from(JSON.stringify(payload)), pair.privateKey).toString('base64'),
      verify: (payload, signature) =>
        edVerify(null, Buffer.from(JSON.stringify(payload)), pub, Buffer.from(signature, 'base64')),
    };
  }

  test('الإقلاعُ المعلَنُ يختمُ مادّةَ المرجعِ الحيّ في المتنِ، والمقبسُ يستهلكُهُ من البيانِ المُتحقَّقِ منهِ، وحذفُ البيانِ أو تحريرُهُ رفضٌ مسمّى', async () => {
    const base = tmp('wl434-sim-');
    const sw = new SwtpmInstance({ stateDir: join(base, 'swtpm-state') });
    mkdirSync(sw.stateDir, { recursive: true });
    await sw.start();
    try {
      const root = join(base, 'app-root');
      mkdirSync(root, { recursive: true });
      const keys = makeKeys();
      const sealer = manifestSealerOf(keys);
      const manifestFile = join(root, 'root-of-trust.manifest.json');
      /** يقرأُ الربطَ من البيانِ **مُتحقَّقًّا من ختمِهِ** في كلّ مرةٍ — لا نسخةً محفوظةً. */
      const readBinding = () => {
        const manifest = new StateManifest(manifestFile, { fsync: false, sealer });
        return manifest.read().freshnessBinding ?? null;
      };
      const socket = (opts = {}) =>
        new SwtpmNvStateBoundSocket({
          tools: () => sw.tools(),
          counterIndex: COUNTER,
          recordIndex: RECORD,
          lockDir: join(base, 'locks'),
          manifestBinding: readBinding,
          ...opts,
        });
      // التهيئةُ بلا ربطٍ (‏v2 تاريخيّ): المقبسُ يقرأُ `base` من `R` حتى المراسمِ.
      const { base: provisionedBase } = await socket().provision();
      // الإقلاعُ المعلَنُ: B10 يجمعُ المادّةَ من المرجعِ الحيّ (المقبضانِ والاسمانِ و`base`)
      // ويختمُها في المتنِ — فلا ملفَّ ربطٍ جانبيًّا في المسارِ البتةَ.
      const first = await bootRoot(root, keys, socket(), { env: { XUUX_FRESHNESS_BIND_DECLARED: '1' } });
      assert.equal(first.freshnessBoot, 'B10');
      const sealed = JSON.parse(readFileSync(manifestFile, 'utf8'));
      assert.equal(sealed.body.version, 3, 'مخطّطُ NV بعدَ المراسمِ');
      // قراءةٌ مستقلةٌ من NV نفسِهِ (tpm2_nvreadpublic خارجَ المقبسِ) — لا مقارنةَ
      // بيانٍ بنفسِهِ: المختومُ في المتنِ يجبُ أن يطابقَ الاسمَ كما يُقرأُ من العتادِ
      // المحاكى مباشرةً.
      const liveCounterName = parseNvName(await sw.tools().exec('tpm2_nvreadpublic', [COUNTER]));
      assert.equal(sealed.body.freshnessBinding.counterName, liveCounterName, 'الربطُ من المرجعِ الحيّ');
      assert.equal(sealed.body.freshnessBinding.recordName, parseNvName(await sw.tools().exec('tpm2_nvreadpublic', [RECORD])), 'واسمُ السجلِّ كذلكَ');
      assert.equal(sealed.body.freshnessBinding.base, provisionedBase.toString(), 'base من قيمةِ C عندَ الربطِ');
      assert.equal(sealed.body.freshnessBinding.instanceId, sealed.body.instanceId, 'مربوطٌ بنسخةِ الجذرِ');
      await first.close();
      // إقلاعٌ ثانٍ: المقبسُ يستهلكُ الربطَ من البيانِ المُتحقَّقِ منهِ (لا من `R` ولا من ملفٍّ)،
      // ومقارنةُ البيانِ والمصدرِ عندَ الإقلاعِ تمرُّ — فالمصدرُ هو الذي ملأ المتنَ.
      const second = await bootRoot(root, keys, socket(), { env: {} });
      assert.equal(second.freshnessBoot, 'B1');
      // والعملُ يزدهرُ فوقَ الربطِ من البيانِ: أمرٌ يُثبَّتُ في سجلٍّ قائمٍ.
      await commitCommand(second, 'cmd-1');
      const beforeDelete = await socket().read();
      const before = readFileSync(manifestFile, 'utf8');
      // حذفُ البيانِ **والنظامُ يعملُ**: المعاملةُ اللاحقةُ تُرفَضُ قبلَ أيّ زيادةٍ في
      // العهدِ (الرفضُ المسمّى `FRESHNESS_NV_BINDING_INVALID` من مصدرِ المقبسِ نفسِهِ —
      // المقبسُ يستهلكُ الربطَ من البيانِ فيلفُّ فقدانَهُ برمزِ الربطِ)، والعدادُ لا يتقدّمُ.
      rmSync(manifestFile);
      let failed = null;
      try {
        await commitCommand(second, 'cmd-2');
      } catch (error) {
        failed = error;
      }
      assert.ok(failed !== null, 'المعاملةُ بعدَ فقدانِ البيانِ تُرفَضُ');
      assert.ok(
        ['FRESHNESS_NV_BINDING_INVALID', 'FRESHNESS_ADVANCE_UNRESOLVED', 'STATE_ROOT_UNPROVISIONED'].includes(
          failed.code,
        ),
        `رفضٌ مسمّى مغلقٌ (وكُتبَ ${failed.code})`,
      );
      const afterDelete = await socket().read();
      assert.equal(afterDelete.epoch, beforeDelete.epoch, 'والعهدُ لم يتقدّمْ — لا زيادةً بلا بيانٍ');
      await second.close();
      // استرجاعُ البيانِ لفحصِ التحريفِ: المحتوى الأصليُّ محفوظٌ في `before` أعلاه.
      writeFileSync(manifestFile, before);
      // وتحريرُ الربطِ في المتنِ يُسقِطُ ختمَهُ فورًا.
      const tampered = JSON.parse(before);
      tampered.body.freshnessBinding.base = '1';
      writeFileSync(manifestFile, JSON.stringify(tampered, null, 2) + '\n');
      assert.equal((await rejection(() => socket().read())).code, BINDING_CODES.INVALID, 'بيانٌ مُحرَّفٌ ⇒ ربطٌ غيرُ صالحٍ');
      // والاسترجاعُ: البيانُ الأصليُّ يعيدُ القراءةَ كما كانت.
      writeFileSync(manifestFile, before);
      assert.equal((await socket().read()).epoch, 1n, 'البيانُ الأصليُّ يعملُ كما كان');
    } finally {
      await sw.dispose();
      rmSync(base, { recursive: true, force: true });
    }
  });
});
