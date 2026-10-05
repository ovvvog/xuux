// حاجزُ ذاكرةِ المشروعِ التنفيذيّةِ — `WL-329`.
//
// **السيناريو الذي يُغلَقُ:** وكيلٌ يُعدِّلُ `src/` ويدفعُ وينتهي رصيدُه، ثمّ يأتي آخرُ فيُحدِّثُ
// الوثائقَ في دفعةٍ لاحقة. كلُّ اختبارٍ هنا يبني **مستودعَ Git حقيقيّاً** في جذرٍ مؤقّتٍ بعقدِ
// `config/project-state.yaml` الحقيقيِّ نفسِه، ويُشغِّلُ الحاجزَ **عمليّةً منفصلةً** كما يُشغِّلُه
// الخطّافُ وCI، ويقرأُ رمزَ خروجِه ورموزَ القواعدِ في مخرَجِه — لا يستدعي دالّةً ويفترضُ مسارَها.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import {
  classifyPath,
  affectedFilesSection,
  declaredPaths,
  evaluateProjectState,
  parseManifest,
  parseWorkLog,
  entryText,
} from '../../scripts/lib/project-state.mjs';

const REPO = process.cwd();
const GUARD = path.join(REPO, 'scripts', 'guard-project-state.mjs');
const manifest = parseManifest(
  parse(readFileSync(path.join(REPO, 'config', 'project-state.yaml'), 'utf8')),
);

/** @type {string[]} */
const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
}

/**
 * @param {string} root
 * @param {string} rel
 * @param {string} text
 */
function write(root, rel, text) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text, 'utf8');
}

const WL1 = `# سجل الأعمال

### [2026-10-01] — WL-001 — البداية

**المنفِّذُ:** اختبار · **الحالةُ بعدَ العملِ:** ✅

#### الملفات المتأثرة

\`src/app.mjs\`

---
`;

const DEBT = `# سجل الديون

| المعرّف | الوصف | المعيار | المالك |
| --- | --- | --- | --- |
| \`LIVE-1\` | دَينٌ مفتوحٌ للاختبار | يُغلَقُ بالإصلاح | منفِّذ |
| ~~\`LIVE-0\`~~ 🟢 | دَينٌ مُغلَق | — | ✅ منفِّذ |
`;

/**
 * @param {string} root
 * @param {string[]} [extra]
 */
function regenerateHandoff(root, extra = []) {
  const run = spawnSync(process.execPath, [GUARD, '--root', root, '--write-handoff', ...extra], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
}

/**
 * مستودعٌ أساسُه `main` بذاكرةٍ متّسقةٍ، ثمّ فرعُ `work` للتغيير.
 *
 * @returns {string}
 */
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'xuux-project-state-'));
  roots.push(root);
  git(root, ['init', '-q', '-b', 'main']);
  mkdirSync(path.join(root, 'config'), { recursive: true });
  copyFileSync(
    path.join(REPO, 'config', 'project-state.yaml'),
    path.join(root, 'config', 'project-state.yaml'),
  );
  write(root, 'AGENTS.md', '# نقطة الدخول\n');
  write(root, 'GOVERNANCE_RULE.md', '# القاعدة\n');
  write(root, 'PROJECT_STATUS.md', 'آخر تحديث: **2026-10-01** — `WL-001` — البداية.\n');
  write(root, 'docs/roadmap/05-work-log.md', WL1);
  write(root, 'docs/roadmap/06-debt-register.md', DEBT);
  write(root, 'docs/roadmap/03-roadmap-to-100.md', '# الخارطة\n');
  write(root, 'docs/roadmap/02-baseline-audit.md', '# الأساس\n');
  write(root, 'docs/roadmap/04-execution-playbook.md', '# الكتاب\n');
  write(root, 'version.json', '{"version":"0.1.0","completion":{"percent":10}}\n');
  write(root, 'config/work-log-ids.yaml', 'gaps: []\n');
  write(root, 'docs/audit/work-log-id-map.md', '# خريطة\n');
  write(
    root,
    'config/external-review.yaml',
    'findings:\n  - id: F-1\n    status: open\n  - id: F-2\n    status: closed\n',
  );
  write(root, 'docs/READINESS_REPORT.md', '# تقرير\n');
  write(root, 'docs/CURRENT_STATE.md', '# الحالة الحالية\n');
  write(root, 'README.md', '# المشروع\n');
  write(root, 'docs/THREAT_MODEL.md', '# نموذج التهديد\n');
  write(root, 'src/app.mjs', 'export const v = 1;\n');
  write(root, 'src/production/entry.mjs', 'export const p = 1;\n');
  regenerateHandoff(root);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'base']);
  git(root, ['checkout', '-qb', 'work']);
  return root;
}

