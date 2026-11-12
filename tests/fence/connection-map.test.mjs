/**
 * خريطةُ مساراتِ الاتصالِ بالقاعدة (`WL-532`، المراجعةُ المعدَّلة §4) — `config/db-connection-map.yaml`.
 *
 * يفشلُ إن ظهرَ موضعُ اتصالٍ في src/ أو scripts/ غيرُ مُدرَجٍ في الخريطة، أو اختلفَ عددُه، أو بقيَ
 * إدخالٌ بلا موضع، أو وُصفَ مسارٌ بأنّه FENCED_WRITER وهو لا يسلكُ الختم. لا يُثبتُ أنّ السياجَ شامل —
 * يُثبتُ فقط أنّ كلَّ مسارٍ مُصنَّفٌ تصنيفاً معلناً لا يُضافُ صامتاً.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import { FENCE_ERRORS, hardwareKeyProvider } from '../../src/fence/db-fence.mjs';

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

// ═══════════════════════════════════════════════════════════════════════════════════════════
// مصفوفةُ تهديداتِ `WL-533` — كتلةُ yaml في `docs/THREAT_MODEL.md` §9.9 (‏مراجعةُ #546: نُقلت من ملفٍّ
// منفصلٍ بلا زيادةٍ في عددِ الملفّات). THR-01..08:
//  - THR-01 الحقولُ والحالاتُ والفاعلون؛ THR-02 كلُّ دليلٍ ملفٌّ موجودٌ ومعرّفُه بعدَ # فيه نصّاً؛
//  - THR-03 MITIGATED_TESTED بدليلٍ اختباريّ؛ THR-04 لا حمايةَ مقيسةً من root/superuser/مالكِ المضيف؛
//  - THR-05 لا ادّعاءَ عتادٍ أو هويّةِ عملية؛ THR-06 قراراتُ المالكِ متّسقة؛ THR-07 T1..T7 تغطّي الكلّ؛
//  - THR-08 الثوابتُ المجمَّدة: SUPPORTED_FRESHNESS_BACKENDS فارغة، وhardwareKeyProvider لا يوقّع.
// ═══════════════════════════════════════════════════════════════════════════════════════════

const THREAT_DOC = readFileSync(path.join(ROOT, 'docs', 'THREAT_MODEL.md'), 'utf8');
const MATRIX = THREAT_DOC.slice(THREAT_DOC.indexOf('### 9.9 ')).match(/```yaml\n([\s\S]*?)```/);
assert.ok(MATRIX, 'لا كتلةَ yaml في docs/THREAT_MODEL.md §9.9');
const doc = YAML.parse(String(MATRIX[1]));
const STATUSES = new Set([
  'MITIGATED_TESTED',
  'MITIGATED_DESIGN',
  'PARTIAL',
  'RESIDUAL',
  'OWNER_DECISION',
]);
const ROOTLIKE = new Set(['host_root', 'superuser', 'friend_root', 'local_admin']);
/** @type {Array<Record<string, any>>} */
const threats = doc.threats;

