// متَّجهاتٌ خارجيّةٌ لتحقُّقِ Roughtime — إغلاقُ الدَّينِ `D-7` (‏`WL-192`).
//
// لِمَ متَّجهاتٌ من طرفٍ ثالثٍ لا رُدودٌ يصنعُها الكودُ: تحقُّقٌ يُختبَرُ بما
// يُنتجُه هو نفسُه يشهدُ لنفسِه ويمرُّ ولو فُهِمَ العَقدُ كلُّه على غيرِ وجهِه.
// والنسبةُ والرخصةُ والحدودُ في `tests/fixtures/roughtime/PROVENANCE.md`.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TAGS,
  TimeError,
  dialect,
  encodeRequest,
  parseMessage,
  unframePacket,
  verifyResponse,
} from '../../src/time/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'roughtime');

/**
 * يُعيدُ الخطأَ المرفوعَ أو يفشلُ — كي يُوازَنَ **الرمزُ** لا نصُّ رسالةٍ.
 *
 * @param {() => unknown} action
 * @returns {import('../../src/time/errors.mjs').TimeError}
 */
function caught(action) {
  try {
    action();
  } catch (error) {
    return /** @type {import('../../src/time/errors.mjs').TimeError} */ (error);
  }
  throw new Error('كان يجب أن يفشل ولم يفشل');
}

/**
 * @param {string} file
 * @returns {Array<Record<string, string>>}
 */
