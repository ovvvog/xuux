/**
 * جامعُ وقائعِ البيئة — الخطوة `M10.05`.
 *
 * **هذا هو الموضعُ الوحيدُ الذي يلمس القرصَ ويُشغِّل أمرَ استخبارٍ** في مسارِ
 * البيئةِ كلِّه؛ و`src/environment/` نقيّةٌ لا تستورد `node:fs` ولا
 * `node:child_process` أصلاً فلا تستطيع أن تفعل. وفصلُ الوقائعِ عن الحكمِ هو ما
 * يجعل الحكمَ قابلاً للاختبارِ بلا حاويةٍ ولا شبكةٍ ولا قرصٍ، ويجعل الضمانَ
 * `G-ENV-VERIFY-READ-ONLY` **بنيةً لا نيّة**.
 *
 * **والأوامرُ هنا أوامرُ استخبارٍ لا أوامرُ عملٍ**: `--version` وما يجري مجراه،
 * ولا واحدٌ منها يكتب شيئاً؛ فجامعٌ يُصلِح ما يجمعه يُخبر عن حالِ ما تركه هو لا
 * عن حالِ البيئة.
 *
 * @module scripts/lib/environment-facts
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { versionInRange } from '../../src/environment/plan.mjs';

/**
 * @typedef {import('../../src/environment/contract.mjs').EnvironmentContract} EnvironmentContract
 * @typedef {import('../../src/environment/contract.mjs').EnvironmentTool} EnvironmentTool
 * @typedef {import('../../src/environment/probes.mjs').ProbeObservation} ProbeObservation
 */

/** مهلةُ أمرِ الاستخبارِ الواحد؛ فأداةٌ لا تُجيب في عشرِ ثوانٍ أداةٌ معطوبة. */
const PROBE_TIMEOUT_MS = 10000;

/**
 * وضعُ البيئةِ المقروءُ **من البيئةِ لا مُخترَعاً**: `STATE_ENV` ثم `CI` ثم
 * `NODE_ENV`، وإلا فـ`development`. والترتيبُ مقصودٌ: الصريحُ يسبق المستنبَط.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function detectProfile(env = process.env) {
  const explicit = env['STATE_ENV'];
  if (explicit === 'development' || explicit === 'ci' || explicit === 'production') {
    return explicit;
  }
  if (env['CI'] === 'true' || env['GITHUB_ACTIONS'] === 'true') return 'ci';
  if (env['NODE_ENV'] === 'production') return 'production';
  return 'development';
}

/**
 * إصدارُ أداةٍ واحدةٍ بأمرِ استخبارِها.
 *
 * @param {EnvironmentTool} tool
 * @returns {{ present: boolean, version: string | null, inRange: boolean }}
 */
export function probeTool(tool) {
  /** @type {import('node:child_process').SpawnSyncReturns<string>} */
  const outcome = spawnSync(tool.command, tool.args, {
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
    shell: false,
  });
  if (outcome.error !== undefined || outcome.status !== 0) {
    return { present: false, version: null, inRange: false };
  }
  const text = `${outcome.stdout ?? ''}${outcome.stderr ?? ''}`.trim();
  const range = versionInRange(tool, text);
  return { present: true, version: text.split('\n')[0] ?? text, inRange: range.inRange };
}

/**
 * وقائعُ الخطّةِ: الوضعُ، والأدواتُ الحاضرةُ **بإصدارٍ داخلَ المجالِ**،
 * والمتغيّراتُ المضبوطةُ **بصيغتِها المُعلَنة**.
 *
 * وأداةٌ حاضرةٌ بإصدارٍ خارجَ المجالِ **لا تُعَدُّ حاضرةً للخطّة**: من أقام
 * البيئةَ بـNode 22 ثم قرأ أخضرَ محلياً قرأ حكماً على بيئةٍ أخرى.
 *
 * @param {EnvironmentContract} contract
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string }} [options]
 * @returns {import('../../src/environment/plan.mjs').EnvironmentFacts}
 */