/**
 * @param {string} root
 * @param {string} [base]
 */
function runGuard(root, base = 'main') {
  const env = { ...process.env };
  delete env['GITHUB_EVENT_NAME'];
  delete env['GITHUB_BASE_REF'];
  delete env['PROJECT_STATE_BASE'];
  const run = spawnSync(
    process.execPath,
    [GUARD, '--root', root, '--base', base, '--no-consistency'],
    {
      encoding: 'utf8',
      env,
    },
  );
  return { status: run.status, out: `${run.stdout}\n${run.stderr}` };
}

/**
 * @param {string} root
 * @param {string} message
 */
function commit(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', message]);
}

/**
 * يُضيفُ مُدخلةً جديدةً في أعلى السجلّ.
 *
 * @param {string} root
 * @param {{ id?: string, title?: string, files: string[], extra?: string }} spec
 */
function addEntry(root, spec) {
  const id = spec.id ?? 'WL-002';
  const entry = `### [2026-10-02] — ${id} — ${spec.title ?? 'تغييرٌ في التطبيق'}

**المنفِّذُ:** اختبار · **الحالةُ بعدَ العملِ:** ✅ منفَّذ

#### ما تمَّ فعلاً

- تعديلٌ.
${spec.extra ?? ''}
#### الملفاتُ المتأثّرة

${spec.files.map((f) => `\`${f}\``).join(' · ')}

---

`;
  const rel = 'docs/roadmap/05-work-log.md';
  const text = readFileSync(path.join(root, rel), 'utf8');
  write(root, rel, text.replace('### [2026-10-01]', `${entry}### [2026-10-01]`));
  const status = readFileSync(path.join(root, 'PROJECT_STATUS.md'), 'utf8');
  write(
    root,
    'PROJECT_STATUS.md',
    `آخر تحديث: **2026-10-02** — \`${id}\` — ${spec.title ?? 'تغيير'}.\n${status}`,
  );
}

test('A — تغييرٌ تنفيذيٌّ بلا تحديثِ ذاكرةِ المشروعِ يُرفَضُ (‏PS2 + PS3)', () => {
  const root = fixture();
  write(root, 'src/app.mjs', 'export const v = 2;\n');
  commit(root, 'code only');
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS2\/NO-RECORD/u);
  assert.match(r.out, /PS3\/STATUS-STALE/u);
  assert.match(r.out, /`src\/app\.mjs`/u);
});

test('A — والدفعُ إلى main بالكودِ وحدَه يُرفَضُ في وضعِ CI لدفعٍ (‏الأساسُ HEAD^1)', () => {
  const root = fixture();
  git(root, ['checkout', '-q', 'main']);
  write(root, 'src/app.mjs', 'export const v = 2;\n');
  commit(root, 'code pushed to main');
  const r = runGuard(root, 'HEAD^1');
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS2\/NO-RECORD/u);
});

test('B — التغييرُ نفسُه مع ذاكرتِه في الحزمةِ نفسِها يمرُّ', () => {
  const root = fixture();
  write(root, 'src/app.mjs', 'export const v = 2;\n');
  addEntry(root, { files: ['src/app.mjs', 'PROJECT_STATUS.md'] });
  regenerateHandoff(root);
  commit(root, 'code + memory');
  const r = runGuard(root);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /WL-002/u);
});

