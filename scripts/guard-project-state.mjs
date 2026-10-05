#!/usr/bin/env node
// حاجزُ ذاكرةِ المشروعِ التنفيذيّةِ — `npm run guard:project-state` (‏`WL-329`).
//
// **القاعدةُ التي يُنفِذُها:** لا يمرُّ تغييرٌ حاملٌ للحالةِ (‏كودٌ، عقدٌ، سيرُ عملٍ، أو
// ذاكرةُ مشروعٍ) إلّا وفي **الحزمةِ نفسِها** مُدخلةُ سجلٍّ جديدةٌ تُسمّي ما تغيَّرَ ولا تُسمّي
// ما لم يتغيَّرْ، ولوحةُ الحالةِ محدَّثةٌ، وصفُّ الدَّينِ الذي عُمِلَ عليه يذكرُ العملَ، والوثائقُ
// التي تصفُ ما تغيَّرَ محدَّثةٌ أو مُعلَنٌ أنّها غيرُ متأثّرةٍ، وملخّصُ التسليمِ مُعادٌ توليدُه.
// ثمّ يُشغِّلُ حواجزَ الاتّساقِ القائمةَ فيعطي حكماً واحداً.
//
// **يحكمُ على الفرقِ لا على الشجرةِ** — وهذا ما لم يكن يقيسُه حاجزٌ قبلَه:
//   الأساسُ: `--base <ref>`، أو `PROJECT_STATE_BASE`، أو في CI لطلبِ دمجٍ `origin/<base_ref>`،
//   أو في CI لدفعٍ إلى `main` الأبُ الأوّلُ `HEAD^1`، وإلّا `merge-base HEAD origin/main`.
//   والفرقُ `git diff --no-renames -z --name-status <base>...HEAD`.
//
// **رموزُ الخروجِ:** `0` الحزمةُ متّسقةٌ · `1` رفضٌ (‏تُطبَعُ القواعدُ) · `2` عجزٌ عن القياسِ
// (‏لا أساسَ، عقدٌ معطوبٌ) — **والعجزُ رفضٌ لا مرور**: الصمتُ لا يُقرأُ نجاحاً.
//
// **حدٌّ معلَنٌ:** يقيسُ الاقترانَ والأثرَ المُدّعى لا صدقَ الوصفِ (‏المادة 1).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parse } from 'yaml';
import {
  evaluateProjectState,
  parseManifest,
  renderHandoff,
  verifyRestorations,
} from './lib/project-state.mjs';

const args = process.argv.slice(2);
/**
 * @param {string} name
 * @returns {string | undefined}
 */
function option(name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}
const repoRoot = path.resolve(option('--root') ?? process.cwd());
const writeHandoff = args.includes('--write-handoff');
const skipConsistency = args.includes('--no-consistency');
const MANIFEST = 'config/project-state.yaml';

/**
 * @param {string[]} gitArgs
 * @returns {string}
 */
