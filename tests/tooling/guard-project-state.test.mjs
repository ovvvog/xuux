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
  parseDebtRows,
  renderHandoff,
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

// ═══ عدمُ فقدانِ التاريخِ (‏`WL-334`، `DOC-24`) — الحادثةُ الحقيقيّةُ أوّلاً ═══
//
// `#254` أدخلَ `WL-330`، وفرعُ `#255` بُنِيَ من حالةٍ أقدمَ وحجزَ `WL-330` فجوةً، ثمّ أُعيدَ
// تأسيسُه بحلِّ التعارضِ لصالحِه فسقطَت `WL-330` وسطرُ لوحتِها **وبقيَت الحواجزُ خضراءَ**.
// المُدخلاتُ وسطورُ اللوحةِ واستثناءُ الفجوةِ منسوخةٌ بايتاً ببايتٍ من الكوميتاتِ الحقيقيّة.

const INCIDENT = path.join(REPO, 'tests', 'fixtures', 'project-memory', 'incident-255');
/** @param {string} name */
const incident = (name) => readFileSync(path.join(INCIDENT, name), 'utf8');
const LOG = 'docs/roadmap/05-work-log.md';

/**
 * يُدرِجُ مُدخلةً في أعلى السجلِّ وسطرَها في أعلى اللوحة — كما يفعلُ كلُّ عملٍ.
 *
 * @param {string} root
 * @param {string} entry
 * @param {string} statusLine
 */
function recordOnTop(root, entry, statusLine) {
  const log = readFileSync(path.join(root, LOG), 'utf8');
  write(root, LOG, log.replace('### [', `${entry}### [`));
  const status = readFileSync(path.join(root, 'PROJECT_STATUS.md'), 'utf8');
  write(root, 'PROJECT_STATUS.md', `${statusLine}\n${status}`);
}

/**
 * أثرُ `#255` في الشجرةِ: الملفّاتُ التي تُسمّيها مُدخلتُه الحقيقيّةُ تتغيّرُ، واستثناءُ الفجوةِ.
 *
 * @param {string} root
 */
function applyPr255Work(root) {
  for (const rel of [
    'src/root-of-trust/clock.mts',
    'src/root-of-trust/production-runtime.mts',
    'src/production/entrypoint.mjs',
    'tests/root-of-trust/wl-331-clock-state.test.mjs',
    'docs/ROOT_OF_TRUST.md',
    'docs/audit/work-log-id-map.md',
  ]) {
    write(root, rel, `// ${rel} — LIVE-37\n`);
  }
  const debt = readFileSync(path.join(root, 'docs/roadmap/06-debt-register.md'), 'utf8');
  write(root, 'docs/roadmap/06-debt-register.md', `${debt}<!-- WL-331 -->\n`);
  write(root, 'config/work-log-ids.yaml', incident('wl-330.gap.yaml.txt'));
  recordOnTop(root, incident('wl-331.entry.txt'), incident('wl-331.status.txt').trimEnd());
}

/**
 * `main` بعدَ `#254`، وفرعُ `pr-255` مبنيٌّ من الأساسِ الأقدم.
 *
 * @returns {string}
 */
function incidentRepo() {
  const root = fixture();
  git(root, ['checkout', '-q', 'main']);
  git(root, ['checkout', '-qb', 'pr-255']);
  applyPr255Work(root);
  regenerateHandoff(root);
  commit(root, 'WL-331 on the older base');
  git(root, ['checkout', '-q', 'main']);
  recordOnTop(root, incident('wl-330.entry.txt'), incident('wl-330.status.txt').trimEnd());
  regenerateHandoff(root);
  commit(root, 'PR #254: WL-330');
  return root;
}