test('B — وأكثرُ من كوميتٍ في الطلبِ مقبولٌ ما دامت الحزمةُ عندَ الدمجِ متّسقة', () => {
  const root = fixture();
  write(root, 'src/app.mjs', 'export const v = 2;\n');
  commit(root, 'code');
  assert.equal(runGuard(root).status, 1, 'الفرعُ بعدَ الكوميتِ الأوّلِ وحدَه غيرُ قابلٍ للدفع.');
  addEntry(root, { files: ['src/app.mjs', 'PROJECT_STATUS.md'] });
  regenerateHandoff(root);
  commit(root, 'memory');
  const r = runGuard(root);
  assert.equal(r.status, 0, r.out);
});

test('السيناريو القديم — توثيقٌ لاحقٌ لكودٍ دُمِجَ قبلَه يُرفَضُ (‏PS5: أثرٌ ليس في الفرق)', () => {
  const root = fixture();
  // الوكيلُ الأوّلُ: كودٌ وحدَه إلى main (‏تجاوزَ الحاجزَ — وهذا ما يرفضُه اختبارُ A).
  git(root, ['checkout', '-q', 'main']);
  write(root, 'src/app.mjs', 'export const v = 2;\n');
  commit(root, 'code only on main');
  // الوكيلُ الثاني: فرعُ توثيقٍ لاحقٍ يدّعي الأثرَ.
  git(root, ['checkout', '-qb', 'late-docs']);
  addEntry(root, { files: ['src/app.mjs', 'PROJECT_STATUS.md'] });
  regenerateHandoff(root);
  commit(root, 'late docs');
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS5\/PHANTOM-CLAIM/u);
  assert.match(r.out, /`src\/app\.mjs`/u);
});

test('C — تعديلُ وثيقةٍ لا تحملُ حالةً لا يَطلُبُ تحديثَ شيءٍ', () => {
  const root = fixture();
  write(root, 'docs/THREAT_MODEL.md', '# نموذج التهديد\n\nتصحيحٌ لغويّ.\n');
  commit(root, 'typo');
  const r = runGuard(root);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /غيرُ مُطلَقةٍ/u);
});

test('C — والتصنيفُ: الوثائقُ محايدةٌ، والذاكرةُ ذاكرةٌ، والأصلُ تنفيذيٌّ', () => {
  assert.equal(classifyPath('docs/THREAT_MODEL.md', manifest), 'neutral');
  assert.equal(classifyPath('docs/external-review/skip-baseline.json', manifest), 'neutral');
  assert.equal(classifyPath('docs/roadmap/05-work-log.md', manifest), 'memory');
  assert.equal(classifyPath('docs/adr/0007-x.md', manifest), 'memory');
  assert.equal(classifyPath('config/external-review.yaml', manifest), 'memory');
  assert.equal(classifyPath('src/x.mjs', manifest), 'executive');
  assert.equal(classifyPath('.github/workflows/ci.yml', manifest), 'executive');
  assert.equal(
    classifyPath('a-new-dir/tool.py', manifest),
    'executive',
    'مجلّدٌ جديدٌ تنفيذيٌّ بلا تعديلِ العقد.',
  );
});

test('C — وطلبُ نشرِ أثرِ القياسِ (‏ملفّاتُ docs/external-review المولَّدةُ) يمرُّ بلا مُدخلة', () => {
  const r = evaluateProjectState({
    manifest,
    changed: [
      { status: 'M', path: 'docs/external-review/skip-baseline.json' },
      { status: 'M', path: 'docs/external-review/M11.05-round-1-plan.md' },
    ],
    headExists: () => true,
    baseWorkLog: WL1,
    headWorkLog: WL1,
    headDebtRegister: DEBT,
  });
  assert.equal(r.triggered, false);
  assert.deepEqual(r.violations, []);
});

