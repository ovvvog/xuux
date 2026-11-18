import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, readFileSync, cpSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../');

// اختبارات حاجز سلسلة التوريد — M11.02
//
// كلُّ اختبار يهيِّئ جذرًا مؤقّتًا ويُشغّل الحاجزَ ثم يتحقّق من الحكم.

/** @param {string} root */
function runGuard(root) {
  try {
    const output = execFileSync('node', ['scripts/guard-supply-chain.mjs', '--root', root], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, output };
  } catch (error) {
    const err = /** @type {Error & { stdout?: string; stderr?: string }} */ (error);
    return { ok: false, output: err.stdout ?? '', stderr: err.stderr ?? '' };
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

/** @param {string} root */
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

// ── WL-557: استثناءٌ ضيّقٌ مؤقّتٌ لثغرةٍ بلا إصدارٍ مُصلَح (‏GHSA-fc5q-39xc-vjpf، picomatch ≤ 4.0.7، «Patched: None»). ──
// الاستثناءُ بمعرّفِ التبليغِ لا باسمِ الحزمة، ولا يُعذِرُ إلا عقدةً تطويريّةً (‏dev: true في ملفِّ القفل) قبلَ تاريخِ انقضائه،
// وبشدّةٍ لا تتجاوزُ المُعلَنة؛ وكلُّ ثغرةٍ عاليةٍ أخرى في السلسلةِ نفسِها تُسقِطُ الإعذار.

const PICO_URL = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
/** @param {Record<string, any>} [over] */
const picoAudit = (over = {}) => ({
  vulnerabilities: {
    picomatch: {
      name: 'picomatch',
      severity: 'high',
      via: [{ name: 'picomatch', url: PICO_URL, severity: 'high', title: 'ReDoS' }],
      nodes: ['node_modules/picomatch'],
    },
    fdir: { name: 'fdir', severity: 'high', via: ['picomatch'], nodes: ['node_modules/fdir'] },
    tinyglobby: {
      name: 'tinyglobby',
      severity: 'high',
      via: ['fdir', 'picomatch'],
      nodes: ['node_modules/tinyglobby'],
    },
    minimatch: {
      name: 'minimatch',
      severity: 'moderate',
      via: [
        {
          name: 'minimatch',
          url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249',
          severity: 'moderate',
        },
      ],
      nodes: ['node_modules/minimatch'],
    },
    'ts-estree': {
      name: 'ts-estree',
      severity: 'high',
      via: ['minimatch', 'tinyglobby'],
      nodes: ['node_modules/ts-estree'],
    },
    ...over,
  },
});
/** @param {boolean} [dev] */
const picoLock = (dev = true) => ({
  lockfileVersion: 3,
  packages: Object.fromEntries(
    ['picomatch', 'fdir', 'tinyglobby', 'minimatch', 'ts-estree'].map((n) => [
      `node_modules/${n}`,
      dev ? { version: '1.0.0', dev: true } : { version: '1.0.0' },
    ]),
  ),
});
const NOW = new Date('2026-11-18T12:00:00Z');

test('WL-557: الإعذارُ يقبلُ ثغرةَ picomatch التطويريّةَ قبلَ الانقضاء — وكلُّ عقدةٍ عاليةٍ في سلسلتها مُعذَرة', async () => {
  const { evaluateAudit, AUDIT_EXCEPTIONS } = await import('../../scripts/audit-check.mjs');
  assert.ok(AUDIT_EXCEPTIONS.some((e) => e.advisory === PICO_URL && e.maxSeverity === 'high'));
  const r = evaluateAudit(picoAudit(), picoLock(true), NOW);
  assert.deepEqual(r.blocking, []);
  assert.deepEqual(r.excused.map((x) => x.name).sort(), [
    'fdir',
    'picomatch',
    'tinyglobby',
    'ts-estree',
  ]);
});

test('WL-557: عقدةٌ إنتاجيّةٌ (‏بلا dev في ملفِّ القفل) لا تُعذَر', async () => {
  const { evaluateAudit } = await import('../../scripts/audit-check.mjs');
  const r = evaluateAudit(picoAudit(), picoLock(false), NOW);
  assert.deepEqual(r.excused, []);
  assert.deepEqual(r.blocking.map((x) => x.name).sort(), [
    'fdir',
    'picomatch',
    'tinyglobby',
    'ts-estree',
  ]);
  // ‏عقدةٌ غائبةٌ عن ملفِّ القفلِ كذلك: لا يُفترَضُ أنّها تطويريّة.
  const r2 = evaluateAudit(picoAudit(), { lockfileVersion: 3, packages: {} }, NOW);
  assert.equal(r2.blocking.length, 4);
});

test('WL-557: بعدَ تاريخِ الانقضاءِ لا إعذار (‏يُعادُ النظرُ أو يُجدَّدُ بقرارٍ مُسجَّل)', async () => {
  const { evaluateAudit, AUDIT_EXCEPTIONS } = await import('../../scripts/audit-check.mjs');
  const e = AUDIT_EXCEPTIONS.find((x) => x.advisory === PICO_URL);
  assert.ok(e !== undefined);
  const after = new Date(Date.parse(`${e.expires}T00:00:00Z`) + 1);
  assert.equal(evaluateAudit(picoAudit(), picoLock(true), after).blocking.length, 4);
  assert.ok(
    Date.parse(`${e.expires}T00:00:00Z`) - NOW.getTime() <= 31 * 86400000,
    'الانقضاءُ خلالَ شهرٍ على الأكثر',
  );
});

test('WL-557: ثغرةٌ عاليةٌ أخرى في السلسلة، أو شدّةٌ حرجة، أو تبليغٌ غيرُ مُستثنى — تُسقِطُ الإعذار', async () => {
  const { evaluateAudit } = await import('../../scripts/audit-check.mjs');
  const other = {
    name: 'minimatch',
    url: 'https://github.com/advisories/GHSA-zzzz-zzzz-zzzz',
    severity: 'high',
  };
  const mixed = picoAudit({
    minimatch: {
      name: 'minimatch',
      severity: 'high',
      via: [other],
      nodes: ['node_modules/minimatch'],
    },
  });
  const r = evaluateAudit(mixed, picoLock(true), NOW);
  assert.deepEqual(r.blocking.map((x) => x.name).sort(), ['minimatch', 'ts-estree']);
  const crit = picoAudit();
  const cp = /** @type {any} */ (crit.vulnerabilities)['picomatch'];
  cp.severity = 'critical';
  cp.via[0].severity = 'critical';
  assert.ok(evaluateAudit(crit, picoLock(true), NOW).blocking.some((x) => x.name === 'picomatch'));
  const unknown = {
    vulnerabilities: {
      pg: {
        name: 'pg',
        severity: 'high',
        via: [{ url: 'https://x/GHSA-1', severity: 'high' }],
        nodes: ['node_modules/pg'],
      },
    },
  };
  assert.equal(
    evaluateAudit(unknown, { packages: { 'node_modules/pg': { dev: true } } }, NOW).blocking.length,
    1,
  );
  // ‏سلسلةٌ دائريّةٌ أو اسمٌ غيرُ موجودٍ في via: لا إعذارَ بالغياب.
  const dangling = {
    vulnerabilities: {
      a: { name: 'a', severity: 'high', via: ['ghost'], nodes: ['node_modules/a'] },
    },
  };
  assert.equal(
    evaluateAudit(dangling, { packages: { 'node_modules/a': { dev: true } } }, NOW).blocking.length,
    1,
  );
});

test('WL-557: حاجزُ سلسلةِ التوريد (‏R3) يُطبِّقُ الإعذارَ نفسَه على التقرير — ويرفضُه للعقدةِ الإنتاجيّة', () => {
  for (const dev of [true, false]) {
    const tmp = makeTempRoot();
    try {
      mkdirSync(path.join(tmp, 'node_modules'), { recursive: true });
      writeFileSync(
        path.join(tmp, 'package.json'),
        JSON.stringify({
          name: 't',
          version: '1.0.0',
          private: true,
          dependencies: { pg: '8.23.0' },
        }),
      );
      writeFileSync(
        path.join(tmp, 'package-lock.json'),
        JSON.stringify({ name: 't', ...picoLock(dev) }),
      );
      writeFileSync(
        path.join(tmp, 'sbom.cdx.json'),
        JSON.stringify({ bomFormat: 'CycloneDX', components: [{ name: 'pg' }] }),
      );
      writeFileSync(path.join(tmp, 'audit-report.json'), JSON.stringify(picoAudit()));
      writeFileSync(path.join(tmp, '.gitignore'), 'node_modules\n');
      const result = runGuard(tmp);
      assert.equal(result.ok, dev, `dev=${dev}: ${result.stderr || result.output}`);
      if (!dev) assert.match(result.stderr || result.output, /R3/);
    } finally {
      cleanup(tmp);
    }
  }
});

test('WL-557: التطويريّةُ لكلِّ عقدةٍ ولكلِّ مسار — وسيطٌ إنتاجيٌّ أو مصدرٌ إنتاجيٌّ أو مسارٌ ثانٍ إنتاجيٌّ لا يُعذَر', async () => {
  const { evaluateAudit } = await import('../../scripts/audit-check.mjs');
  const mid = picoLock(true);
  mid.packages['node_modules/ts-estree'] = { version: '1.0.0' };
  assert.deepEqual(
    evaluateAudit(picoAudit(), mid, NOW).blocking.map((x) => x.name),
    ['ts-estree'],
  );
  const src = picoLock(true);
  src.packages['node_modules/picomatch'] = { version: '1.0.0' };
  assert.deepEqual(
    evaluateAudit(picoAudit(), src, NOW).blocking.map((x) => x.name),
    ['fdir', 'picomatch', 'tinyglobby', 'ts-estree'],
  );
  const two = picoAudit();
  two.vulnerabilities.picomatch.nodes = [
    'node_modules/picomatch',
    'node_modules/x/node_modules/picomatch',
  ];
  const lk = picoLock(true);
  lk.packages['node_modules/x/node_modules/picomatch'] = { version: '1.0.0' };
  assert.ok(evaluateAudit(two, lk, NOW).blocking.some((x) => x.name === 'picomatch'));
});

test('WL-557: اسمٌ غيرُ محلولٍ بينَ أسماءِ via المحلولةِ يُسقِطُ الإعذار', async () => {
  const { evaluateAudit } = await import('../../scripts/audit-check.mjs');
  const a = picoAudit();
  a.vulnerabilities.tinyglobby.via = ['picomatch', 'ghost'];
  assert.ok(evaluateAudit(a, picoLock(true), NOW).blocking.some((x) => x.name === 'tinyglobby'));
});

/**
 * WL-565: جذرٌ أدنى صالحٌ بكلِّ الشروطِ إلا R5، بحزمِ قفلٍ يحدّدُها الاختبار.
 *
 * @param {Record<string, unknown>} packages
 */
function floorRoot(packages) {
  const tmp = makeTempRoot();
  mkdirSync(path.join(tmp, 'node_modules'), { recursive: true });
  writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({
      name: 'test',
      version: '1.0.0',
      private: true,
      devDependencies: { ajv: '8.20.0' },
    }),
  );
  writeFileSync(
    path.join(tmp, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      name: 'test',
      packages: { '': { name: 'test' }, ...packages },
    }),
  );
  writeFileSync(
    path.join(tmp, 'sbom.cdx.json'),
    JSON.stringify({
      bomFormat: 'CycloneDX',
      specVersion: '1.4',
      components: [{ name: 'ajv', version: '8.20.0' }],
    }),
  );
  writeFileSync(path.join(tmp, 'audit-report.json'), JSON.stringify({ vulnerabilities: {} }));
  writeFileSync(path.join(tmp, '.gitignore'), 'node_modules\n');
  return tmp;
}