test('الحادثةُ #255 — إعادةُ تأسيسٍ بحلِّ التعارضِ لصالحِ الفرعِ تُسقِطُ WL-330 فيُرَدُّ الطلب (‏PS11) رغمَ استثناءِ الفجوة', () => {
  const root = incidentRepo();
  git(root, ['checkout', '-q', 'pr-255']);
  git(root, ['rebase', '-q', '-X', 'theirs', 'main']);
  regenerateHandoff(root);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'regenerate handoff after rebase']);
  const log = readFileSync(path.join(root, LOG), 'utf8');
  assert.doesNotMatch(log, /— WL-330 —/u, 'شرطُ الاستنساخ: العمليّةُ نفسُها أسقطَت المُدخلة.');
  assert.match(log, /— WL-331 —/u);
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS11\/HISTORY-LOST: مُدخلةُ `WL-330`/u);
  assert.match(r.out, /PS11\/STATUS-HISTORY-LOST: سطرُ «آخر تحديث» لـ`WL-330`/u);
  assert.doesNotMatch(
    r.out,
    /PS(4|5|6|7|8|9)\//u,
    'السقوطُ وحدَه سببُ الردّ — سائرُ الحزمةِ متّسق.',
  );
});

test('الحادثةُ #255 — الطلبُ نفسُه بحلٍّ يُبقي WL-330 وسطرَها يمرّ', () => {
  const root = incidentRepo();
  git(root, ['checkout', '-qb', 'pr-255-kept', 'main']);
  applyPr255Work(root);
  // الحلُّ الصحيحُ: الفجوةُ لم يبقَ لها محلٌّ (‏صارَ لـ`WL-330` عنوانٌ) فلا تُنسَخ.
  write(root, 'config/work-log-ids.yaml', 'allowed_gaps: []\n');
  regenerateHandoff(root);
  commit(root, 'WL-331 rebased with WL-330 kept');
  const r = runGuard(root);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /كلُّ مُدخلةٍ وسطرِ لوحةٍ على الأساسِ باقٍ في المرشَّح/u);
  assert.match(r.out, /مُدخلاتٌ جديدةٌ: WL-331 /u);
});

test('التاريخ — إعادةُ كتابةِ مُدخلةٍ قديمةٍ تُرَدُّ (‏PS12)، وتغيُّرُ ذيلِها وحدَه حينَ تُضافُ جارتُها لا يُرَدّ', () => {
  const root = fixture();
  addEntry(root, { files: ['src/app.mjs', 'PROJECT_STATUS.md'] });
  write(root, 'src/app.mjs', 'export const v = 2;\n');
  const log = readFileSync(path.join(root, LOG), 'utf8');
  // ذيلُ WL-001 (‏الفاصلُ) يتغيّرُ — ليس تعديلاً.
  write(root, LOG, log.replace(/\n---\n$/u, '\n'));
  regenerateHandoff(root);
  commit(root, 'tail only');
  assert.equal(runGuard(root).status, 0);
  const now = readFileSync(path.join(root, LOG), 'utf8');
  write(root, LOG, now.replace('— البداية', '— البدايةُ المُصحَّحة'));
  regenerateHandoff(root);
  commit(root, 'rewrite WL-001 title');
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS12\/HISTORY-REWRITTEN: مُدخلةُ `WL-001`/u);
});