test('D — العملُ تمَّ وصفُّ الدَّينِ ما زالَ يصفُ ما قبلَه يُرفَضُ (‏PS7)', () => {
  const root = fixture();
  write(root, 'src/app.mjs', 'export const v = 2;\n');
  addEntry(root, {
    title: '`LIVE-1`: الإصلاحُ منفَّذ',
    files: ['src/app.mjs', 'PROJECT_STATUS.md'],
  });
  regenerateHandoff(root);
  commit(root, 'fix without debt row');
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS7\/DEBT-ROW-STALE/u);
  assert.match(r.out, /`LIVE-1`/u);

  // والإصلاحُ في الحزمةِ نفسِها: الصفُّ يذكرُ المُدخلةَ ويُسمّى في «الملفات المتأثرة».
  const debt = readFileSync(path.join(root, 'docs/roadmap/06-debt-register.md'), 'utf8');
  write(
    root,
    'docs/roadmap/06-debt-register.md',
    debt.replace(
      '| يُغلَقُ بالإصلاح |',
      '| يُغلَقُ بالإصلاح — **منفَّذٌ في `WL-002`، الإغلاقُ بعدَ المراجعة** |',
    ),
  );
  const log = readFileSync(path.join(root, 'docs/roadmap/05-work-log.md'), 'utf8');
  write(
    root,
    'docs/roadmap/05-work-log.md',
    log.replace(
      '`src/app.mjs` · `PROJECT_STATUS.md`',
      '`src/app.mjs` · `PROJECT_STATUS.md` · `docs/roadmap/06-debt-register.md`',
    ),
  );
  regenerateHandoff(root);
  commit(root, 'debt row');
  const ok = runGuard(root);
  assert.equal(ok.status, 0, ok.out);
});

test('D — وثيقةٌ تصفُ ما تغيَّرَ ولم تُحدَّثْ تُرفَضُ، والإعلانُ الصريحُ بسببٍ يقبلُها (‏PS8)', () => {
  const root = fixture();
  write(root, 'src/production/entry.mjs', 'export const p = 2;\n');
  addEntry(root, { files: ['src/production/entry.mjs', 'PROJECT_STATUS.md'] });
  regenerateHandoff(root);
  commit(root, 'production change');
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS8\/AFFECTED-DOC-STALE/u);
  assert.match(r.out, /docs\/CURRENT_STATE\.md/u);

  const log = readFileSync(path.join(root, 'docs/roadmap/05-work-log.md'), 'utf8');
  write(
    root,
    'docs/roadmap/05-work-log.md',
    log.replace(
      '- تعديلٌ.\n',
      '- تعديلٌ.\n- غيرُ متأثِّرٍ: `docs/CURRENT_STATE.md` — ثابتٌ داخليٌّ لا يغيّرُ المسارَ الإنتاجيَّ الموصوف.\n',
    ),
  );
  regenerateHandoff(root);
  commit(root, 'declare unaffected');
  const ok = runGuard(root);
  assert.equal(ok.status, 0, ok.out);
});

test('E — مُدخلةٌ تدّعي تنفيذَ ملفٍّ لا أثرَ له في الفرقِ تُرفَضُ (‏PS5)', () => {
  const root = fixture();
  write(root, 'src/app.mjs', 'export const v = 2;\n');
  addEntry(root, {
    files: ['src/app.mjs', 'src/feature.mjs', 'tests/feature.test.mjs', 'PROJECT_STATUS.md'],
  });
  regenerateHandoff(root);
  commit(root, 'claims more than done');
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS5\/PHANTOM-CLAIM: .*`src\/feature\.mjs`/u);
  assert.match(r.out, /PS5\/PHANTOM-CLAIM: .*`tests\/feature\.test\.mjs`/u);
});

test('E — ومُدخلةٌ تُغفِلُ ملفّاً تغيَّرَ تُرفَضُ (‏PS4)، وبلا قسمِ «الملفات المتأثرة» (‏PS6)', () => {
  const root = fixture();
  write(root, 'src/app.mjs', 'export const v = 2;\n');
  write(root, 'src/other.mjs', 'export const o = 1;\n');
  addEntry(root, { files: ['src/app.mjs', 'PROJECT_STATUS.md'] });
  regenerateHandoff(root);
  commit(root, 'omits a file');
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS4\/UNRECORDED-FILE: `src\/other\.mjs`/u);

  const v = evaluateProjectState({
    manifest,
    changed: [
      { status: 'M', path: 'src/app.mjs' },
      { status: 'M', path: 'PROJECT_STATUS.md' },
    ],
    headExists: () => true,
    baseWorkLog: WL1,
    headWorkLog: `### [2026-10-02] — WL-002 — بلا قسم\n\nنصٌّ.\n\n${WL1}`,
    headDebtRegister: DEBT,
  });
  assert.ok(v.violations.some((x) => x.code === 'PS6/NO-AFFECTED-SECTION'));
});

