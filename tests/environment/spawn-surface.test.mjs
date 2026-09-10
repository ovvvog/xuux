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
  importClosure,
  importSpecifiers,
  resolveRelative,
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
