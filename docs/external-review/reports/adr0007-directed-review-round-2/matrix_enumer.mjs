// Reference decision function transcribed from annex §د (stages 0–3).
// Not production code. Lives outside the review tree.

function decide(s) {
  // Stage 0 — first cause. Code mapping is under-specified in the annex
  // ("بحسب السبب الأول"); this transcription assigns one code per cause
  // in the order listed, and records the ambiguity separately.
  if (!s.connectOk) return { stage: 0, code: 'STATE_TPM_CHANNEL_FAILED', cls: 'close' };
  if (!s.readCOk) return { stage: 0, code: 'STATE_TPM_UNAVAILABLE', cls: 'close' };
  if (s.indexMissing) return { stage: 0, code: 'STATE_TPM_INDEX_MISSING', cls: 'close' };
  if (!s.namesMatch) return { stage: 0, code: 'STATE_TPM_ATTEST_INVALID', cls: 'close', note: 'annex lists this code; body table does not' };

  // Stage 1
  if (!s.bodyPresent || !s.parseable || !s.sealOk || !s.certOk) {
    return { stage: 1, code: 'STATE_TPM_ATTEST_INVALID', cls: 'close' };
  }

  // Stage 2 — before any halt/retired classification
  const rel = s.C - s.B;
  if (rel < 0) return { stage: 2, code: 'STATE_TPM_COUNTER_MISMATCH', cls: 'close', rel };
  if (rel === 1 || rel > 1) return { stage: 2, code: 'STATE_MANIFEST_TPM_TORN', cls: 'close', rel };
  if (rel !== 0) return { stage: 2, code: 'UNMAPPED', cls: 'close', rel };

  // Stage 3 — row order as written: halted before retired
  if (s.halted) return { stage: 3, code: 'STATE_HALT_SOVEREIGN', cls: 'halt', rel };
  if (s.retired) return { stage: 3, code: 'STATE_RETIRED', cls: 'retired', rel };
  return { stage: 3, code: 'running', cls: 'running', rel };
}

const anchors = [
  { name: 'ok', connectOk: true, readCOk: true, indexMissing: false, namesMatch: true },
  { name: 'no-connect', connectOk: false, readCOk: true, indexMissing: false, namesMatch: true },
  { name: 'no-read', connectOk: true, readCOk: false, indexMissing: false, namesMatch: true },
  { name: 'index-missing', connectOk: true, readCOk: true, indexMissing: true, namesMatch: true },
  { name: 'name-mismatch', connectOk: true, readCOk: true, indexMissing: false, namesMatch: false },
];
const structs = [
  { name: 'absent', bodyPresent: false, parseable: false, sealOk: false, certOk: false },
  { name: 'unparseable', bodyPresent: true, parseable: false, sealOk: false, certOk: false },
  { name: 'seal-bad', bodyPresent: true, parseable: true, sealOk: false, certOk: false },
  { name: 'cert-bad', bodyPresent: true, parseable: true, sealOk: true, certOk: false },
  { name: 'valid', bodyPresent: true, parseable: true, sealOk: true, certOk: true },
];
const rels = [-2, -1, 0, 1, 2, 5];
const flags = [
  { name: 'neither', halted: false, retired: false },
  { name: 'halt', halted: true, retired: false },
  { name: 'retired', halted: false, retired: true },
  { name: 'both', halted: true, retired: true },
];

const running = [];
const bothFlag = [];
let n = 0;
for (const a of anchors) {
  for (const st of structs) {
    for (const rel of rels) {
      for (const f of flags) {
        for (const staged of [false, true]) {
          n++;
          const B = 10;
          const s = {
            ...a, ...st, ...f,
            B: st.bodyPresent && st.parseable ? B : null,
            C: a.readCOk ? B + rel : null,
            staged,
          };
          const r = decide(s);
          if (r.cls === 'running') {
            running.push({ a: a.name, st: st.name, rel, f: f.name, staged, r });
          }
          if (st.name === 'valid' && a.name === 'ok' && rel === 0 && f.name === 'both') {
            bothFlag.push({ staged, r });
          }
        }
      }
    }
  }
}

function scenario(label, s) {
  return { label, result: decide(s) };
}

