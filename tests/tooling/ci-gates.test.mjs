// حاجزٌ على الحواجز — أُضيف في `WL-045`.
//
// **العيبُ الذي يُغلقه:** كان في `package.json` تسعةَ عشرَ نصَّ حاجزٍ
// (`guard:*`) مُعلَنةً في `npm run validate`، ولم يكن مسارُ التكامل المستمر
// يُشغِّل منها إلا اثنين: `guard:templates` و`guard:filecount`. فسبعةَ عشرَ
// حاجزاً — التخويلُ والتغليفُ والنسبُ والذاكرةُ والاحتفاظُ والسجلُّ والمعرفةُ
// والدستورُ والتشريعُ والقضاءُ والمؤسساتُ والولاياتُ والاتحادُ والسيادةُ
// والتقاريرُ والرقابةُ وطبقةُ الواجهة — كانت تُقاس على جهاز المطوّر إن شاء، ولا
// تمنع دمجاً واحداً. والبوابةُ التي لا تُشغَّل آلياً ليست بوابةً بل نيّة.
//
// **قرارٌ مقصود:** الدعوى تُقاس على `package.json` لا على قائمةٍ مكتوبةٍ هنا:
// قائمةٌ مثبَّتةٌ في الاختبار تُنسى مع أوّلِ حاجزٍ جديد، فتعود الفجوةُ نفسُها
// صامتة. فكلُّ نصٍّ يبدأ بـ`guard:` يجب أن يظهر في `ci.yml`، وحاجزٌ جديدٌ بلا
// خطوةٍ في المسار يُخفق هذا الاختبارَ يومَ إعلانه لا بعد أشهر.
//
// **حدٌّ معلَن:** الاختبارُ يقرأ `ci.yml` نصّاً ويطابق `npm run guard:x`؛ فهو
// يقيس **وصلَ** الحاجز بالمسار لا صحّةَ ما يفحصه الحاجزُ نفسُه. وذاك مقيسٌ في
// اختبارات كلِّ حاجزٍ على حِدة.
//
// WL-546: دُمِجَ هنا tests/tooling/typecheck-strictness.test.mjs (‏G1: حارسا بوابةِ الجودةِ من النجاحِ الكاذبِ بالإعداد)
// اختبار صرامة فحص الأنواع — يحرس ما أُنجز في M2.00 من الانحدار.
// السبب: الدين النوعي الذي صُفِّر في M2.00 لم ينشأ من كود خاطئ فقط، بل من إعداد
// كان يبدو صارماً وهو لا يفحص شيئاً (`checkJs: false` مع كود كله `.mjs`). تصفير
// الأخطاء بلا حرس على الإعداد يعني أن سطراً واحداً في `tsconfig.json` يستطيع
// إعادة النجاح الكاذب دون أن تسقط أي بوابة. هذا الاختبار يجعل ذلك السطر مكشوفاً.
// التشغيل: node --test tests/tooling/ci-gates.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.cwd();
const workflow = readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

/** @type {Record<string, string>} */
const scripts = pkg.scripts ?? {};
const guardNames = Object.keys(scripts).filter((name) => name.startsWith('guard:'));

test('كل حاجز معلَن في package.json يُشغَّل في التكامل المستمر', () => {
  assert.ok(guardNames.length >= 19, `عدد الحواجز المُعلَنة ${guardNames.length} أقلّ من المتوقّع`);
  const missing = guardNames.filter((name) => !workflow.includes(`npm run ${name}`));
  assert.deepEqual(
    missing,
    [],
    `حواجزُ مُعلَنةٌ غائبةٌ عن ci.yml فلا تمنع دمجاً: ${missing.join(', ')}`,
  );
});

test('كل حاجز يُشغَّل في validate كذلك، فلا يبقى حاجزٌ لا يناديه أحد', () => {
  const validate = String(scripts['validate'] ?? '');
  const missing = guardNames.filter((name) => !validate.includes(`npm run ${name}`));
  assert.deepEqual(missing, [], `حواجزُ غائبةٌ عن validate: ${missing.join(', ')}`);
});

