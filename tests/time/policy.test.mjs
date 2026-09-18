// سياسةُ الوقتِ: تُحمَّلُ وتُفحَصُ أو تُرفَضُ برمزِها — `D-7` (‏`WL-192`).
//
// المقيسُ ليس أنّ الملفَّ يُقرأُ، بل أنَّ سياسةً **تبدو صحيحةً نحوياً وتُعطِّلُ
// الضمانَ** تُرفَضُ عندَ التحميلِ: نِصابٌ فوقَ عددِ المصادرِ، ومصادرُ من مِفتاحٍ
// واحدٍ، وحدودٌ متناقضةٌ، ولهجةٌ لا مُفكِّكَ لها.

import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import YAML from 'yaml';

import { loadTimePolicy } from '../../src/time/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** مِفتاحانِ مُعلَنانِ في القائمةِ المنشورةِ — يُستعملانِ شكلاً لا اتّصالاً. */
const KEY_A = '0GD7c3yP8xEc4Zl2zeuN2SlLvDVVocjsPSL8/Rl/7zg=';
const KEY_B = 'AW5uAoTSTDfG5NfY1bTh08GUnOqlRb+HVhbJ3ODJvsE=';

/**
 * @param {Record<string, unknown>} overrides
 * @returns {{ dir: string, cleanup: () => void }}
 */
function writePolicy(overrides) {
  const dir = registerTmpRoot(mkdtempSync(path.join(tmpdir(), 'xuux-time-policy-')));
  mkdirSync(path.join(dir, 'schemas'));
  copyFileSync(
    path.join(ROOT, 'config', 'schemas', 'time.schema.json'),
    path.join(dir, 'schemas', 'time.schema.json'),
  );
  const base = {
    version: 1,
    quorum: 2,
    maxRadiusMs: 3000,
    maxAgeMs: 900000,
    maxLocalSkewMs: 5000,
    requestTimeoutMs: 3000,
    sovereign: { requireAttestedTime: true },
    sources: [
      { id: 'src-a', dialect: 'ietf', host: 'a.example.org', port: 2002, publicKey: KEY_A },
      { id: 'src-b', dialect: 'ietf', host: 'b.example.org', port: 2002, publicKey: KEY_B },
    ],
  };
  writeFileSync(path.join(dir, 'time.yaml'), YAML.stringify({ ...base, ...overrides }));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
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

test('سياسةُ المستودعِ تُحمَّلُ وتُلزِمُ الوقتَ المُبرهَنَ في المسارِ السياديِّ', () => {
  const policy = loadTimePolicy({ dir: path.join(ROOT, 'config') });
  assert.equal(policy.requireAttestedTime, true, 'معيارُ إغلاقِ D-7 نفسُه');
  assert.ok(policy.quorum >= 2);
  assert.ok(policy.sources.length >= policy.quorum);
  for (const source of policy.sources) {
    assert.equal(source.publicKey.length, 32, 'مِفتاحُ ed25519 اثنانِ وثلاثونَ بايتاً');
  }
  assert.equal(policy.source('cloudflare').port, 2003);
  assert.equal(caught(() => policy.source('لا-وجود-له')).code, 'TIME_SOURCE_UNKNOWN');
});

test('نِصابٌ فوقَ عددِ المصادرِ تعطيلٌ مكتوبٌ سياسةً فيُرفَضُ عندَ التحميلِ', () => {
  const { dir, cleanup } = writePolicy({ quorum: 3 });
  try {
    const error = caught(() => loadTimePolicy({ dir }));
    assert.equal(error.code, 'TIME_CONFIG_INVALID');
    assert.match(error.message, /أكبرُ من عددِ المصادرِ/);
  } finally {
    cleanup();
  }
});

test('مصدرانِ بمفتاحٍ واحدٍ أو عنوانٍ واحدٍ نِصابٌ متوهَّمٌ فيُرفَضانِ', () => {
  const sameKey = writePolicy({
    sources: [
      { id: 'src-a', dialect: 'ietf', host: 'a.example.org', port: 2002, publicKey: KEY_A },
      { id: 'src-b', dialect: 'ietf', host: 'b.example.org', port: 2002, publicKey: KEY_A },
    ],
  });
  try {
    assert.match(caught(() => loadTimePolicy({ dir: sameKey.dir })).message, /مِفتاحٌ مكرَّرٌ/);
  } finally {
    sameKey.cleanup();
  }

  const sameHost = writePolicy({
    sources: [
      { id: 'src-a', dialect: 'ietf', host: 'a.example.org', port: 2002, publicKey: KEY_A },
      { id: 'src-b', dialect: 'ietf', host: 'a.example.org', port: 2002, publicKey: KEY_B },
    ],
  });
  try {
    assert.match(caught(() => loadTimePolicy({ dir: sameHost.dir })).message, /عنوانٌ مكرَّرٌ/);
  } finally {
    sameHost.cleanup();
  }
});

test('حدودٌ متناقضةٌ تُرفَضُ: عمرٌ أضيقُ من نصفِ القُطرِ، وانزياحٌ أضيقُ منه', () => {
  const narrowAge = writePolicy({ maxAgeMs: 2000, maxRadiusMs: 3000 });
  try {
    assert.match(caught(() => loadTimePolicy({ dir: narrowAge.dir })).message, /حدُّ العمرِ/);
  } finally {
    narrowAge.cleanup();
  }
  const narrowSkew = writePolicy({ maxLocalSkewMs: 1000, maxRadiusMs: 3000 });
  try {
    assert.match(
      caught(() => loadTimePolicy({ dir: narrowSkew.dir })).message,
      /حدُّ انزياحِ ساعةِ الجهازِ/,
    );
  } finally {
    narrowSkew.cleanup();
  }
});

test('لهجةٌ لا مُفكِّكَ لها تُرفَضُ في السياسةِ لا تُسأَلُ ثمّ يُعجَزُ عن فهمِها', () => {
  const { dir, cleanup } = writePolicy({
    sources: [
      { id: 'src-a', dialect: 'ietf', host: 'a.example.org', port: 2002, publicKey: KEY_A },
      { id: 'src-b', dialect: 'roughenough', host: 'b.example.org', port: 2002, publicKey: KEY_B },
    ],
  });
  try {
    // المخطَّطُ يحصرُ اللهجاتَ، فالرفضُ يقعُ منه أو من فحصِ التماسكِ — والمهمُّ
    // أنّه يقعُ عندَ التحميلِ برمزٍ واحدٍ لا عندَ أوّلِ سؤالٍ.
    assert.equal(caught(() => loadTimePolicy({ dir })).code, 'TIME_CONFIG_INVALID');
  } finally {
    cleanup();
  }
});

test('سياسةٌ مفقودةٌ أو مخطَّطٌ مفقودٌ رفضٌ مُسمّى لا افتراضاتٌ في الكودِ', () => {
  const dir = registerTmpRoot(mkdtempSync(path.join(tmpdir(), 'xuux-time-empty-')));
  try {
    assert.equal(caught(() => loadTimePolicy({ dir })).code, 'TIME_CONFIG_INVALID');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