test('WL-565: R5 — نسخةُ fast-uri أو minimatch داخلَ مدى التبليغِ المسدودِ تُغلقُ الحاجز، بأيِّ عمق', () => {
  /** @type {Array<[string, string]>} */
  const cases = [
    ['node_modules/fast-uri', '3.1.8'],
    ['node_modules/fast-uri', '3.0.0'],
    ['node_modules/ajv/node_modules/fast-uri', '3.1.6'],
    ['node_modules/minimatch', '10.2.6'],
    ['node_modules/minimatch', '7.0.0'],
    ['node_modules/eslint/node_modules/minimatch', '11.0.0'],
    ['node_modules/minimatch', 'not-a-version'],
  ];
  for (const [key, version] of cases) {
    const tmp = floorRoot({ [key]: { version, dev: true } });
    try {
      const result = runGuard(tmp);
      assert.equal(result.ok, false, `${key}@${version} يجبُ أن يُغلِقَ الحاجز`);
      assert.match(result.stderr ?? '', /R5:/, `${key}@${version}: سببُ الإغلاقِ R5`);
      assert.ok(
        (result.stderr ?? '').includes(`${key}@`),
        `${key}@${version}: المسارُ مُسمّىً في الرسالة`,
      );
    } finally {
      cleanup(tmp);
    }
  }
});