test('ملخّصُ التسليمِ: تعديلُه بيدٍ أو نسيانُ توليدِه يُرفَضُ (‏PS9)', () => {
  const root = fixture();
  write(root, 'src/app.mjs', 'export const v = 2;\n');
  addEntry(root, { files: ['src/app.mjs', 'PROJECT_STATUS.md'] });
  commit(root, 'forgot handoff');
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS9\/HANDOFF-STALE/u);
  regenerateHandoff(root);
  const handoff = readFileSync(path.join(root, 'docs/HANDOFF.md'), 'utf8');
  assert.match(handoff, /آخرُ مُدخلةٍ:\*\* `WL-002`/u);
  assert.match(handoff, /`LIVE-1`/u);
  assert.match(handoff, /مفتوحةٌ \*\*1\*\* من \*\*2\*\*/u);
});

test('العجزُ عن القياسِ رفضٌ لا مرورٌ (‏خروجٌ 2)', () => {
  const root = fixture();
  const r = runGuard(root, 'no-such-ref');
  assert.equal(r.status, 2, r.out);
});

test('ملفُّ ذاكرةٍ مُعلَنٌ غائبٌ يُرفَضُ (‏PS1)', () => {
  const root = fixture();
  rmSync(path.join(root, 'AGENTS.md'));
  addEntry(root, { files: ['AGENTS.md', 'PROJECT_STATUS.md'] });
  regenerateHandoff(root);
  commit(root, 'delete entry point');
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS1\/MISSING: .*AGENTS\.md/u);
});

test('المساراتُ المُعلَنةُ: بادئاتٌ وأنماطٌ وملفّات — ولا يُعَدُّ معرِّفٌ أو أمرٌ مساراً', () => {
  assert.deepEqual(
    declaredPaths(
      '`src/a.mjs` · `tests/` · `tests/helpers/wl-*.mjs` · `WL-002` · `npm run x` · `LIVE-1` · `v0.65.0`',
    ),
    ['src/a.mjs', 'tests/', 'tests/helpers/wl-*.mjs'],
  );
});

test('المستودعُ نفسُه: العقدُ يُقرأ، ونقطةُ الدخولِ وملخّصُ التسليمِ موجودان، والخطّافُ يُشغِّلُ الحاجز', () => {
  assert.equal(manifest.entryPoint, 'AGENTS.md');
  const agents = readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8');
  assert.match(agents, /npm run guard:project-state/u);
  assert.match(agents, /docs\/HANDOFF\.md/u);
  const hook = readFileSync(path.join(REPO, 'scripts', 'hooks', 'pre-push'), 'utf8');
  assert.match(hook, /npm run --silent guard:project-state/u);
  const pkg = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['guard:project-state'], 'node scripts/guard-project-state.mjs');
  assert.equal(pkg.scripts.prepare, 'node scripts/install-hooks.mjs');
});

test('القسمُ يُقرأُ من ترويستِه لا من ذكرِه في نصِّ بندٍ (‏انكشفَ بتطبيقِ الحاجزِ على مُدخلتِه نفسِها)', () => {
  const body = [
    '#### ما تمَّ فعلاً',
    '',
    '- `PS4` ملفٌّ لا تُسمّيه «الملفات المتأثرة» — و`origin/main` أساسٌ.',
    '',
    '#### الملفاتُ المتأثّرة',
    '',
    '`src/a.mjs`',
    '',
    '#### الدليل',
    '',
    '`src/not-a-claim.mjs`',
  ].join('\n');
  assert.deepEqual(declaredPaths(String(affectedFilesSection(body))), ['src/a.mjs']);
  assert.deepEqual(
    declaredPaths(
      String(affectedFilesSection('**الملفات المتأثرة:** `x/y.mjs`\n\n**الدليل:** `z/w.mjs`')),
    ),
    ['x/y.mjs'],
  );
});

