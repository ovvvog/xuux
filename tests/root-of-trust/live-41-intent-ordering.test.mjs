// @ts-nocheck
// tests/root-of-trust/live-41-intent-ordering.test.mjs
//
// `LIVE-41` (‏`WL-337`) — ترتيبُ صندوقِ القصودِ داخلَ الملّي ثانيةِ الواحدةِ:
//
//   `newRootIntentId` كانَ يُنشِئُ المعرِّفَ كـ«وقتٍ ثمَّ ذيلٍ عشوائيٍّ»، و`drainAsync`
//   يرتِّبُ الأسماءَ ترتيباً معجميّاً — فقصدانِ في الملّي ثانيةِ نفسِها يُطبَّقانِ
//   بترتيبِ الذيلِ العشوائيِّ لا الإيداع. قِيسَ: من 2000 زوجٍ 1988 في الملّي ثانيةِ
//   نفسِها، و996 منها معكوسٌ.
//
//   الإصلاحُ: عدّادٌ رتيبٌ بينَ الوقتِ والذيلِ — يتزايدُ ضمنَ الملّي ثانيةِ ويعودُ
//   إلى الصفرِ عندَ تقدُّمِ الوقتِ. فالترتيبُ المعجميُّ يطابقُ ترتيبَ التوليدِ داخلَ
//   العمليّةِ، والذيلُ العشوائيُّ يبقى للعزلِ لا للترتيبِ.
//
//   **حدُّ الادعاءِ:** الترتيبُ داخلَ العمليّةِ الواحدةِ عندَ تعادلِ الملّي ثانيةِ،
//   لا ترتيبٌ عالميٌّ بينَ عمليّاتٍ مستقلّةٍ.
//
// الاختباراتُ:
//   (أ) التعادلُ الزمنيُّ — ثبّتِ الساعةَ وأنشِئْ قصوداً في الملّي ثانيةِ نفسِها.
//   (ب) الاستمرارُ خارجَ التعادلِ — تقدُّمُ الوقتِ يُحافِظُ على الترتيبِ.
//   (ج) الذيلُ العشوائيُّ لا يُحدِّدُ الترتيبَ — ذيلٌ معكوسٌ والترتيبُ صحيحٌ.
//   (د) سلوكُ الصندوقِ الفعليِّ — إيداعٌ ثمَّ `drainAsync` والترتيبُ مطابقٌ.
//   (هـ) انحدارُ `WL-336` — 2000 زوجٍ في الملّي ثانيةِ نفسِها بلا انقلابٍ.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  newRootIntentId,
  setRootIntentIdRandomBytesForTesting,
  submitRootIntent,
  rootIntentPaths,
  RootIntentProcessor,
} from '../../src/root-of-trust/index.mjs';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

/** يُثبِّتُ `Date.now` على قيمةٍ ثابتةٍ ويُعيدُها في النهاية. */
function freezeTime(fixedMs) {
  const original = Date.now;
  Date.now = () => fixedMs;
  return () => {
    Date.now = original;
  };
}

/** يُصنعُ ذيلاً عشوائيّاً بـ`hex` ذي قيمةٍ ثابتةٍ. */
function tailFromHex(hex) {
  return () => Buffer.from(hex, 'hex');
}

test('LIVE-41 (أ): التعادلُ الزمنيُّ — قصودٌ في الملّي ثانيةِ نفسِها تُرتَّبُ بترتيبِ التوليدِ', () => {
  const restore = freezeTime(1_700_000_000_000);
  try {
    const ids = [];
    for (let i = 0; i < 50; i += 1) {
      ids.push(newRootIntentId());
    }
    // كلُّ زوجٍ متتالٍ يجبُ أن يكونَ id[i] < id[i+1] معجميّاً.
    for (let i = 0; i < ids.length - 1; i += 1) {
      assert.ok(ids[i] < ids[i + 1], `الترتيبُ معكوسٌ عندَ ${i}: ${ids[i]} >= ${ids[i + 1]}`);
    }
  } finally {
    restore();
  }
});

test('LIVE-41 (ب): الاستمرارُ خارجَ التعادلِ — تقدُّمُ الوقتِ يُحافِظُ على الترتيبِ', () => {
  const base = 1_700_000_000_000;
  const restore = freezeTime(base);
  try {
    const first = newRootIntentId();
    restore();
    const restore2 = freezeTime(base + 1);
    try {
      const second = newRootIntentId();
      assert.ok(first < second, `${first} >= ${second}`);
    } finally {
      restore2();
    }
  } finally {
    restore();
  }
});