test('التاريخ — حذفٌ مقصودٌ يمرُّ بإعلانٍ جديدٍ تملكُه مُدخلةٌ جديدة؛ وبلا مالكٍ يُرَدُّ (‏PS13)', () => {
  const root = fixture();
  addEntry(root, {
    id: 'WL-002',
    title: 'حذفُ WL-001 مقصوداً',
    files: ['config/work-log-ids.yaml', 'PROJECT_STATUS.md'],
  });
  const log = readFileSync(path.join(root, LOG), 'utf8');
  write(root, LOG, log.replace(/### \[2026-10-01\][\s\S]*$/u, ''));
  const decl = (/** @type {string} */ by) =>
    `history_amendments:\n  - id: WL-001\n    action: remove\n    by: ${by}\n    reason: مُدخلةٌ مكرَّرةٌ مقيسة\n`;
  write(root, 'config/work-log-ids.yaml', decl('WL-001'));
  regenerateHandoff(root);
  commit(root, 'remove with unowned declaration');
  const bad = runGuard(root);
  assert.equal(bad.status, 1, bad.out);
  assert.match(bad.out, /PS13\/AMENDMENT-UNOWNED/u);
  assert.match(bad.out, /PS11\/HISTORY-LOST: مُدخلةُ `WL-001`/u);
  write(root, 'config/work-log-ids.yaml', decl('WL-002'));
  regenerateHandoff(root);
  commit(root, 'owned declaration');
  const ok = runGuard(root);
  assert.equal(ok.status, 0, ok.out);
  assert.match(ok.out, /تعديلٌ مُعلَنٌ: WL-001/u);
});

test('التاريخ — إعلانٌ قديمٌ على الأساسِ لا يُعفي حذفاً جديداً', () => {
  const root = fixture();
  git(root, ['checkout', '-q', 'main']);
  addEntry(root, { id: 'WL-002', title: 'عمل', files: ['src/app.mjs', 'PROJECT_STATUS.md'] });
  write(root, 'src/app.mjs', 'export const v = 2;\n');
  write(
    root,
    'config/work-log-ids.yaml',
    'history_amendments:\n  - id: WL-001\n    action: remove\n    by: WL-002\n    reason: إعلانٌ قديم\n',
  );
  regenerateHandoff(root);
  commit(root, 'old declaration on main');
  git(root, ['checkout', '-qB', 'work']);
  const log = readFileSync(path.join(root, LOG), 'utf8');
  write(root, LOG, log.replace(/### \[2026-10-01\][\s\S]*$/u, ''));
  regenerateHandoff(root);
  commit(root, 'silent removal under an old declaration');
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS11\/HISTORY-LOST: مُدخلةُ `WL-001`/u);
});

// ═══ `DOC-25` (‏`WL-335`) — فقودٌ حقيقيّةٌ على `main` تُكتشَفُ ثمّ تُستعادُ حرفيّاً ═══
//
// لكلِّ حادثةٍ: النصُّ الأصلُ والنصُّ التالفُ منسوخانِ بايتاً ببايتٍ من الكوميتَين الحقيقيَّين
// (‏`tests/fixtures/project-memory/doc-25/README.md`). يُقيَّدُ الأصلُ على `main`، ثمّ يُطبَّقُ التلفُ
// كما وقع، فيُشترَطُ أن يُرَدّ؛ ثمّ تُستعادُ النسخةُ الأصلُ بإعلانٍ ومُدخلةٍ مالكةٍ فتمرّ.

const DOC25 = path.join(REPO, 'tests', 'fixtures', 'project-memory', 'doc-25');
/** @param {string} name */
const doc25 = (name) => readFileSync(path.join(DOC25, name), 'utf8');
const DOC25_IDS = ['wl-283', 'wl-282', 'wl-222', 'wl-115'];

/**
 * @param {string} root
 * @param {'original' | 'damaged'} from
 * @param {'original' | 'damaged'} to
 * @param {string[]} [ids]
 */
function swapEntries(root, from, to, ids = DOC25_IDS) {
  let log = readFileSync(path.join(root, LOG), 'utf8');
  for (const id of ids) {
    const was = doc25(`${id}.${from}.txt`);
    assert.ok(log.includes(was), `شرطُ الاستنساخ: نصُّ ${id} (${from}) في السجلّ`);
    log = log.replace(was, doc25(`${id}.${to}.txt`));
  }
  write(root, LOG, log);
}

/**
 * `main`: الأصولُ مُقيَّدةٌ (‏كوميتُ `src`) ثمّ التلفُ كما وقعَ على `main` (‏كوميتُ `damage`).
 *
 * @returns {{ root: string, src: string }}
 */
function doc25Repo() {
  const root = fixture();
  git(root, ['checkout', '-q', 'main']);
  const log = readFileSync(path.join(root, LOG), 'utf8');
  const originals = DOC25_IDS.map((id) => `${doc25(`${id}.original.txt`)}\n---\n\n`).join('');
  write(root, LOG, log.replace('### [2026-10-01]', `${originals}### [2026-10-01]`));
  const status = readFileSync(path.join(root, 'PROJECT_STATUS.md'), 'utf8');
  write(root, 'PROJECT_STATUS.md', `${doc25('wl-291.status.txt')}${status}`);
  regenerateHandoff(root);
  commit(root, 'history as merged');
  const src = git(root, ['rev-parse', 'HEAD']).trim();
  return { root, src };
}

/**
 * يُطبِّقُ التلفَ الحقيقيَّ: المتونُ التالفةُ، وسطرُ `WL-292` مكانَ سطرِ `WL-291` (‏`d6e591b4`).
 *
 * @param {string} root
 */
function applyDoc25Damage(root) {
  swapEntries(root, 'original', 'damaged');
  const status = readFileSync(path.join(root, 'PROJECT_STATUS.md'), 'utf8');
  write(
    root,
    'PROJECT_STATUS.md',
    status.replace(doc25('wl-291.status.txt'), doc25('wl-292.status.txt')),
  );
  // سطرُ `WL-292` جديدٌ فمصدرُه مُدخلتُه — كما في الكوميتِ الحقيقيّ.
  const log = readFileSync(path.join(root, LOG), 'utf8');
  write(
    root,
    LOG,
    `${log.replace('### [', '### [2026-10-01] — WL-292 — جولةُ مجلس\n\n- **الملفات المتأثرة:** `PROJECT_STATUS.md`\n\n---\n\n### [')}`,
  );
}

/**
 * @param {string} root
 * @param {string} src
 * @param {{ entries?: string[], status?: boolean, by?: string }} [opts]
 */
function declareDoc25(root, src, opts = {}) {
  const by = opts.by ?? 'WL-335';
  const entries = (opts.entries ?? DOC25_IDS).map(
    (id) => `  - id: ${id.toUpperCase()}\n    from: ${src}\n    by: ${by}\n    reason: DOC-25\n`,
  );
  const status =
    opts.status === false
      ? ''
      : `restored_status_lines:\n  - id: WL-291\n    from: ${src}\n    by: ${by}\n    reason: DOC-25\n`;
  write(root, 'config/work-log-ids.yaml', `restored_entries:\n${entries.join('')}${status}`);
}

/** @param {string} root */
function restoreStatusLine(root) {
  const status = readFileSync(path.join(root, 'PROJECT_STATUS.md'), 'utf8');
  write(
    root,
    'PROJECT_STATUS.md',
    status.replace(
      doc25('wl-292.status.txt'),
      `${doc25('wl-292.status.txt')}${doc25('wl-291.status.txt')}`,
    ),
  );
}

/**
 * `main` تالفٌ (‏كما هو اليومَ) وفرعُ `work` منه.
 *
 * @returns {{ root: string, src: string }}
 */
function damagedMain() {
  const { root, src } = doc25Repo();
  applyDoc25Damage(root);
  regenerateHandoff(root);
  commit(root, 'damage as it happened');
  git(root, ['checkout', '-qB', 'work']);
  return { root, src };
}

test('DOC-25 — التلفُ الحقيقيُّ يُكتشَفُ قبلَ الاستعادةِ: بترُ WL-282/WL-283 وتعديلُ WL-222 وWL-115 (‏عنوانٌ قديم) وسقوطُ سطرِ WL-291', () => {
  const { root, src } = doc25Repo();
  git(root, ['checkout', '-qb', 'damage']);
  applyDoc25Damage(root);
  regenerateHandoff(root);
  commit(root, 'damage');
  const r = runGuard(root, src);
  assert.equal(r.status, 1, r.out);
  for (const id of ['WL-283', 'WL-282', 'WL-222', 'WL-115']) {
    assert.match(r.out, new RegExp(`PS12/HISTORY-REWRITTEN: مُدخلةُ \`${id}\``, 'u'));
  }
  // النسبةُ صحيحةٌ: تعديلُ `WL-115` لا يُنسَبُ إلى مُدخلةٍ قبلَها (‏`DOC-27`).
  assert.doesNotMatch(r.out, /PS12\/HISTORY-REWRITTEN: مُدخلةُ `WL-001`/u);
  assert.match(r.out, /PS11\/STATUS-HISTORY-LOST: سطرُ «آخر تحديث» لـ`WL-291`/u);
});

test('DOC-25 — الاستعادةُ الحرفيّةُ بإعلانٍ ومُدخلةٍ مالكةٍ تمرّ، والمُستعادُ ليس عملاً جديداً', () => {
  const { root, src } = damagedMain();
  swapEntries(root, 'damaged', 'original');
  restoreStatusLine(root);
  addEntry(root, {
    id: 'WL-335',
    title: 'DOC-25',
    files: ['config/work-log-ids.yaml', 'PROJECT_STATUS.md'],
  });
  declareDoc25(root, src);
  regenerateHandoff(root);
  commit(root, 'restore');
  const r = runGuard(root);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /مُستعادٌ: WL-283 WL-282 WL-222 WL-115 \+ 1 سطرَ لوحة/u);
  assert.match(r.out, /مُدخلاتٌ جديدةٌ: WL-335 /u);
  assert.doesNotMatch(r.out, /PS4|PS5|PS10|PS11|PS12/u);
});

test('DOC-25 — بلا إعلانٍ تُرَدُّ الاستعادةُ نفسُها (‏PS12)، وسطرُ اللوحةِ بلا مصدرٍ يُرَدُّ (‏PS10/STATUS-UNSOURCED)', () => {
  const { root } = damagedMain();
  swapEntries(root, 'damaged', 'original');
  restoreStatusLine(root);
  addEntry(root, { id: 'WL-335', title: 'DOC-25', files: ['PROJECT_STATUS.md'] });
  regenerateHandoff(root);
  commit(root, 'restore undeclared');
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS12\/HISTORY-REWRITTEN: مُدخلةُ `WL-283`/u);
  assert.match(r.out, /PS10\/STATUS-UNSOURCED: سطرُ «آخر تحديث» لـ`WL-291`/u);
});

test('DOC-25 — «استعادةُ» نصٍّ جديدٍ ليس في التاريخِ تُرَدُّ (‏PS10/RESTORE-ALTERED): مُدخلةٌ بجملةٍ زائدةٍ، وسطرُ لوحةٍ مُختلَق', () => {
  const { root, src } = damagedMain();
  swapEntries(root, 'damaged', 'original');
  const log = readFileSync(path.join(root, LOG), 'utf8');
  const original = doc25('wl-283.original.txt');
  write(
    root,
    LOG,
    log.replace(original, original.replace(/\n$/u, '\n- **أُضيفَ لاحقاً:** دليلٌ لم يُقيَّد.\n')),
  );
  const status = readFileSync(path.join(root, 'PROJECT_STATUS.md'), 'utf8');
  write(
    root,
    'PROJECT_STATUS.md',
    status.replace(
      doc25('wl-292.status.txt'),
      `${doc25('wl-292.status.txt')}${doc25('wl-291.status.txt').replace('**2026-10-01**', '**2026-10-02**')}`,
    ),
  );
  addEntry(root, {
    id: 'WL-335',
    title: 'DOC-25',
    files: ['config/work-log-ids.yaml', 'PROJECT_STATUS.md'],
  });
  declareDoc25(root, src);
  regenerateHandoff(root);
  commit(root, 'restore with invented text');
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS10\/RESTORE-ALTERED: `WL-283`/u);
  assert.match(r.out, /PS12\/HISTORY-REWRITTEN: مُدخلةُ `WL-283`/u, 'لا إعفاءَ لنصٍّ لم يُتحقَّق.');
  assert.match(r.out, /PS10\/RESTORE-ALTERED: سطرُ «آخر تحديث» المُستعادُ لـ`WL-291`/u);
  assert.match(r.out, /PS10\/STATUS-UNSOURCED: سطرُ «آخر تحديث» لـ`WL-291`/u);
  assert.doesNotMatch(r.out, /`WL-282`|`WL-222`|`WL-115`/u, 'الاستعاداتُ الصحيحةُ لا تُرَدّ.');
});

