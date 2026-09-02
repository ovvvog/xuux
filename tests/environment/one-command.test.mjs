// اختبارُ قبولِ الخطوة `M10.05`: **بيئةٌ نظيفةٌ ⇒ نظامٌ عاملٌ بأمرٍ واحدٍ ⇒
// فحصُ صحّةٍ ناجح**.
//
// ومعيارُ القبولِ ثلاثةُ أجزاءٍ لا جزءٌ واحد، وكلٌّ يسقط وحدَه إن انكسر:
//
//   ١. **بعمليّاتٍ أبناءٍ حقيقيّةٍ لا بنداءِ دالّة**: كلُّ ما يُقاس هنا يُشغَّل
//      بـ`spawnSync('node', ['scripts/bootstrap.mjs', …])` ويُقرأ **رمزُ خروجِ
//      العمليّة** لا قيمةُ إرجاعٍ في الذاكرة. فمن نادى دالّةً في العمليّةِ
//      نفسِها قاس منطقاً ولم يقس «أمراً واحداً» يُكتب في طرفيّةٍ أو في مسارٍ
//      آليّ: لا يقيس رمزَ الخروجِ، ولا استيرادَ السكربتِ، ولا مخرَجَه.
//
//   ٢. **على بيئةٍ نظيفةٍ فعلاً لا على هذا المستودع**: يُبنى مجلَّدٌ مؤقّتٌ
//      خالٍ وعقدٌ مُشتقٌّ من العقدِ الحقيقيِّ (`config/environment.yaml`) بأطوارٍ
//      رخيصةٍ، فيُقاس الانتقالُ من **لا شيء** إلى **بيئةٍ صالحةٍ** بأمرٍ واحد.
//      ولو قيس على المستودعِ الحاضرِ لكانت المجلَّداتُ قائمةً قبل الأمرِ فيُقرأ
//      أخضرٌ لم يُقمه الأمر.
//
//   ٣. **الفحصُ يسبق ويلحق**: يُقاس الحكمُ **قبل** الإقامةِ فيجب أن يكون
//      `unfit` برمزٍ غيرِ صفريّ، و**بعدها** فيجب أن يكون `healthy` برمزٍ صفريّ.
//      فحكمٌ أخضرُ بعدَ الإقامةِ وحدَه لا يُثبت أنّ الإقامةَ هي التي أخضرته.
//
// **حدٌّ معلَنٌ:** العقدُ المُشتقُّ يستبدل `phase:install` و`phase:build` وما
// جرى مجراها بطورٍ رخيصٍ (`node --version`)، لأنّ `npm ci` في اختبارٍ يجعل
// البوابةَ تُنزِّل الشبكةَ في كلِّ تشغيل. **وأطوارُ العقدِ الحقيقيِّ مقيسةٌ**
// في الجزءِ الرابعِ بتشغيلٍ جافٍّ على العقدِ الحقيقيِّ نفسِه: تُقرأ خطّتُه
// كاملةً وتُقاس أسبابُ تخطّيها، فلا طورَ حقيقيٌّ يبقى بلا قياس.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

import YAML from 'yaml';

import { exitCodeOf, loadEnvironmentContract } from '../../src/environment/index.mjs';

const ROOT = process.cwd();
const BOOTSTRAP = 'scripts/bootstrap.mjs';
const VERIFY = 'scripts/verify-environment.mjs';

/**
 * تشغيلُ سكربتٍ **كعمليّةٍ ابنةٍ حقيقيّةٍ** وقراءةُ رمزِ خروجِها ومخرَجِها.
 *
 * @param {string} script
 * @param {string[]} args
 * @param {string} cwd
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function run(script, args, cwd) {
  const outcome = spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
    shell: false,
    env: { ...process.env, STATE_ENV: 'development' },
  });
  assert.equal(outcome.error, undefined, `العمليّةُ الابنةُ لم تُشغَّل: ${String(outcome.error)}`);
  return {
    status: outcome.status ?? -1,
    stdout: outcome.stdout ?? '',
    stderr: outcome.stderr ?? '',
  };
}

/**
 * عقدٌ مُشتقٌّ من العقدِ الحقيقيِّ بأطوارٍ رخيصةٍ ومجساتٍ كلُّها حاسمةٌ — يُكتب
 * في `config/environment.yaml` داخلَ مجلَّدٍ مؤقّتٍ **خالٍ**.
 *
 * @returns {string} مسارُ المجلَّدِ المؤقّتِ (وهو مجلَّدُ العملِ للأمرِ الواحد).
 */
