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

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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
