/**
 * سطحُ استدعاءِ العمليّاتِ في مسارِ البيئةِ — وحدةٌ وقاعدةُ الحاجزِ `R10`.
 *
 * الوحدةُ نقيّةٌ يُحقَن قارئُها، فحالاتُ **الرفضِ** تُقاس بمستودعٍ مُصطنَعٍ في
 * الذاكرةِ لا بإفسادِ المستودعِ الحقيقيّ؛ وحالةُ **القبولِ** تُقاس على المستودعِ
 * الحقيقيِّ نفسِه وعلى الحاجزِ عمليّةً ابنةً — فحكمُ الحاجزِ رمزُ خروجٍ لا نصٌّ.
 */

import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  SPAWN_IMPORT,
  auditSpawnSurface,
  dynamicSpecifiers,
  importClosure,
  importSpecifiers,
  opaqueLoadReasons,
  resolveRelative,
  stripComments,
} from '../../src/environment/spawn-surface.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const GUARD_SCRIPT = path.join(ROOT, 'scripts/guard-environment.mjs');
const DOC = path.join(ROOT, 'docs/ENVIRONMENT.md');

/**
 * قارئٌ من خريطةٍ في الذاكرةِ — مستودعٌ مُصطنَعٌ بلا قرص.
 *
 * @param {Record<string, string>} files
 * @returns {(file: string) => string | null}
 */
function readerOf(files) {
  return (file) => (Object.hasOwn(files, file) ? String(files[file]) : null);
}

test('استخراجُ المواصفاتِ يلتقط الاستيرادَ الساكنَ وإعادةَ التصديرِ ولا يلتقط الديناميّ', () => {
  const source = [
    "import fs from 'node:fs';",
    "import { a } from './a.mjs';",
    "export { b } from '../lib/b.mjs';",
    "const late = await import('./dynamic.mjs');",
  ].join('\n');
  const specs = importSpecifiers(source);
  assert.deepEqual(specs, ['node:fs', './a.mjs', '../lib/b.mjs']);
  assert.ok(!specs.includes('./dynamic.mjs'), 'الحدُّ المعلَن: الديناميُّ خارجَ القياس');
});

test('الاستيرادُ الممتدُّ على أسطرٍ يُلتقَط — وإلّا كان كسرُ السطرِ بابَ تسلُّلٍ من الحاجز', () => {
  // قيسَ هذا بالتنفيذِ لا بالنظرِ: إضافةُ ملفٍ جديدٍ إلى المسارِ باستيرادٍ
  // ممتدٍّ **أنقصت** الإغلاقَ المقيسَ من 11 إلى 10 بدلَ أن تزيدَه، فكان من
  // يكسر سطرَ استيرادِه يخرج من قياسِ R10 وهو داخلَ المسارِ فعلاً.
  const source = [
    'import {',
    '  EnvironmentLedger,',
    '  auditLedgerFile,',
    "} from './lib/environment-ledger.mjs';",
    'export {',
    '  judge,',
    "} from '../src/environment/tool-readiness.mjs';",
  ].join('\n');
  assert.deepEqual(importSpecifiers(source), [
    './lib/environment-ledger.mjs',
    '../src/environment/tool-readiness.mjs',
  ]);
});

test('المواصفةُ لا تعبُر حدَّ الجملةِ فيُختلق تبعٌ لا وجودَ له', () => {
  const source = ["import a from './a.mjs';", "const x = qq from './ghost.mjs';"].join('\n');
  assert.deepEqual(importSpecifiers(source), ['./a.mjs']);
});

test('حلُّ المواصفةِ النسبيّةِ يُعطي مساراً من الجذرِ ويُهمِل غيرَ النسبيّة', () => {
  assert.equal(resolveRelative('scripts/bootstrap.mjs', './lib/x.mjs'), 'scripts/lib/x.mjs');
  assert.equal(resolveRelative('scripts/lib/x.mjs', '../../src/y.mjs'), 'src/y.mjs');
  assert.equal(resolveRelative('scripts/bootstrap.mjs', 'node:fs'), null);
  assert.equal(resolveRelative('scripts/bootstrap.mjs', 'yaml'), null);
});

test('الإغلاقُ تبعيٌّ: يبلغُ ما يصله المسارُ بغيرِ واسطةٍ مباشرة', () => {
  const files = {
    'scripts/entry.mjs': "import { a } from './lib/a.mjs';",
    'scripts/lib/a.mjs': "import { b } from './b.mjs';",
    'scripts/lib/b.mjs': "import fs from 'node:fs';",
    'scripts/lib/orphan.mjs': "import { spawnSync } from 'node:child_process';",
  };
  const { closure, missing } = importClosure({
    entries: ['scripts/entry.mjs'],
    sourceOf: readerOf(files),
  });
  assert.deepEqual(closure, ['scripts/entry.mjs', 'scripts/lib/a.mjs', 'scripts/lib/b.mjs']);
  assert.deepEqual(missing, []);
});

