/**
 * جاهزيّةُ الأدواتِ — **حضورُ الأداةِ ليس صلاحيتَها** (وحدةٌ وقاعدةُ الحاجزِ `R11`).
 *
 * الوحدةُ نقيّةٌ تُحقَن نتيجةُ التشغيلِ فيها، فحالاتُ **الرفضِ** تُقاس بوقائعَ
 * مُصطنَعةٍ في الذاكرةِ وبعقودٍ مُصطنَعةٍ في مجلَّدٍ مؤقَّتٍ لا بإفسادِ المستودعِ
 * الحقيقيّ؛ وحالةُ **القبولِ** تُقاس على العقدِ الحقيقيِّ وعلى الحاجزِ عمليّةً
 * ابنةً — فحكمُ الحاجزِ رمزُ خروجٍ لا نصٌّ يُقرأ.
 */

import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import YAML from 'yaml';

import { loadEnvironmentContract } from '../../src/environment/contract.mjs';
import {
  READINESS_STATES,
  auditReadinessSurface,
  declaresReadiness,
  judgeToolReadiness,
  readinessCommandText,
  toolsDeclaringReadiness,
} from '../../src/environment/tool-readiness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const GUARD_SCRIPT = path.join(ROOT, 'scripts/guard-environment.mjs');
const CONFIG_DIR = path.join(ROOT, 'config');

/** أداةٌ مُصطنَعةٌ تُعلن جاهزيّةً — لا تلمس قرصاً ولا تُشغَّل. */
const TOOL = Object.freeze({
  id: 'tool:demo',
  command: 'demo',
  args: ['--version'],
  minMajor: 2,
  maxMajor: 3,
  readiness: { args: ['status', '--json'], statement: 'يسأل الخادمَ نفسَه لا الملفَّ التنفيذيّ.' },
});

test('الحالُ الفارقةُ: أداةٌ حاضرةٌ بإصدارٍ مقبولٍ وأمرُ جاهزيّتِها أخفق ⇒ المجسُّ غيرُ مستوفٍ', () => {
  const judgement = judgeToolReadiness(TOOL, {
    present: true,
    inRange: true,
    version: '2.4.0',
    readiness: { ok: false, observed: 'cannot connect to daemon' },
  });
  assert.equal(judgement.state, 'present-unready');
  assert.equal(judgement.satisfied, false);
  // والتفصيلُ يُسمّي الأمرَ الذي أخفق لا يُلمِّح إليه.
  assert.ok(judgement.detail.includes('demo status --json'));
});

test('الأداةُ نفسُها بأمرِ جاهزيّةٍ ناجحٍ ⇒ `ready` ومستوفٍ', () => {
  const judgement = judgeToolReadiness(TOOL, {
    present: true,
    inRange: true,
    version: '2.4.0',
    readiness: { ok: true, observed: '28.0.1' },
  });
  assert.equal(judgement.state, 'ready');
  assert.equal(judgement.satisfied, true);
});

test('من لم يُعلن جاهزيّةً لم يتغيّر حكمُه: `unmeasured` مستوفٍ — ولا يُقرأ غيرُ المقيسِ ساقطاً', () => {
  const plain = { id: 'tool:node', command: 'node', args: ['--version'] };
  const judgement = judgeToolReadiness(plain, { present: true, inRange: true, version: '20.1.0' });
  assert.equal(judgement.state, 'unmeasured');
  assert.equal(judgement.satisfied, true);
  assert.equal(declaresReadiness(plain), false);
});

test('الغيابُ وخروجُ الإصدارِ عن المجالِ يسبقان سؤالَ الجاهزيّةِ ولا يُخلَطان به', () => {
  const absent = judgeToolReadiness(TOOL, { present: false, inRange: false, version: null });
  assert.equal(absent.state, 'absent');
  assert.equal(absent.satisfied, false);

  const old = judgeToolReadiness(TOOL, { present: true, inRange: false, version: '1.0.0' });
  assert.equal(old.state, 'out-of-range');
  assert.equal(old.satisfied, false);
  assert.ok(READINESS_STATES.includes(old.state));
});