test('DOC-25 — والإعلانُ نفسُه لا يصيرُ إعفاءً عامّاً: بلا مُدخلةٍ مالكةٍ يُرَدُّ، ولا يُعفي من PS4/PS5', () => {
  const { root, src } = damagedMain();
  swapEntries(root, 'damaged', 'original');
  restoreStatusLine(root);
  write(root, 'src/app.mjs', 'export const v = 9;\n');
  addEntry(root, {
    id: 'WL-335',
    title: 'DOC-25',
    files: ['config/work-log-ids.yaml', 'PROJECT_STATUS.md'],
  });
  declareDoc25(root, src, { by: 'WL-001' });
  regenerateHandoff(root);
  commit(root, 'unowned restore + undeclared code change');
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS10\/RESTORE-UNOWNED: استعادةُ WL-283/u);
  assert.match(r.out, /PS10\/RESTORE-UNOWNED: استعادةُ سطر WL-291/u);
  assert.match(r.out, /PS12\/HISTORY-REWRITTEN: مُدخلةُ `WL-283`/u);
  assert.match(
    r.out,
    /PS4\/[A-Z-]+: .*src\/app\.mjs/u,
    'كودٌ لم تُسمِّه المُدخلةُ يُرَدُّ رغمَ الاستعادة.',
  );
});