test('كل حاجز في ci.yml نصٌّ قائم في package.json', () => {
  const referenced = [...workflow.matchAll(/npm run (guard:[a-z-]+)/g)].map((m) => m[1]);
  assert.ok(referenced.length > 0);
  const unknown = referenced.filter((name) => !(String(name) in scripts));
  assert.deepEqual(unknown, [], `المسارُ ينادي حواجزَ لا وجودَ لها: ${unknown.join(', ')}`);
});

test('الاختبارات وفحوص الأنواع والأسلوب باقية في المسار', () => {
  for (const command of [
    'npm run lint',
    'npm run format:check',
    'npm run typecheck',
    'npm run build',
    'npm run scan:secrets',
    'npm test',
    'npm run validate:seed',
    'npm run check:registries',
  ]) {
    assert.ok(workflow.includes(command), `الخطوة ${command} غابت عن ci.yml`);
  }
});

// `LIVE-17` / `WL-257`: سجلُّ وظيفةِ الفحصِ لا يُرفَعُ على العدّاءِ المقيمِ، فأعدادُ
// الاختباراتِ تُقرأُ من أثرٍ لا من السجلِّ. ويُقاسُ هنا **بنيةُ** المصدرِ: خطوةُ
// الاختباراتِ تَنسَخُ TAP بـ`pipefail` فلا يُخفي `tee` سقوطاً، والخلاصةُ حاسمةٌ عند
// الغيابِ، والأثرُ يُرفَعُ ولو سقطَت الاختباراتُ. **وحدٌّ معلَنٌ:** صحّةُ الأعدادِ
// نفسِها تُقاسُ بقراءةِ الأثرِ من تشغيلةٍ على `main`، لا بهذا الاختبارِ.
test('LIVE-17 — أعدادُ الاختباراتِ أثرٌ مرفوعٌ لا يتعلّقُ برفعِ السجلِّ', async () => {
  const { parse } = await import('yaml');
  /** @type {Array<Record<string, any>>} */
  const steps = parse(workflow).jobs.validate.steps;
  const i = steps.findIndex((s) => s.id === 'tests');
  assert.ok(i > -1, 'خطوةُ الاختباراتِ مُعرَّفةٌ بـ`id: tests`.');
  const run = steps[i] ?? {};
  assert.equal(
    run.shell,
    'bash',
    '`shell: bash` يُفعِّلُ `-eo pipefail` فرمزُ الخطوةِ رمزُ `npm test`.',
  );
  assert.match(String(run.run), /^npm test \| tee "\$RUNNER_TEMP\/ci-tests\.tap"$/);

  const summary = steps.find((s) => String(s.name).startsWith('خلاصة أعداد الاختبارات (LIVE-17)'));
  assert.ok(summary, 'خطوةُ الخلاصةِ قائمةٌ.');
  assert.ok(steps.indexOf(summary) > i, 'الخلاصةُ بعدَ الاختباراتِ.');
  assert.match(String(summary.if), /always\(\)/, 'تُشغَّلُ ولو سقطَت الاختباراتُ.');
  assert.match(String(summary.run), /CI_TAP_MISSING/);
  assert.match(String(summary.run), /CI_TAP_INCOMPLETE/);
  assert.ok(!/\|\|\s*true\s*$/m.test(String(summary.run).split('\n').at(-1) ?? ''));
  for (const key of ['tests', 'pass', 'fail', 'skipped']) {
    assert.ok(String(summary.run).includes(key), `الخلاصةُ تقرأُ \`# ${key}\`.`);
  }

  const upload = steps.find((s) => String(s.uses ?? '').startsWith('actions/upload-artifact@'));
  assert.ok(upload, 'الأثرُ يُرفَعُ.');
  assert.ok(steps.indexOf(upload) > steps.indexOf(summary));
  assert.match(String(upload.if), /always\(\)/);
  assert.equal(upload.with.name, 'ci-tests-tap');
  assert.equal(upload.with['if-no-files-found'], 'error', 'غيابُ الملفِّ يُسقِطُ لا يُسكِتُ.');
  assert.match(String(upload.with.path), /ci-tests\.tap/);
  assert.match(String(upload.with.path), /ci-tests-summary\.txt/);
});