test('جاهزيّةٌ مُعلَنةٌ ولم تُقَسْ لا تُقرأ جاهزيّةً — الصمتُ ليس نجاحاً', () => {
  const judgement = judgeToolReadiness(TOOL, { present: true, inRange: true, version: '2.4.0' });
  assert.equal(judgement.state, 'present-unready');
  assert.equal(judgement.satisfied, false);
});

test('مقايسةُ العقدِ بالوثيقةِ ترفض في الاتجاهين وترفض اختلافَ نصِّ الأمر', () => {
  const tools = [
    { id: 'tool:demo', command: 'demo', readiness: TOOL.readiness },
    {
      id: 'tool:other',
      command: 'other',
      readiness: { args: ['ping'], statement: 'يسأل الخدمةَ لا الملفَّ.' },
    },
  ];
  const audit = auditReadinessSurface({
    tools,
    documented: [
      { tool: 'tool:demo', command: 'demo status --xml' },
      { tool: 'tool:gone', command: 'gone check' },
    ],
  });
  assert.deepEqual(audit.undeclared, ['tool:other']);
  assert.deepEqual(audit.stale, ['tool:gone']);
  assert.equal(audit.mismatched.length, 1);
  assert.equal(audit.mismatched[0]?.tool, 'tool:demo');
  assert.equal(audit.measured, 2);
});

test('عقدٌ يجعل أمرَ الجاهزيّةِ هو أمرَ الإصدارِ نفسَه يُرفَض عند التحميل', () => {
  const workdir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'env-readiness-')));
  const source = YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, 'environment.yaml'), 'utf8'));
  for (const tool of source.toolchain) {
    if (tool.readiness !== undefined) {
      tool.readiness.args = [...tool.args];
    }
  }
  fs.writeFileSync(path.join(workdir, 'environment.yaml'), YAML.stringify(source), 'utf8');
  fs.cpSync(path.join(CONFIG_DIR, 'schemas'), path.join(workdir, 'schemas'), { recursive: true });
  assert.throws(
    () => loadEnvironmentContract({ dir: workdir }),
    /قياسٌ يُعاد بنفسِه|مطابقٌ لأمرِ إصدارِها/u,
  );
  fs.rmSync(workdir, { recursive: true, force: true });
});

test('الوحدةُ نقيّةٌ: لا قرصَ ولا عمليّةَ ابنةَ ولا `process` في وحدةِ الحكم', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/environment/tool-readiness.mjs'), 'utf8');
  for (const specifier of ['node:fs', 'node:child_process', 'node:process']) {
    assert.ok(!source.includes(`'${specifier}'`), `الوحدةُ تستورد ${specifier}`);
  }
});

test('العقدُ الحقيقيُّ: ما يُعلن جاهزيّةً موثَّقٌ في §١٧ في الاتجاهين', () => {
  const contract = loadEnvironmentContract({ dir: CONFIG_DIR });
  const tools = toolsDeclaringReadiness(contract);
  assert.ok(tools.length >= 1, 'لا أداةَ تُعلن جاهزيّةً — والقاعدةُ بلا مقيسٍ لا تُقاس');
  const doc = fs.readFileSync(path.join(ROOT, 'docs/ENVIRONMENT.md'), 'utf8');
  for (const tool of tools) {
    assert.ok(doc.includes(tool.id), `${tool.id} غيرُ مذكورٍ في الوثيقة`);
    assert.ok(doc.includes(readinessCommandText(tool)), `أمرُ ${tool.id} غيرُ مذكورٍ في الوثيقة`);
  }
});

test('الحاجزُ عمليّةً ابنةً: يقبل المستودعَ الحقيقيَّ برمزٍ صفريٍّ ويُعلن ما قاسه', () => {
  const outcome = spawnSync(process.execPath, [GUARD_SCRIPT], { encoding: 'utf8', cwd: ROOT });
  assert.equal(outcome.status, 0, `${outcome.stdout}${outcome.stderr}`);
  assert.ok(outcome.stdout.includes('صلاحيتُها'));
});