// ═══ الاستعادةُ (‏`WL-332`، `DOC-24`) ═══
//
// الحادثةُ: مُدخلةٌ دُمِجَت على `main` (‏`WL-330` في `#254`) ثمّ أسقطَها دمجٌ لاحقٌ (‏`#255`).
// فاستعادتُها حرفيّاً كانت تُرَدُّ بـ`PS5` لأنّ الحاجزَ يراها عملاً جديداً يدّعي ملفّاتٍ لا أثرَ
// لها في الفرق — فكانَ الحاجزُ يدفعُ إلى إعادةِ حذفِها. هنا: الاستعادةُ المُعلَنةُ المُطابِقةُ
// تمرُّ، وكلُّ صورةٍ تجعلُها باباً للتوثيقِ اللاحقِ تُرَدّ.

/**
 * `main`: مُدخلةُ `WL-002` مع كودِها تُدمَجُ (‏A)، ثمّ تسقطُ في دمجٍ لاحقٍ (‏B). يعيدُ جذرَ
 * المستودعِ على فرعِ `work` من B، وكوميتَ A، ونصَّ المُدخلةِ كما دُمِجَت.
 *
 * @returns {{ root: string, mergedSha: string, lost: string }}
 */
function lostEntryFixture() {
  const root = fixture();
  git(root, ['checkout', '-q', 'main']);
  write(root, 'src/app.mjs', 'export const v = 2;\n');
  addEntry(root, {
    id: 'WL-002',
    title: 'عملٌ دُمِجَ',
    files: ['src/app.mjs', 'PROJECT_STATUS.md'],
  });
  regenerateHandoff(root);
  commit(root, 'PR A: WL-002');
  const mergedSha = git(root, ['rev-parse', 'HEAD']).trim();
  const log = readFileSync(path.join(root, 'docs/roadmap/05-work-log.md'), 'utf8');
  const lost = entryText(parseWorkLog(log).find((e) => e.id === 'WL-002') ?? assert.fail('WL-002'));
  write(root, 'docs/roadmap/05-work-log.md', log.replace(lost, ''));
  regenerateHandoff(root);
  commit(root, 'PR B: rewrites the log and drops WL-002');
  git(root, ['checkout', '-qB', 'work']);
  return { root, mergedSha, lost };
}

/**
 * @param {string} root
 * @param {string} text
 */
function reinsert(root, text) {
  const rel = 'docs/roadmap/05-work-log.md';
  const log = readFileSync(path.join(root, rel), 'utf8');
  write(root, rel, log.replace('### [2026-10-01]', `${text}### [2026-10-01]`));
}

/**
 * @param {string} root
 * @param {Record<string, string>} decl
 */
function declareRestore(root, decl) {
  const lines = Object.entries(decl).map(([k, v]) => `    ${k}: ${v}`);
  lines[0] = `  - ${String(lines[0]).trimStart()}`;
  write(root, 'config/work-log-ids.yaml', `restored_entries:\n${lines.join('\n')}\n`);
}

test('استعادة — مُدخلةٌ دُمِجَت ثمّ سقطَت تُستعادُ حرفيّاً بإعلانٍ ومُدخلةٍ مالكةٍ فتمرّ', () => {
  const { root, mergedSha, lost } = lostEntryFixture();
  addEntry(root, {
    id: 'WL-003',
    title: 'استعادةُ WL-002',
    files: ['config/work-log-ids.yaml', 'PROJECT_STATUS.md'],
  });
  reinsert(root, lost);
  declareRestore(root, { id: 'WL-002', from: mergedSha, by: 'WL-003', reason: 'سقطَت في PR B' });
  regenerateHandoff(root);
  commit(root, 'restore');
  const r = runGuard(root);
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /PS5|PS10/u);
  assert.match(r.out, /مُدخلاتٌ جديدةٌ: WL-003 /u, 'المُستعادةُ ليست عملاً جديداً.');
});