// `LIVE-17/SKIP-NO-REASON` / `WL-259`: أوّلُ قراءةٍ للأثرِ كشفَت 9 تخطّياتٍ بلا سببٍ.
// ويُقاسُ هنا **السلوكُ** لا النصُّ: تُشغَّلُ خطوةُ الخلاصةِ نفسُها على TAP مُصطنَعٍ،
// فتخطٍّ عارٍ يُسقِطُها بـ`CI_TAP_BARE_SKIP` بعدَ كتابةِ الخلاصةِ، وتخطٍّ مُسبَّبٌ يَمُرُّ.
test('LIVE-17/SKIP-NO-REASON — تخطٍّ بلا سببٍ في TAP يُسقِطُ خطوةَ الخلاصةِ', async () => {
  const { parse } = await import('yaml');
  const { mkdtempSync, writeFileSync, readFileSync: read, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  /** @type {Array<Record<string, any>>} */
  const steps = parse(workflow).jobs.validate.steps;
  const summary = steps.find((s) => String(s.name).startsWith('خلاصة أعداد الاختبارات (LIVE-17)'));
  assert.ok(summary, 'خطوةُ الخلاصةِ قائمةٌ.');
  const script = String(summary.run).replaceAll('${{ steps.tests.outcome }}', 'success');
  const tail =
    '# tests 2\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n# duration_ms 1\n';
  /** @param {string} skipLine */
  const runWith = (skipLine) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'xuux-bare-skip-'));
    try {
      writeFileSync(
        path.join(dir, 'ci-tests.tap'),
        `TAP version 13\nok 1 - a\n${skipLine}\n1..2\n${tail}`,
      );
      writeFileSync(path.join(dir, 'summary.md'), '');
      const r = spawnSync('bash', ['-eo', 'pipefail', '-c', script], {
        env: {
          ...process.env,
          RUNNER_TEMP: dir,
          GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md'),
        },
        encoding: 'utf8',
      });
      return {
        status: r.status,
        stderr: r.stderr,
        out: read(path.join(dir, 'ci-tests-summary.txt'), 'utf8'),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const bare = runWith('ok 2 - b # SKIP');
  assert.equal(bare.status, 1, 'تخطٍّ عارٍ يُسقِطُ الخطوةَ.');
  assert.match(bare.stderr, /CI_TAP_BARE_SKIP/);
  assert.match(bare.out, /^bare_skips: 1$/m, 'الخلاصةُ مكتوبةٌ قبلَ السقوطِ فيُرفَعُ الأثرُ.');
  const bareSpaces = runWith('    ok 2 - b # SKIP   ');
  assert.equal(bareSpaces.status, 1, 'فراغٌ بعدَ `# SKIP` ليسَ سبباً.');
  const reasoned = runWith('ok 2 - b # SKIP XUUX_CHANNEL_POC=1 غيرُ مُعلَنٍ');
  assert.equal(reasoned.status, 0, `تخطٍّ مُسبَّبٌ يَمُرُّ: ${reasoned.stderr}`);
  assert.match(reasoned.out, /^bare_skips: 0$/m);
});

// `WL-286`: نُقل CI من self-hosted runner (xuux-ci-linux) إلى GitHub-hosted runner
// (ubuntu-latest) بقرار المالك. لا عدّاءٌ مقيمٌ بعدَ اليوم. ويُقاسُ هنا أنّ المسارَ
// لا يَحتوي على إشارةٍ إلى العدّاءِ المحليِّ.
test('WL-286 — لا إشارةَ إلى self-hosted أو linux-vm أو xuux-ci-linux في المسار', () => {
  for (const token of ['self-hosted', 'linux-vm', 'xuux-ci-linux', 'runner-preflight']) {
    assert.ok(!workflow.includes(token), `ci.yml يحوي إشارةً إلى العدّاء المحلي: ${token}`);
  }
});

test('WL-286 — الوظائفُ كلُّها على ubuntu-latest', async () => {
  const { parse } = await import('yaml');
  /** @type {Record<string, Record<string, any>>} */
  const jobs = parse(workflow).jobs;
  for (const [name, job] of Object.entries(jobs)) {
    assert.deepEqual(job['runs-on'], 'ubuntu-latest', `الوظيفةُ ${name} ليست على ubuntu-latest`);
  }
});

test('WL-286 — لا وظيفةَ preflight بعدَ نقل CI إلى GitHub-hosted', async () => {
  const { parse } = await import('yaml');
  /** @type {Record<string, Record<string, any>>} */
  const jobs = parse(workflow).jobs;
  assert.ok(!jobs.preflight, 'وظيفةُ preflight أُزيلت مع نقل CI إلى GitHub-hosted.');
  assert.ok(jobs.validate, 'وظيفةُ validate قائمةٌ.');
  assert.ok(jobs['gate-report'], 'وظيفةُ gate-report قائمةٌ.');
  // validate لا تحتاج preflight بعد الآن
  assert.notEqual(jobs.validate?.needs, 'preflight', 'validate لا يحتاج preflight.');
  // gate-report يحتاج validate وحدها
  assert.deepEqual(jobs['gate-report']?.needs, ['validate'], 'gate-report يحتاج validate وحدها.');
  // gate-report لا يذكر preflight
  assert.doesNotMatch(
    String(jobs['gate-report']?.steps?.[0]?.run ?? ''),
    /preflight/,
    'gate-report لا يذكر preflight.',
  );
});

test('WL-286 — لا خطوةَ تفريغِ /tmp خاصّةٍ بالعدّاء المقيم', async () => {
  const { parse } = await import('yaml');
  /** @type {Array<Record<string, any>>} */
  const steps = parse(workflow).jobs.validate.steps;
  // لا خطوة تفريغ بقايا التشغيلات السابقة
  const cleanup = steps.find(
    (s) =>
      String(s.name ?? '').includes('تفريغ بقايا') ||
      String(s.run ?? '').includes('rm -rf /tmp/royal-attest-*'),
  );
  assert.ok(!cleanup, 'لا خطوةَ تفريغِ /tmp خاصّةٍ بالعدّاء المقيم.');
  // لكن جرد /tmp قبل/بعد الاختبارات باقٍ (سياسة محروسة — WL-219)
  const before = steps.find((s) => String(s.run ?? '').includes('.xuux-tmp-before.txt'));
  assert.ok(before, 'جرد /tmp قبل الاختبارات باقٍ.');
  const after = steps.find((s) => String(s.name ?? '').includes('مقايسة /tmp بعد'));
  assert.ok(after, 'مقايسة /tmp بعد الاختبارات باقيةٌ.');
});

test('WL-327 — مسارُ النشرِ cancel-in-progress: true', async () => {
  const { parse } = await import('yaml');
  const publishWorkflow = readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'publish-skip-baseline.yml'),
    'utf8',
  );
  /** @type {Record<string, any>} */
  const parsed = parse(publishWorkflow);
  const concurrency = parsed.concurrency;
  assert.ok(concurrency, 'مسارُ النشرِ بلا مجموعةِ تزامنٍ.');
  assert.equal(
    concurrency.group,
    'publish-skip-baseline',
    'مجموعةُ التزامنِ ليست publish-skip-baseline.',
  );
  assert.equal(
    concurrency['cancel-in-progress'],
    true,
    'cancel-in-progress ليس true — تشغيلةٌ منتظرةٌ قد تحجبُ ما بعدها (OPS-1/MAIN-DRIFT-WINDOW لمسة (ج)).',
  );
});

