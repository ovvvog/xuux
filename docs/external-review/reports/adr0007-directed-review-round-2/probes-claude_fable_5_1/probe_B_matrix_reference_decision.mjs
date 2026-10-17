// probe_B — دالةُ قرارٍ مرجعيةٌ مستقلةٌ (كتبها المراجعُ claude_fable_5_1) لمصفوفةِ §د كما هي مكتوبةٌ في
// docs/adr/0007-annex-a-seal-transaction-and-recovery-matrix.md @ e549fcb3 — غيرُ إنتاجيةٍ، غرضُها اختبارُ
// الادعاءِ: «حصريةٌ كاملةٌ حتميةٌ» بالتعدادِ الشاملِ، ثم تتبُّعُ سيناريوهاتِ الثابتَينِ.
// ملاحظةٌ: الملحقُ يقولُ إنَّ دالةً كهذه «تُرفَقُ بالمتنِ» — وهي غيرُ مرفقةٍ في الكوميتِ المُراجَعِ؛ فهذه بديلُ المراجعِ.

const OUT = {
  CHANNEL: 'STATE_TPM_CHANNEL_FAILED', UNAVAIL: 'STATE_TPM_UNAVAILABLE', INDEX_MISSING: 'STATE_TPM_INDEX_MISSING',
  ATTEST_INVALID: 'STATE_TPM_ATTEST_INVALID', MISMATCH: 'STATE_TPM_COUNTER_MISMATCH', TORN: 'STATE_MANIFEST_TPM_TORN',
  HALT: 'STATE_HALT_SOVEREIGN', RETIRED: 'STATE_RETIRED', RUNNING: 'running',
};

/** تنفيذٌ حرفيٌّ لمراحلِ §د بالترتيبِ (0 → 1 → 2 → 3). يُعيدُ {stage, out}. */
export function decide(s) {
  // المرحلةُ 0: قراءةُ المرساةِ
  if (s.anchor !== 'ok') return { stage: 0, out: ({ channel: OUT.CHANNEL, unavailable: OUT.UNAVAIL, index: OUT.INDEX_MISSING, names: OUT.ATTEST_INVALID })[s.anchor] };
  // المرحلةُ 1: صلاحيةُ البنيةِ
  if (s.manifest !== 'present') return { stage: 1, out: OUT.ATTEST_INVALID, note: 'manifest ' + s.manifest };
  if (!s.sealOk) return { stage: 1, out: OUT.ATTEST_INVALID, note: 'hsm seal' };
  if (s.certify !== 'ok') return { stage: 1, out: OUT.ATTEST_INVALID, note: 'certify ' + s.certify };
  if (!s.attestEqB) return { stage: 1, out: OUT.ATTEST_INVALID, note: 'attest.counter != B' };
  // المرحلةُ 2: مقارنةُ العدّادِ
  if (s.delta < 0) return { stage: 2, out: OUT.MISMATCH };
  if (s.delta === 1) return { stage: 2, out: OUT.TORN, note: 'C==B+1 (no idle completion)' };
  if (s.delta > 1) return { stage: 2, out: OUT.TORN, note: 'C>B+1' };
  // delta === 0 ⇒ المرحلةُ 3 (staged يُهمَلُ)
  if (s.halted) return { stage: 3, out: OUT.HALT, note: s.retired ? 'AMBIGUOUS: halted&&retired both true — matrix lists two matching rows; priority not stated' : undefined };
  if (s.retired) return { stage: 3, out: OUT.RETIRED };
  return { stage: 3, out: OUT.RUNNING };
}

