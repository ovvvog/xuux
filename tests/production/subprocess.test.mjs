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
import { execSync, execFileSync } from 'node:child_process';
import { strictEqual, ok } from 'node:assert';
import { resolve } from 'node:path';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

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

// ── WL-514 ──
/*
 * ثابتُ `RISK-0054 = NO-GO` المطلق (‏`WL-514`).
 *
 * **علّةُ وجودِه فجوةٌ مقيسةٌ لا تكرار:** `S2` أعلاه يرفضُ اسمًا عشوائيًّا
 * (`'unsupported-backend'`)، فلو أُضيفَ `'tpm-nv'` إلى `SUPPORTED_FRESHNESS_BACKENDS` لبقيَ أخضر.
 * وحارسُ الملفّاتِ المحميّةِ في `tests/sim/tpm-ceremony-guard.test.mjs` **نسبيٌّ**: يقابلُ الشجرةَ
 * بالأساسِ، فيمنعُ التغييرَ ولا يصفُ الحالة. وهذا الاختبارُ يصفُ الحالةَ نفسَها مطلقًا:
 * المجموعةُ فارغةٌ حرفيًّا، ولا إضافةَ إليها، والمُشغِّلُ لا يُنشئُ مقبسًا.
 *
 * **ولا يُعدَّلُ هذا الاختبارُ إلا معَ رفعِ `RISK-0054` بقرارٍ مخوَّلٍ (ق5)** — وهو قرارٌ محجوزٌ للمالك.
 * لا يقرأُ إلا النصَّ، فلا يحتاجُ بناءً ولا `node_modules`.
 */
const ENTRY = 'scripts/production-entry.mjs';
const entrySource = readFileSync(resolve(REPO_ROOT, ENTRY), 'utf8');

/** يحذفُ التعليقاتِ كي لا يُخدَعَ الفحصُ بنصٍّ معلَّق. @param {string} text @returns {string} */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/.*$/gmu, '$1');
}
const entryCode = stripComments(entrySource);

describe('RISK-0054 = NO-GO — مجموعةُ مصادرِ الحداثةِ المدعومةِ فارغةٌ حرفيًّا', () => {
  test('تعريفٌ واحدٌ فقط، وهو `new Set([])` بلا عنصر', () => {
    const defs = [...entryCode.matchAll(/SUPPORTED_FRESHNESS_BACKENDS\s*=\s*([^;]+);/gu)];
    assert.equal(defs.length, 1, `يلزمُ تعريفٌ واحدٌ في ${ENTRY}، وُجدَ ${defs.length}`);
    const rhs = defs[0]?.[1] ?? '';
    assert.match(rhs.trim(), /^new Set\(\s*\[\s*\]\s*\)$/u, `التعريفُ ليس فارغًا: ${rhs}`);
  });

  test('لا إضافةَ ولا إعادةَ إسنادٍ ولا تمريرَ للمجموعةِ إلى ما يعدّلُها', () => {
    const uses = [...entryCode.matchAll(/SUPPORTED_FRESHNESS_BACKENDS(\s*\.\s*\w+)?/gu)].map((m) =>
      (m[1] ?? '').replace(/\s/gu, ''),
    );
    // الاستعمالُ المسموحُ: التعريفُ (بلا لاحقة) والسؤالُ `.has` وحدَه.
    const disallowed = uses.filter((u) => u !== '' && u !== '.has');
    assert.deepEqual(disallowed, [], `استعمالٌ غيرُ مسموح: ${disallowed.join(', ')}`);
    assert.equal(
      uses.filter((u) => u === '').length,
      1,
      'ظهورٌ عارٍ إضافيٌّ للمجموعة (تمريرٌ أو إسناد)',
    );
  });

  test('المُشغِّلُ لا يُنشئُ مقبسَ حداثةٍ (‏`freshnessSocket = null`)', () => {
    assert.match(entryCode, /const freshnessSocket = null;/u);
    assert.doesNotMatch(entryCode, /new\s+\w*FreshnessSocket\s*\(/u, 'المُشغِّلُ يُنشئُ مقبسًا');
  });

  test('لا تعريفَ آخرَ للمجموعةِ في الشجرةِ المتعقَّبة', () => {
    const files = execFileSync(
      'git',
      [
        '-C',
        REPO_ROOT,
        'grep',
        '-l',
        '-e',
        'SUPPORTED_FRESHNESS_BACKENDS\\s*=',
        '--',
        'src',
        'scripts',
        'sim',
      ],
      {
        encoding: 'utf8',
      },
    )
      .split('\n')
      .filter(Boolean);
    assert.deepEqual(files, [ENTRY]);
  });
});