test('جامعٌ ثانٍ يتسلّل إلى الإغلاقِ يُردّ غيرَ معلَن', () => {
  const files = {
    'scripts/entry.mjs':
      "import { f } from './lib/facts.mjs';\nimport { s } from './lib/sneak.mjs';",
    'scripts/lib/facts.mjs': "import { spawnSync } from 'node:child_process';",
    'scripts/lib/sneak.mjs': "import { execSync } from 'node:child_process';",
  };
  const audit = auditSpawnSurface({
    entries: ['scripts/entry.mjs'],
    declared: ['scripts/lib/facts.mjs'],
    sourceOf: readerOf(files),
  });
  assert.deepEqual(audit.undeclared, ['scripts/lib/sneak.mjs']);
  assert.deepEqual(audit.stale, []);
});

test('إعلانٌ بقي بعد زوالِ سببِه يُردّ كذلك', () => {
  const files = {
    'scripts/entry.mjs': "import { f } from './lib/facts.mjs';",
    'scripts/lib/facts.mjs': "import fs from 'node:fs';",
  };
  const audit = auditSpawnSurface({
    entries: ['scripts/entry.mjs'],
    declared: ['scripts/lib/facts.mjs'],
    sourceOf: readerOf(files),
  });
  assert.deepEqual(audit.spawners, []);
  assert.deepEqual(audit.stale, ['scripts/lib/facts.mjs']);
});

test('مدخلٌ معلَنٌ لا وجودَ له يُقيَّد غياباً ولا يُبتلَع', () => {
  const audit = auditSpawnSurface({
    entries: ['scripts/gone.mjs'],
    declared: [],
    sourceOf: readerOf({}),
  });
  assert.deepEqual(audit.missing, ['scripts/gone.mjs']);
});

test('المستودعُ الحقيقيّ: سطحُ الاستدعاءِ هو عينُ ما تُعلنه الوثيقةُ §١٦', () => {
  const document = fs.readFileSync(DOC, 'utf8');
  const start = document.indexOf('## ١٦.');
  assert.ok(start !== -1, 'القسم ١٦ غائبٌ من docs/ENVIRONMENT.md');
  const rest = document.slice(start);
  const end = rest.indexOf('\n## ', 1);
  const section = end === -1 ? rest : rest.slice(0, end);

  /** @param {RegExp} pattern @returns {string[]} */
  const paths = (pattern) => {
    /** @type {string[]} */
    const found = [];
    for (const match of section.matchAll(pattern)) {
      const value = match[1];
      if (value !== undefined && value.includes('/')) found.push(value);
    }
    return [...new Set(found)];
  };

  const entries = paths(/^- `([^`]+)`/gmu);
  const declared = paths(/^\| `([^`]+)` \|/gmu);
  assert.deepEqual(entries, ['scripts/bootstrap.mjs', 'scripts/verify-environment.mjs']);
  assert.deepEqual(declared, ['scripts/bootstrap.mjs', 'scripts/lib/environment-facts.mjs']);

  const audit = auditSpawnSurface({
    entries,
    declared,
    sourceOf: (file) => {
      const full = path.join(ROOT, file);
      return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
    },
  });
  assert.deepEqual(audit.missing, []);
  assert.deepEqual(audit.undeclared, []);
  assert.deepEqual(audit.stale, []);
  assert.deepEqual(audit.spawners, declared);
  assert.ok(audit.closure.length >= entries.length);
  assert.equal(SPAWN_IMPORT, 'node:child_process');
});

test('الحاجزُ عمليّةً ابنةً: يقبل المستودعَ ويُصرِّح بمقاسِ السطحِ في حكمِه', () => {
  const outcome = spawnSync(process.execPath, [GUARD_SCRIPT], { encoding: 'utf8', shell: false });
  assert.equal(
    outcome.status,
    0,
    `الحاجزُ رفض: ${String(outcome.stdout)}${String(outcome.stderr)}`,
  );
  assert.match(String(outcome.stdout), /سطحُ استدعاءِ العمليّاتِ محصورٌ في 2 ملفّاتٍ معلَنةٍ/u);
});

// ── الثغرةُ المُعلَنةُ التي أُغلِقت: التحميلُ الديناميُّ خارجَ قياسِ R10 ──

