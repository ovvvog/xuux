/**
 * tests/production/subprocess.test.mjs
 *
 * اختباراتُ الإقلاعِ الإنتاجيِّ في عمليةٍ منفصلةٍ — تُشغِّلُ العقدةَ ببيئةِ
 * إنتاجٍ فعليةٍ (NODE_ENV=production، STATE_ENV=production) وتُثبتُ النجاحَ
 * مع deps اختباريةٍ والفشلَ المغلقَ عند غيابِ الساعةِ الموثوقةِ أو backend الحداثة.
 *
 * هذه الاختباراتُ **مختلفةٌ** عن اختباراتِ `entrypoint.test.mjs` التي تُشغِّلُ
 * `createProductionSystem()` في نفس العمليةِ مع deps مُحقَنة. هنا تُختبرُ
 * نقطةُ الدخولِ الحقيقيّةُ `scripts/production-entry.mjs` في عمليةٍ منفصلةٍ.
 */
import { test, describe } from 'node:test';
import { execSync } from 'node:child_process';
import { strictEqual, ok } from 'node:assert';
import { resolve } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const RUNNER = resolve(REPO_ROOT, 'scripts', 'production-entry.mjs');

const BASE_ENV = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  NODE_ENV: 'production',
  STATE_ENV: 'production',
  XUUX_ROOT_OF_TRUST_MODE: 'hsm',
  XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
  XUUX_PKCS11_TOKEN: 'xuux-test',
  XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
  XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
  XUUX_PKCS11_PIN: 'unused',
  XUUX_ROOT_OF_TRUST_PROVISION: '1',
};

function runProductionEntry(extraEnv = {}) {
  const env = { ...BASE_ENV, ...extraEnv };
  try {
    const stdout = execSync('node "' + RUNNER + '"', {
      env,
      timeout: 10000,
      stdio: 'pipe',
      cwd: REPO_ROOT,
    });
    return { exitCode: 0, stdout: stdout.toString(), stderr: '' };
  } catch (err) {
    const e = /** @type {{ status?: number, stdout?: Buffer, stderr?: Buffer }} */ (err);
    return {
      exitCode: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

/** @param {string} fixturePath */
function runFixture(fixturePath) {
  try {
    const stdout = execSync('node "' + fixturePath + '"', {
      env: { ...process.env, NODE_ENV: 'production', STATE_ENV: 'production' },
      timeout: 15000,
      stdio: 'pipe',
      cwd: REPO_ROOT,
    });
    return { exitCode: 0, stdout: stdout.toString(), stderr: '' };
  } catch (err) {
    const e = /** @type {{ status?: number, stdout?: Buffer, stderr?: Buffer }} */ (err);
    return {
      exitCode: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

describe('Subprocess Production Boot — اختباراتُ عمليةٍ منفصلةٍ', () => {
  test('S0 — عمليةٌ منفصلةٌ تُقلعُ ببيئةِ إنتاجٍ فعليةٍ مع deps اختبارية', () => {
    const fixturePath = resolve(
      REPO_ROOT,
      'tests',
      'production',
      'fixtures',
      'subprocess-boot.mjs',
    );
    const result = runFixture(fixturePath);
    strictEqual(result.exitCode, 0, 'Subprocess boot must succeed with test deps');
    const output = JSON.parse(result.stdout.trim());
    strictEqual(output.ok, true, 'Boot must report ok=true');
    strictEqual(output.kingIdMatches, true, 'King ID must match HSM public key fingerprint');
    strictEqual(output.signThrows, true, 'Sign must fail (no private key in memory)');
    strictEqual(output.verifyWorks, true, 'Verify must work (returns false for bad sig)');
  });

  test('S1 — production-entry.mjs يرفضُ البيئةَ غيرَ الإنتاجيةِ', () => {
    const result = runProductionEntry({ NODE_ENV: 'development', STATE_ENV: 'development' });
    strictEqual(result.exitCode, 1);
    ok(
      result.stderr.includes('requires NODE_ENV=production') ||
        result.stderr.includes('STATE_ENV=production'),
      'Runner must reject non-production env',
    );
  });

  test('S2 — production-entry.mjs يرفضُ backendَ حداثةٍ غيرَ مدعومٍ (فشلٌ مغلقٌ)', () => {
    const tmpRoot = '/tmp/xuux-subprocess-unsupported-' + process.pid;
    try {
      mkdirSync(tmpRoot, { recursive: true });
      const result = runProductionEntry({
        XUUX_STATE_ROOT: tmpRoot,
        XUUX_FRESHNESS_BACKEND: 'unsupported-backend',
      });
      // Should fail — no supported freshness backend in this environment
      strictEqual(result.exitCode, 1);
      ok(
        result.stderr.includes('not supported') || result.stderr.includes('XUUX_FRESHNESS_BACKEND'),
        'Runner must reject unsupported freshness backend. Got: ' + result.stderr,
      );
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('S3 — production-entry.mjs يفشلُ مغلقاً بلا مقبسِ حداثةٍ', () => {
    const tmpRoot = '/tmp/xuux-subprocess-no-freshness-' + process.pid;
    try {
      mkdirSync(tmpRoot, { recursive: true });
      const result = runProductionEntry({
        XUUX_STATE_ROOT: tmpRoot,
        // No XUUX_FRESHNESS_BACKEND
      });
      strictEqual(result.exitCode, 1);
      ok(
        result.stderr.includes('XUUX_FRESHNESS_BACKEND') || result.stderr.includes('freshness'),
        'Runner must fail without freshness backend. Got: ' + result.stderr,
      );
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
