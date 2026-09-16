// الساعةُ المُبرهَنةُ على سلكٍ حقيقيٍّ — إغلاقُ الدَّينِ `D-7` (‏`WL-192`).
//
// كلُّ اختبارٍ هنا يمرُّ على **مِقبسِ UDP محليٍّ** لا على نداءِ دالّةٍ: بناءُ
// الطلبِ، وحسابُ ورقةِ ميركل على رزمتِه، والمُهلةُ، وفكُّ الرَّدِّ — أربعةٌ لا
// يقيسُها متَّجهٌ محفوظٌ ولا نداءٌ داخليٌّ. والمتَّجهاتُ الخارجيّةُ تقيسُ التعميةَ
// في `roughtime.test.mjs`، وهذه تقيسُ القرارَ.
//
// وحدٌّ مُعلَنٌ: الشاهدُ المحليُّ **ليس مصدرَ وقتٍ صحيحٍ** — يوقِّعُ ما تقولُه
// ساعةُ الجهازِ. فالمقيسُ هنا أنَّ المسارَ يعملُ ويرفضُ، لا أنَّ الوقتَ صحيحٌ.

import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import { AttestedClock, TimeWitness, loadTimePolicy, startWitness } from '../../src/time/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @param {Array<{ id: string, port: number, publicKey: Buffer }>} sources
 * @param {Record<string, unknown>} [overrides]
 * @returns {{ policy: import('../../src/time/policy.mjs').TimePolicy, cleanup: () => void }}
 */
