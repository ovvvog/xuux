/**
 * خريطةُ مساراتِ الاتصالِ بالقاعدة (`WL-532`، المراجعةُ المعدَّلة §4) — `config/db-connection-map.yaml`.
 *
 * يفشلُ إن ظهرَ موضعُ اتصالٍ في src/ أو scripts/ غيرُ مُدرَجٍ في الخريطة، أو اختلفَ عددُه، أو بقيَ
 * إدخالٌ بلا موضع، أو وُصفَ مسارٌ بأنّه FENCED_WRITER وهو لا يسلكُ الختم. لا يُثبتُ أنّ السياجَ شامل —
 * يُثبتُ فقط أنّ كلَّ مسارٍ مُصنَّفٌ تصنيفاً معلناً لا يُضافُ صامتاً.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLASSES = new Set([
  'FENCED_WRITER',
  'DEFAULT_DENY',
  'MIGRATOR_HALTED',
  'FENCE_CONTROL',
  'BREAK_GLASS',
  'ISOLATED_DB',
  'LAB_ONLY',
  'LIBRARY',
]);

/** @type {Record<string, RegExp>} */
const PATTERNS = {
  createPool: /(?<!function )\bcreatePool\(/g,
  'pg.Pool': /\bnew (?:pg\.)?Pool\(/g,
  'pg.Client': /\bnew (?:pg\.)?Client\(/g,
  pg_tool:
    /\b(?:resolvePgTool|bin)\('(?:psql|pg_dump|pg_restore|pg_basebackup|createdb|dropdb|initdb|pg_ctl|pg_controldata)'\)/g,
};

/**
 * يعدُّ مواضعَ الاتصالِ في نصٍّ بعدَ حذفِ سطورِ التعليق (تعليقٌ يذكرُ `new Pool(` ليس اتصالاً).
 * @param {string} source
 * @returns {Record<string, number>}
 */
export function countSites(source) {
  const code = source
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  /** @type {Record<string, number>} */
  const out = {};
  for (const [kind, re] of Object.entries(PATTERNS)) {
    const n = (code.match(re) ?? []).length;
    if (n > 0) out[kind] = n;
  }
  return out;
}

function scan() {
  /** @type {Map<string, number>} */
  const found = new Map();
  for (const dir of ['src', 'scripts']) {
    for (const rel of readdirSync(path.join(ROOT, dir), { recursive: true })) {
      const name = String(rel);
      if (!/\.m?js$/.test(name)) continue;
      const file = path.posix.join(dir, name.split(path.sep).join('/'));
      for (const [kind, n] of Object.entries(
        countSites(readFileSync(path.join(ROOT, file), 'utf8')),
      )) {
        found.set(`${file}#${kind}`, n);
      }
    }
  }
  return found;
}

const map = YAML.parse(readFileSync(path.join(ROOT, 'config', 'db-connection-map.yaml'), 'utf8'));

test('CONN-MAP-01: الماسحُ يلتقطُ كلَّ نوعٍ ويتجاهلُ التعليق', () => {
  const sample = [
    '// new Pool({ connectionString }) في تعليق',
    'export function createPool(o) {}',
    'const a = createPool();',
    'const b = new pg.Pool({});',
    'const c = new Client({});',
    "run(bin('psql'), []);",
  ].join('\n');
  assert.deepEqual(countSites(sample), { createPool: 1, 'pg.Pool': 1, 'pg.Client': 1, pg_tool: 1 });
});

test('CONN-MAP-02: كلُّ موضعِ اتصالٍ مُدرَجٌ بعددِه، ولا إدخالَ بلا موضع', () => {
  const found = scan();
  /** @type {Map<string, number>} */
  const declared = new Map();
  for (const s of map.sites) {
    const key = `${s.file}#${s.kind}`;
    assert.ok(!declared.has(key), `إدخالٌ مكرَّر: ${key}`);
    declared.set(key, s.count);
  }
  const unlisted = [...found].filter(([k]) => !declared.has(k)).map(([k, n]) => `${k}×${n}`);
  const stale = [...declared].filter(([k]) => !found.has(k)).map(([k]) => k);
  const mismatched = [...found]
    .filter(([k, n]) => declared.has(k) && declared.get(k) !== n)
    .map(([k, n]) => `${k}: مُعلَن ${declared.get(k)} وموجود ${n}`);
  assert.deepEqual({ unlisted, stale, mismatched }, { unlisted: [], stale: [], mismatched: [] });
});

test('CONN-MAP-03: كلُّ إدخالٍ مُصنَّفٌ بفئةٍ معروفةٍ وسببٍ ودور', () => {
  for (const s of map.sites) {
    assert.ok(CLASSES.has(s.fence), `${s.file}: فئةٌ غيرُ معروفة ${s.fence}`);
    for (const f of ['purpose', 'role', 'why']) {
      assert.ok(typeof s[f] === 'string' && s[f].trim() !== '', `${s.file}: ${f} فارغ`);
    }
  }
});

test('CONN-MAP-04: FENCED_WRITER يسلكُ المصافحةَ والختمَ فعلاً؛ وغيابُ المُشرِفِ مُعلَن', () => {
  const writers = map.sites.filter(
    (/** @type {{fence: string}} */ s) => s.fence === 'FENCED_WRITER',
  );
  assert.ok(writers.length > 0);
  for (const s of writers) {
    const src = readFileSync(path.join(ROOT, s.file), 'utf8');
    assert.match(src, /prepareFencedWorker\(/, `${s.file} يُعلَنُ مُسيَّجاً بلا مصافحة`);
    assert.match(src, /\.seal\(/, `${s.file} يُعلَنُ مُسيَّجاً بلا ختمِ جلسات`);
  }
  // لا مسارَ يُعلَنُ مُسيَّجاً وهو لا يعرفُ السياج: مَن صُنِّفَ DEFAULT_DENY لا يستوردُ مصافحةَ العامل.
  for (const s of map.sites.filter(
    (/** @type {{fence: string}} */ x) => x.fence === 'DEFAULT_DENY',
  )) {
    assert.doesNotMatch(readFileSync(path.join(ROOT, s.file), 'utf8'), /prepareFencedWorker/);
  }
  assert.equal(map.production_supervisor, 'absent');
  assert.equal(map.supervisor.status, 'absent');
  assert.ok(map.supervisor.decision_required.trim().length > 0);
});