test('WL-565: R5 — النسخُ المصحَّحةُ وما خارجَ المدى المنشورِ تمرّ، واسمٌ يشبهُ الحزمةَ لا يُلتبَس', () => {
  const tmp = floorRoot({
    'node_modules/fast-uri': { version: '3.1.9', dev: true },
    'node_modules/x/node_modules/fast-uri': { version: '4.2.3', dev: true },
    'node_modules/old/node_modules/fast-uri': { version: '2.4.0', dev: true },
    'node_modules/minimatch': { version: '11.0.1', dev: true },
    'node_modules/y/node_modules/minimatch': { version: '6.2.0', dev: true },
    'node_modules/not-minimatch': { version: '10.0.0', dev: true },
    'node_modules/fast-uri-extra': { version: '3.1.0', dev: true },
  });
  try {
    const result = runGuard(tmp);
    assert.equal(result.ok, true, `Expected pass, got: ${result.output || result.stderr}`);
  } finally {
    cleanup(tmp);
  }
});

test('WL-565: قفلُ المستودعِ نفسُه فوقَ الأرضيّات — كلُّ نسخِ fast-uri وminimatch خارجَ المدى المصاب', () => {
  const lock = JSON.parse(readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  /** @type {string[]} */
  const seen = [];
  for (const [key, entry] of Object.entries(lock.packages)) {
    const name = key.split('node_modules/').pop();
    if (name !== 'fast-uri' && name !== 'minimatch') continue;
    seen.push(`${key}@${entry.version}`);
    const [major = 0, minor = 0, patch = 0] = String(entry.version).split('.').map(Number);
    const n = major * 1e6 + minor * 1e3 + patch;
    if (name === 'fast-uri') assert.ok(n < 3e6 || n >= 3001009, `${key}@${entry.version}`);
    else assert.ok(n < 7e6 || n >= 11000001, `${key}@${entry.version}`);
  }
  assert.ok(
    seen.some((s) => s.startsWith('node_modules/fast-uri@')),
    `fast-uri في القفل: ${seen.join(', ')}`,
  );
  assert.ok(
    seen.some((s) => s.startsWith('node_modules/minimatch@')),
    `minimatch في القفل: ${seen.join(', ')}`,
  );
});

/**
 * جذرٌ مؤقّتٌ بشفرةِ تشغيلٍ في `src/` وpackage.json مُعطى (‏WL-568).
 *
 * @param {Record<string, unknown>} pkgFields
 * @param {Record<string, string>} files مسارٌ نسبيٌّ تحتَ `src/` ← نصّ.
 */
function runtimeRoot(pkgFields, files) {
  const tmp = floorRoot({});
  writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 'test', version: '1.0.0', private: true, ...pkgFields }),
  );
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(tmp, 'src', rel)), { recursive: true });
    writeFileSync(path.join(tmp, 'src', rel), text);
  }
  return tmp;
}