function policyFor(sources, overrides = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'xuux-time-clock-'));
  mkdirSync(path.join(dir, 'schemas'));
  copyFileSync(
    path.join(ROOT, 'config', 'schemas', 'time.schema.json'),
    path.join(dir, 'schemas', 'time.schema.json'),
  );
  writeFileSync(
    path.join(dir, 'time.yaml'),
    YAML.stringify({
      version: 1,
      quorum: 2,
      maxRadiusMs: 3000,
      maxAgeMs: 900000,
      maxLocalSkewMs: 5000,
      requestTimeoutMs: 1000,
      sovereign: { requireAttestedTime: true },
      sources: sources.map((source) => ({
        id: source.id,
        dialect: 'ietf',
        host: '127.0.0.1',
        port: source.port,
        publicKey: source.publicKey.toString('base64'),
      })),
      ...overrides,
    }),
  );
  return {
    policy: loadTimePolicy({ dir }),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * @param {(input: { witness: (options?: object) => Promise<{ id: string, port: number, publicKey: Buffer }> }) => Promise<void>} body
 * @returns {Promise<void>}
 */
async function withWitnesses(body) {
  /** @type {Array<{ close: () => Promise<void> }>} */
  const servers = [];
  let index = 0;
  const witness = async (/** @type {object} */ options = {}) => {
    const instance = new TimeWitness({ dialectId: 'ietf', ...options });
    const server = await startWitness({ witness: instance });
    servers.push(server);
    index += 1;
    return { id: `witness-${index}`, port: server.port, publicKey: instance.publicKey };
  };
  try {
    await body({ witness });
  } finally {
    await Promise.all(servers.map((server) => server.close()));
  }
}

/**
 * @param {() => Promise<unknown>} action
 * @returns {Promise<import('../../src/time/errors.mjs').TimeError>}
 */
async function rejected(action) {
  try {
    await action();
  } catch (error) {
    return /** @type {import('../../src/time/errors.mjs').TimeError} */ (error);
  }
  throw new Error('كان يجب أن يفشل ولم يفشل');
}

test('شاهدانِ صادقانِ على مِقبسٍ حقيقيٍّ: وقتٌ مُبرهَنٌ بفترةِ تقاطعٍ ومصدرَينِ مُسمَّيَينِ', async () => {
  await withWitnesses(async ({ witness }) => {
    const first = await witness();
    const second = await witness();
    const { policy, cleanup } = policyFor([first, second]);
    try {
      const clock = new AttestedClock({ policy });
      assert.equal(clock.attestation(), null, 'لا بُرهانَ قبلَ سؤالٍ');
      assert.equal((await rejected(async () => clock.now())).code, 'TIME_QUORUM_NOT_MET');

      const view = await clock.attest();
      assert.deepEqual([...view.sources].sort(), [first.id, second.id].sort());
      assert.ok(view.radiusMs > 0 && view.radiusMs <= policy.maxRadiusMs);
      assert.ok(Math.abs(view.atMs - Date.now()) < 5000, 'الشاهدُ يوقِّعُ ساعةَ هذا الجهازِ');
      assert.ok(clock.now() >= view.atMs, 'الوقتُ يتقدَّمُ بالمقياسِ الرتيبِ لا يثبتُ');
      clock.assertTrusted();
      const described = clock.describe();
      assert.equal(described.attested, true);
      assert.equal(described.lastProofs.length, 2);
    } finally {
      cleanup();
    }
  });
});

test('شاهدٌ يوقِّعُ وقتاً بعيداً: التقاطعُ فارغٌ فيُرفَضُ ولا يُجمَعُ بمتوسِّطٍ', async () => {
  await withWitnesses(async ({ witness }) => {
    const honest = await witness();
    const liar = await witness({ now: () => Date.now() + 3600000 });
    const { policy, cleanup } = policyFor([honest, liar]);
    try {
      const clock = new AttestedClock({ policy });
      const error = await rejected(() => clock.attest());
      assert.equal(error.code, 'TIME_SOURCES_DISAGREE');
      assert.equal(clock.attestation(), null, 'رفضٌ لا يُخلِّفُ بُرهاناً نصفَ مقبولٍ');
    } finally {
      cleanup();
    }
  });
});

test('مصدرٌ صامتٌ: النِّصابُ لا يُستوفى، والمُهلةُ تُنهي السؤالَ ولا تُعلِّقُه', async () => {
  await withWitnesses(async ({ witness }) => {
    const honest = await witness();
    // مِفتاحُ الصامتِ مستقلٌّ: مِفتاحٌ مكرَّرٌ ترفضُه السياسةُ نفسُها، فيُقاسُ
    // الصمتُ لا التكرارُ.
    const { policy, cleanup } = policyFor([
      honest,
      { id: 'silent', port: 1, publicKey: new TimeWitness({ dialectId: 'ietf' }).publicKey },
    ]);
    try {
      const started = Date.now();
      const error = await rejected(() => new AttestedClock({ policy }).attest());
      assert.equal(error.code, 'TIME_QUORUM_NOT_MET');
      assert.ok(Date.now() - started < 10000, 'السؤالُ ينتهي بمُهلةٍ لا بانتظارٍ بلا نهايةٍ');
      const detail = /** @type {{ refusals?: Array<{ code: string }> }} */ (error.detail ?? {});
      assert.ok(
        (detail.refusals ?? []).some((refusal) => refusal.code === 'TIME_TRANSPORT_FAILED'),
        'الرفضُ يُسمّي المصدرَ الذي عجزَ لا يُجمِلُ',
      );
    } finally {
      cleanup();
    }
  });
});

test('مِفتاحٌ مُعلَنٌ غيرُ مِفتاحِ الموقِّعِ: رَدٌّ يُرفَضُ ولو كانَ توقيعُه سليماً في نفسِه', async () => {
  await withWitnesses(async ({ witness }) => {
    const first = await witness();
    const second = await witness();
    // يُبدَّلُ مِفتاحُ الأوّلِ بمفتاحِ غريبٍ: الرَّدُّ موقَّعٌ فعلاً، لكن ليس بمن
    // تُعلِنُه السياسةُ — وقبولُه قبولٌ لأيِّ موقِّعٍ.
    const stranger = new TimeWitness({ dialectId: 'ietf' });
    const { policy, cleanup } = policyFor([
      { id: first.id, port: first.port, publicKey: stranger.publicKey },
      second,
    ]);
    try {
      const error = await rejected(() => new AttestedClock({ policy }).attest());
      assert.equal(error.code, 'TIME_QUORUM_NOT_MET');
      const detail = /** @type {{ refusals?: Array<{ code: string }> }} */ (error.detail ?? {});
      assert.ok(
        (detail.refusals ?? []).some(
          (refusal) => refusal.code === 'TIME_DELEGATION_SIGNATURE_INVALID',
        ),
        'الرفضُ من سلسلةِ التفويضِ لا من عطبٍ في الشكلِ',
      );
    } finally {
      cleanup();
    }
  });
});

test('بُرهانٌ فاتَ عمرُه يُقرأُ عدماً، والعمرُ بمقياسٍ رتيبٍ لا بساعةِ الجهازِ', async () => {
  await withWitnesses(async ({ witness }) => {
    const first = await witness();
    const second = await witness();
    const { policy, cleanup } = policyFor([first, second], { maxAgeMs: 4000 });
    try {
      let ticks = 0n;
      const clock = new AttestedClock({ policy, monotonic: () => ticks });
      await clock.attest();
      assert.ok(clock.attestation() !== null);
      // إرجاعُ ساعةِ الجهازِ لا يُجدِّدُ بُرهاناً: العمرُ من المقياسِ الرتيبِ.
      ticks = 5_000_000_000n;
      assert.equal(clock.attestation(), null);
      assert.equal((await rejected(async () => clock.now())).code, 'TIME_ATTESTATION_STALE');
    } finally {
      cleanup();
    }
  });
});

test('ساعةُ جهازٍ منزاحةٌ: البُرهانُ يعلو عليها، والانزياحُ يُعلَنُ برمزِه لا يُكتَمُ', async () => {
  await withWitnesses(async ({ witness }) => {
    const first = await witness();
    const second = await witness();
    const { policy, cleanup } = policyFor([first, second]);
    try {
      const clock = new AttestedClock({ policy, wallClock: () => Date.now() + 600000 });
      const view = await clock.attest();
      assert.ok(Math.abs(view.localSkewMs) > policy.maxLocalSkewMs);
      assert.equal(
        (await rejected(async () => clock.assertLocalClockAgrees())).code,
        'TIME_LOCAL_SKEW_EXCEEDED',
      );
      // ومع ذلك يُقرأُ الوقتُ المُبرهَنُ لا وقتُ الجهازِ المنزاحُ.
      assert.ok(Math.abs(clock.now() - Date.now()) < 5000);
    } finally {
      cleanup();
    }
  });
});

test('الساعةُ المُبرهَنةُ تُنفِّذُ عقدَ `TrustedClock` وتزيدُ عليه `attestation`', async () => {
  await withWitnesses(async ({ witness }) => {
    const first = await witness();
    const second = await witness();
    const { policy, cleanup } = policyFor([first, second]);
    try {
      const clock = new AttestedClock({ policy });
      for (const method of ['now', 'assertTrusted', 'attestation']) {
        assert.equal(
          typeof (/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (clock))[method]),
          'function',
          `العقدُ يلزمُه \`${method}\``,
        );
      }
      await clock.attest();
      const view = clock.attestation();
      assert.ok(view !== null);
      for (const key of ['atMs', 'radiusMs', 'ageMs', 'sources', 'localSkewMs']) {
        assert.ok(key in view, `شكلُ البُرهانِ يلزمُه \`${key}\``);
      }
    } finally {
      cleanup();
    }
  });
});

test('سياسةٌ بلا سياسةٍ: بناءُ ساعةٍ مُبرهَنةٍ بلا حدودٍ يُرفَضُ', () => {
  assert.throws(
    () => new AttestedClock(/** @type {never} */ ({})),
    (error) => {
      assert.equal(
        /** @type {import('../../src/time/errors.mjs').TimeError} */ (error).code,
        'TIME_CONFIG_INVALID',
      );
      return true;
    },
  );
});