function parseVectors(file) {
  /** @type {Array<Record<string, string>>} */
  const blocks = [];
  /** @type {string} */
  let section = '';
  /** @type {Record<string, string>} */
  let current = {};
  const flush = () => {
    if (Object.keys(current).length > 0) {
      blocks.push({ section, ...current });
      current = {};
    }
  };
  for (const raw of readFileSync(path.join(FIXTURES, file), 'utf8').split('\n')) {
    const line = raw.trim();
    if (line === '') {
      flush();
      continue;
    }
    if (line.startsWith('[')) {
      flush();
      section = line.slice(1, -1);
      continue;
    }
    if (line.startsWith('#')) {
      current.comment = line.slice(1).trim();
      continue;
    }
    const separator = line.indexOf('=');
    current[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  flush();
  return blocks;
}

test('متَّجهاتُ طلبٍ خارجيّةٌ: الرزمةُ تُبنى بايتاً ببايتٍ كما يبنيها مُنفِّذٌ مستقلٌّ', () => {
  const vectors = parseVectors('roughtime_request.vec');
  const valid = vectors.filter(
    (vector) => vector.section === 'Valid' && vector.Nonce !== undefined,
  );
  assert.ok(valid.length >= 1, 'متَّجهُ طلبٍ صحيحٌ واحدٌ على الأقلِّ');
  for (const vector of valid) {
    const nonce = Buffer.from(String(vector.Nonce), 'hex');
    const built = encodeRequest({ nonce, dialectId: 'google' });
    assert.equal(built.toString('hex'), String(vector.Request).toLowerCase());
    assert.equal(
      built.length,
      1024,
      'الطلبُ مُثبَّتٌ عندَ ألفٍ وأربعةٍ وعشرينَ بايتاً كي لا يصيرَ الخادمُ مُضخِّماً في إغراقٍ',
    );
  }
});

test('متَّجهاتُ رُدودٍ خارجيّةٌ: الصحيحُ يُقبَلُ بوسطٍ ونصفِ قُطرٍ مطابقَينِ للرقمِ المنشورِ', () => {
  const vectors = parseVectors('roughtime_response.vec');
  /** @type {Buffer} */
  let nonce = Buffer.alloc(64);
  /** @type {Buffer} */
  let publicKey = Buffer.alloc(32);
  let accepted = 0;
  for (const vector of vectors) {
    if (vector.Nonce !== undefined) nonce = Buffer.from(vector.Nonce, 'hex');
    if (vector.Pubkey !== undefined) publicKey = Buffer.from(vector.Pubkey, 'hex');
    if (vector.Response === undefined || vector.section !== 'Valid') continue;
    const proof = verifyResponse({
      response: Buffer.from(vector.Response, 'hex'),
      nonce,
      publicKey,
      dialectId: 'google',
    });
    assert.equal(proof.dialect, 'google');
    assert.equal(proof.midpointMs, Math.round(Number(vector.MidpointMicroSeconds) / 1000));
    assert.equal(proof.radiusMs, Math.round(Number(vector.RadiusMicroSeconds) / 1000));
    assert.equal(proof.earliestMs, proof.midpointMs - proof.radiusMs);
    assert.equal(proof.latestMs, proof.midpointMs + proof.radiusMs);
    accepted += 1;
  }
  assert.equal(accepted, 3, 'ثلاثةُ رُدودٍ صحيحةٍ بأشجارِ ورقةٍ وورقتينِ وأربعِ أوراقٍ');
});

test('متَّجهاتُ رُدودٍ خارجيّةٌ: كلُّ رَدٍّ معطوبٍ يُرفَضُ برمزٍ لا يُقبَلُ بتحفُّظٍ', () => {
  const vectors = parseVectors('roughtime_response.vec');
  /** @type {Buffer} */
  let nonce = Buffer.alloc(64);
  /** @type {Buffer} */
  let publicKey = Buffer.alloc(32);
  let rejected = 0;
  for (const vector of vectors) {
    if (vector.Nonce !== undefined) nonce = Buffer.from(vector.Nonce, 'hex');
    if (vector.Pubkey !== undefined) publicKey = Buffer.from(vector.Pubkey, 'hex');
    if (vector.Response === undefined || vector.section !== 'Invalid') continue;
    assert.throws(
      () =>
        verifyResponse({
          response: Buffer.from(String(vector.Response), 'hex'),
          nonce,
          publicKey,
          dialectId: 'google',
        }),
      (error) => {
        assert.ok(
          error instanceof TimeError,
          `الرفضُ يجبُ أن يكونَ مُسمّى: ${vector.comment ?? ''}`,
        );
        assert.match(error.code, /^TIME_[A-Z_]+$/);
        return true;
      },
      `كانَ يجبُ رفضُ: ${vector.comment ?? ''}`,
    );
    rejected += 1;
  }
  assert.equal(rejected, 14, 'أربعةَ عشرَ رَدّاً معطوباً مع سببِ العطبِ منشوراً في المتَّجهِ');
});

test('حدُّ نصفِ القُطرِ يُطبَّقُ على متَّجهٍ صحيحٍ: فترةٌ أوسعُ من الحدِّ تُرفَضُ', () => {
  // المُستهانُ والمِفتاحُ يُقرآنِ **بالتسلسلِ** لا بأوّلِ ظهورٍ في الملفِّ: كلُّ
  // كتلةٍ تُغيِّرُهما لمن بعدَها، وأخذُ أوّلِ مُستهانٍ في الملفِّ يُقرِنُ رَدّاً
  // بمُستهانِ كتلةٍ أخرى فيُرفَضُ لسببٍ غيرِ الذي يُقاسُ.
  const vectors = parseVectors('roughtime_response.vec');
  /** @type {Buffer} */
  let nonce = Buffer.alloc(64);
  /** @type {Buffer} */
  let publicKey = Buffer.alloc(32);
  /** @type {Buffer | null} */
  let response = null;
  for (const vector of vectors) {
    if (vector.Nonce !== undefined) nonce = Buffer.from(vector.Nonce, 'hex');
    if (vector.Pubkey !== undefined) publicKey = Buffer.from(vector.Pubkey, 'hex');
    if (vector.section === 'Valid' && vector.Response !== undefined) {
      response = Buffer.from(vector.Response, 'hex');
      break;
    }
  }
  assert.ok(response !== null, 'متَّجهُ رَدٍّ صحيحٍ واحدٌ على الأقلِّ');
  // نصفُ قُطرِ المتَّجهِ ألفُ ميلي ثانيةٍ، والحدُّ أقلُّ منه.
  const error = caught(() =>
    verifyResponse({ response, nonce, publicKey, dialectId: 'google', maxRadiusMs: 999 }),
  );
  assert.equal(error.code, 'TIME_RADIUS_TOO_WIDE');
  // ومع حدٍّ يسعُ الفترةَ يُقبَلُ الرَّدُّ نفسُه — فالرفضُ من الحدِّ لا من عطبٍ.
  assert.equal(
    verifyResponse({ response, nonce, publicKey, dialectId: 'google', maxRadiusMs: 1000 }).radiusMs,
    1000,
  );
});

test('لهجةُ `ietf` تُغلِّفُ الرزمةَ وتُعلِنُ وسمَ النوعِ، ولهجةُ `google` لا تفعلُ', () => {
  const ietf = dialect('ietf');
  assert.equal(ietf.nonceLength, 32);
  assert.equal(ietf.hashLength, 32);
  assert.equal(ietf.framed, true);
  assert.equal(ietf.merkleLeaf, 'packet');
  const google = dialect('google');
  assert.equal(google.nonceLength, 64);
  assert.equal(google.hashLength, 64);
  assert.equal(google.framed, false);
  assert.equal(google.merkleLeaf, 'nonce');
  assert.notEqual(
    ietf.delegationContext.toString('latin1'),
    google.delegationContext.toString('latin1'),
  );

  const packet = encodeRequest({
    nonce: Buffer.alloc(32, 3),
    dialectId: 'ietf',
    serverPublicKey: Buffer.alloc(32, 4),
  });
  assert.equal(packet.subarray(0, 8).toString('latin1'), 'ROUGHTIM');
  assert.ok(packet.length >= 1024);
  const fields = parseMessage(unframePacket(packet));
  assert.equal(fields.get(TAGS.NONC)?.length, 32);
  assert.equal(fields.get(TAGS.TYPE)?.readUInt32LE(0), 0);
  assert.equal(fields.get(TAGS.VER)?.readUInt32LE(0), 1);
  assert.ok(
    fields.has(TAGS.SRV),
    'وسمُ الخادمِ يُشتَقُّ من مِفتاحِه فلا يُخدَمُ الطلبُ من خادمٍ آخرَ',
  );
});

test('لهجةٌ غيرُ مُنفَّذةٍ تُرفَضُ باسمِها لا تُخمَّنُ', () => {
  assert.equal(caught(() => dialect('roughenough')).code, 'TIME_INPUT_INVALID');
});