function git(gitArgs) {
  return execFileSync('git', gitArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * @param {string} rel
 * @returns {string}
 */
function readHead(rel) {
  return readFileSync(path.join(repoRoot, rel), 'utf8');
}

/**
 * @param {string} message
 * @returns {never}
 */
function unmeasurable(message) {
  console.error(`⛔ حاجزُ ذاكرةِ المشروعِ عاجزٌ عن القياسِ — والعجزُ رفضٌ: ${message}`);
  process.exit(2);
}

/** @returns {import('./lib/project-state.mjs').ProjectStateManifest} */
function loadManifest() {
  try {
    return parseManifest(parse(readHead(MANIFEST)));
  } catch (error) {
    return unmeasurable(
      `\`${MANIFEST}\`: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * @param {import('./lib/project-state.mjs').ProjectStateManifest} manifest
 * @returns {string}
 */
function handoffText(manifest) {
  /**
   * @param {string} rel
   * @returns {string}
   */
  const optionalText = (rel) => (existsSync(path.join(repoRoot, rel)) ? readHead(rel) : '');
  const reviewText = optionalText('config/external-review.yaml');
  const versionText = optionalText('version.json');
  return renderHandoff({
    manifest,
    workLog: optionalText(manifest.workLog),
    status: optionalText(manifest.status),
    debtRegister: optionalText(manifest.debtRegister),
    externalReview: reviewText === '' ? null : parse(reviewText),
    version: versionText === '' ? null : JSON.parse(versionText),
  });
}

const manifest = loadManifest();

if (writeHandoff) {
  writeFileSync(path.join(repoRoot, manifest.handoff), handoffText(manifest), 'utf8');
  console.log(`✅ كُتِبَ \`${manifest.handoff}\` من مصادرِه.`);
  process.exit(0);
}

/** @returns {string} */
function resolveBase() {
  const explicit = option('--base') ?? process.env['PROJECT_STATE_BASE'];
  if (explicit !== undefined && explicit !== '') return explicit;
  const event = process.env['GITHUB_EVENT_NAME'];
  const baseRef = process.env['GITHUB_BASE_REF'];
  if (event === 'pull_request' && baseRef) return `origin/${baseRef}`;
  if (event === 'push') return 'HEAD^1';
  try {
    return git(['merge-base', 'HEAD', 'origin/main']).trim();
  } catch {
    return unmeasurable(
      'لا أساسَ للمقارنةِ: `origin/main` غائبٌ — `git fetch origin main` أو مرِّرْ `--base`.',
    );
  }
}

const base = resolveBase();
let baseSha = '';
try {
  baseSha = git(['rev-parse', '--verify', `${base}^{commit}`]).trim();
} catch {
  unmeasurable(`الأساسُ \`${base}\` لا يُحَلُّ إلى كوميت.`);
}

/** @type {import('./lib/project-state.mjs').ChangedFile[]} */
const changed = [];
{
  const raw = git(['diff', '--no-renames', '-z', '--name-status', `${baseSha}...HEAD`]);
  const parts = raw.split('\0').filter((p) => p.length > 0);
  for (let i = 0; i + 1 < parts.length; i += 2) {
    changed.push({ status: String(parts[i]), path: String(parts[i + 1]) });
  }
}

/**
 * @param {string} rel
 * @returns {string}
 */
function readBase(rel) {
  try {
    return git(['show', `${baseSha}:${rel}`]);
  } catch {
    return '';
  }
}

const WORK_LOG_IDS = 'config/work-log-ids.yaml';
/** @type {unknown[]} */
let restoreDeclarations = [];
if (existsSync(path.join(repoRoot, WORK_LOG_IDS))) {
  try {
    const declared = parse(readHead(WORK_LOG_IDS))?.restored_entries ?? [];
    if (!Array.isArray(declared)) throw new Error('`restored_entries` ليست قائمة');
    restoreDeclarations = declared;
  } catch (error) {
    unmeasurable(`\`${WORK_LOG_IDS}\`: ${error instanceof Error ? error.message : String(error)}`);
  }
}
const headWorkLogText = existsSync(path.join(repoRoot, manifest.workLog))
  ? readHead(manifest.workLog)
  : '';
const restoration = verifyRestorations({
  declarations: /** @type {any[]} */ (restoreDeclarations),
  baseWorkLog: readBase(manifest.workLog),
  headWorkLog: headWorkLogText,
  workLogAt: (commit) => {
    try {
      return git(['show', `${commit}:${manifest.workLog}`]);
    } catch {
      return null;
    }
  },
  isAncestorOfBase: (commit) =>
    spawnSync('git', ['merge-base', '--is-ancestor', commit, baseSha], { cwd: repoRoot }).status ===
    0,
});

const result = evaluateProjectState({
  restored: restoration.restored,
  manifest,
  changed,
  headExists: (rel) => existsSync(path.join(repoRoot, rel)),
  baseWorkLog: readBase(manifest.workLog),
  headWorkLog: headWorkLogText,
  headDebtRegister: existsSync(path.join(repoRoot, manifest.debtRegister))
    ? readHead(manifest.debtRegister)
    : '',
});

const violations = [...restoration.violations, ...result.violations];
const handoffPath = path.join(repoRoot, manifest.handoff);
const expectedHandoff = handoffText(manifest);
if (!existsSync(handoffPath) || readFileSync(handoffPath, 'utf8') !== expectedHandoff) {
  violations.push({
    code: 'PS9/HANDOFF-STALE',
    message: `\`${manifest.handoff}\` لا يطابقُ مصادرَه — \`npm run handoff:report\` ثمّ ضمِّنْه في الحزمة.`,
  });
}

console.log('═══ حاجزُ ذاكرةِ المشروعِ التنفيذيّةِ (project-state) ═══');
console.log(`  الأساسُ: ${base} = ${baseSha.slice(0, 12)} · ملفّاتٌ متغيّرةٌ: ${changed.length}`);
console.log(
  `  تنفيذيٌّ: ${result.executive.length} · ذاكرةٌ: ${result.memory.length} · مُدخلاتٌ جديدةٌ: ${
    result.newEntries.join(' ') || '—'
  } · القاعدةُ ${result.triggered ? 'مُطلَقةٌ' : 'غيرُ مُطلَقةٍ (لا تغييرَ حاملاً للحالة)'}`,
);

/** @type {string[]} */
const failedConsistency = [];
if (!skipConsistency) {
  for (const guard of [
    'status-freshness',
    'work-log-ids',
    'doc-counts',
    'progress',
    'version',
    'readiness',
  ]) {
    const script = path.join(repoRoot, 'scripts', `guard-${guard}.mjs`);
    if (!existsSync(script)) {
      failedConsistency.push(`guard:${guard} (غائب)`);
      continue;
    }
    const run = spawnSync(process.execPath, [script], { cwd: repoRoot, encoding: 'utf8' });
    if (run.status !== 0) {
      failedConsistency.push(`guard:${guard}`);
      process.stderr.write(run.stdout ?? '');
      process.stderr.write(run.stderr ?? '');
    }
  }
  console.log(
    `  حواجزُ الاتّساقِ: ${failedConsistency.length === 0 ? 'ستّتُها ناجحةٌ' : `ساقطةٌ: ${failedConsistency.join(' · ')}`}`,
  );
}

if (violations.length > 0 || failedConsistency.length > 0) {
  console.error('\n⛔ الحكمُ: ذاكرةُ المشروعِ غيرُ متّسقةٍ مع التغييرِ — الدفعُ والدمجُ مرفوضان:');
  for (const v of violations) console.error(`  • ${v.code}: ${v.message}`);
  for (const g of failedConsistency) console.error(`  • CONSISTENCY: ${g} ساقطٌ (مخرَجُه أعلاه).`);
  console.error(
    '\nالإصلاحُ في الحزمةِ نفسِها لا في دفعةٍ لاحقةٍ: مُدخلةُ `WL-NNN` بقالبِ المادة 6 تُسمّي كلَّ ملفٍّ تغيَّرَ،' +
      ' وسطرُ «آخر تحديث»، وصفُّ الدَّين، ثمّ `npm run readiness:report` و`npm run handoff:report`. والدورةُ في `AGENTS.md`.',
  );
  process.exit(1);
}

console.log(
  '✅ الحكمُ: الكودُ وذاكرةُ المشروعِ حزمةٌ واحدةٌ متّسقةٌ. **اقترانٌ مقيسٌ لا صدقُ وصفٍ: صحّةُ النصِّ شرطُ المادة 1.**',
);
