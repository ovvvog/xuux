// probe_A — قياسٌ على المحاكي (غيرُ إنتاجيٍّ) — claude_fable_5_1
// السؤال: هل محاكي الشجرةِ (sim/tpm/manifest_seal_sim.mjs، غيرُ مُعدَّلٍ في e549fcb3)
// ما زالَ يُعيدُ `running` من مرشَّحٍ تاريخيٍّ بعدَ إيقافٍ سياديٍّ مُقرٍّ؟
// (سيناريو §4.8 المنقَّح: لقطةٌ من محاولةٍ قُطعتْ قبلَ الزيادةِ ← إيقافٌ سياديٌّ مُقرٌّ ← استعادةُ اللقطةِ)
// التصميمُ المنقَّحُ (§د) يقولُ: يجبُ الإغلاقُ (C == B+1 ⇒ STATE_MANIFEST_TPM_TORN).
// يُشغَّلُ من داخلِ نسخةِ الشجرةِ (tree-copy) بـ TPM2TOOLS_TCTI=swtpm:... XUUX_TPM_SIM=1
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import {
  FreshnessAnchorSim, snapshotState, restoreState, RUNNING, HALT,
} from '../tree-copy/sim/tpm/manifest_seal_sim.mjs';
import { nvDefineCounter, nvReadPublic, nvUndefine, nvIncrement, nvReadCounter } from '../tree-copy/sim/tpm/tpm_client.mjs';

const NV = 0x01800101; // في مجالِ المالكِ وفقَ سجلِّ TCG v1p6
const root = '/home/user/workspace/council-adr0007-r2/claude_fable_5_1/probes/_pA/root';
const snap = '/home/user/workspace/council-adr0007-r2/claude_fable_5_1/probes/_pA/snap';
rmSync('/home/user/workspace/council-adr0007-r2/claude_fable_5_1/probes/_pA', { recursive: true, force: true });
mkdirSync(root, { recursive: true }); mkdirSync(snap, { recursive: true });

const log = (...a) => console.log(...a);
await nvUndefine(NV).catch(() => {});
const def = await nvDefineCounter(NV);
log('nvdefine rc=', def.rc, def.stderr.trim().slice(0, 120));
const tpm = { nvIncrement: (i) => nvIncrement(i), nvReadCounter: (i) => nvReadCounter(i) };
const sim = new FreshnessAnchorSim(root, tpm, 'ak-sim', 'nv-sim', NV);

const prov = await sim.provision('probeA');
log('provision: B=', prov.tpm.counter);
const s1 = await sim.seal();
log('seal#1:', s1);
let before = sim.readManifest();
log('state before attempt: B=', before.tpm.counter, 'C=', await sim.readCounter(), 'halted=', before.halted ?? false);

// محاولةُ ختمٍ تُقطعُ قبلَ الزيادةِ، واللقطةُ تُؤخذُ عندَ نقطةِ القطعِ (staged + token.stagedCommit موجودانِ)
let interrupted = false;
try {
  await sim.seal({ beforeIncrement: () => { snapshotState(root, snap); throw new Error('CUT_BEFORE_INCREMENT'); } });
} catch (e) { interrupted = true; log('attempt interrupted:', e.message); }
log('snapshot has staged?', existsSync(snap + '/root-of-trust.manifest.staged.json'));

// تعافٍ عاديٌّ بعدَ القطعِ (يُهمَلُ staged) ثمَّ إيقافٌ سياديٌّ مُقرٌّ
const r0 = await sim.recover();
log('recover after cut:', r0);
const h = await sim.haltSovereign('owner-decision');
log('haltSovereign:', h);
const r1 = await sim.recover();
log('recover after halt:', r1, '| C=', await sim.readCounter(), 'B=', sim.readManifest().tpm.counter);

// استعادةُ اللقطةِ التاريخيةِ (جذرُ الحالةِ + التوكنُ) — العدّادُ لا يُمسُّ
restoreState(snap, root);
const C = await sim.readCounter(); const B = sim.readManifest().tpm.counter;
log('after restore: C=', C, 'B=', B, 'C-B=', C - B, 'staged.counter=', sim.readStaged()?.tpm?.counter);
const r2 = await sim.recover();
log('RECOVER AFTER HISTORICAL RESTORE =>', JSON.stringify(r2));
const m = sim.readManifest();
log('manifest now: halted=', m.halted ?? false, 'counter=', m.tpm.counter, 'halt.json=', JSON.stringify(sim.readHalt()));
const verdict = r2.state === RUNNING
  ? 'MEASURED: simulator returned RUNNING from a historical candidate after an acknowledged sovereign halt (counter NOT lowered) — contradicts revised §د (expects STATE_MANIFEST_TPM_TORN).'
  : 'MEASURED: simulator did not return RUNNING (' + r2.error + ').';
log(verdict);
await nvUndefine(NV);
process.exit(r2.state === RUNNING ? 10 : 0);
