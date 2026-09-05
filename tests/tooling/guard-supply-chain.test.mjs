import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../');

// اختبارات حاجز سلسلة التوريد — M11.02
//
// كلُّ اختبار يهيِّئ جذرًا مؤقّتًا ويُشغّل الحاجزَ ثم يتحقّق من الحكم.

function runGuard(root) {
  try {
    const output = execFileSync('node', ['scripts/guard-supply-chain.mjs', '--root', root], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, output };
  } catch (error) {
    return { ok: false, output: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

function makeTempRoot() {
  const tmp = path.join(
    repoRoot,
    '.test-tmp',
    `supply-chain-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmp, { recursive: true });
  return tmp;
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

test('guard:supply-chain passes when all conditions are met', () => {
  const tmp = makeTempRoot();
  try {
    // Minimal valid setup
    mkdirSync(path.join(tmp, 'node_modules'), { recursive: true });
    writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({
        name: 'test',
        version: '1.0.0',
        private: true,
        dependencies: { pg: '8.23.0' },
        devDependencies: { typescript: '5.9.3' },
      }),
    );
    writeFileSync(
      path.join(tmp, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        name: 'test',
        packages: {},
      }),
    );
    writeFileSync(
      path.join(tmp, 'sbom.cdx.json'),
      JSON.stringify({
        bomFormat: 'CycloneDX',
        specVersion: '1.4',
        components: [{ name: 'pg', version: '8.23.0' }],
      }),
    );
    writeFileSync(
      path.join(tmp, 'audit-report.json'),
      JSON.stringify({
        vulnerabilities: {},
      }),
    );
    writeFileSync(path.join(tmp, '.gitignore'), 'node_modules\n');

    const result = runGuard(tmp);
    assert.equal(result.ok, true, `Expected pass, got: ${result.output || result.stderr}`);
  } finally {
    cleanup(tmp);
  }
});

test('guard:supply-chain fails when package-lock.json is missing', () => {
  const tmp = makeTempRoot();
  try {
    writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({
        name: 'test',
        version: '1.0.0',
        dependencies: { pg: '8.23.0' },
      }),
    );
    writeFileSync(
      path.join(tmp, 'sbom.cdx.json'),
      JSON.stringify({
        bomFormat: 'CycloneDX',
        components: [{ name: 'pg' }],
      }),
    );
    writeFileSync(path.join(tmp, 'audit-report.json'), JSON.stringify({ vulnerabilities: {} }));
    writeFileSync(path.join(tmp, '.gitignore'), 'node_modules\n');

    const result = runGuard(tmp);
    assert.equal(result.ok, false);
    assert.match(result.stderr || result.output, /R0/);
  } finally {
    cleanup(tmp);
  }
});

test('guard:supply-chain fails when dependencies are not pinned', () => {
  const tmp = makeTempRoot();
  try {
    writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({
        name: 'test',
        version: '1.0.0',
        dependencies: { pg: '^8.23.0' },
      }),
    );
    writeFileSync(
      path.join(tmp, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        name: 'test',
        packages: {},
      }),
    );
    writeFileSync(
      path.join(tmp, 'sbom.cdx.json'),
      JSON.stringify({
        bomFormat: 'CycloneDX',
        components: [{ name: 'pg' }],
      }),
    );
    writeFileSync(path.join(tmp, 'audit-report.json'), JSON.stringify({ vulnerabilities: {} }));
    writeFileSync(path.join(tmp, '.gitignore'), 'node_modules\n');

    const result = runGuard(tmp);
    assert.equal(result.ok, false);
    assert.match(result.stderr || result.output, /R1/);
  } finally {
    cleanup(tmp);
  }
});

test('guard:supply-chain fails when SBOM is missing', () => {
  const tmp = makeTempRoot();
  try {
    writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({
        name: 'test',
        version: '1.0.0',
        dependencies: { pg: '8.23.0' },
      }),
    );
    writeFileSync(
      path.join(tmp, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        name: 'test',
        packages: {},
      }),
    );
    writeFileSync(path.join(tmp, 'audit-report.json'), JSON.stringify({ vulnerabilities: {} }));
    writeFileSync(path.join(tmp, '.gitignore'), 'node_modules\n');

    const result = runGuard(tmp);
    assert.equal(result.ok, false);
    assert.match(result.stderr || result.output, /R2/);
  } finally {
    cleanup(tmp);
  }
});

test('guard:supply-chain fails when critical vulnerabilities exist', () => {
  const tmp = makeTempRoot();
  try {
    writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({
        name: 'test',
        version: '1.0.0',
        dependencies: { pg: '8.23.0' },
      }),
    );
    writeFileSync(
      path.join(tmp, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        name: 'test',
        packages: {},
      }),
    );
    writeFileSync(
      path.join(tmp, 'sbom.cdx.json'),
      JSON.stringify({
        bomFormat: 'CycloneDX',
        components: [{ name: 'pg' }],
      }),
    );
    writeFileSync(
      path.join(tmp, 'audit-report.json'),
      JSON.stringify({
        vulnerabilities: {
          pg: { severity: 'critical', via: [{ title: 'SQL Injection' }] },
        },
      }),
    );
    writeFileSync(path.join(tmp, '.gitignore'), 'node_modules\n');

    const result = runGuard(tmp);
    assert.equal(result.ok, false);
    assert.match(result.stderr || result.output, /R3/);
  } finally {
    cleanup(tmp);
  }
});
