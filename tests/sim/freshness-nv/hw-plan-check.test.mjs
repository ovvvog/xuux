// @ts-nocheck
// tests/sim/freshness-nv/hw-plan-check.test.mjs
//
// WL-432 — فاحصُ خطّةِ التأهيلِ العتاديِّ قرائيٌّ ولا يتّصلُ بـTPM. المدخلُ: لقطةُ جردِ swtpm المثبَّتةُ
// (‏`tests/fixtures/tpm-host/swtpm-inventory.json`) وتقاريرُ **اصطناعيّةٌ** مشتقّةٌ منها تحاكي شكلَ جردِ عتادٍ —
// لا تُعَدُّ دليلَ عتاد؛ تقيسُ منطقَ الفاحصِ وحدَه.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { analyzeInventory } from '../../../sim/tpm-host/decode_inventory.mjs';
import {
  SIMULATOR_HANDLES,
  planCheck,
  proposeHandles,
  rangeOf,
} from '../../../sim/freshness-nv/hw-plan-check.mjs';
import { registerTmpRoot } from '../../helpers/tmp-roots.mjs';

const FIXTURE = fileURLToPath(new URL('../../fixtures/tpm-host/swtpm-inventory.json', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../../sim/freshness-nv/hw-plan-check.mjs', import.meta.url));
const base = () => analyzeInventory(JSON.parse(readFileSync(FIXTURE, 'utf8')));

/** تقريرٌ اصطناعيٌّ بشكلِ جردِ عتاد (‏ليس دليلَ عتاد). */
function hardwareLike(mut = (r) => r) {
  const r = structuredClone(base());
  r.evidenceClass = 'hardware-tbs';
  r.getTpm = {
    available: true,
    ok: true,
    fields: {
      TpmPresent: true,
      TpmReady: true,
      TpmEnabled: true,
      TpmActivated: true,
      TpmOwned: true,
      RestartPending: false,
      ManagedAuthLevel: 'Full',
      LockedOut: false,
      OwnerAuth: 'MUST-NOT-APPEAR',
    },
  };
  r.nv.nvCountersMax = { ok: true, value: 8, semantics: 'fixed-maximum' };
  r.nv.nvCountersDefined = 4;
  return mut(r) ?? r;
}

test('لقطةُ swtpm ⇒ BLOCKED لأنّها ليست دليلَ عتاد، والمقترحُ في مجالِ المالكِ لا مقبضَ محاكاة', () => {
  const out = planCheck(base());
  assert.equal(out.verdict, 'BLOCKED');
  assert.ok(out.blockers.includes('NOT_HARDWARE_EVIDENCE'));
  assert.ok(out.blockers.includes('READINESS_UNKNOWN_GET_TPM_ABSENT'));
  assert.equal(rangeOf(Number.parseInt(out.proposal.c, 16)), 'owner');
  assert.equal(Number.parseInt(out.proposal.r, 16), Number.parseInt(out.proposal.c, 16) + 1);
  assert.deepEqual(out.proposal.issues, []);
  assert.equal(out.proposal.recheckImmediatelyBeforeDefine, true);
  assert.equal(out.readOnly, true);
});

test('مقبضا المحاكاة في مجالِ مصنّعِ المنصّة ⇒ مانعٌ مسمّىً إن طُلبا على العتاد', () => {
  for (const h of SIMULATOR_HANDLES) assert.equal(rangeOf(h), 'platform-manufacturer');
  const out = planCheck(hardwareLike(), { c: '0x01500030', r: '0x01500031' });
  assert.ok(out.blockers.includes('HANDLE_C_IS_SIMULATOR_HANDLE'));
  assert.ok(out.blockers.includes('HANDLE_R_IS_SIMULATOR_HANDLE'));
  assert.ok(out.blockers.includes('HANDLE_C_NOT_IN_OWNER_RANGE:platform-manufacturer'));
});

test('شكلُ عتادٍ سليم ⇒ لا موانعَ قرائيّة — ويبقى قرارُ المالكِ لازمًا، ولا يُطبَعُ OwnerAuth', () => {
  const out = planCheck(hardwareLike());
  assert.deepEqual(out.blockers, []);
  assert.equal(out.verdict, 'NO_READ_ONLY_BLOCKERS__OWNER_DECISION_STILL_REQUIRED');
  assert.equal(out.resources.counterQuota.headroomUpperBound, 4);
  assert.ok(out.ownerDecisions.some((d) => d.startsWith('OWNER_RANGE_OCCUPIED_UNATTRIBUTED:1')));
  assert.equal(out.resources.size.freeNvBytes, null);
  assert.equal(out.resources.authorization.proven, false);
  assert.ok(!JSON.stringify(out).includes('MUST-NOT-APPEAR'));
  assert.ok(!Object.hasOwn(out.readiness, 'OwnerAuth'));
});

test('أبعادُ الموارد منفصلة: حصّةُ العدّاداتِ المستنفدةُ مانع، والهامشُ الواحدُ ملاحظةٌ لأنّ S1 وC لا يتعايشان', () => {
  const full = planCheck(hardwareLike((r) => void (r.nv.nvCountersDefined = 8)));
  assert.ok(full.blockers.includes('NV_COUNTER_QUOTA_EXHAUSTED'));
  const one = planCheck(hardwareLike((r) => void (r.nv.nvCountersDefined = 7)));
  assert.deepEqual(one.blockers, []);
  assert.ok(one.notes.some((n) => n.startsWith('NV_COUNTER_HEADROOM_IS_ONE')));
  const unknown = planCheck(hardwareLike((r) => void (r.nv.nvCountersMax = { ok: false, error: 'ABSENT' })));
  assert.ok(unknown.blockers.includes('NV_COUNTER_QUOTA_UNKNOWN'));
  const pool = planCheck(base());
  assert.ok(pool.notes.some((n) => n.startsWith('NV_COUNTER_QUOTA_POOL_BOUND')));
});

test('حجمُ R: يتجاوزُ NV_INDEX_MAX أو يحتاجُ أكثرَ من NV_Write واحد ⇒ مانع', () => {
  assert.ok(
    planCheck(hardwareLike((r) => void (r.nv.nvIndexMaxDataSize = 64))).blockers.includes(
      'R_EXCEEDS_NV_INDEX_MAX_OR_UNKNOWN',
    ),
  );
  assert.ok(
    planCheck(hardwareLike((r) => void (r.nv.nvBufferMax = 64))).blockers.includes(
      'R_NEEDS_MULTIPLE_NV_WRITES_OR_UNKNOWN',
    ),
  );
});

test('التداخل: المقترحُ يتخطّى المشغول، واختيارُ مشغولٍ أو خارجَ المجالِ أو C=R مانع', () => {
  const free = proposeHandles([]);
  const skipped = proposeHandles([free.c]);
  assert.notEqual(skipped.c, free.c);
  assert.equal(skipped.skipped, 1);
  const r = hardwareLike();
  const used = r.handles?.ownerRangeInUse ?? planCheck(r).handles.ownerRangeInUse;
  const out = planCheck(r, { c: used[0], r: used[0] });
  assert.ok(out.blockers.includes('HANDLE_C_IN_USE'));
  assert.ok(out.blockers.includes('HANDLE_C_EQUALS_R'));
  assert.ok(planCheck(r, { c: '0x01c00002', r: '0x01c00003' }).blockers.includes('HANDLE_C_NOT_IN_OWNER_RANGE:tcg-defined'));
});

test('الجاهزيّة: قفلُ DA أو إعادةُ تشغيلٍ معلّقةٌ أو Get-Tpm فاشلٌ ⇒ مانع', () => {
  assert.ok(
    planCheck(hardwareLike((r) => void (r.getTpm.fields.LockedOut = true))).blockers.includes('TPM_DA_LOCKED_OUT_OR_UNKNOWN'),
  );
  assert.ok(
    planCheck(hardwareLike((r) => void (r.getTpm.fields.RestartPending = true))).blockers.includes('TPM_RESTART_PENDING'),
  );
  assert.ok(
    planCheck(hardwareLike((r) => void (r.getTpm.ok = false))).blockers.includes('READINESS_UNKNOWN_GET_TPM_ABSENT'),
  );
});

test('حقولُ Get-Tpm نصوصٌ كما يكتبُها جردُ Windows ("True"/"False") ⇒ تُقرأُ صحيحةً، والمجهولُ مانع', () => {
  const asStrings = (r) => {
    for (const [k, v] of Object.entries(r.getTpm.fields)) if (typeof v === 'boolean') r.getTpm.fields[k] = v ? 'True' : 'False';
  };
  const ok = planCheck(hardwareLike(asStrings));
  for (const b of ok.blockers) assert.ok(!/^TPM_NOT_READY|^TPM_DA_|^TPM_RESTART/.test(b), b);
  assert.ok(
    planCheck(hardwareLike((r) => void (asStrings(r), (r.getTpm.fields.LockedOut = 'True')))).blockers.includes('TPM_DA_LOCKED_OUT_OR_UNKNOWN'),
  );
  assert.ok(
    planCheck(hardwareLike((r) => void (asStrings(r), (r.getTpm.fields.TpmReady = 'Unknown')))).blockers.includes('TPM_NOT_READY:TpmReady'),
  );
  assert.ok(
    planCheck(hardwareLike((r) => void (asStrings(r), delete r.getTpm.fields.RestartPending))).blockers.includes('TPM_RESTART_PENDING'),
  );
});

test('جردٌ فاسدٌ أو ناقصٌ ⇒ مانع، وسمةٌ غيرُ مقروءةٍ لفهرسٍ ⇒ مانعٌ مسمّىً بالمقبض', () => {
  assert.ok(planCheck(hardwareLike((r) => void r.errors.push('X'))).blockers.includes('INVENTORY_INVALID'));
  assert.ok(
    planCheck(hardwareLike((r) => void (r.capabilitiesComplete['nv-index-handles'] = false))).blockers.includes(
      'CAPABILITY_INCOMPLETE:nv-index-handles',
    ),
  );
  const bad = planCheck(hardwareLike((r) => void Object.assign(r.nvIndexes[0], { ok: false, error: 'NO_RESPONSE' })));
  assert.ok(bad.blockers.some((b) => b.startsWith('NV_PUBLIC_UNREADABLE:')));
});

test('سطرُ الأوامر: رموزُ الخروج 1 للموانع و2 للمدخلِ الفاسد، والمصدرُ لا يتّصلُ بأيِّ TPM', () => {
  const ok = spawnSync(process.execPath, [SCRIPT, FIXTURE], { encoding: 'utf8' });
  assert.equal(ok.status, 1);
  assert.match(JSON.parse(ok.stdout).inventorySha256, /^[0-9a-f]{64}$/);
  const dir = registerTmpRoot(mkdtempSync(join(tmpdir(), 'wl432-plan-')));
  const junk = join(dir, 'junk.json');
  writeFileSync(junk, '{not json');
  assert.equal(spawnSync(process.execPath, [SCRIPT, junk], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' }).status, 2);
  const src = readFileSync(SCRIPT, 'utf8');
  for (const forbidden of ['child_process', "'node:net'", 'tbs.dll', '/dev/tpm', 'tpm2_']) {
    assert.ok(!src.includes(forbidden), forbidden);
  }
});

const CONTEXT_PS1 = fileURLToPath(
  new URL('../../../sim/freshness-nv/win_hw_context_readonly.ps1', import.meta.url),
);
const pwshAvailable =
  spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' })
    .status === 0;

test('سياقُ Windows القرائيّ: شيفرتُه (لا تعليقاتُه) لا تقرأُ مخزنَ التفويضاتِ ولا تكتبُ ولا تمسُّ TPM', () => {
  const code = readFileSync(CONTEXT_PS1, 'utf8')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n');
  for (const forbidden of [
    'Get-Tpm',
    'OwnerAuth',
    'Services\\TPM\\WMI',
    'manage-bde',
    'RecoveryPassword',
    'KeyProtectorId',
    'Set-ItemProperty',
    'New-ItemProperty',
    'Remove-Item',
    'New-Item ',
    'Clear-Tpm',
    'Initialize-Tpm',
    'Tbsip',
    'DllImport',
    'Add-Type',
    'Invoke-WebRequest',
  ]) {
    assert.ok(!code.includes(forbidden), forbidden);
  }
  // يقرأُ أسماءَ القيمِ وحدَها من قوائمِ TBS، وأنواعَ حُماةِ BitLocker وحدَها.
  assert.match(code, /GetValueNames\(\)/);
  assert.match(code, /KeyProtectorType/);
});

test(
  'سياقُ Windows القرائيّ: يُحلَّلُ بلا أخطاءٍ ويخرجُ 2 خارجَ Windows بلا ملفّ',
  { skip: pwshAvailable ? false : 'pwsh unavailable' },
  () => {
    const parse = spawnSync(
      'pwsh',
      [
        '-NoProfile',
        '-Command',
        `$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${CONTEXT_PS1}',[ref]$null,[ref]$e);$e.Count`,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(parse.stdout.trim(), '0', parse.stderr);
    const dir = registerTmpRoot(mkdtempSync(join(tmpdir(), 'wl432-ctx-')));
    const run = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', CONTEXT_PS1, '-OutDir', dir], {
      encoding: 'utf8',
    });
    assert.equal(run.status, 2, run.stderr);
    assert.match(run.stderr, /NOT_WINDOWS/);
    assert.deepEqual(readdirSync(dir), []);
  },
);