test('WL-568: R6 — حزمةٌ تستوردُها src/ وهي في devDependencies وحدَها تُغلقُ الحاجز، بكلِّ صيغِ الاستيراد', () => {
  /** @type {Array<[string, string]>} */
  const cases = [
    ['ajv', "import { Ajv2020 } from 'ajv/dist/2020.js';\n"],
    ['ajv', "const m = await import('ajv');\n"],
    ['ajv', "import 'ajv';\n"],
    ['ajv', "export { default } from 'ajv';\n"],
    ['ajv', "const m = require('ajv');\n"],
    ['@scope/pkg', "import x from '@scope/pkg/sub/index.js';\n"],
    ['left-pad', "import pad from 'left-pad';\n"],
  ];
  for (const [name, text] of cases) {
    const tmp = runtimeRoot(
      { dependencies: { pg: '8.23.0' }, devDependencies: { ajv: '8.20.0' } },
      { 'deep/nested/mod.mjs': text },
    );
    try {
      const result = runGuard(tmp);
      assert.equal(result.ok, false, `${text.trim()} يجبُ أن يُغلِقَ الحاجز`);
      assert.match(result.stderr ?? '', /R6:/, `${text.trim()}: سببُ الإغلاقِ R6`);
      assert.ok(
        (result.stderr ?? '').includes(`${name} (‏src/deep/nested/mod.mjs`),
        `${text.trim()}: الحزمةُ والملفُّ مُسمَّيانِ: ${result.stderr ?? ''}`,
      );
    } finally {
      cleanup(tmp);
    }
  }
});