export function collectFacts(contract, options = {}) {
  const env = options.env ?? process.env;
  const profile = detectProfile(env);
  /** @type {string[]} */
  const presentTools = [];
  for (const tool of contract.toolchain) {
    const outcome = probeTool(tool);
    if (outcome.present && outcome.inRange) presentTools.push(tool.id);
  }
  /** @type {string[]} */
  const setVariables = [];
  for (const variable of contract.variables) {
    const value = env[variable.id];
    if (value !== undefined && value !== '' && new RegExp(variable.format).test(value)) {
      setVariables.push(variable.id);
    }
  }
  return { profile, presentTools, setVariables };
}

/**
 * وقائعُ المجساتِ — قراءةٌ محضةٌ، **ولا قيمةَ متغيّرٍ سرّيٍّ تُطبَع** بل
 * حضورُها ومطابقتُها الصيغةَ. فمتغيّرٌ سرّيٌّ يُطبَع في مخرَجِ فحصٍ يُحفَظ في
 * سجلِّ بناءٍ سرٌّ انتهى.
 *
 * @param {EnvironmentContract} contract
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string }} [options]
 * @returns {ProbeObservation[]}
 */
export function collectObservations(contract, options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  /** @type {ProbeObservation[]} */
  const observations = [];
  for (const probe of contract.probes) {
    if (probe.kind === 'tool') {
      const tool = contract.toolchain.find((entry) => entry.id === probe.target);
      if (tool === undefined) continue;
      const outcome = probeTool(tool);
      observations.push({
        probe: probe.id,
        satisfied: outcome.present && outcome.inRange,
        detail: !outcome.present
          ? `الأداةُ «${tool.command}» غيرُ موجودةٍ في المسارِ.`
          : outcome.inRange
            ? `الأداةُ «${tool.command}» حاضرةٌ بإصدارٍ داخلَ المجالِ المُعلَنِ.`
            : `الأداةُ «${tool.command}» حاضرةٌ بإصدارٍ خارجَ المجالِ المُعلَنِ (${String(tool.minMajor ?? '—')}..${String(tool.maxMajor ?? '—')}).`,
        observed: outcome.version ?? 'غائبة',
      });
      continue;
    }
    if (probe.kind === 'variable') {
      const variable = contract.variables.find((entry) => entry.id === probe.target);
      if (variable === undefined) continue;
      const value = env[variable.id];
      const present = value !== undefined && value !== '';
      const matches = present && new RegExp(variable.format).test(value);
      observations.push({
        probe: probe.id,
        satisfied: matches,
        detail: !present
          ? `المتغيّرُ «${variable.id}» غيرُ مضبوطٍ.`
          : matches
            ? `المتغيّرُ «${variable.id}» مضبوطٌ ومطابقٌ لصيغتِه المُعلَنة.`
            : `المتغيّرُ «${variable.id}» مضبوطٌ ولا يطابق صيغتَه المُعلَنة.`,
        // لا قيمةَ سرٍّ في المخرَجِ — الحضورُ والمطابقةُ وحدَهما.
        observed: variable.secret
          ? present
            ? 'مضبوطٌ (مكتومُ القيمة)'
            : 'غائب'
          : (value ?? 'غائب'),
      });
      continue;
    }
    const target = path.resolve(cwd, probe.target);
    /** @type {import('node:fs').Stats | null} */
    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      stat = null;
    }
    const satisfied =
      stat !== null && (probe.kind === 'directory' ? stat.isDirectory() : stat.isFile());
    observations.push({
      probe: probe.id,
      satisfied,
      detail: satisfied
        ? `${probe.kind === 'directory' ? 'المجلَّدُ' : 'الملفُّ'} «${probe.target}» حاضرٌ.`
        : `${probe.kind === 'directory' ? 'المجلَّدُ' : 'الملفُّ'} «${probe.target}» غائبٌ أو ليس من نوعِه المُعلَن.`,
      observed: probe.target,
    });
  }
  return observations;
}
