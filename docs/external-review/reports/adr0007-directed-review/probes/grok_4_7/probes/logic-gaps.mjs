// مسابِرُ تصنيفٍ — تستوردُ المحاكي للقراءةِ فقط ولا تكتبُ في شجرةِ المراجعةِ.
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FreshnessAnchorSim, STATE_TPM_COUNTER_MISMATCH, STATE_HALT_SOVEREIGN, STATE_MANIFEST_TPM_TORN } from '/home/user/workspace/xuux-review-a76c8478/sim/tpm/manifest_seal_sim.mjs';
import { frame, parseMessage, ChannelServer } from '/home/user/workspace/xuux-review-a76c8478/sim/tpm/channel_protocol.mjs';

const out = [];
function note(name, value) {
  out.push({ name, ...value });
}

function mockTpm(start = 1) {
  let c = start;
  return {
    nvIncrement: async () => ({ rc: 0, counter: ++c }),
    nvReadCounter: async () => ({ rc: 0, counter: c }),
    bump: async (n = 1) => { c += n; return c; },
    get: () => c,
  };
}

async function makeAnchor(tag, tpm, counter) {
  const dir = mkdtempSync(join(tmpdir(), 'xuux-probe-' + tag + '-'));
  const a = new FreshnessAnchorSim(dir, tpm, 'ak-probe', 'nv-probe', '0x01000099');
  await a.provision('inst-probe');
  // provision may increment; align by sealing until we have a certified body if asked
  return { a, dir };
}

// 1) شهادةٌ غائبةٌ والعدّادُ يطابقُ المتنَ
{
  const tpm = mockTpm(0);
  const { a, dir } = await makeAnchor('nocert', tpm);
  const body = a.readManifest();
  note('provision-certify-field', { certify: body.tpm.certify, counter: body.tpm.counter, tpm: tpm.get() });
  const rec = await a.recover();
  note('missing-certify-after-provision', { state: rec.state, error: rec.error ?? null, halted: rec.state === 'halted' });
  rmSync(dir, { recursive: true, force: true });
}

// 2) بعدَ ختمٍ ناجحٍ: نزعُ الشهادةِ معَ إبقاءِ العدّادِ مطابقاً
{
  const tpm = mockTpm(0);
  const { a, dir } = await makeAnchor('strip', tpm);
  const s = await a.seal();
  const man = a.readManifest();
  man.tpm.certify = null;
  writeFileSync(join(dir, 'root-of-trust.manifest.json'), JSON.stringify(man));
  const rec = await a.recover();
  note('strip-certify-counter-match', {
    sealOk: s.ok,
    state: rec.state,
    error: rec.error ?? null,
    bodyCounter: man.tpm.counter,
    tpmCounter: tpm.get(),
  });
  rmSync(dir, { recursive: true, force: true });
}

// 3) halt.json epoch=1 معَ متنٍ متخلّفٍ عن العدّادِ (لقطةُ إيقافٍ بعدَ زيادةٍ لاحقةٍ)
{
  const tpm = mockTpm(0);
  const { a, dir } = await makeAnchor('sov-replay', tpm);
  const h = await a.haltSovereign('owner-order');
  const snapMan = readFileSync(join(dir, 'root-of-trust.manifest.json'));
  const snapHalt = readFileSync(join(dir, 'halt.json'));
  const snapTok = readFileSync(join(dir, 'token-state.json'));
  const cAfterHalt = tpm.get();
  await tpm.bump(2); // زيادةٌ لاحقةٌ لا يفسّرها المتنُ المستعادُ
  writeFileSync(join(dir, 'root-of-trust.manifest.json'), snapMan);
  writeFileSync(join(dir, 'halt.json'), snapHalt);
  writeFileSync(join(dir, 'token-state.json'), snapTok);
  const rec = await a.recover();
  note('sovereign-file-plus-counter-ahead', {
    haltOk: h.ok,
    counterAfterHalt: cAfterHalt,
    tpmNow: tpm.get(),
    state: rec.state,
    error: rec.error ?? null,
    direction: rec.direction ?? null,
    classifiedAsMismatch: rec.error === STATE_TPM_COUNTER_MISMATCH,
    classifiedAsSovereign: rec.error === STATE_HALT_SOVEREIGN,
  });
  rmSync(dir, { recursive: true, force: true });
}