test('DOC-25 — حذفٌ جديدٌ متخفٍّ خلفَ allowed_gaps لا يمرّ (‏PS11) ولو أُعلِنَ معرِّفُه فجوةً', () => {
  const { root } = damagedMain();
  const log = readFileSync(path.join(root, LOG), 'utf8');
  write(root, LOG, log.replace(`${doc25('wl-283.damaged.txt')}\n---\n\n`, ''));
  assert.doesNotMatch(readFileSync(path.join(root, LOG), 'utf8'), /— WL-283 —/u, 'شرطُ الاستنساخ');
  write(
    root,
    'config/work-log-ids.yaml',
    'allowed_gaps:\n  - id: WL-283\n    reason: >-\n      محجوزٌ لطلبٍ مفتوح\n',
  );
  addEntry(root, {
    id: 'WL-335',
    title: 'عمل',
    files: ['config/work-log-ids.yaml', 'PROJECT_STATUS.md'],
  });
  regenerateHandoff(root);
  commit(root, 'drop WL-283 behind a gap');
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS11\/HISTORY-LOST: مُدخلةُ `WL-283`/u);
});

test('التاريخ — سطرٌ فارغٌ أو فاصلٌ في وسطِ مُدخلةٍ قديمةٍ تغييرٌ (‏DOC-27: البصمةُ تُهمِلُ الذيلَ وحدَه)', () => {
  const root = fixture();
  addEntry(root, { files: ['src/app.mjs', 'PROJECT_STATUS.md'] });
  write(root, 'src/app.mjs', 'export const v = 2;\n');
  const log = readFileSync(path.join(root, LOG), 'utf8');
  write(
    root,
    LOG,
    log.replace(
      '**المنفِّذُ:** اختبار · **الحالةُ بعدَ العملِ:** ✅\n\n#### الملفات المتأثرة',
      '**المنفِّذُ:** اختبار · **الحالةُ بعدَ العملِ:** ✅\n#### الملفات المتأثرة',
    ),
  );
  regenerateHandoff(root);
  commit(root, 'drop a blank line inside WL-001');
  const r = runGuard(root);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /PS12\/HISTORY-REWRITTEN: مُدخلةُ `WL-001`/u);
});

