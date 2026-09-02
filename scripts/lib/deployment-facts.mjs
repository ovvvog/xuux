/**
 * جامعُ وقائعِ النشرِ وكاتبُ دفترِه — الخطوة `M10.06`.
 *
 * **هذا هو الموضعُ الوحيدُ الذي يلمس القرصَ ويُشغِّل عمليّةً** في مسارِ النشرِ
 * كلِّه؛ و`src/deployment/plan.mjs` و`rollout.mjs` و`releases.mjs` نقيّةٌ لا
 * تستورد `node:fs` ولا `node:child_process` أصلاً فلا تستطيع أن تفعل
 * (‏`G-DEPLOY-PURE-JUDGEMENT`). وفصلُ الوقائعِ عن الحكمِ هو ما يجعل حكمَ الموجةِ
 * قابلاً للاختبارِ بلا قرصٍ ولا عمليّةٍ ابنة.
 *
 * والضمانُ المُنفَّذُ هنا `G-DEPLOY-INJECTED-CLOCK`: كلُّ زمنٍ يُكتب في الدفترِ
 * يصل **مُعامِلاً** — لا `Date.now()` في متنِ منطقٍ ولا مؤقِّتٌ يعمل بنفسِه —
 * فمدّةُ التراجعِ تُثبَّت في الاختبارِ ولا تُقرأ من ساعةِ الجهاز.
 *
 * @module scripts/lib/deployment-facts
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { DEPLOY_ERRORS, DeploymentError } from '../../src/deployment/errors.mjs';

/**
 * @typedef {import('../../src/deployment/contract.mjs').DeploymentContract} DeploymentContract
 * @typedef {import('../../src/deployment/releases.mjs').LedgerEntry} LedgerEntry
 */

/**
 * مواضعُ النشرِ مُطلَقةً من جذرٍ مُمرَّر — ولا جذرَ مكتوبٌ هنا، فالاختبارُ
 * يُنشِئ جذرَه المؤقّتَ ويُمرِّره.
 *
 * @param {DeploymentContract} contract
 * @param {string} root
 * @returns {{ ledger: string, pointer: string, releases: string }}
 */
export function deploymentPaths(contract, root) {
  return {
    ledger: path.resolve(root, contract.ledger.path),
    pointer: path.resolve(root, contract.ledger.pointerPath),
    releases: path.resolve(root, contract.ledger.releasesPath),
  };
}

/**
 * بصمُ محتوى مجلَّدٍ ملفّاً ملفّاً — بيانُ الإصدار.
 *
 * @param {string} dir
 * @returns {{ files: { path: string, sha256: string, bytes: number }[], digest: string }}
 */
export function digestDirectory(dir) {
  /** @type {{ path: string, sha256: string, bytes: number }[]} */
  const files = [];
  /** @param {string} current */
  const walk = (current) => {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const bytes = fs.readFileSync(absolute);
      files.push({
        path: path.relative(dir, absolute),
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
      });
    }
  };
  walk(dir);
  const digest = crypto
    .createHash('sha256')
    .update(files.map((file) => `${file.path}:${file.sha256}`).join('\n'))
    .digest('hex');
  return { files, digest };
}

/**
 * تهيئةُ إصدارٍ: نسخُ محتواه إلى مجلَّدِ الإصداراتِ وبصمُه في بيانِه.
 *
 * @param {object} input
 * @param {DeploymentContract} input.contract
 * @param {string} input.root
 * @param {string} input.releaseId
 * @param {string} input.source
 * @param {number} input.at الزمنُ من ساعةٍ مُمرَّرة.
 * @returns {{ dir: string, digest: string, fileCount: number }}
 */
export function stageRelease({ contract, root, releaseId, source, at }) {
  assertClock(at);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new DeploymentError(
      DEPLOY_ERRORS.RELEASE_UNKNOWN,
      `مصدرُ الإصدارِ «${source}» ليس مجلَّداً قائماً — ولا يُبصَم محتوىً لا وجودَ له.`,
      { source },
    );
  }
  const paths = deploymentPaths(contract, root);
  const dir = path.join(paths.releases, releaseId);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(source, dir, { recursive: true });
  const probe = path.join(dir, contract.release.probeFile);
  if (!fs.existsSync(probe)) {
    throw new DeploymentError(
      DEPLOY_ERRORS.PROBE_FAILED,
      `الإصدار «${releaseId}» بلا ملفِّ مجسٍّ (${contract.release.probeFile}) — وإصدارٌ لا يُقاس لا تُفتح له بوابة.`,
      { release: releaseId, probeFile: contract.release.probeFile },
    );
  }
  const { files, digest } = digestDirectory(dir);
  fs.writeFileSync(
    path.join(dir, contract.release.manifestFile),
    `${JSON.stringify({ release: releaseId, stagedAt: at, digest, files }, null, 2)}\n`,
    'utf8',
  );
  return { dir, digest, fileCount: files.length };
}

/**
 * نداءُ مجسِّ الإصدارِ لموجةٍ بعينِها وقراءةُ مشاهداتِه.
 *
 * والمجسُّ **عمليّةٌ ابنةٌ حقيقيّةٌ** لا دالّةٌ تُستورَد: فإصدارٌ معطوبٌ قد يُعطب
 * عند تحميلِه نفسِه، ومن استورده في عمليّةِ الناشرِ أسقط ناشرَه معه.
 *
 * @param {object} input
 * @param {DeploymentContract} input.contract
 * @param {string} input.releaseDir
 * @param {import('../../src/deployment/plan.mjs').PlannedWave} input.wave
 * @returns {Readonly<Record<string, { total: number, bad: number }>>}
 */
