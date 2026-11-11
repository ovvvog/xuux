/**
 * تدقيقُ Ed25519 داخلَ القاعدة (`WL-532` §6) — تفاضليٌّ مع مراجعَ مستقلّة.
 *
 * **ما يُقاس:** `fence.ed25519_verify` و`fence.ed25519_key_ok` كما شُحِنا في
 * `migrations/0024_fence.up.sql` (يُستخرَجُ قسمُ Ed25519 من الملفِّ نفسِه ويُحمَّلُ في قاعدةٍ
 * معزولة)، مقابلَ:
 *  1. متّجهاتِ طرفٍ ثالثٍ محفوظةٍ بايتاً ببايتٍ في `tests/fixtures/ed25519/` (مستثناةٌ من المنسّق،
 *     وبصمتُها SHA-256 في `FIXTURES` أدناه تُفحَصُ قبلَ الاستعمال؛ الرخصة Apache-2.0):
 *     - Wycheproof (C2SP)، مثبَّتٌ بالإيداع:
 *       https://github.com/C2SP/wycheproof/blob/a3d5d1423f2592d6646836a45a21a1b209da9f4d/testvectors_v1/ed25519_test.json
 *       ‏210 حالات (117 صحيحة، 64 مرفوضة، 29 «مقبولة» = مفاتيحُ رتبةٍ صغيرةٍ/مختلطة)، وفيها
 *       متّجهاتُ RFC 8032 §7.1 وتطويعُ S والترميزُ غيرُ القانونيّ والأطوالُ الخاطئة؛
 *     - ed25519-speccheck (ورقة «Taming the many EdDSAs»، 2020)، مثبَّتٌ بالإيداع:
 *       https://github.com/novifinancial/ed25519-speccheck/blob/5e4bfc4542293286e9ad3cb2b805badee00503de/cases.json
 *       ‏12 حالةً حدّية: A/R رتبةٍ صغيرة، معادلةٌ بعاملِ المرافقِ وبدونه، S وA وR غيرُ قانونيّة.
 *     السياسةُ المتوقَّعة صارمةٌ بنمطِ libsodium: تُقبَلُ speccheck 3 وحدَها، ويُرفَضُ مفتاحُ
 *     الرتبةِ الصغيرة، ويُقبَلُ مختلطُ الرتبةِ عندَ التحقّقِ لكن يُرفَضُ عندَ تسجيلِ المفتاح
 *     (`ed25519_key_ok` يشترط [L]A = O). OpenSSL يقبلُ ما ترفضُه القاعدةُ عمداً (speccheck
 *     0،1،2،11 وWycheproof 152–159). والتنفيذُ بـplpgsql ليس ثابتَ الزمن — تحقّقٌ بمفاتيحَ
 *     عامّةٍ لا أسرارَ فيه؛
 *  2. `node:crypto` (OpenSSL) — مرجعٌ مستقلٌّ بسياسةٍ أرخى (يقبلُ المفتاحَ من رتبةٍ صغيرة)؛
 *  3. libsodium (عبرَ PyNaCl إن وُجِد) — مرجعٌ بالسياسةِ الصارمةِ نفسِها: **مطابقةٌ تامّة**.
 *     في CI لا PyNaCl فيُتخطّى ويُعلَنُ سببُه؛ وفي المختبرِ (`scripts/fence-lab.mjs`) يُشغَّلُ
 *     بـ`XUUX_ED_SODIUM=required` فغيابُه فشلٌ لا تخطٍّ.
 *
 * **حدّ:** مطابقةُ مراجعَ على حالاتٍ وعيّناتِ ضبابٍ ليست برهاناً رياضياً.
 */

import assert from 'node:assert/strict';
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomInt,
  sign,
  verify,
} from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';

import { createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';

const FIX = new URL('../fixtures/ed25519/', import.meta.url);
const FIXTURES = {
  'wycheproof_ed25519_test.json':
    'ea80ffebac085e21cb9d3e903e7fa2b448d96702da5b31f061d0b83b430b74b3',
  'speccheck_cases.json': '08e47a36d9aead288664930505584f353fff113ab854f2800db1e4f5b3540450',
};
/** @param {string} name */
const fixtureBytes = (name) => readFileSync(new URL(name, FIX));

const FUZZ_N = Math.max(1, Number(process.env['XUUX_ED_FUZZ_N'] ?? 120));
const SODIUM_MODE = process.env['XUUX_ED_SODIUM'] ?? 'auto';

// الترميزاتُ القانونيّةُ الثمانيةُ لعناصرِ زمرةِ الالتواء (رتبةٌ تقسمُ 8).
const SMALL_ORDER = [
  '0100000000000000000000000000000000000000000000000000000000000000',
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0000000000000000000000000000000000000000000000000000000000000080',
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a', // secret-scan:allow — نقطةُ التواءٍ عامّة
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa', // secret-scan:allow — نقطةُ التواءٍ عامّة
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05', // secret-scan:allow — نقطةُ التواءٍ عامّة
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85', // secret-scan:allow — نقطةُ التواءٍ عامّة
];
// المفاتيحُ العامّةُ لمتّجهاتِ RFC 8032 §7.1 (TEST 1/2/3/1024) — يُشترَطُ وجودُها في Wycheproof.
const RFC8032_PUBS = [
  'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', // secret-scan:allow — مفتاحٌ عامّ
  '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c', // secret-scan:allow — مفتاحٌ عامّ
  'fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025', // secret-scan:allow — مفتاحٌ عامّ
  '278117fc144c72340f67d0f2316e8386ceffbf2b2428c9c51fef7c597f1d426e', // secret-scan:allow — مفتاحٌ عامّ
];
const L = (1n << 252n) + 27742317777372353535851937790883648493n;

/**
 * @typedef {{ id: string, pk: string, msg: string, sig: string, kind: string }} Case
 */

/** @param {string} pk @param {string} msg @param {string} sig */
function nodeVerify(pk, msg, sig) {
  try {
    const key = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pk, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, Buffer.from(msg, 'hex'), key, Buffer.from(sig, 'hex'));
  } catch {
    return false;
  }
}

/** @param {Buffer} b */
const leToBig = (b) => BigInt(`0x${Buffer.from(b).reverse().toString('hex') || '0'}`);
/** @param {bigint} n */
const bigToLe32 = (n) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex').reverse();

/** @returns {Case[]} */
function vectorCases() {
  /** @type {Case[]} */
  const out = [];
  const wy = JSON.parse(fixtureBytes('wycheproof_ed25519_test.json').toString('utf8'));
  for (const g of wy.testGroups)
    for (const t of g.tests)
      out.push({
        id: `wy-${t.tcId}`,
        pk: g.publicKey.pk,
        msg: t.msg,
        sig: t.sig,
        kind: `${t.result}:${t.flags.join(',')}`,
      });
  const spec = JSON.parse(fixtureBytes('speccheck_cases.json').toString('utf8'));
  spec.forEach((/** @type {any} */ c, /** @type {number} */ i) =>
    out.push({ id: `spec-${i}`, pk: c.pub_key, msg: c.message, sig: c.signature, kind: 'spec' }),
  );
  return out;
}

/** ضبابٌ مولَّد: صحيحٌ، وطفراتٌ، وتطويعٌ، وعشوائيّ، وتزويرٌ شامل. @returns {Case[]} */
function fuzzCases() {
  /** @type {Case[]} */
  const out = [];
  for (let i = 0; i < FUZZ_N; i++) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const pk = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
    const msg = randomBytes(randomInt(0, 200));
    const sig = sign(null, msg, privateKey);
    const H = (/** @type {Buffer} */ b) => b.toString('hex');
    out.push({ id: `fz-${i}-valid`, pk: H(pk), msg: H(msg), sig: H(sig), kind: 'valid' });
    const flip = (/** @type {Buffer} */ b) => {
      const c = Buffer.from(b);
      if (c.length === 0) return Buffer.from([1]);
      const j = randomInt(0, c.length * 8);
      c[j >> 3] = Number(c[j >> 3]) ^ (1 << (j & 7));
      return c;
    };
    out.push({ id: `fz-${i}-flip-sig`, pk: H(pk), msg: H(msg), sig: H(flip(sig)), kind: 'mutant' });
    out.push({ id: `fz-${i}-flip-msg`, pk: H(pk), msg: H(flip(msg)), sig: H(sig), kind: 'mutant' });
    out.push({ id: `fz-${i}-flip-pk`, pk: H(flip(pk)), msg: H(msg), sig: H(sig), kind: 'mutant' });
    const s = leToBig(sig.subarray(32));
    const k = BigInt(randomInt(1, 9));
    if (s + k * L < 1n << 256n) {
      const mall = Buffer.concat([sig.subarray(0, 32), bigToLe32(s + k * L)]);
      out.push({
        id: `fz-${i}-malleable`,
        pk: H(pk),
        msg: H(msg),
        sig: H(mall),
        kind: 'malleable',
      });
    }
    out.push({
      id: `fz-${i}-random`,
      pk: H(randomBytes(32)),
      msg: H(msg),
      sig: H(randomBytes(64)),
      kind: 'random',
    });
    // تزويرٌ شامل: A = R = O وS = 0 يتحقّقُ بلا عاملِ مرافقٍ لأيّ رسالة.
    out.push({
      id: `fz-${i}-forge-identity`,
      pk: SMALL_ORDER[0] ?? '',
      msg: H(msg),
      sig: `${SMALL_ORDER[0]}${'00'.repeat(32)}`,
      kind: 'forgery',
    });
    // R من رتبةٍ صغيرةٍ مع مفتاحٍ صادق: تطويعٌ بإضافةِ عنصرِ التواء.
    out.push({
      id: `fz-${i}-small-R`,
      pk: H(pk),
      msg: H(msg),
      sig: `${SMALL_ORDER[randomInt(0, 8)]}${H(sig.subarray(32))}`,
      kind: 'mutant',
    });
  }
  return out;
}

