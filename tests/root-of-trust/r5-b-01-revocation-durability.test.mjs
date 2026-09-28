// شاهدُ `R5-B-01` و`R5-A-05` — إعلانُ ثباتِ مخزنِ السحبِ صريحاً لا مُستنتَجاً.
//
// العيبُ (`R5-B-01`، تقريرُ `M11.04` الجولةُ الخامسةُ): حارسُ الإنتاجِ في
// `CertificateAuthority` كانَ يرفضُ `instanceof MemoryRevocationStore` وحدَه، فمخزنٌ
// متطايرٌ آخرُ يُحقِّقُ `RevocationStore` ولا يرثُ ذلكَ الصنفَ يُقبَلُ في الإنتاجِ،
// ثمّ تعودُ الشهادةُ المسحوبةُ صالحةً على مخزنٍ جديدٍ بعدَ إعادةِ الإقلاع.
//
// العيبُ (`R5-A-05`، التقريرُ نفسُه): `MemoryRevocationStore.revoke()` كانَ يُرجعُ
// `true`، فيقولُ `revokeCertificate` `persisted: true` عن سحبٍ لم يُكتَبْ كتابةً دائمة.
//
// الإصلاحُ: حقلٌ إلزاميٌّ `durability: 'persistent' | 'volatile'` في العقدِ، والإنتاجُ
// يرفضُ ما لم يُعلِنْ `'persistent'` بمساواةٍ تامّة؛ ومخزنُ الذاكرةِ يُعلِنُ
// `'volatile'` ويُرجعُ `false` من `revoke()`.
//
// **حدٌّ مُعلَنٌ لا مستورٌ:** الإعلانُ خبرٌ يُسأَلُ عنه المُنفِّذُ لا برهانٌ على القرصِ؛
// فالحارسُ يرفضُ الصامتَ والمتطايرَ المُعلَنَ، ولا يَكشفُ مخزناً يَكذبُ في إعلانِه.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import {
  CertificateAuthority,
  FileRevocationStore,
  KingIdentity,
  MemoryRevocationStore,
} from '../../src/root-of-trust/index.mjs';

const PRODUCTION = Object.freeze({ STATE_ENV: 'production' });
const CODE = 'PERSISTENT_REVOCATION_STORE_REQUIRED_IN_PRODUCTION';

/** @param {() => unknown} fn */
function assertRefused(fn, /** @type {string} */ why) {
  assert.throws(fn, (err) => /** @type {Error} */ (err).message === CODE, why);
}

/** مخزنٌ متطايرٌ مخصَّصٌ لا يرثُ `MemoryRevocationStore` — عينُ مسارِ `R5-B-01`. */
function volatileStore(/** @type {Record<string, unknown>} */ extra = {}) {
  const revoked = new Set();
  return {
    ...extra,
    isRevoked: (/** @type {string} */ id) => revoked.has(id),
    revoke: (/** @type {string} */ id) => {
      revoked.add(id);
      return true;
    },
    ready: () => true,
  };
}

test('R5-B-01: مخزنٌ مخصَّصٌ لا يرثُ الذاكرةَ ولا يُعلِنُ الثباتَ ⇒ مرفوضٌ في الإنتاج', () => {
  const store = volatileStore();
  assert.equal(store instanceof MemoryRevocationStore, false, 'المقدِّمة: لا ميراث');
  assertRefused(
    // @ts-expect-error — الحقلُ `durability` غائبٌ قصداً: هذا مسارُ العيبِ نفسُه.
    () => new CertificateAuthority(new KingIdentity(), { revocationStore: store, env: PRODUCTION }),
    'الصامتُ عن الثباتِ لا يُقرأُ ثابتاً',
  );
});

test('R5-B-01: مخزنٌ يُعلِنُ `volatile` ⇒ مرفوضٌ في الإنتاج', () => {
  const store = volatileStore({ durability: 'volatile' });
  assertRefused(
    // @ts-expect-error — `durability` مُستنتَجٌ `string` من الكائنِ المنشورِ.
    () => new CertificateAuthority(new KingIdentity(), { revocationStore: store, env: PRODUCTION }),
    'المتطايرُ المُعلَنُ مرفوض',
  );
});

test('R5-B-01: لا تجاوزَ بقيمةٍ قريبةٍ من `persistent` — المساواةُ تامّة', () => {
  for (const value of ['Persistent', 'persistent ', 'PERSISTENT', true, 1, {}, null, '']) {
    const store = volatileStore({ durability: value });
    assertRefused(
      () =>
        new CertificateAuthority(new KingIdentity(), {
          // @ts-expect-error — قيمٌ خارجَ العقدِ قصداً.
          revocationStore: store,
          env: PRODUCTION,
        }),
      `القيمةُ ${JSON.stringify(value)} ليست إعلانَ ثبات`,
    );
  }
});

