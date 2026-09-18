/**
 * دفترُ أثرِ الإقامةِ — سلسلةٌ ورأسٌ ذرّيّ (`ADR 0008`).
 *
 * **ما يقيسه هذا الملفُّ ولا يدّعي غيرَه:** أنّ البترَ والتبديلَ وفقدَ الرأسِ
 * **تُكشَف**، وأنّ الإقامةَ **لا تتعطّل** بعطبِ دفترِها، وأنّ الفاحصَ
 * **يُغلَق** عليه. ولا يقيس صموداً أمامَ خصمٍ يملك القرصَ — الرأسُ ذرّيٌّ لا
 * موقَّعٌ، و`R3-A-01` تبقى مفتوحةً.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import {
  LEDGER_STATES,
  auditLedgerChain,
  chainRecord,
  genesisHash,
  ledgerHeader,
  ledgerStateRefuses,
  parseLedgerHeader,
  stableStringify,
} from '../../src/environment/ledger-chain.mjs';
import {
  EnvironmentLedger,
  auditLedgerFile,
  frozenLedgerPath,
  headPathFor,
} from '../../scripts/lib/environment-ledger.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/** @returns {string} */
function makeTempDir() {
  return registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'xuux-ledger-')));
}

/**
 * دفترٌ سليمٌ بثلاثةِ قيودٍ في مجلَّدٍ مؤقَّت.
 *
 * @returns {{ dir: string, file: string, head: string, ledger: EnvironmentLedger }}
 */
function freshLedger() {
  const dir = makeTempDir();
  const file = path.join(dir, 'logs', 'environment-ledger.jsonl');
  const ledger = new EnvironmentLedger(file, { createDir: true });
  ledger.append('phase.recorded', 'system@test', { phase: 'phase:install', ok: true });
  ledger.append('phase.recorded', 'system@test', { phase: 'phase:build', ok: true });
  ledger.append('health.verdict', 'system@test', { verdict: 'fit' });
  return { dir, file, head: headPathFor(file), ledger };
}

test('التسلسلُ مستقرُّ الترتيبِ فلا يُقرأ اختلافُ ترتيبِ المفاتيحِ عبثاً', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
  assert.equal(stableStringify({ a: [{ z: 1, y: 2 }] }), '{"a":[{"y":2,"z":1}]}');
});

test('دفترٌ حديثُ الكتابةِ سليمٌ، ورأسُه يشهد بعدَدِ قيودِه وبآخرِ بصمٍ فيه', () => {
  const { file, head, ledger } = freshLedger();
  assert.equal(ledger.count, 3);
  assert.equal(ledger.dropped, 0);
  assert.equal(ledger.quarantine, null);

  const audit = auditLedgerFile(file);
  assert.equal(audit.state, LEDGER_STATES.INTACT);
  assert.equal(audit.refuses, false);
  assert.equal(audit.committed, 3);
  assert.equal(audit.present, 3);

  const header = parseLedgerHeader(fs.readFileSync(head, 'utf8'));
  assert.notEqual(header, null);
  assert.equal(header?.count, 3);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(header?.head, JSON.parse(/** @type {string} */ (lines[2])).hash);
  assert.equal(JSON.parse(/** @type {string} */ (lines[0])).prevHash, genesisHash());
});

test('دفترٌ مفتوحٌ ثانيةً يستأنف السلسلةَ ولا يبدأ من البذرةِ من جديد', () => {
  const { file } = freshLedger();
  const again = new EnvironmentLedger(file, { createDir: true });
  const seq = again.append('phase.recorded', 'system@test', { phase: 'phase:migrate' });
  assert.equal(seq, 4, 'الترتيبُ يتّصل بما قبلَه لا بما كُتِب في هذه العمليّة');
  assert.equal(auditLedgerFile(file).state, LEDGER_STATES.INTACT);
});

test('البترُ يُكشَف: حذفُ آخرِ سطرٍ يترك رأساً يشهد بأكثرَ ممّا في المتن', () => {
  const { file } = freshLedger();
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  fs.writeFileSync(file, `${lines.slice(0, 2).join('\n')}\n`, 'utf8');
  const audit = auditLedgerFile(file);
  assert.equal(audit.state, LEDGER_STATES.TRUNCATED);
  assert.equal(audit.refuses, true);
});