// 4) سباقُ زيادةٍ: staged عند C+1 والعدّادُ عند C+2 والمتنُ عند C
{
  const tpm = mockTpm(0);
  const { a, dir } = await makeAnchor('race', tpm);
  const committed = a.readManifest();
  const C = committed.tpm.counter;
  const staged = {
    ...committed,
    sequence: committed.sequence + 1,
    journalHead: 'checkpoint:' + (committed.sequence + 1),
    tpm: { akName: a.akName, nvIndexName: a.nvIndexName, counter: C + 1, certify: null },
  };
  writeFileSync(join(dir, 'root-of-trust.manifest.staged.json'), JSON.stringify(staged));
  const ts = a.readTokenState();
  ts.stagedCommit = FreshnessAnchorSim.stagedCommitHash(staged);
  a.writeTokenState(ts);
  await tpm.bump(2); // العدّادُ سبقَ الزيادةَ المتوقَّعةَ بواحدٍ إضافيٍّ
  const rec = await a.recover();
  note('concurrent-extra-increment', {
    body: C,
    staged: C + 1,
    tpm: tpm.get(),
    state: rec.state,
    error: rec.error ?? null,
    torn: rec.torn ?? null,
    direction: rec.direction ?? null,
  });
  rmSync(dir, { recursive: true, force: true });
}

// 5) seal() حين يكونُ العدّادُ متقدّماً سلفاً: هل يزيدُ قبلَ الرفضِ؟
{
  const tpm = mockTpm(0);
  const { a, dir } = await makeAnchor('preinc', tpm);
  const before = tpm.get();
  await tpm.bump(1);
  const mid = tpm.get();
  const s = await a.seal();
  note('seal-when-already-ahead', {
    before,
    afterExternalBump: mid,
    afterSealAttempt: tpm.get(),
    incrementedDuringFailedSeal: tpm.get() !== mid,
    seal: s,
  });
  rmSync(dir, { recursive: true, force: true });
}

// 6) متنٌ غيرُ قابلٍ للتحليلِ
{
  const tpm = mockTpm(0);
  const { a, dir } = await makeAnchor('badjson', tpm);
  writeFileSync(join(dir, 'root-of-trust.manifest.json'), '{not-json');
  let thrown = null;
  let rec = null;
  try { rec = await a.recover(); } catch (e) { thrown = String(e && e.message ? e.message : e); }
  note('unreadable-manifest', { thrown, rec });
  rmSync(dir, { recursive: true, force: true });
}

// 7) قناةٌ بلا مصادقةٍ: إطارٌ مزوَّرٌ بعدّادٍ أعلى يُقبَلُ
{
  const srv = new ChannelServer();
  const first = srv.handle(parseMessage(frame(Buffer.from('{"op":"read"}'), 1)));
  const forged = srv.handle(parseMessage(frame(Buffer.from('{"op":"increment"}'), 2)));
  const replay = srv.handle(parseMessage(frame(Buffer.from('{"op":"increment"}'), 2)));
  note('channel-no-auth', {
    first,
    forgedAccepted: forged.ok === true,
    replayRejected: replay.ok === false && replay.error === 'REPLAY',
    macFieldPresent: false,
  });
}

// 8) fsync في مسارِ الختمِ — فحصُ نصِّ الدالةِ
{
  const src = readFileSync('/home/user/workspace/xuux-review-a76c8478/sim/tpm/manifest_seal_sim.mjs', 'utf8');
  const sealStart = src.indexOf('async seal(');
  const sealEnd = src.indexOf('async haltSovereign(');
  const sealSrc = src.slice(sealStart, sealEnd);
  note('seal-durability-calls', {
    fsync: sealSrc.includes('fsync'),
    writeFileSync: sealSrc.includes('writeFileSync'),
    renameSync: sealSrc.includes('renameSync'),
    lock: /lock|flock|mutex/i.test(sealSrc),
  });
}

console.log(JSON.stringify(out, null, 2));