/**
 * يتحقّقُ من دفعةٍ داخلَ القاعدة باستعلامٍ واحد.
 * @param {import('pg').Pool} pool @param {Case[]} cases @returns {Promise<boolean[]>}
 */
async function dbVerify(pool, cases) {
  const r = await pool.query(
    `SELECT fence.ed25519_verify(decode(p,'hex'), decode(m,'hex'), decode(s,'hex')) AS v
       FROM unnest($1::text[], $2::text[], $3::text[]) WITH ORDINALITY AS t(p, m, s, o) ORDER BY o`,
    [cases.map((c) => c.pk), cases.map((c) => c.msg), cases.map((c) => c.sig)],
  );
  return r.rows.map((x) => x.v === true);
}

/** @returns {string | false} سببُ عدمِ توفّرِ libsodium، أو false إن توفّر. */
function sodiumMissing() {
  const r = spawnSync('python3', ['-c', 'import nacl.bindings'], { encoding: 'utf8' });
  return r.status === 0
    ? false
    : 'PyNaCl/libsodium غيرُ مثبَّت (python3 -c "import nacl.bindings" فشل)';
}

/** @param {Case[]} cases @returns {boolean[]} */
function sodiumVerify(cases) {
  const py = [
    'import json,sys,nacl.bindings as b',
    'out=[]',
    'for c in json.load(sys.stdin):',
    '  try:',
    "    b.crypto_sign_open(bytes.fromhex(c['sig'])+bytes.fromhex(c['msg']),bytes.fromhex(c['pk'])); out.append(True)",
    '  except Exception: out.append(False)',
    'print(json.dumps(out))',
  ].join('\n');
  const r = spawnSync('python3', ['-c', py], {
    input: JSON.stringify(
      cases.map((c) => ({ pk: c.pk, msg: c.msg, sig: c.sig.length === 128 ? c.sig : '' })),
    ),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0, r.stderr);
  // libsodium يفترضُ توقيعاً بطولِ 64؛ الأطوالُ الأخرى مرفوضةٌ عندنا مسبقاً.
  return JSON.parse(r.stdout).map((/** @type {boolean} */ v, /** @type {number} */ i) =>
    (cases[i]?.sig.length ?? 0) === 128 && (cases[i]?.pk.length ?? 0) === 64 ? v : false,
  );
}

test('متّجهاتُ الطرفِ الثالث محفوظةٌ ببصمتِها المعلَنة', () => {
  for (const [name, digest] of Object.entries(FIXTURES))
    assert.equal(createHash('sha256').update(fixtureBytes(name)).digest('hex'), digest, name);
  const wy = fixtureBytes('wycheproof_ed25519_test.json').toString('utf8');
  for (const pk of RFC8032_PUBS) assert.ok(wy.includes(pk), `متجهُ RFC 8032 مفقود: ${pk}`);
});

describe(
  'Ed25519 داخلَ القاعدة — تدقيقٌ تفاضليّ (WL-532 §6)',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof createIsolatedDatabase>>} */
    let db;
    /** @type {Case[]} */
    let vectors;
    /** @type {Case[]} */
    let fuzz;
    /** @type {boolean[]} */
    let vDb;
    /** @type {boolean[]} */
    let fDb;
    before(async () => {
      db = await createIsolatedDatabase('ed25519');
      const sql = readFileSync(
        new URL('../../migrations/0024_fence.up.sql', import.meta.url),
        'utf8',
      );
      const start = sql.indexOf('CREATE FUNCTION fence._ed_modpow');
      const end = sql.indexOf('-- ── مساعداتُ الحالة');
      assert.ok(start > 0 && end > start, 'قسمُ Ed25519 غيرُ موجودٍ في الهجرة');
      await db.pool.query('CREATE SCHEMA fence');
      await db.pool.query(sql.slice(start, end));
      vectors = vectorCases();
      fuzz = fuzzCases();
      vDb = await dbVerify(db.pool, vectors);
      fDb = await dbVerify(db.pool, fuzz);
    });
    after(async () => {
      await db?.drop();
    });

    test('Wycheproof: كلُّ «صحيح» يُقبَل وكلُّ «مرفوض» يُرفَض؛ «المقبولُ» بالسياسةِ الصارمة', () => {
      /** @type {string[]} */
      const bad = [];
      vectors.forEach((c, i) => {
        if (!c.id.startsWith('wy-')) return;
        const want = c.kind.startsWith('valid')
          ? true
          : c.kind.startsWith('invalid')
            ? false
            : c.kind === 'acceptable:SmallOrderPublicKey'
              ? false
              : true; // مختلطُ الرتبة يُقبَلُ تحقّقاً (كـlibsodium) ويُرفَضُ تسجيلاً — أدناه
        if (vDb[i] !== want) bad.push(`${c.id} ${c.kind} db=${vDb[i]}`);
      });
      assert.deepEqual(bad, []);
      assert.equal(vectors.filter((c) => c.id.startsWith('wy-')).length, 210);
    });

    test('ed25519-speccheck: لا يُقبَلُ إلا الحالة 3 (سلوكُ libsodium)', () => {
      const got = vectors.flatMap((c, i) => (c.id.startsWith('spec-') ? [vDb[i]] : []));
      assert.deepEqual(got, [
        false,
        false,
        false,
        true,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
      ]);
    });

    test('اختلافُ OpenSSL محصورٌ في المفتاحِ من رتبةٍ صغيرةٍ وA غيرِ القانونيّ (القاعدةُ أشدّ)', () => {
      const diff = vectors.flatMap((c, i) =>
        nodeVerify(c.pk, c.msg, c.sig) === vDb[i] ? [] : [`${c.id}:${vDb[i] ? 'db+' : 'db-'}`],
      );
      const allowed = new Set([
        ...[152, 153, 154, 155, 156, 157, 158, 159].map((n) => `wy-${n}:db-`),
        'spec-0:db-',
        'spec-1:db-',
        'spec-2:db-',
        'spec-11:db-',
      ]);
      assert.deepEqual(
        diff.filter((d) => !allowed.has(d)),
        [],
        'اختلافٌ غيرُ مفسَّر',
      );
      assert.ok(
        diff.length > 0 && diff.every((d) => d.endsWith(':db-')),
        'القاعدةُ لا تقبلُ ما يرفضُه OpenSSL',
      );
    });

    test(`ضبابٌ تفاضليّ مع node:crypto (${FUZZ_N} مفتاحاً × 8 طفرات)`, () => {
      /** @type {string[]} */
      const bad = [];
      const counts = /** @type {Record<string, number>} */ ({});
      fuzz.forEach((c, i) => {
        counts[c.kind] = (counts[c.kind] ?? 0) + 1;
        const n = nodeVerify(c.pk, c.msg, c.sig);
        if (c.kind === 'forgery') {
          // OpenSSL يقبلُ التزويرَ الشامل؛ القاعدةُ يجبُ أن ترفضه.
          if (fDb[i] !== false) bad.push(`${c.id} قُبِل التزوير`);
          if (n !== true) bad.push(`${c.id} مرجعُ التزوير لم يعد يقبل — راجِع الاختبار`);
        } else if (c.kind === 'valid' && fDb[i] !== true) bad.push(`${c.id} صحيحٌ رُفِض`);
        else if (c.kind === 'malleable' && fDb[i] !== false) bad.push(`${c.id} S+kL قُبِل`);
        else if (c.kind !== 'valid' && fDb[i] && !n)
          bad.push(`${c.id} قبلته القاعدةُ ورفضه OpenSSL`);
        else if (
          c.kind !== 'valid' &&
          c.kind !== 'forgery' &&
          fDb[i] !== n &&
          !c.id.endsWith('small-R')
        )
          bad.push(`${c.id} db=${fDb[i]} node=${n} pk=${c.pk} msg=${c.msg} sig=${c.sig}`);
      });
      assert.deepEqual(bad, []);
      assert.ok((counts['valid'] ?? 0) === FUZZ_N && (counts['forgery'] ?? 0) === FUZZ_N);
    });

    test('مدخلاتٌ مشوَّهة: NULL وأطوالٌ خاطئة تُرجعُ false بلا استثناء', async () => {
      const r = await db.pool.query(
        `SELECT fence.ed25519_verify(NULL, ''::bytea, decode(repeat('00',64),'hex')) AS a,
              fence.ed25519_verify(decode(repeat('00',32),'hex'), NULL, decode(repeat('00',64),'hex')) AS b,
              fence.ed25519_verify(decode(repeat('00',32),'hex'), ''::bytea, NULL) AS c,
              fence.ed25519_verify(''::bytea, ''::bytea, ''::bytea) AS d,
              fence.ed25519_verify(decode(repeat('01',31),'hex'), ''::bytea, decode(repeat('00',64),'hex')) AS e,
              fence.ed25519_verify(decode(repeat('01',33),'hex'), ''::bytea, decode(repeat('00',64),'hex')) AS f,
              fence.ed25519_verify(decode($1,'hex'), ''::bytea, decode(repeat('00',63),'hex')) AS g,
              fence.ed25519_verify(decode($1,'hex'), ''::bytea, decode(repeat('00',65),'hex')) AS h,
              fence.ed25519_key_ok(NULL) AS i, fence.ed25519_key_ok(''::bytea) AS j`,
        [RFC8032_PUBS[0]],
      );
      assert.deepEqual(Object.values(r.rows[0]), Array(10).fill(false));
    });

    test('تسجيلُ المفاتيح (ed25519_key_ok): الصادقُ يُقبَل؛ الصغيرُ والمختلطُ وغيرُ القانونيّ يُرفَض', async () => {
      const honest = [...RFC8032_PUBS];
      for (let i = 0; i < 8; i++)
        honest.push(
          generateKeyPairSync('ed25519')
            .publicKey.export({ format: 'der', type: 'spki' })
            .subarray(12)
            .toString('hex'),
        );
      const wy = JSON.parse(fixtureBytes('wycheproof_ed25519_test.json').toString('utf8'));
      const mixed = [
        ...new Set(
          wy.testGroups.flatMap((/** @type {any} */ g) =>
            g.tests.some((/** @type {any} */ t) => t.flags.includes('MixedOrderPublicKey'))
              ? [g.publicKey.pk]
              : [],
          ),
        ),
      ];
      assert.ok(mixed.length > 0);
      // y + p لقيمِ y الصغيرة (ترميزٌ غيرُ قانونيّ): y=1 ⇒ ‎0xee…ff7f‎.
      const nonCanonical = ['eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f'];
      const q = async (/** @type {string[]} */ ks) =>
        (
          await db.pool.query(
            `SELECT fence.ed25519_key_ok(decode(k,'hex')) AS ok FROM unnest($1::text[]) WITH ORDINALITY t(k,o) ORDER BY o`,
            [ks],
          )
        ).rows.map((x) => x.ok);
      assert.deepEqual(
        await q(honest),
        honest.map(() => true),
      );
      assert.deepEqual(
        await q(SMALL_ORDER),
        SMALL_ORDER.map(() => false),
      );
      assert.deepEqual(
        await q(mixed),
        mixed.map(() => false),
      );
      assert.deepEqual(await q(nonCanonical), [false]);
    });

    test('libsodium: مطابقةٌ تامّةٌ على المتّجهاتِ والضبابِ كلِّه', (t) => {
      const missing = sodiumMissing();
      if (missing) {
        assert.notEqual(SODIUM_MODE, 'required', `XUUX_ED_SODIUM=required و${missing}`);
        t.skip(missing);
        return;
      }
      const all = [...vectors, ...fuzz];
      const ref = sodiumVerify(all);
      const got = [...vDb, ...fDb];
      const bad = all.flatMap((c, i) =>
        ref[i] === got[i] ? [] : [`${c.id} ${c.kind} db=${got[i]} sodium=${ref[i]}`],
      );
      assert.deepEqual(bad, []);
      t.diagnostic(`libsodium agreement: ${all.length}/${all.length}`);
    });
  },
);