export function probeWave({ contract, releaseDir, wave }) {
  const probe = path.join(releaseDir, contract.release.probeFile);
  const outcome = spawnSync(
    process.execPath,
    [probe, '--wave', wave.id, '--share', String(wave.sharePercent)],
    { encoding: 'utf8', timeout: wave.timeoutMs, shell: false },
  );
  if (outcome.error !== undefined || outcome.status !== 0) {
    throw new DeploymentError(
      DEPLOY_ERRORS.PROBE_FAILED,
      `مجسُّ الموجةِ «${wave.id}» لم يُتمّ (رمزُ خروجٍ ${String(outcome.status)}): ${String(
        outcome.stderr ?? '',
      )
        .trim()
        .slice(0, 300)}`,
      { wave: wave.id, status: outcome.status },
    );
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(String(outcome.stdout ?? ''));
  } catch (error) {
    throw new DeploymentError(
      DEPLOY_ERRORS.PROBE_FAILED,
      `مخرَجُ مجسِّ الموجةِ «${wave.id}» ليس JSON صالحاً: ${error instanceof Error ? error.message : String(error)}`,
      { wave: wave.id },
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new DeploymentError(
      DEPLOY_ERRORS.PROBE_FAILED,
      `مخرَجُ مجسِّ الموجةِ «${wave.id}» ليس سجلَّ مشاهداتٍ بمعرّفاتِ أهدافٍ.`,
      { wave: wave.id },
    );
  }
  return Object.freeze(/** @type {Record<string, { total: number, bad: number }>} */ (parsed));
}

/**
 * قراءةُ وقائعِ الدفترِ — مصدرُ الحقيقةِ عن آخرِ إصدارٍ نُشِّط بحكمٍ صحيح.
 *
 * @param {DeploymentContract} contract
 * @param {string} root
 * @returns {LedgerEntry[]}
 */
export function readLedger(contract, root) {
  const file = deploymentPaths(contract, root).ledger;
  if (!fs.existsSync(file)) return [];
  /** @type {LedgerEntry[]} */
  const entries = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      entries.push(/** @type {LedgerEntry} */ (JSON.parse(trimmed)));
    } catch {
      throw new DeploymentError(
        DEPLOY_ERRORS.CONFIG_INVALID,
        'سطرٌ في دفترِ النشرِ لا يُقرأ — ودفترٌ لا يُقرأ سطرُه لا يُشتقّ منه هدفُ تراجع.',
        { file },
      );
    }
  }
  return entries;
}

/**
 * كتابةُ واقعةٍ في الدفترِ بإضافةٍ سطريّةٍ — لا تعديلَ لسطرٍ سابقٍ أبداً.
 *
 * @param {object} input
 * @param {DeploymentContract} input.contract
 * @param {string} input.root
 * @param {{ type: string } & Record<string, unknown>} input.entry
 * @param {number} input.at
 * @returns {Record<string, unknown>}
 */
export function appendLedger({ contract, root, entry, at }) {
  assertClock(at);
  const declared = new Set(contract.audit.events.map((event) => event.type));
  if (!declared.has(entry.type)) {
    throw new DeploymentError(
      DEPLOY_ERRORS.CONFIG_INVALID,
      `واقعةٌ من نوع «${entry.type}» تُكتب في الدفترِ ولا إعلانَ لها في audit.events — وحدثٌ لا يجده قارئُ الوثيقة.`,
      { type: entry.type },
    );
  }
  const file = deploymentPaths(contract, root).ledger;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const written = { ...entry, at };
  fs.appendFileSync(file, `${JSON.stringify(written)}\n`, 'utf8');
  return written;
}

/**
 * قراءةُ مؤشِّرِ الإصدارِ النشط.
 *
 * @param {DeploymentContract} contract
 * @param {string} root
 * @returns {{ release: string, wave: string, sharePercent: number, at: number } | null}
 */
export function readPointer(contract, root) {
  const file = deploymentPaths(contract, root).pointer;
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * كتابةُ مؤشِّرِ الإصدارِ النشط — لحظةً واحدةً يقرؤها القارئ.
 *
 * @param {object} input
 * @param {DeploymentContract} input.contract
 * @param {string} input.root
 * @param {string} input.release
 * @param {string} input.wave
 * @param {number} input.sharePercent
 * @param {number} input.at
 * @returns {void}
 */
export function writePointer({ contract, root, release, wave, sharePercent, at }) {
  assertClock(at);
  const paths = deploymentPaths(contract, root);
  const releaseDir = path.join(paths.releases, release);
  if (!fs.existsSync(releaseDir)) {
    throw new DeploymentError(
      DEPLOY_ERRORS.RELEASE_UNKNOWN,
      `الإصدار «${release}» غيرُ مُهيَّأٍ في مجلَّدِ الإصدارات — ولا يُنشَّط ما لا وجودَ له، ولا سيّما هدفَ تراجعٍ.`,
      { release, releaseDir },
    );
  }
  fs.mkdirSync(path.dirname(paths.pointer), { recursive: true });
  fs.writeFileSync(
    paths.pointer,
    `${JSON.stringify({ release, wave, sharePercent, at }, null, 2)}\n`,
    'utf8',
  );
}

/**
 * @param {number} at
 * @returns {void}
 */
function assertClock(at) {
  if (!Number.isFinite(at)) {
    throw new DeploymentError(
      DEPLOY_ERRORS.CLOCK_INVALID,
      'الساعةُ المُمرَّرةُ لا تُصدر عدداً منتهياً — ولا تُقاس بها مدّةُ تراجعٍ ولا يُختم بها سطرُ دفتر.',
      { at },
    );
  }
}