// ---- التعدادُ الشاملُ ----
const dims = {
  anchor: ['ok', 'channel', 'unavailable', 'index', 'names'],
  manifest: ['absent', 'unparseable', 'present'],
  sealOk: [true, false],
  certify: ['absent', 'bad', 'ok'],
  attestEqB: [true, false],
  delta: [-1, 0, 1, 2],      // C−B ∈ {سالب, 0, 1, >1}
  halted: [false, true],
  retired: [false, true],
  staged: ['absent', 'present'],
};
const keys = Object.keys(dims);
let total = 0, running = 0, ambiguous = 0, outcomes = {};
let violations = [];
function* combos(i = 0, acc = {}) {
  if (i === keys.length) { yield { ...acc }; return; }
  for (const v of dims[keys[i]]) yield* combos(i + 1, { ...acc, [keys[i]]: v });
}
for (const s of combos()) {
  total++;
  const d = decide(s);
  outcomes[d.out] = (outcomes[d.out] ?? 0) + 1;
  if (d.note && d.note.startsWith('AMBIGUOUS')) ambiguous++;
  if (d.out === OUT.RUNNING) {
    running++;
    // شرطُ الثابتِ 2: running فقط عندَ متنٍ كاملِ التحققِ وC==B وغيرِ موقوفٍ وغيرِ متقاعدٍ
    const ok = s.anchor === 'ok' && s.manifest === 'present' && s.sealOk && s.certify === 'ok' && s.attestEqB && s.delta === 0 && !s.halted && !s.retired;
    if (!ok) violations.push(s);
  }
  // staged يجبُ ألا يؤثِّرَ في النتيجةِ أبدًا
  const twin = decide({ ...s, staged: s.staged === 'absent' ? 'present' : 'absent' });
  if (twin.out !== d.out) violations.push({ stagedInfluence: s });
}
console.log('combos total =', total);
console.log('outcomes =', JSON.stringify(outcomes));
console.log('running combos =', running, '(expected = anchor ok × present × sealOk × certify ok × attestEqB × delta0 × !halted × !retired × staged(2) = 2)');
console.log('invariant-2 violations (running without full verification / staged influences result) =', violations.length);
console.log('stage-3 double-match (halted && retired both true, delta==0, fully checked) =', ambiguous, '— the matrix text gives no priority rule; the written rows are not mutually exclusive inside stage 3');

// ---- تتبُّعُ السيناريوهاتِ (استنتاجٌ تصميميٌّ على الدالةِ المرجعيةِ، لا قياسُ عتادٍ) ----
function trace(name, s) { const d = decide(s); console.log(`[${name}] stage=${d.stage} => ${d.out}${d.note ? ' (' + d.note + ')' : ''}`); return d; }
const full = { anchor: 'ok', manifest: 'present', sealOk: true, certify: 'ok', attestEqB: true, staged: 'absent', halted: false, retired: false };
trace('S1 halt acknowledged (B_halt==C), boot', { ...full, delta: 0, halted: true });
trace('S2 restore snapshot immediately before halt (B=C-1)', { ...full, delta: 1 });
trace('S3 restore older snapshot (B<C-1)', { ...full, delta: 2 });
trace('S4 torn between increment and durable commit (B=C-1, staged present)', { ...full, delta: 1, staged: 'present' });
trace('S5 P01: cut before increment then halt then restore (committed B=C-1; no sealed envelope for C exists)', { ...full, delta: 1, staged: 'present' });
trace('S6 forward forgery / other device body (B>C)', { ...full, delta: -1 });
trace('S7 body without certify at matching counter', { ...full, delta: 0, certify: 'absent' });
trace('S8 unparseable manifest', { ...full, manifest: 'unparseable', delta: 0 });
trace('S9 retired device booted', { ...full, delta: 0, retired: true });
trace('S10 retired + halted both set', { ...full, delta: 0, retired: true, halted: true });
trace('S11 retirement seal torn between increment and commit on OLD device (B_pre=C-1)', { ...full, delta: 1 });
console.log('NOTE S11: old device is TORN (not RETIRED). TORN is resumable by the sovereign resume path (§د الاستئناف); the matrix has no input representing an issued-but-uncommitted retirement record, so "retired row prevents dual running" holds only if the retirement commit succeeded.');
console.log('NOTE resume: the only halted→running transition is the sovereign resume path, which is outside the matrix inputs; its binding to the specific halt (counter/digest) is not specified in §د/§ج.');
process.exit(violations.length === 0 ? 0 : 20);