test('WL-568: R6 — المُعلَنُ في dependencies/optionalDependencies والمدمجُ والنسبيُّ يمرّ، وخارجَ src/ لا يُقرأ', () => {
  const tmp = runtimeRoot(
    {
      dependencies: { ajv: '8.20.0', '@scope/pkg': '1.0.0' },
      optionalDependencies: { pkcs11js: '2.1.7' },
      devDependencies: { eslint: '10.15.0' },
    },
    {
      'a.mjs': [
        "import { Ajv2020 } from 'ajv/dist/2020.js';",
        "import fs from 'node:fs';",
        "import path from 'path';",
        "import { x } from './b.mjs';",
        "import y from '../src/b.mjs';",
        "import z from '@scope/pkg/sub.js';",
        "const p = await import('pkcs11js');",
        "/** @type {typeof import('ajv/dist/2020.js').Ajv2020} */",
        "// يلتقطُ `import('…')` و`require('…')` بمواصفةٍ حرفيّة.",
        "const m = 'text from somewhere';",
        "const self = await import('test/lib.mjs');",
        '',
      ].join('\n'),
      'b.mjs': 'export const x = 1;\n',
    },
  );
  writeFileSync(path.join(tmp, 'tool.mjs'), "import eslint from 'eslint';\n");
  try {
    const result = runGuard(tmp);
    assert.equal(result.ok, true, `Expected pass, got: ${result.output || result.stderr}`);
  } finally {
    cleanup(tmp);
  }
});

test('WL-568: شفرةُ تشغيلِ المستودعِ نفسِه — كلُّ استيرادِها مُعلَنٌ تبعيّةَ تشغيل (‏ajv في dependencies)', () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies?.ajv, '8.20.0', 'ajv تبعيّةُ تشغيل');
  assert.equal(pkg.devDependencies?.ajv, undefined, 'ajv ليست في devDependencies');
  const lock = JSON.parse(readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  for (const name of [
    'ajv',
    'fast-uri',
    'fast-deep-equal',
    'json-schema-traverse',
    'require-from-string',
  ])
    assert.notEqual(lock.packages[`node_modules/${name}`]?.dev, true, `${name} ليست dev في القفل`);
  const tmp = runtimeRoot(
    {
      dependencies: pkg.dependencies,
      optionalDependencies: pkg.optionalDependencies,
      devDependencies: pkg.devDependencies,
    },
    {},
  );
  cpSync(path.join(repoRoot, 'src'), path.join(tmp, 'src'), { recursive: true });
  try {
    const result = runGuard(tmp);
    assert.equal(result.ok, true, `Expected pass, got: ${result.output || result.stderr}`);
    writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({
        name: 'test',
        dependencies: Object.fromEntries(
          Object.entries(pkg.dependencies).filter(([name]) => name !== 'ajv'),
        ),
        optionalDependencies: pkg.optionalDependencies,
        devDependencies: { ...pkg.devDependencies, ajv: '8.20.0' },
      }),
    );
    const before = runGuard(tmp);
    assert.equal(
      before.ok,
      false,
      'ajv في devDependencies وحدَها يُغلِقُ الحاجزَ على src/ الحقيقيّ',
    );
    assert.match(before.stderr ?? '', /R6: [^\n]*ajv \(‏src\/[^\n]*، 39 ملفّاً\)\.$/m);
  } finally {
    cleanup(tmp);
  }
});