test.describe('WL-533 مصفوفةُ التهديدات (docs/THREAT_MODEL.md §9.9)', () => {
  test('THR-01: الحقولُ والحالاتُ والفاعلون', () => {
    assert.equal(doc.version, 1);
    assert.equal(doc.phase, 'WL-533');
    const ids = new Set();
    for (const t of threats) {
      for (const k of ['id', 'actor', 'asset', 'attack', 'control', 'status', 'limit']) {
        assert.ok(typeof t[k] === 'string' && t[k].trim() !== '', `${t.id}: ${k}`);
      }
      assert.ok(Array.isArray(t.evidence), `${t.id}: evidence`);
      assert.match(t.id, /^TH-[A-Z]{3}-\d{2}$/);
      assert.ok(!ids.has(t.id), `مكرّر ${t.id}`);
      ids.add(t.id);
      assert.ok(STATUSES.has(t.status), `${t.id}: ${t.status}`);
      assert.ok(t.actor in doc.actors, `${t.id}: فاعلٌ غيرُ معرَّف ${t.actor}`);
    }
    assert.ok(threats.length >= 25);
  });

  test('THR-02: كلُّ دليلٍ موجودٌ ومعرّفُه في ملفِّه', () => {
    for (const t of threats) {
      for (const ref of t.evidence) {
        const [file, anchor] = String(ref).split('#');
        const full = path.join(ROOT, /** @type {string} */ (file));
        assert.ok(existsSync(full), `${t.id}: ${file} غيرُ موجود`);
        if (anchor !== undefined) {
          assert.ok(
            readFileSync(full, 'utf8').includes(anchor),
            `${t.id}: ${anchor} غائبٌ عن ${file}`,
          );
        }
      }
    }
  });

  test('THR-03: MITIGATED_TESTED بدليلٍ اختباريٍّ لا وثيقة', () => {
    for (const t of threats.filter((x) => x.status === 'MITIGATED_TESTED')) {
      assert.ok(
        t.evidence.some(
          (/** @type {string} */ e) =>
            e.startsWith('tests/') || /^scripts\/fence-lab\.mjs#LAB-/.test(e),
        ),
        `${t.id}: MITIGATED_TESTED بلا اختبار`,
      );
    }
  });

  test('THR-04: لا حمايةَ من root/superuser/مالكِ المضيف', () => {
    for (const t of threats.filter((x) => ROOTLIKE.has(x.actor))) {
      assert.ok(
        ['RESIDUAL', 'OWNER_DECISION', 'MITIGATED_DESIGN'].includes(t.status),
        `${t.id}: ${t.actor} ⇒ ${t.status}`,
      );
    }
    const hostRoot = threats.filter((x) => x.actor === 'host_root' || x.actor === 'superuser');
    assert.ok(hostRoot.length >= 2);
    assert.ok(hostRoot.every((x) => x.status !== 'MITIGATED_TESTED'));
  });

  test('THR-05: لا ادّعاءَ عتادٍ أو هويّةِ عمليةٍ أو حمايةٍ من superuser', () => {
    // على البياناتِ لا التعليقات (رأسُ الملفِّ يذكرُ العباراتِ المحظورةَ ليحظرَها).
    const data = JSON.stringify(doc);
    for (const bad of [
      /hardware[- ]backed"?:\s*true/i,
      /process identity proven/i,
      /superuser protection/i,
    ]) {
      assert.doesNotMatch(data, bad);
    }
    for (const t of threats.filter((x) => String(x.status).startsWith('MITIGATED'))) {
      assert.doesNotMatch(`${t.control} ${t.limit}`, /مدعومٌ بالعتاد|حمايةٌ عتاديّةٌ مثبتة/);
    }
  });

  test('THR-06: قراراتُ المالك متّسقة', () => {
    const decisions = new Map(doc.owner_decisions.map((/** @type {any} */ d) => [d.id, d]));
    for (const d of decisions.values()) {
      for (const k of ['question', 'why']) assert.ok(String(d[k]).trim() !== '', `${d.id}: ${k}`);
      assert.ok(Array.isArray(d.options) && d.options.length >= 2, `${d.id}: options`);
      for (const b of d.blocks)
        assert.ok(
          threats.some((t) => t.id === b),
          `${d.id}: ${b}`,
        );
    }
    for (const t of threats) {
      if (t.decision !== undefined) assert.ok(decisions.has(t.decision), `${t.id}: ${t.decision}`);
      if (t.status === 'OWNER_DECISION') assert.ok(t.decision !== undefined, `${t.id} بلا قرار`);
    }
  });

  test('THR-07: المهامُّ السبعُ تغطّي كلَّ التهديدات', () => {
    const tasks = doc.owner_tasks;
    assert.deepEqual(
      tasks.map((/** @type {any} */ t) => t.id),
      ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
    );
    const covered = new Set(tasks.flatMap((/** @type {any} */ t) => t.threats));
    for (const t of threats) assert.ok(covered.has(t.id), `${t.id} خارجَ المهامّ`);
    for (const id of covered)
      assert.ok(
        threats.some((t) => t.id === id),
        `مهمّةٌ تشيرُ إلى ${id}`,
      );
  });

  test('THR-08: الثوابتُ المجمَّدة — لا backend حداثة، ولا مزوِّدَ عتاديٌّ يوقّع', () => {
    const entry = readFileSync(path.join(ROOT, 'scripts', 'production-entry.mjs'), 'utf8');
    assert.match(entry, /const SUPPORTED_FRESHNESS_BACKENDS = new Set\(\[\]\);/);
    const hw = hardwareKeyProvider('pkcs11:token=none');
    assert.throws(
      () => hw.sign(Buffer.from('x')),
      (e) => /** @type {any} */ (e).code === FENCE_ERRORS.KEY_PROVIDER_UNAVAILABLE,
    );
    assert.throws(() => hw.publicKeyRaw());
  });
});