// ── `DOC-29` (‏`WL-338`): معرِّفٌ بنقطةٍ، وحالةُ §4.3 من العقدِ في ملخّصِ التسليم ──

const DOC29_TABLE = [
  '### 4.3 نتائجُ المراجعةِ المستقلّة',
  '',
  '| المعرِّفُ | الشدّةُ | المعالجةُ المُقيَّدةُ | الإغلاقُ |',
  '| --- | --- | --- | --- |',
  '| `M11.04-F05` | عالية | مُعالَجةٌ | مجلس |',
  '| ~~`M11.04-F01`~~ 🟢 | عالية | مُعالَجةٌ · مُغلَقةٌ في العقد | مجلس |',
  '| `R4-B-01` | متوسطة | مُعالَجةٌ | مجلس |',
  '',
].join('\n');

test('DOC-29 — parseDebtRows يقرأُ معرِّفاً بنقطةٍ (‏`M11.04-F05`) ولا يُسقِطُه، وكانَ يُسقِطُه', () => {
  const rows = parseDebtRows(DOC29_TABLE);
  const ids = rows.map((r) => r.id);
  assert.deepEqual(ids, ['M11.04-F05', 'M11.04-F01', 'R4-B-01']);
  // المفتوحُ يبقى مفتوحاً: الإصلاحُ يُضيفُ المعرِّفَ ولا يُغيِّرُ حكمَ علامتِه.
  assert.equal(rows.find((r) => r.id === 'M11.04-F05')?.closed, false);
  // المُعلَّمُ بالشطبِ و🟢 مُغلَقٌ ولو كانَ بنقطة.
  assert.equal(rows.find((r) => r.id === 'M11.04-F01')?.closed, true);
  // والنمطُ القديمُ (‏بلا نقطةٍ) كانَ يُسقِطُ الصفَّين — شاهدُ الانحدار.
  const oldPattern = /^(~~)?`([A-Z][A-Z0-9]*(?:[-/][A-Za-z0-9]+)*)`(~~)?/u;
  assert.equal(oldPattern.exec('`M11.04-F05`'), null);
});

