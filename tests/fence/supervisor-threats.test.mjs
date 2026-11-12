/**
 * مصفوفةُ تهديداتِ `WL-533` (‏`config/fence-supervisor-threats.yaml`) قابلةٌ للفحص — لا تقريرٌ نصّيّ:
 *
 *  - THR-01: كلُّ تهديدٍ بحقولِه، وحالتُه من القائمة، وفاعلُه معرَّف.
 *  - THR-02: كلُّ دليلٍ ملفٌّ موجود؛ ومعرّفُ الاختبارِ أو خطوةُ المختبرِ بعدَ `#` موجودٌ نصّاً في ذلك الملف.
 *  - THR-03: MITIGATED_TESTED يتطلّبُ دليلاً اختباريّاً (‏`tests/…` أو `scripts/fence-lab.mjs#LAB-*`).
 *  - THR-04: تهديدٌ فاعلُه host_root أو superuser أو friend_root أو local_admin لا يكونُ MITIGATED_TESTED ولا PARTIAL (لا حمايةَ مقيسةً من root).
 *  - THR-05: لا سطرَ يدّعي «hardware-backed» أو «process identity proven» أو «superuser protection».
 *  - THR-06: كلُّ قرارِ مالكٍ مُشارٍ إليه معرَّف، وكلُّ قرارٍ معرَّفٍ يحجبُ تهديداً قائماً، وكلُّ OWNER_DECISION له قرار.
 *  - THR-07: المهامُّ T1..T7 كلُّها، وكلُّ تهديدٍ في مهمّةٍ واحدةٍ على الأقلّ.
 *  - THR-08: الثوابتُ المحظورُ تغييرُها في هذه المرحلة: `SUPPORTED_FRESHNESS_BACKENDS` فارغة، و`hardwareKeyProvider` لا يوقّع.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import { FENCE_ERRORS, hardwareKeyProvider } from '../../src/fence/db-fence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = readFileSync(path.join(ROOT, 'config', 'fence-supervisor-threats.yaml'), 'utf8');
const doc = YAML.parse(SOURCE);
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

describe('WL-533 مصفوفةُ التهديدات', () => {
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