test('WL-588 — مسارُ ci.yml: مجموعةُ التزامنِ ci-${{ github.ref }} وcancel-in-progress: true مثبَّتان', async () => {
  // سياسةٌ مقرَّرةٌ للمالك (‏WL-585 البندان 7–8): تشغيلةٌ أحدثُ على المرجعِ نفسِه تُلغي الأقدم،
  // فلا يُعَدُّ نجاحٌ إلّا لتشغيلةِ الرأسِ المقصود. كانَ تبديلُها إلى false أو تغييرُ المجموعةِ
  // يمرُّ بلا اختبار (‏WL-327 يثبِّتُ مسارَ النشرِ وحدَه).
  const { parse } = await import('yaml');
  /** @type {Record<string, any>} */
  const parsed = parse(readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8'));
  const concurrency = parsed.concurrency;
  assert.ok(
    concurrency && typeof concurrency === 'object',
    'ci.yml بلا كتلةِ concurrency على مستوى المسار.',
  );
  assert.equal(
    concurrency.group,
    'ci-${{ github.ref }}',
    'مجموعةُ تزامنِ ci.yml ليست ci-${{ github.ref }}.',
  );
  assert.equal(concurrency['cancel-in-progress'], true, 'cancel-in-progress في ci.yml ليس true.');
  for (const [name, job] of Object.entries(parsed.jobs ?? {})) {
    assert.equal(
      /** @type {any} */ (job).concurrency,
      undefined,
      `الوظيفةُ ${name} تُعرِّفُ concurrency خاصّةً تتجاوزُ سياسةَ المسار.`,
    );
  }
});

test('WL-448 — المسارُ يَجري على كلِّ طلبِ دمجٍ أيًّا كانت قاعدتُه (الطلباتُ المركَّبة)', async () => {
  const { parse } = await import('yaml');
  /** @type {Record<string, any>} */
  const on = parse(workflow).on;
  // `pull_request` حاضرٌ، و**بلا** مرشّحِ فروعٍ: طلبٌ قاعدتُه فرعُ طلبٍ آخرَ يُفحَصُ كذلك.
  assert.ok(on && 'pull_request' in on, 'ci.yml يَجري على pull_request.');
  const pr = on.pull_request ?? {};
  assert.equal(
    pr.branches,
    undefined,
    'لا مرشّحَ branches على pull_request — وإلّا سقطَ الطلبُ المركَّبُ صامتًا.',
  );
  assert.equal(pr['branches-ignore'], undefined, 'ولا branches-ignore.');
  assert.equal(pr.paths, undefined, 'ولا مرشّحَ مساراتٍ يُسقِطُ طلبًا توثيقيًّا.');
  assert.equal(pr['paths-ignore'], undefined, 'ولا paths-ignore.');
  // و`push` على قائمةٍ صريحةٍ لا على كلِّ فرع — التوسيعُ للطلباتِ لا للدفعِ إلى كلِّ فرع.
  // WL-585: القائمةُ `main` وفرعُ التكاملِ المصرَّحُ وحدَه (‏انظرِ الاختبارَ التالي).
  assert.deepEqual(
    on.push?.branches,
    ['main', 'wl-532-533-integration'],
    'push على main وفرعِ التكاملِ وحدَهما.',
  );
});

test('WL-585 — كوميتُ الدمجِ في فرعِ التكاملِ يُفحَصُ آليّاً (‏push)، لا بتشغيلٍ يدويٍّ يقيسُ على main', async () => {
  const { parse } = await import('yaml');
  /** @type {Record<string, any>} */
  const on = parse(workflow).on;
  // قبلُ: `push: branches: [main]` — دمجُ طلبٍ في `wl-532-533-integration` لا يُطلِقُ CI أصلاً،
  // والتشغيلُ اليدويُّ (‏`workflow_dispatch`) يقيسُ ذاكرةَ المشروعِ على `merge-base HEAD origin/main`
  // فلا يرى فقدَ ما على فرعِ التكاملِ ولم يبلغْ `main` (‏صنفُ `DOC-24` على مستوى كوميتِ الدمج).
  // و`push` يقيسُ على `HEAD^1` — رأسِ التكاملِ السابق (‏`guard-project-state.mjs` · `resolveBase`).
  const branches = on.push?.branches ?? [];
  assert.ok(
    branches.includes('wl-532-533-integration'),
    'push لا يشملُ فرعَ التكاملِ: كوميتُ الدمجِ فيه بلا فحصٍ آليّ.',
  );
  assert.ok(branches.includes('main'), 'push على main باقٍ.');
  // لا محارف بدل: فرعُ تكاملٍ واحدٌ مصرَّحٌ به، لا كلُّ فرعِ `wl-*`.
  for (const b of branches) assert.doesNotMatch(String(b), /[*?[\]!]/u, `نمطٌ لا اسمٌ: ${b}`);
  assert.equal(on.push?.['branches-ignore'], undefined, 'ولا branches-ignore.');
  assert.equal(on.push?.paths, undefined, 'ولا مرشّحَ مساراتٍ يُسقِطُ دمجاً توثيقيّاً.');
  assert.equal(on.push?.['paths-ignore'], undefined, 'ولا paths-ignore.');
  assert.ok('workflow_dispatch' in on, 'التشغيلُ اليدويُّ باقٍ.');
});

// ── WL-546: دُمِجَ هنا tests/tooling/typecheck-strictness.test.mjs (‏G1: حارسا بوابةِ الجودةِ من النجاحِ الكاذبِ بالإعداد) (‏كتلةٌ مستقلّةُ النطاق: أسماءٌ مشتركة) ──
{
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

  /**
   * إعداد المدقّق كما هو مكتوب في المستودع.
   * @returns {Record<string, unknown>} كائن `compilerOptions`
   */
  function compilerOptions() {
    const raw = readFileSync(join(repoRoot, 'tsconfig.json'), 'utf8');
    const parsed = /** @type {{ compilerOptions?: Record<string, unknown> }} */ (JSON.parse(raw));
    const options = parsed.compilerOptions;
    assert.ok(options, 'tsconfig.json يجب أن يحتوي compilerOptions');
    return options;
  }

  test('checkJs مُفعَّل — وإلا فالفحص لا يقرأ الكود أصلاً', () => {
    const options = compilerOptions();
    assert.equal(options.allowJs, true, 'allowJs مطلوب لأن كل الكود بامتداد .mjs');
    assert.equal(
      options.checkJs,
      true,
      'checkJs معطَّل: المدقّق سيمرّ على الكود بلا فحص ويُنتج نجاحاً كاذباً',
    );
  });

  test('أعلام الصرامة التي اعتمد عليها تصفير M2.00 باقية', () => {
    const options = compilerOptions();
    for (const flag of [
      'strict',
      'noUncheckedIndexedAccess',
      'exactOptionalPropertyTypes',
      'noImplicitOverride',
      'noFallthroughCasesInSwitch',
      'noImplicitReturns',
      'noUnusedLocals',
      'noUnusedParameters',
    ]) {
      assert.equal(options[flag], true, `العلم ${flag} أُسقط: هذا تخفيف للصرامة لا إصلاح`);
    }
  });

  test('نطاق الفحص يشمل الكود والاختبارات والأدوات معاً', () => {
    const raw = readFileSync(join(repoRoot, 'tsconfig.json'), 'utf8');
    const parsed = /** @type {{ include?: string[] }} */ (JSON.parse(raw));
    const include = parsed.include ?? [];
    for (const pattern of ['src/**/*.mjs', 'tests/**/*.mjs', 'scripts/**/*.mjs']) {
      assert.ok(include.includes(pattern), `النطاق لا يشمل ${pattern}`);
    }
  });
}

// `WL-601` (‏إذنُ المالكِ بالخيار «هـ»): `backup-restore.test.mjs` بلغَ 119.1 ث من مهلةِ الملفِّ 120 ث في CI
// (‏التشغيلة 45216924161). فيُشغَّلُ وحدَه بمهلةِ ملفٍّ 240 ث، وكلُّ اختبارٍ فيه بمهلةٍ 60 ث، وتبقى مهلةُ بقيّةِ
// الحزمةِ 120 ث. ويُقاسُ هنا أنَّ الاستثناءَ محصورٌ في ذاكَ الملفِّ وحدَه: (١) بقيّةُ الحزمةِ = ما يكتشفُه
// `node --test tests/` ناقصاً ملفّاً واحداً بالضبط؛ (٢) المهلتانِ في موضعَيهما ولا 240 ث في غيرِ ذلك؛
// (٣) `npm test` يُشغِّلُ الجزأين كليهما ويَسقطُ إن سقطَ أيُّهما؛ (٤) كلُّ `test()` في الملفِّ يحملُ 60 ث صراحةً.
const BACKUP_RESTORE_FILE = 'tests/persistence/backup-restore.test.mjs';

test('WL-601 — مهلةُ 240 ث محصورةٌ في backup-restore وحدَه، وبقيّةُ الحزمةِ 120 ث بلا نقصٍ في الملفّات', async () => {
  const { readdirSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const suite = String(scripts['test:suite']);
  const isolated = String(scripts['test:backup-restore']);
  assert.match(suite, /^node --test --test-concurrency=1 --test-timeout=120000 \$\(find tests /);
  assert.equal(
    isolated,
    `node --test --test-concurrency=1 --test-timeout=240000 ${BACKUP_RESTORE_FILE}`,
  );
  for (const [name, body] of Object.entries(scripts)) {
    if (name === 'test:backup-restore') continue;
    assert.ok(!/--test-timeout=240000/.test(body), `${name}: مهلةُ 240 ث خارجَ الملفِّ المعزول`);
  }
  // اكتشافُ `node --test` في Node 20 لمجلّد: كلُّ ملفٍّ ‎.js/.mjs/.cjs اسمُه (‏بلا امتداد) `test`
  // أو `test-*` أو `*[._-]test`، أو أيُّ ملفٍّ كذلك تحتَ مجلّدٍ اسمُه `test`، وتُتخطّى `node_modules`.
  /** @type {string[]} */
  const discovered = [];
  /** @type {string[]} */
  const testDirs = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        if (entry.name === 'test') testDirs.push(rel);
        walk(rel);
      } else if (/^(test|test-.+|.+[._-]test)\.[cm]?js$/.test(entry.name)) {
        discovered.push(rel);
      }
    }
  };
  walk('tests');
  assert.deepEqual(
    testDirs,
    [],
    'مجلّدٌ اسمُه `test` يوسِّعُ اكتشافَ node فيُخرجُ القائمةَ عن المطابقة',
  );
  assert.ok(discovered.includes(BACKUP_RESTORE_FILE));
  const command = /\$\((find tests .*)\)$/.exec(suite)?.[1];
  assert.ok(command, 'قائمةُ بقيّةِ الحزمةِ تُولَّدُ بـ`find`');
  const listed = execFileSync('sh', ['-c', command], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const expected = discovered.filter((f) => f !== BACKUP_RESTORE_FILE).sort();
  assert.deepEqual(listed, expected, 'بقيّةُ الحزمةِ = اكتشافُ node ناقصاً backup-restore وحدَه');
  assert.equal(listed.length, discovered.length - 1);
});

test('WL-601 — `npm test` يُشغِّلُ الجزأين كليهما ويَسقطُ إن سقطَ أيُّهما، وخطوةُ الخلاصةِ تقرأُ الملخّصين', async () => {
  const {
    mkdtempSync,
    writeFileSync,
    readFileSync: read,
    rmSync,
    chmodSync,
  } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const { parse } = await import('yaml');
  const dir = mkdtempSync(path.join(tmpdir(), 'xuux-wl601-'));
  try {
    // `npm` مُستبدَلٌ بنصٍّ يُسجِّلُ ما طُلِبَ منه ويخرجُ بالرمزِ المضبوطِ لكلِّ جزء.
    const fake = path.join(dir, 'npm');
    writeFileSync(
      fake,
      '#!/bin/sh\necho "$*" >> "$WL601_LOG"\ncase "$3" in\n  test:suite) exit "$WL601_SUITE";;\n  test:backup-restore) exit "$WL601_BR";;\nesac\nexit 97\n',
    );
    chmodSync(fake, 0o755);
    /** @param {number} suiteCode @param {number} brCode */
    const run = (suiteCode, brCode) => {
      const log = path.join(dir, `log-${suiteCode}-${brCode}`);
      const r = spawnSync('sh', ['-c', String(scripts.test)], {
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          WL601_LOG: log,
          WL601_SUITE: String(suiteCode),
          WL601_BR: String(brCode),
        },
        encoding: 'utf8',
      });
      return { status: r.status, calls: read(log, 'utf8').trim().split('\n') };
    };
    const both = ['run -s test:suite', 'run -s test:backup-restore'];
    assert.deepEqual(run(0, 0), { status: 0, calls: both });
    assert.deepEqual(
      run(1, 0),
      { status: 1, calls: both },
      'سقوطُ بقيّةِ الحزمةِ لا يحجبُ تشغيلَ الملفِّ المعزول',
    );
    assert.deepEqual(run(0, 1), { status: 1, calls: both });
    assert.deepEqual(run(1, 1), { status: 1, calls: both });

    /** @type {Array<Record<string, any>>} */
    const steps = parse(workflow).jobs.validate.steps;
    const summary = steps.find((s) =>
      String(s.name).startsWith('خلاصة أعداد الاختبارات (LIVE-17)'),
    );
    assert.ok(summary);
    const script = String(summary.run).replaceAll('${{ steps.tests.outcome }}', 'success');
    /** @param {number} n */
    const tail = (n) =>
      `# tests ${n}\n# suites 0\n# pass ${n}\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n`;
    writeFileSync(
      path.join(dir, 'ci-tests.tap'),
      `TAP version 13\nok 1 - a\nok 2 - b\n1..2\n${tail(2)}TAP version 13\nok 1 - c\n1..1\n${tail(1)}`,
    );
    writeFileSync(path.join(dir, 'summary.md'), '');
    const r = spawnSync('bash', ['-eo', 'pipefail', '-c', script], {
      env: { ...process.env, RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md') },
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    const out = read(path.join(dir, 'ci-tests-summary.txt'), 'utf8');
    assert.deepEqual(
      out.match(/^# tests \d+$/gm),
      ['# tests 2', '# tests 1'],
      'الملخّصانِ كلاهما في الأثر',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WL-601 — كلُّ `test()` في backup-restore يحملُ مهلةَ 60 ث صراحةً، ولا مهلةَ رقميّةَ غيرُها', () => {
  const src = readFileSync(path.join(repoRoot, BACKUP_RESTORE_FILE), 'utf8');
  assert.match(src, /^const PER_TEST_TIMEOUT_MS = 60_000;$/m);
  const starts = [...src.matchAll(/^\s*test\(/gm)].map((m) => m.index ?? 0);
  assert.ok(starts.length >= 37, `عددُ نداءاتِ test(): ${starts.length}`);
  for (const start of starts) {
    const head = src.slice(start, src.indexOf('async', start));
    assert.match(head, /timeout: PER_TEST_TIMEOUT_MS \}/, `بلا مهلةِ 60 ث: ${head.slice(0, 120)}`);
  }
  assert.doesNotMatch(src, /timeout: \d/, 'مهلةٌ رقميّةٌ تتجاوزُ الثابت');
});