test('DOC-29 — المستودعُ نفسُه: كلُّ صفٍّ في §4.3 يحملُ علامةَ إغلاقٍ بقدرِ ما في العقدِ لا أكثر', () => {
  const debt = readFileSync(path.join(REPO, manifest.debtRegister), 'utf8');
  const contract = parse(readFileSync(path.join(REPO, 'config', 'external-review.yaml'), 'utf8'));
  /** @type {Array<{id: string, status: string}>} */
  const findings = contract.findings;
  const rows = parseDebtRows(debt).filter((r) => r.section.startsWith('4.3'));
  assert.equal(rows.length, findings.length, 'كلُّ نتيجةٍ في العقدِ صفٌّ في §4.3 تقرؤُه الدالّة');
  for (const f of findings) {
    const row = rows.find((r) => r.id === f.id);
    assert.ok(row, `«${f.id}» غائبٌ عن قراءةِ §4.3`);
    assert.equal(
      row.closed,
      f.status === 'closed',
      `«${f.id}»: علامةُ الصفِّ تُخالِفُ \`${f.status}\``,
    );
  }
  assert.ok(rows.some((r) => r.id === 'M11.04-F05' && !r.closed));
  assert.ok(rows.some((r) => r.id === 'M11.04-F07' && !r.closed));
});

test('DOC-29 — ملخّصُ التسليمِ: المفتوحتانِ بنقطةٍ تظهرانِ، والمُغلَقُ في العقدِ لا يُعرَضُ بلا علامة، والعددُ المفتوحُ من العقدِ', () => {
  const read = (/** @type {string} */ f) => readFileSync(path.join(REPO, f), 'utf8');
  const contract = parse(read('config/external-review.yaml'));
  const handoff = renderHandoff({
    manifest,
    workLog: read(manifest.workLog),
    status: read(manifest.status),
    debtRegister: read(manifest.debtRegister),
    externalReview: contract,
    version: JSON.parse(read('version.json')),
  });
  assert.equal(handoff, read(manifest.handoff), 'الملخّصُ المُلتزَمُ مولَّدٌ من مصادرِه الحاليّة');
  const section2 = handoff.split('## 2 —')[1]?.split('## 3 —')[0] ?? '';
  const section3 = handoff.split('## 3 —')[1]?.split('## 4 —')[0] ?? '';
  for (const id of ['M11.04-F05', 'M11.04-F07']) {
    assert.ok(section2.includes(`\`${id}\``), `«${id}» مفتوحةٌ ويجبُ أن تظهرَ في §2`);
  }
  /** @type {Array<{id: string, status: string}>} */
  const findings = contract.findings;
  for (const f of findings.filter((x) => x.status === 'closed')) {
    assert.ok(
      !section2.includes(`\`${f.id}\``),
      `«${f.id}» مُغلَقةٌ في العقدِ وتُعرَضُ في §2 بلا علامة`,
    );
  }
  const openCount = findings.filter((x) => x.status !== 'closed').length;
  assert.match(
    section3,
    new RegExp(`مفتوحةٌ \\*\\*${openCount}\\*\\* من \\*\\*${findings.length}\\*\\*`, 'u'),
  );
});