test('التعليقُ ليس تحميلاً: `import()` في JSDoc لا يُعَدّ تبعاً ولا مُستدعياً', () => {
  // شرطٌ لا زينة: في هذا المستودعِ عشراتُ `@type {import('…')}`. من عدَّها
  // تحميلاً أطلقَ إنذاراتٍ كاذبةً، وحاجزٌ يُتجاهَل أسوأُ من حاجزٍ لا يوجد.
  const source = [
    "/** @type {import('../src/environment/probes.mjs').HealthReport} */",
    "// import('node:child_process')",
    "/* @typedef {import('./ghost.mjs').T} T */",
    "const real = await import('./actual.mjs');",
  ].join('\n');
  assert.deepEqual(dynamicSpecifiers(source), ['./actual.mjs']);
});

test('السلسلةُ النصّيّةُ تُصان: «//» داخلَ نصٍّ ليس بدايةَ تعليق', () => {
  const source = [
    "const url = 'https://example.test/x';",
    "const q = await import('./a.mjs');",
  ].join('\n');
  const stripped = stripComments(source);
  assert.ok(stripped.includes('https://example.test/x'), 'النصُّ بُتِر وكأنّه تعليق');
  assert.deepEqual(dynamicSpecifiers(source), ['./a.mjs']);
});

test('الإغلاقُ يتبع الديناميَّ الحرفيَّ — وإلّا كان `import()` بابَ تسلُّلٍ من القياس', () => {
  /** @type {Record<string, string>} */
  const files = {
    'scripts/entry.mjs': "const m = await import('./lib/hidden.mjs');",
    'scripts/lib/hidden.mjs': "import cp from 'node:child_process';\nexport const x = cp;",
  };
  const { closure } = importClosure({
    entries: ['scripts/entry.mjs'],
    sourceOf: (file) => files[file] ?? null,
  });
  assert.deepEqual(closure, ['scripts/entry.mjs', 'scripts/lib/hidden.mjs']);
});

test('مُستدعٍ يصل إلى العمليّاتِ بـ`import()` وحدَه يُردّ غيرَ معلَن', () => {
  /** @type {Record<string, string>} */
  const files = {
    'scripts/entry.mjs': "const cp = await import('node:child_process');\nexport const s = cp;",
  };
  const audit = auditSpawnSurface({
    entries: ['scripts/entry.mjs'],
    declared: [],
    sourceOf: (file) => files[file] ?? null,
  });
  assert.deepEqual(audit.spawners, ['scripts/entry.mjs']);
  assert.deepEqual(audit.undeclared, ['scripts/entry.mjs']);
  assert.equal(audit.spawners.includes(SPAWN_IMPORT), false);
});

test('ما لا يُقاس لا يُمرَّر: المواصفةُ المحسوبةُ و`createRequire` يُردّان', () => {
  const byExpression = opaqueLoadReasons('const m = await import(chosenAtRuntime);');
  assert.equal(byExpression.length, 1, 'مواصفةٌ محسوبةٌ مرّت بلا ردّ');
  const byRequire = opaqueLoadReasons("import { createRequire } from 'node:module';");
  assert.equal(byRequire.length, 1, '`createRequire` مرّ بلا ردّ');
  // والسليمُ لا يُتَّهم.
  assert.deepEqual(opaqueLoadReasons("import fs from 'node:fs';\nawait import('./a.mjs');"), []);
});

test('الحاجزُ عمليّةً ابنةً: متسلّلٌ يستدعي بالديناميِّ يُخرِج الحاجزَ بـ1', () => {
  // قياسٌ بالتشغيلِ لا بالنظر: هذا عينُ المتسلّلِ الذي **مرّ صامتاً** قبل
  // هذا الإصلاح، والحاجزُ يومَها خرج صفراً معلناً «السطحُ محصورٌ في 2».
  const probe = path.join(ROOT, 'scripts/lib/spawn-surface-intruder.probe.mjs');
  const entry = path.join(ROOT, 'scripts/bootstrap.mjs');
  const original = fs.readFileSync(entry, 'utf8');
  fs.writeFileSync(
    probe,
    [
      'export async function sneak() {',
      "  const cp = await import('node:child_process');",
      "  return cp.spawnSync('echo', ['x']).status;",
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  try {
    fs.writeFileSync(
      entry,
      `import { sneak } from './lib/spawn-surface-intruder.probe.mjs';\n${original}`,
      'utf8',
    );
    const run = spawnSync(process.execPath, [GUARD_SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(run.status, 1, 'المتسلّلُ مرّ — الثغرةُ عادت');
    assert.ok(
      `${run.stdout}${run.stderr}`.includes('spawn-surface-intruder.probe.mjs'),
      'الحاجزُ ردَّ ولم يُسمِّ من ردّ',
    );
  } finally {
    fs.writeFileSync(entry, original, 'utf8');
    fs.rmSync(probe, { force: true });
  }
});
