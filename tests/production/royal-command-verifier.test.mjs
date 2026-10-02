// @ts-nocheck
/**
 * tests/production/royal-command-verifier.test.mjs
 *
 * P0-A — اختباراتُ التحققِ التشفيريِّ من الأمرِ الملكيِّ على halt/resume.
 *
 * يُثبتُ أنّ:
 *   1. غيابُ التوقيعِ يُرفَضُ (لا يُقبلُ كائنٌ بلا توقيعٍ).
 *   2. التوقيعُ الخاطئُ مرفوضٌ.
 *   3. الكائنُ المزوَّرُ مرفوضٌ.
 *   4. التوقيعُ الصحيحُ لـ halt يقبلُ halt فقط.
 *   5. توقيعُ halt لا يقبلُ resume.
 *   6. الـ verifier الافتراضي لا يُمرِّرُ `() => true`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as softwareSign } from 'node:crypto';
import {
  createRoyalCommandVerifier,
  canonicalRoyalCommand,
} from '../../src/root-of-trust/royal-command.mjs';
import { fingerprint } from '../../src/root-of-trust/index.mjs';

function fixedKeys() {
  const king = generateKeyPairSync('ed25519');
  return { king };
}

function royalCommand(keys, operation, opts = {}) {
  const kingId = 'king:' + fingerprint(keys.king.publicKey).slice(0, 24);
  const body = {
    operation,
    signerId: kingId,
    reason: opts.reason ?? 'test',
    at: opts.at ?? new Date().toISOString(),
  };
  const signature = softwareSign(
    null,
    Buffer.from(canonicalRoyalCommand(body)),
    keys.king.privateKey,
  ).toString('base64url');
  return { ...body, signature };
}

describe('P0-A — التحققُ التشفيريُّ من الأمرِ الملكيِّ', () => {
  const keys = fixedKeys();
  const verifier = createRoyalCommandVerifier(
    keys.king.publicKey.export({ type: 'spki', format: 'pem' }),
  );

  test('V1 — غيابُ التوقيعِ مرفوضٌ', () => {
    const cmd = { operation: 'halt', signerId: 'king:test', reason: 'test' };
    assert.strictEqual(verifier(cmd), false, 'Command without signature must be rejected');
  });

  test('V2 — التوقيعُ الخاطئُ مرفوضٌ', () => {
    const cmd = royalCommand(keys, 'halt');
    const forged = { ...cmd, signature: 'a'.repeat(64) };
    assert.strictEqual(verifier(forged), false, 'Bad signature must be rejected');
  });

  test('V3 — الكائنُ المزوَّرُ مرفوضٌ', () => {
    const cmd = royalCommand(keys, 'halt');
    const tampered = { ...cmd, reason: 'different-reason' };
    assert.strictEqual(verifier(tampered), false, 'Tampered command must be rejected');
  });

  test('V4 — التوقيعُ الصحيحُ لـ halt يقبلُ halt', () => {
    const cmd = royalCommand(keys, 'halt');
    assert.strictEqual(verifier(cmd), true, 'Valid halt signature must be accepted');
  });

  test('V5 — توقيعُ halt لا يقبلُ resume', () => {
    const cmd = royalCommand(keys, 'halt');
    // Try to use halt signature for resume
    const tampered = { ...cmd, operation: 'resume' };
    assert.strictEqual(verifier(tampered), false, 'Halt signature must not accept resume');
  });

  test('V6 — الـ signerId غيرُ المطابقِ مرفوضٌ', () => {
    const cmd = royalCommand(keys, 'halt');
    // Re-sign with correct body but wrong signerId in the command
    const body = { operation: 'halt', signerId: 'king:wrong', reason: cmd.reason, at: cmd.at };
    const signature = softwareSign(
      null,
      Buffer.from(JSON.stringify(body)),
      keys.king.privateKey,
    ).toString('base64url');
    const forgedCmd = { ...body, signature };
    assert.strictEqual(verifier(forgedCmd), false, 'Wrong signerId must be rejected');
  });

  test('V7 — لا يوجد default () => true — الـ verifier يُشتَقُّ من المفتاح العام', () => {
    // The verifier must not be () => true — it must verify signatures
    const unsignedCmd = { operation: 'halt', signerId: 'king:test' };
    assert.strictEqual(verifier(unsignedCmd), false, 'Verifier must not accept unsigned commands');
    // And it must reject null
    assert.strictEqual(verifier(null), false, 'Verifier must reject null');
    assert.strictEqual(verifier(undefined), false, 'Verifier must reject undefined');
  });
});