test('R5-B-01: كائنٌ على نموذجِ الذاكرةِ بلا حقلِ الإعلانِ ⇒ مرفوضٌ (لا عبورَ بالنموذج)', () => {
  const store = Object.create(MemoryRevocationStore.prototype);
  assert.equal(store.durability, undefined, 'الإعلانُ حقلُ كائنٍ لا صفةُ نموذج');
  assertRefused(
    () => new CertificateAuthority(new KingIdentity(), { revocationStore: store, env: PRODUCTION }),
    'النموذجُ وحدَه لا يُعلِنُ ثباتاً',
  );
});

test('R5-B-01: `MemoryRevocationStore` يُعلِنُ `volatile` ويُرفَضُ صريحاً وافتراضاً', () => {
  const memory = new MemoryRevocationStore();
  assert.equal(memory.durability, 'volatile');
  assertRefused(
    () =>
      new CertificateAuthority(new KingIdentity(), { revocationStore: memory, env: PRODUCTION }),
    'الذاكرةُ الممرَّرةُ صراحةً مرفوضة',
  );
  assertRefused(
    () => new CertificateAuthority(new KingIdentity(), { env: PRODUCTION }),
    'الذاكرةُ الافتراضيّةُ مرفوضة',
  );
});

test('R5-B-01: مخزنٌ مخصَّصٌ يُعلِنُ `persistent` بلا أيِّ ميراثٍ ⇒ يُقبَلُ (لا حكمَ للصنف)', () => {
  const store = volatileStore({ durability: 'persistent' });
  const ca = new CertificateAuthority(new KingIdentity(), {
    // @ts-expect-error — `durability` مُستنتَجٌ `string`؛ القيمةُ نفسُها في العقد.
    revocationStore: store,
    env: PRODUCTION,
  });
  assert.equal(ca instanceof CertificateAuthority, true);
});

test('R5-B-01: `FileRevocationStore` يُعلِنُ `persistent` ويُقبَلُ في الإنتاجِ ويَكتبُ فعلاً', () => {
  const dir = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-r5b01-')));
  try {
    const store = new FileRevocationStore(join(dir, 'revoked.jsonl'));
    assert.equal(store.durability, 'persistent');
    const king = new KingIdentity();
    const ca = new CertificateAuthority(king, { revocationStore: store, env: PRODUCTION });
    const cert = ca.issue('agent:x', 'minister', ['read']);
    assert.equal(ca.revoke(cert.id, 'compromised').persisted, true, 'كُتِبَ على القرص');
    const reborn = new CertificateAuthority(king, {
      revocationStore: new FileRevocationStore(join(dir, 'revoked.jsonl')),
      env: PRODUCTION,
    });
    assert.equal(reborn.isValid(cert), false, 'بعدَ «إعادةِ الإقلاعِ» ما زالت مسحوبة');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R5-A-05: `MemoryRevocationStore` ⇒ `revokeCertificate(...).persisted === false`', () => {
  const memory = new MemoryRevocationStore();
  const ca = new CertificateAuthority(new KingIdentity(), { revocationStore: memory });
  const cert = ca.issue('agent:x', 'minister', ['read']);
  const result = ca.revoke(cert.id, 'compromised');
  assert.equal(result.persisted, false, 'لا يُدَّعى ثباتٌ لسحبٍ في الذاكرة');
  // أثرُ السحبِ داخلَ العمليّةِ قائمٌ — التصحيحُ في الخبرِ لا في الإنفاذ.
  assert.equal(ca.isValid(cert), false, 'السحبُ نافذٌ في العمليّةِ الحيّة');
  assert.equal(memory.isRevoked(cert.id), true);
  assert.equal(memory.revoke('cert:other'), false, 'الإرجاعُ المباشرُ `false` أيضاً');
  assert.equal(memory.isRevoked('cert:other'), true, 'وأثرُه في الذاكرةِ قائم');
});

test('R5-A-05: مخزنٌ جديدٌ في الذاكرةِ لا يَعرفُ سحبَ سابقِه — وهو ما يقولُه `persisted: false`', () => {
  const king = new KingIdentity();
  const ca1 = new CertificateAuthority(king, { revocationStore: new MemoryRevocationStore() });
  const cert = ca1.issue('agent:x', 'minister', ['read']);
  assert.equal(ca1.revoke(cert.id, 'compromised').persisted, false);
  const ca2 = new CertificateAuthority(king, { revocationStore: new MemoryRevocationStore() });
  assert.equal(ca2.isValid(cert), true, 'المتطايرُ لا يدوم — فالخبرُ `false` صادق');
});