test('الحذفُ من الوسطِ يُكشَف بالترتيبِ لا بالطولِ وحدَه', () => {
  const { file, head } = freshLedger();
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  // يُحذَف الأوسطُ ويُترَك العددُ كما هو بتكرارِ الأخيرِ: الطولُ يُطابق الرأسَ.
  fs.writeFileSync(file, `${[lines[0], lines[2], lines[2]].join('\n')}\n`, 'utf8');
  const header = parseLedgerHeader(fs.readFileSync(head, 'utf8'));
  assert.equal(header?.count, 3, 'العددُ في الرأسِ لم يتغيّر، فالطولُ وحدَه لا يكفي');
  const audit = auditLedgerFile(file);
  assert.equal(audit.state, LEDGER_STATES.MUTATED);
  assert.equal(audit.refuses, true);
});

test('تبديلُ حقلٍ في قيدٍ يُكشَف ببصمِه ولو بقيت السلسلةُ متّصلةً شكلاً', () => {
  const { file } = freshLedger();
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const tampered = JSON.parse(/** @type {string} */ (lines[1]));
  tampered.data = { phase: 'phase:build', ok: false };
  lines[1] = JSON.stringify(tampered);
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  const audit = auditLedgerFile(file);
  assert.equal(audit.state, LEDGER_STATES.MUTATED);
  assert.equal(audit.refuses, true);
});

test('متنٌ بلا رأسٍ يُرَدُّ، ورأسٌ لا يُقرأ يُرَدُّ', () => {
  const { file, head } = freshLedger();
  fs.rmSync(head);
  assert.equal(auditLedgerFile(file).state, LEDGER_STATES.HEADER_MISSING);
  fs.writeFileSync(head, '{ ليس JSON', 'utf8');
  assert.equal(auditLedgerFile(file).state, LEDGER_STATES.HEADER_INVALID);
  fs.writeFileSync(head, `${JSON.stringify(ledgerHeader(3, 'x'.repeat(64)))}\n`, 'utf8');
  assert.equal(auditLedgerFile(file).state, LEDGER_STATES.HEADER_INVALID, 'بصمٌ ليس ستّ عشريّاً');
});

test('رأسٌ من دفترٍ آخرَ يُكشَف بـhead-mismatch لا بـmutated', () => {
  const { file, head } = freshLedger();
  const other = chainRecord(genesisHash(), 1, 'x', 'y', {});
  fs.writeFileSync(head, `${JSON.stringify(ledgerHeader(3, other.hash))}\n`, 'utf8');
  const audit = auditLedgerFile(file);
  assert.equal(audit.state, LEDGER_STATES.HEAD_MISMATCH);
  assert.equal(audit.refuses, true);
});

test('ذيلٌ لم يشهد به رأسٌ يُعلَن ولا يُغلَق عليه — انقطاعٌ لا عبث', () => {
  const { file } = freshLedger();
  fs.appendFileSync(file, `${JSON.stringify({ seq: 4, prevHash: 'z', type: 't' })}\n`, 'utf8');
  const audit = auditLedgerFile(file);
  assert.equal(audit.state, LEDGER_STATES.PENDING_TAIL);
  assert.equal(audit.refuses, false, 'انقطاعُ تيّارٍ لا يُعطِّل الفحصَ إلى الأبد');
  assert.equal(audit.committed, 3);
  assert.equal(audit.present, 4);
});

test('غيابُ الدفترِ كلِّه ليس عبثاً به', () => {
  const audit = auditLedgerChain({ headerText: null, bodyText: null });
  assert.equal(audit.state, LEDGER_STATES.ABSENT);
  assert.equal(audit.refuses, false);
  for (const state of Object.values(LEDGER_STATES)) {
    assert.equal(typeof ledgerStateRefuses(state), 'boolean');
  }
});