const scenarios = [
  scenario('restore older snapshot after acknowledged halt (C=B+1, old body not halted)', {
    connectOk: true, readCOk: true, indexMissing: false, namesMatch: true,
    bodyPresent: true, parseable: true, sealOk: true, certOk: true,
    C: 6, B: 5, halted: false, retired: false,
  }),
  scenario('restore much older snapshot (C>B+1)', {
    connectOk: true, readCOk: true, indexMissing: false, namesMatch: true,
    bodyPresent: true, parseable: true, sealOk: true, certOk: true,
    C: 9, B: 5, halted: false, retired: false,
  }),
  scenario('staged present, C==B+1, committed older', {
    connectOk: true, readCOk: true, indexMissing: false, namesMatch: true,
    bodyPresent: true, parseable: true, sealOk: true, certOk: true,
    C: 6, B: 5, halted: false, retired: false, staged: true,
  }),
  scenario('crash after increment before commit, committed not halted', {
    connectOk: true, readCOk: true, indexMissing: false, namesMatch: true,
    bodyPresent: true, parseable: true, sealOk: true, certOk: true,
    C: 6, B: 5, halted: false, retired: false,
  }),
  scenario('halt body restored but counter ahead of body (F03 shape)', {
    connectOk: true, readCOk: true, indexMissing: false, namesMatch: true,
    bodyPresent: true, parseable: true, sealOk: true, certOk: true,
    C: 8, B: 6, halted: true, retired: false,
  }),
  scenario('acknowledged halt still on disk, C==B', {
    connectOk: true, readCOk: true, indexMissing: false, namesMatch: true,
    bodyPresent: true, parseable: true, sealOk: true, certOk: true,
    C: 6, B: 6, halted: true, retired: false,
  }),
  scenario('retired committed, C==B', {
    connectOk: true, readCOk: true, indexMissing: false, namesMatch: true,
    bodyPresent: true, parseable: true, sealOk: true, certOk: true,
    C: 4, B: 4, halted: false, retired: true,
  }),
  scenario('halt AND retired, C==B', {
    connectOk: true, readCOk: true, indexMissing: false, namesMatch: true,
    bodyPresent: true, parseable: true, sealOk: true, certOk: true,
    C: 4, B: 4, halted: true, retired: true,
  }),
  scenario('forward forgery C<B', {
    connectOk: true, readCOk: true, indexMissing: false, namesMatch: true,
    bodyPresent: true, parseable: true, sealOk: true, certOk: true,
    C: 3, B: 5, halted: false, retired: false,
  }),
  scenario('consistent running', {
    connectOk: true, readCOk: true, indexMissing: false, namesMatch: true,
    bodyPresent: true, parseable: true, sealOk: true, certOk: true,
    C: 5, B: 5, halted: false, retired: false,
  }),
  scenario('body absent', {
    connectOk: true, readCOk: true, indexMissing: false, namesMatch: true,
    bodyPresent: false, parseable: false, sealOk: false, certOk: false,
    C: 1, B: null, halted: false, retired: false,
  }),
  scenario('unparseable body', {
    connectOk: true, readCOk: true, indexMissing: false, namesMatch: true,
    bodyPresent: true, parseable: false, sealOk: false, certOk: false,
    C: 5, B: null, halted: false, retired: false,
  }),
  scenario('cert absent/bad, C==B', {
    connectOk: true, readCOk: true, indexMissing: false, namesMatch: true,
    bodyPresent: true, parseable: true, sealOk: true, certOk: false,
    C: 5, B: 5, halted: false, retired: false,
  }),
  scenario('timeout but increment did not land (C==B) — matrix does not see the attempt', {
    connectOk: true, readCOk: true, indexMissing: false, namesMatch: true,
    bodyPresent: true, parseable: true, sealOk: true, certOk: true,
    C: 5, B: 5, halted: false, retired: false,
  }),
];

const runningUnexpected = running.filter(x => !(x.a === 'ok' && x.st === 'valid' && x.rel === 0 && x.f === 'neither'));
const summary = {
  combinations: n,
  running_cells: running.length,
  running_only_expected: runningUnexpected.length === 0,
  running_unexpected: runningUnexpected,
  both_flag_results: bothFlag,
  scenarios,
};
console.log(JSON.stringify(summary, null, 2));