test('استعادة — بلا إعلانٍ تُحاكَمُ عملاً جديداً فتُرَدُّ بادّعاءِ ملفّاتٍ لا أثرَ لها (‏PS5)', () => {
  const { root, lost } = lostEntryFixture();
  addEntry(root, { id: 'WL-003', title: 'استعادة', files: ['PROJECT_STATUS.md'] });
  reinsert(root, lost);
  regenerateHandoff(root);
  commit(root, 'restore undeclared');
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS5\/PHANTOM-CLAIM: .*src\/app\.mjs/u);
});

test('استعادة — نصٌّ مُعدَّلٌ ولو بحرفٍ يُرَدُّ (‏PS10/RESTORE-ALTERED): الاستعادةُ نسخٌ لا إعادةُ كتابة', () => {
  const { root, mergedSha, lost } = lostEntryFixture();
  addEntry(root, {
    id: 'WL-003',
    title: 'استعادة',
    files: ['config/work-log-ids.yaml', 'PROJECT_STATUS.md'],
  });
  reinsert(root, lost.replace('تعديلٌ.', 'تعديلٌ مُحسَّنٌ.'));
  declareRestore(root, { id: 'WL-002', from: mergedSha, by: 'WL-003', reason: 'سقطَت' });
  regenerateHandoff(root);
  commit(root, 'restore altered');
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS10\/RESTORE-ALTERED/u);
});

test('استعادة — من كوميتٍ ليس سلفاً للأساسِ تُرَدُّ (‏PS10/RESTORE-NOT-HISTORY): لا توثيقَ لاحقاً متنكِّراً', () => {
  const root = fixture();
  // فرعٌ جانبيٌّ لم يُدمَج كتبَ مُدخلةً لكودٍ دُمِجَ على main وحدَه — ثمّ يُدّعى أنّها «مُستعادة».
  git(root, ['checkout', '-q', 'main']);
  write(root, 'src/app.mjs', 'export const v = 2;\n');
  commit(root, 'code only on main');
  git(root, ['checkout', '-qb', 'side']);
  addEntry(root, {
    id: 'WL-002',
    title: 'توثيقٌ لاحق',
    files: ['src/app.mjs', 'PROJECT_STATUS.md'],
  });
  commit(root, 'side entry');
  const sideSha = git(root, ['rev-parse', 'HEAD']).trim();
  git(root, ['checkout', '-q', 'main']);
  git(root, ['checkout', '-qB', 'work']);
  const sideLog = git(root, ['show', `${sideSha}:docs/roadmap/05-work-log.md`]);
  const text = entryText(parseWorkLog(sideLog).find((e) => e.id === 'WL-002') ?? assert.fail());
  addEntry(root, {
    id: 'WL-003',
    title: 'ادّعاءُ استعادة',
    files: ['config/work-log-ids.yaml', 'PROJECT_STATUS.md'],
  });
  reinsert(root, text);
  declareRestore(root, { id: 'WL-002', from: sideSha, by: 'WL-003', reason: 'ادّعاء' });
  regenerateHandoff(root);
  commit(root, 'disguised late docs');
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS10\/RESTORE-NOT-HISTORY/u);
});

test('استعادة — إعلانٌ بلا مُدخلةٍ مالكةٍ جديدةٍ يُرَدُّ (‏PS10/RESTORE-UNOWNED)', () => {
  const { root, mergedSha, lost } = lostEntryFixture();
  reinsert(root, lost);
  declareRestore(root, { id: 'WL-002', from: mergedSha, by: 'WL-001', reason: 'سقطَت' });
  const status = readFileSync(path.join(root, 'PROJECT_STATUS.md'), 'utf8');
  write(root, 'PROJECT_STATUS.md', `آخر تحديث: **2026-10-03** — استعادة.\n${status}`);
  regenerateHandoff(root);
  commit(root, 'restore without owner entry');
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS10\/RESTORE-UNOWNED/u);
});