test('دفترٌ معطوبٌ يدخل الحجرَ: لا يُكتَب فيه حرفٌ ويُحصى الإسقاطُ مُعلَناً', () => {
  const { file } = freshLedger();
  const before = fs.readFileSync(file, 'utf8');
  const lines = before.trim().split('\n');
  fs.writeFileSync(file, `${lines.slice(0, 2).join('\n')}\n`, 'utf8');
  const broken = fs.readFileSync(file, 'utf8');

  const ledger = new EnvironmentLedger(file, { createDir: true });
  assert.notEqual(ledger.quarantine, null);
  const seq = ledger.append('phase.recorded', 'system@test', { phase: 'phase:install' });
  assert.equal(seq, 0);
  assert.equal(ledger.count, 0);
  assert.equal(ledger.dropped, 1, 'الإسقاطُ يُقال ولا يُسكَت');
  assert.equal(fs.readFileSync(file, 'utf8'), broken, 'الدليلُ يُصان كما وُجِد ولا يُكتَب فوقَه');
});

test('الوحدةُ النقيّةُ لا تملك المُلحِقَ أصلاً (R7)', () => {
  const source = fs.readFileSync(
    path.join(repoRoot, 'src', 'environment', 'ledger-chain.mjs'),
    'utf8',
  );
  for (const forbidden of ["'node:fs'", "'node:child_process'", "'node:process'"]) {
    assert.ok(!source.includes(forbidden), `الوحدةُ النقيّةُ تستورد ${forbidden}`);
  }
});

test('الملفُّ القديمُ مُجمَّدٌ: الإقامةُ لا تكتب فيه ولا تحذفه', () => {
  const { file } = freshLedger();
  const frozen = frozenLedgerPath(file);
  const original = '{"type":"phase.recorded","actor":"system@bootstrap","data":{}}\n';
  fs.writeFileSync(frozen, original, 'utf8');

  const ledger = new EnvironmentLedger(file, { createDir: true });
  ledger.append('health.verdict', 'system@test', { verdict: 'fit' });

  assert.ok(fs.existsSync(frozen), 'المُجمَّدُ لا يُحذَف');
  assert.equal(
    fs.readFileSync(frozen, 'utf8'),
    original,
    'المُجمَّدُ لا يُكتَب فيه ولا يُهاجَر منه',
  );
  assert.equal(auditLedgerFile(file).state, LEDGER_STATES.INTACT, 'ولا يدخل في حكمِ السلامة');
});

test('الفاحصُ عمليّةً ابنةً: يُغلَق على دفترٍ مبتورٍ برمزِ ENV_LEDGER_BROKEN', () => {
  const { file } = freshLedger();
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  fs.writeFileSync(file, `${lines.slice(0, 2).join('\n')}\n`, 'utf8');

  const outcome = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'verify-environment.mjs'), '--json', `--ledger=${file}`],
    { cwd: repoRoot, encoding: 'utf8', shell: false, timeout: 120_000 },
  );

  assert.notEqual(outcome.status, 0, 'مسارُ التحقّقِ يُغلَق ولا يُقال عن البيئةِ «صالحةٌ»');
  const payload = JSON.parse((outcome.stdout ?? '').trim().split('\n').at(-1) ?? '{}');
  assert.equal(payload.ok, false);
  assert.equal(payload.code, 'ENV_LEDGER_BROKEN');
  assert.equal(payload.ledger.state, LEDGER_STATES.TRUNCATED);
});

test('الفاحصُ لا يُغلَق على دفترٍ سليمٍ — فالإغلاقُ على العطبِ لا على الحضور', () => {
  const { file } = freshLedger();
  const outcome = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'verify-environment.mjs'), '--json', `--ledger=${file}`],
    { cwd: repoRoot, encoding: 'utf8', shell: false, timeout: 120_000 },
  );
  const payload = JSON.parse((outcome.stdout ?? '').trim().split('\n').at(-1) ?? '{}');
  assert.equal(payload.code, undefined, 'لا رمزَ رفضٍ على دفترٍ سليم');
  assert.equal(payload.ledger.state, LEDGER_STATES.INTACT);
  assert.equal(payload.ledger.refuses, false);
});