test('LIVE-41 (ج): الذيلُ العشوائيُّ لا يُحدِّدُ الترتيبَ — ذيلٌ معكوسٌ والترتيبُ صحيحٌ', () => {
  const restore = freezeTime(1_700_000_000_000);
  try {
    // ذيلُ الأوّلِ أكبرُ معجميّاً من ذيلِ الثاني — لولا العدّادُ لانقلبَ الترتيبُ.
    setRootIntentIdRandomBytesForTesting(tailFromHex('ffffffffffffffffffffffff'));
    const first = newRootIntentId();
    setRootIntentIdRandomBytesForTesting(tailFromHex('000000000000000000000000'));
    const second = newRootIntentId();
    setRootIntentIdRandomBytesForTesting(null);

    assert.ok(first < second, `الترتيبُ معكوسٌ رغمَ العدّادِ: ${first} >= ${second}`);
  } finally {
    restore();
    setRootIntentIdRandomBytesForTesting(null);
  }
});

test('LIVE-41 (د): سلوكُ الصندوقِ الفعليِّ — `drainAsync` يُطبِّقُ بترتيبِ الإيداعِ', async () => {
  const base = mkdtempSync(join(tmpdir(), 'live41-box-'));
  registerTmpRoot(base);
  const root = join(base, 'root');
  const { requests } = rootIntentPaths(root);

  // `haltSwitch` مزيفٌ يسجِّلُ ترتيبَ التطبيقِ.
  const applied = [];
  const fakeHaltSwitch = {
    read: () => ({ epoch: 0, directive: null }),
    nodes: () => [],
    haltAsync: (reason, _command) => {
      applied.push({ kind: 'halt', reason });
      return Promise.resolve({ halted: true });
    },
    resumeAsync: (reason, _command) => {
      applied.push({ kind: 'resume', reason });
      return Promise.resolve({ resumed: true });
    },
    confirmHaltAsync: (nodeId, _proof, _detail) => {
      applied.push({ kind: 'confirm', nodeId });
      return Promise.resolve({ confirmed: nodeId });
    },
    registerNodeAsync: (nodeId, _options) => {
      applied.push({ kind: 'register', nodeId });
      return Promise.resolve({ registered: nodeId });
    },
    unregisterNodeAsync: (nodeId) => {
      applied.push({ kind: 'unregister', nodeId });
      return Promise.resolve();
    },
  };

  const processor = new RootIntentProcessor({
    root,
    haltSwitch: fakeHaltSwitch,
    anchor: async () => ({ anchored: true }),
    anchorVerifier: { verify: () => true },
    fsync: false,
  });

  // أودِعْ خمسةَ قصودِ إيقافٍ في الملّي ثانيةِ نفسِها بترتيبٍ معروف.
  const restore = freezeTime(1_700_000_001_000);
  try {
    const ids = [];
    for (let i = 0; i < 5; i += 1) {
      const intent = submitRootIntent(
        root,
        'halt',
        { royalCommand: { x: i }, reason: `halt-${i}` },
        { fsync: false },
      );
      ids.push(intent.id);
    }

    // تأكَّدْ من أنّ أسماءَ الملفات مُرتَّبةٌ معجميّاً بترتيبِ الإيداعِ.
    const names = readdirSync(requests)
      .filter((n) => n.endsWith('.json'))
      .sort();
    assert.equal(names.length, 5, 'خمسةُ ملفّاتٍ في الصندوقِ');
    const fileIds = names.map((n) => n.replace(/\.json$/, ''));
    assert.deepEqual(fileIds, ids, 'ترتيبُ الملفاتِ يطابقُ ترتيبَ الإيداعِ');

    // تأكَّدْ من أنّ `drainAsync` يُطبِّقُ بترتيبِ الإيداعِ.
    const handled = await processor.drainAsync();
    assert.equal(handled, 5, 'خمسةُ قصودٍ مُعالَجةٌ');
    assert.equal(applied.length, 5, 'خمسةُ تطبيقاتٍ');
    const appliedReasons = applied.map((a) => a.reason);
    assert.deepEqual(
      appliedReasons,
      ['halt-0', 'halt-1', 'halt-2', 'halt-3', 'halt-4'],
      'ترتيبُ التطبيقِ يطابقُ ترتيبَ الإيداعِ',
    );
  } finally {
    restore();
    rmSync(base, { recursive: true, force: true });
  }
});

test('LIVE-41 (هـ): انحدارُ `WL-336` — 2000 زوجٍ في الملّي ثانيةِ نفسِها بلا انقلابٍ', () => {
  const restore = freezeTime(1_700_000_002_000);
  try {
    const ids = [];
    for (let i = 0; i < 2000; i += 1) {
      ids.push(newRootIntentId());
    }

    // جميعُ الأزواجِ المتتاليةِ في الملّي ثانيةِ نفسِها.
    let ties = 0;
    let inversions = 0;
    for (let i = 0; i < ids.length - 1; i += 1) {
      const ts1 = ids[i].split('-')[0];
      const ts2 = ids[i + 1].split('-')[0];
      if (ts1 === ts2) {
        ties += 1;
        if (ids[i] >= ids[i + 1]) {
          inversions += 1;
        }
      }
    }

    assert.equal(ties, 1999, 'كلُّ الأزواجِ في الملّي ثانيةِ نفسِها');
    assert.equal(inversions, 0, 'لا انقلاباتٍ في الترتيبِ');
  } finally {
    restore();
  }
});