function cleanEnvironment() {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-one-command-'));
  const source = YAML.parse(fs.readFileSync(path.join(ROOT, 'config', 'environment.yaml'), 'utf8'));

  source.toolchain = source.toolchain.filter(
    (/** @type {{ id: string }} */ tool) => tool.id !== 'tool:docker',
  );
  source.phases = [
    source.phases.find((/** @type {{ kind: string }} */ phase) => phase.kind === 'directories'),
    {
      id: 'phase:probe-node',
      title: 'طورٌ رخيصٌ يُثبت أنّ الأمرَ الواحدَ يُشغِّل عمليّاتٍ فعلاً',
      kind: 'command',
      command: 'node',
      args: ['--version'],
      idempotent: true,
      timeoutMs: 30000,
      statement:
        'طورٌ رخيصٌ في عقدِ الاختبارِ وحدَه: يُثبت أنّ المُنفِّذَ يُشغِّل أمراً حقيقيّاً ويقرأ رمزَ خروجِه، بلا شبكةٍ ولا حاوية.',
    },
  ];
  source.probes = [
    ...source.directories.map((/** @type {{ path: string }} */ directory) => ({
      id: `probe:dir-${directory.path.replace(/[^a-z]+/gi, '-').replace(/^-|-$/g, '')}`,
      kind: 'directory',
      target: directory.path,
      severity: 'critical',
      statement: `مجلَّدُ زمنِ التشغيل «${directory.path}» يجب أن يكون حاضراً بعدَ الأمرِ الواحد.`,
    })),
    {
      id: 'probe:contract-present',
      kind: 'file',
      target: 'config/environment.yaml',
      severity: 'critical',
      statement: 'العقدُ نفسُه يجب أن يكون حاضراً في مجلَّدِ العمل.',
    },
  ];
  source.healthCheck.requiredProbes = source.probes.map((/** @type {{ id: string }} */ p) => p.id);
  source.variables = source.variables.map((/** @type {{ requiredIn: string[] }} */ variable) => ({
    ...variable,
    requiredIn: [],
  }));

  fs.mkdirSync(path.join(workdir, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(workdir, 'config', 'environment.yaml'),
    YAML.stringify(source),
    'utf8',
  );
  return workdir;
}

test('بيئةٌ نظيفةٌ: الفحصُ قبلَ الإقامةِ يحكم unfit برمزٍ غيرِ صفريٍّ ولا يُصلِح شيئاً', () => {
  const workdir = cleanEnvironment();
  const before = run(VERIFY, ['--json', `--dir=${path.join(workdir, 'config')}`], workdir);
  const report = JSON.parse(before.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.verdict, 'unfit');
  assert.ok(before.status > 0, 'حكمٌ بالفشلِ يخرج صفراً حكمٌ لا يقرؤه مسارٌ آليّ');
  assert.equal(before.status, report.exitCode);
  // الفحصُ قراءةٌ محضةٌ: لم يُنشئ مجلَّداً ولم يُقِم شيئاً — ولا مجلَّدَ سجلٍّ.
  assert.equal(fs.existsSync(path.join(workdir, '.state')), false);
  assert.ok(report.auditDropped > 0, 'قيدُ الأثرِ يُعلَن مُسقَطاً ولا يُسكَت');
  // ولا يُخضِّر نفسَه بالتشغيلِ الثاني.
  const again = run(VERIFY, ['--json', `--dir=${path.join(workdir, 'config')}`], workdir);
  assert.equal(JSON.parse(again.stdout).verdict, 'unfit');
  fs.rmSync(workdir, { recursive: true, force: true });
});

test('بيئةٌ نظيفةٌ ⇒ أمرٌ واحدٌ ⇒ فحصُ صحّةٍ ناجح — بعمليّاتٍ أبناءٍ حقيقيّة', () => {
  const workdir = cleanEnvironment();
  const configDir = path.join(workdir, 'config');

  const bootstrap = run(BOOTSTRAP, ['--json', `--dir=${configDir}`], workdir);
  const outcome = JSON.parse(bootstrap.stdout);
  assert.equal(outcome.ok, true, `الإقامةُ فشلت: ${bootstrap.stdout}${bootstrap.stderr}`);
  assert.equal(bootstrap.status, 0, 'أمرٌ واحدٌ ينتهي بإقامةٍ صالحةٍ يخرج صفراً');
  // كلُّ طورٍ نُفِّذ فعلاً — لا طورٌ «مُخطَّطٌ» في تشغيلٍ غيرِ جافّ.
  assert.ok(outcome.phases.length >= 2);
  for (const phase of outcome.phases) {
    assert.ok(
      ['ok', 'skipped'].includes(phase.status),
      `طورٌ بحالٍ غيرِ متوقّعةٍ: ${phase.status}`,
    );
  }
  assert.equal(outcome.verdict, 'healthy');

  // المجلَّداتُ قامت بالأمرِ نفسِه لا بيدِ الاختبار.
  for (const directory of ['.state', '.state/weights', '.state/logs']) {
    assert.equal(
      fs.existsSync(path.join(workdir, directory)),
      true,
      `المجلَّد ${directory} لم يُنشَأ`,
    );
  }
  // وسجلُّ الأثرِ كُتِب على القرصِ بقيودٍ تُقرأ.
  const ledger = path.join(workdir, '.state', 'logs', 'environment.jsonl');
  assert.equal(fs.existsSync(ledger), true);
  const entries = fs
    .readFileSync(ledger, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
  assert.ok(entries.length >= 3);
  assert.ok(entries.some((entry) => entry.type === 'environment.bootstrap.planned'));
  assert.ok(entries.some((entry) => entry.type === 'environment.bootstrap.phase'));
  assert.ok(entries.some((entry) => entry.type === 'environment.verify.completed'));

  // الفحصُ المستقلُّ بعدَ الإقامةِ: حكمٌ ناجحٌ برمزٍ صفريّ.
  const after = run(VERIFY, ['--json', `--dir=${configDir}`], workdir);
  const report = JSON.parse(after.stdout);
  assert.equal(report.verdict, 'healthy');
  assert.equal(after.status, 0);
  assert.equal(report.criticalFailures, 0);

  // **والإقامةُ متكافئةٌ**: الأمرُ نفسُه مرّةً ثانيةً لا يُفسِد ما قام.
  const second = run(BOOTSTRAP, ['--json', `--dir=${configDir}`], workdir);
  assert.equal(second.status, 0);
  assert.equal(JSON.parse(second.stdout).verdict, 'healthy');

  fs.rmSync(workdir, { recursive: true, force: true });
});

test('العقدُ الحقيقيُّ: تشغيلٌ جافٌّ يقرأ أطوارَه كلَّها ولا يُحدِث أثراً', () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-dry-run-'));
  const contract = loadEnvironmentContract({ dir: path.join(ROOT, 'config') });
  const dry = run(
    BOOTSTRAP,
    ['--dry-run', '--json', `--dir=${path.join(ROOT, 'config')}`],
    workdir,
  );
  const outcome = JSON.parse(dry.stdout);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.dryRun, true);
  // كلُّ طورٍ معلَنٍ في العقدِ الحقيقيِّ مقروءٌ في الخطّةِ بترتيبِه.
  assert.deepEqual(
    outcome.phases.map((/** @type {{ phase: string }} */ phase) => phase.phase),
    contract.phases.map((phase) => phase.id),
  );
  for (const phase of outcome.phases) {
    assert.ok(['planned', 'skipped'].includes(phase.status), 'تشغيلٌ جافٌّ لا يُنفِّذ طوراً');
    // وكلُّ تخطٍّ بسببٍ مُسمّى مكتوبٍ لا صامت.
    if (phase.status === 'skipped') assert.ok(phase.detail.length > 0);
  }
  // ورمزُ الخروجِ من العقدِ لا من السكربت.
  assert.equal(dry.status, exitCodeOf(contract, outcome.verdict));
  // ولا أثرَ في مجلَّدِ العملِ: لا مجلَّدَ زمنِ تشغيلٍ ولا سجلَّ.
  assert.deepEqual(fs.readdirSync(workdir), []);
  fs.rmSync(workdir, { recursive: true, force: true });
});
