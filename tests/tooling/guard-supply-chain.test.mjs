import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
  cpSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

/**
 * WL-574: يختمُ تقريرَ تدقيقٍ بمنشئِه — وقتُ توليدٍ UTC وبصمةُ SHA-256 لبايتاتِ `package-lock.json` الخامِ في الجذر،
 * محسوبةً هنا مستقلّةً عن الشفرةِ المُختبَرة. القفلُ يُكتَبُ قبلَ التقرير دائماً.
 *
 * @param {string} root @param {Record<string, unknown>} report @param {Date} [at]
 */
function stamped(root, report, at = new Date()) {
  const lockfileSha256 = createHash('sha256')
    .update(readFileSync(path.join(root, 'package-lock.json')))
    .digest('hex');
  return { ...report, xuuxAudit: { version: 1, generatedAt: at.toISOString(), lockfileSha256 } };
}

/**
 * WL-575: يختمُ SBOM ببصمةِ SHA-256 لبايتاتِ `package-lock.json` الخامِ في الجذر — خاصّيّةُ CycloneDX
 * ‏`metadata.properties[{name: 'xuux:lockfileSha256'}]`، محسوبةً هنا مستقلّةً عن الشفرةِ المُختبَرة.
 *
 * @param {string} root @param {Record<string, any>} sbom
 */
function stampedSbom(root, sbom) {
  const value = createHash('sha256')
    .update(readFileSync(path.join(root, 'package-lock.json')))
    .digest('hex');
  const metadata = sbom.metadata ?? {};
  return {
    ...sbom,
    metadata: {
      ...metadata,
      properties: [...(metadata.properties ?? []), { name: 'xuux:lockfileSha256', value }],
    },
  };
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
      JSON.stringify(
        stampedSbom(tmp, {
          bomFormat: 'CycloneDX',
          specVersion: '1.4',
          components: [{ name: 'pg', version: '8.23.0' }],
        }),
      ),
    );
    writeFileSync(
      path.join(tmp, 'audit-report.json'),
      JSON.stringify(
        stamped(tmp, {
          vulnerabilities: {},
        }),
      ),
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
// ‏WL-571: أُزيلَ الإعذارُ من `AUDIT_EXCEPTIONS` (‏سُحِبَ التبليغ)؛ اختباراتُ الآليّةِ (‏WL-557) تُمرِّرُه صراحةً بشروطِه نفسِها.
const PICO_EXC = Object.freeze([
  Object.freeze({
    advisory: PICO_URL,
    package: 'picomatch',
    maxSeverity: /** @type {const} */ ('high'),
    expires: '2026-12-02',
    why: 'تثبيتٌ اختباريٌّ لآليّةِ WL-557',
  }),
]);

test('WL-557: الإعذارُ يقبلُ ثغرةَ picomatch التطويريّةَ قبلَ الانقضاء — وكلُّ عقدةٍ عاليةٍ في سلسلتها مُعذَرة', async () => {
  const { evaluateAudit } = await import('../../scripts/audit-check.mjs');
  assert.ok(PICO_EXC.some((e) => e.advisory === PICO_URL && e.maxSeverity === 'high'));
  const r = evaluateAudit(picoAudit(), picoLock(true), NOW, PICO_EXC);
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
  const r = evaluateAudit(picoAudit(), picoLock(false), NOW, PICO_EXC);
  assert.deepEqual(r.excused, []);
  assert.deepEqual(r.blocking.map((x) => x.name).sort(), [
    'fdir',
    'picomatch',
    'tinyglobby',
    'ts-estree',
  ]);
  // ‏عقدةٌ غائبةٌ عن ملفِّ القفلِ كذلك: لا يُفترَضُ أنّها تطويريّة.
  const r2 = evaluateAudit(picoAudit(), { lockfileVersion: 3, packages: {} }, NOW, PICO_EXC);
  assert.equal(r2.blocking.length, 4);
});

test('WL-557: بعدَ تاريخِ الانقضاءِ لا إعذار (‏يُعادُ النظرُ أو يُجدَّدُ بقرارٍ مُسجَّل)', async () => {
  const { evaluateAudit } = await import('../../scripts/audit-check.mjs');
  const e = PICO_EXC.find((x) => x.advisory === PICO_URL);
  assert.ok(e !== undefined);
  const after = new Date(Date.parse(`${e.expires}T00:00:00Z`) + 1);
  assert.equal(evaluateAudit(picoAudit(), picoLock(true), after, PICO_EXC).blocking.length, 4);
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
  const r = evaluateAudit(mixed, picoLock(true), NOW, PICO_EXC);
  assert.deepEqual(r.blocking.map((x) => x.name).sort(), ['minimatch', 'ts-estree']);
  const crit = picoAudit();
  const cp = /** @type {any} */ (crit.vulnerabilities)['picomatch'];
  cp.severity = 'critical';
  cp.via[0].severity = 'critical';
  assert.ok(
    evaluateAudit(crit, picoLock(true), NOW, PICO_EXC).blocking.some((x) => x.name === 'picomatch'),
  );
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
    evaluateAudit(unknown, { packages: { 'node_modules/pg': { dev: true } } }, NOW, PICO_EXC)
      .blocking.length,
    1,
  );
  // ‏سلسلةٌ دائريّةٌ أو اسمٌ غيرُ موجودٍ في via: لا إعذارَ بالغياب.
  const dangling = {
    vulnerabilities: {
      a: { name: 'a', severity: 'high', via: ['ghost'], nodes: ['node_modules/a'] },
    },
  };
  assert.equal(
    evaluateAudit(dangling, { packages: { 'node_modules/a': { dev: true } } }, NOW, PICO_EXC)
      .blocking.length,
    1,
  );
});

test('WL-557/WL-571: حاجزُ سلسلةِ التوريد (‏R3) يُطبِّقُ حكمَ audit:check نفسَه — بلا إعذارٍ تسقطُ سلسلةُ picomatch تطويريّةً وإنتاجيّة، والتقريرُ النظيفُ يمرّ', () => {
  for (const [dev, report] of /** @type {const} */ ([
    [true, 'pico'],
    [false, 'pico'],
    [true, 'clean'],
  ])) {
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
        JSON.stringify(stampedSbom(tmp, { bomFormat: 'CycloneDX', components: [{ name: 'pg' }] })),
      );
      writeFileSync(
        path.join(tmp, 'audit-report.json'),
        JSON.stringify(stamped(tmp, report === 'pico' ? picoAudit() : { vulnerabilities: {} })),
      );
      writeFileSync(path.join(tmp, '.gitignore'), 'node_modules\n');
      const result = runGuard(tmp);
      const ok = report === 'clean';
      assert.equal(result.ok, ok, `dev=${dev} ${report}: ${result.stderr || result.output}`);
      if (!ok) assert.match(result.stderr || result.output, /R3: 4 ثغرة حرجة\/عالية/);
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
    evaluateAudit(picoAudit(), mid, NOW, PICO_EXC).blocking.map((x) => x.name),
    ['ts-estree'],
  );
  const src = picoLock(true);
  src.packages['node_modules/picomatch'] = { version: '1.0.0' };
  assert.deepEqual(
    evaluateAudit(picoAudit(), src, NOW, PICO_EXC).blocking.map((x) => x.name),
    ['fdir', 'picomatch', 'tinyglobby', 'ts-estree'],
  );
  const two = picoAudit();
  two.vulnerabilities.picomatch.nodes = [
    'node_modules/picomatch',
    'node_modules/x/node_modules/picomatch',
  ];
  const lk = picoLock(true);
  lk.packages['node_modules/x/node_modules/picomatch'] = { version: '1.0.0' };
  assert.ok(evaluateAudit(two, lk, NOW, PICO_EXC).blocking.some((x) => x.name === 'picomatch'));
});

test('WL-557: اسمٌ غيرُ محلولٍ بينَ أسماءِ via المحلولةِ يُسقِطُ الإعذار', async () => {
  const { evaluateAudit } = await import('../../scripts/audit-check.mjs');
  const a = picoAudit();
  a.vulnerabilities.tinyglobby.via = ['picomatch', 'ghost'];
  assert.ok(
    evaluateAudit(a, picoLock(true), NOW, PICO_EXC).blocking.some((x) => x.name === 'tinyglobby'),
  );
});

// ── WL-571: حسمُ LIVE-76 — سُحِبَ GHSA-fc5q-39xc-vjpf و`npm audit --json` لا يُبلِّغُه، فأُزيلَ الإعذار. ──

test('WL-571: لا إعذارَ في AUDIT_EXCEPTIONS — سلسلةُ picomatch نفسُها تسقطُ تطويريّةً قبلَ الانقضاءِ السابق', async () => {
  const { evaluateAudit, AUDIT_EXCEPTIONS } = await import('../../scripts/audit-check.mjs');
  assert.deepEqual(AUDIT_EXCEPTIONS, []);
  assert.ok(Object.isFrozen(AUDIT_EXCEPTIONS));
  const r = evaluateAudit(picoAudit(), picoLock(true), NOW);
  assert.deepEqual(r.excused, []);
  assert.deepEqual(r.blocking.map((x) => x.name).sort(), [
    'fdir',
    'picomatch',
    'tinyglobby',
    'ts-estree',
  ]);
  assert.ok(r.blocking.every((x) => x.reason === `تبليغٌ غيرُ مُعذَر: ${PICO_URL}`));
});

test('WL-571: كلُّ ثغرةٍ حرجةٍ أو عاليةٍ أخرى تُسقِطُ الفحصَ بالقائمةِ الافتراضيّة — تطويريّةً أو إنتاجيّةً، مباشرةً أو عبرَ سلسلة', async () => {
  const { evaluateAudit } = await import('../../scripts/audit-check.mjs');
  for (const severity of ['high', 'critical']) {
    for (const dev of [true, false]) {
      const audit = {
        vulnerabilities: {
          leaf: {
            name: 'leaf',
            severity,
            via: [{ url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', severity }],
            nodes: ['node_modules/leaf'],
          },
          parent: { name: 'parent', severity, via: ['leaf'], nodes: ['node_modules/parent'] },
        },
      };
      const lock = {
        packages: {
          'node_modules/leaf': dev ? { dev: true } : {},
          'node_modules/parent': dev ? { dev: true } : {},
        },
      };
      const r = evaluateAudit(audit, lock, NOW);
      assert.deepEqual(r.excused, [], `${severity}/${dev}`);
      assert.deepEqual(
        r.blocking.map((x) => x.name),
        ['leaf', 'parent'],
        `${severity}/${dev}`,
      );
    }
  }
  // ‏شدّةٌ مجهولةٌ في السلسلةِ تُعامَلُ حرجة، ودونَ «عالية» لا يُسقِط (‏الحدُّ نفسُه).
  const odd = {
    vulnerabilities: {
      x: { name: 'x', severity: 'high', via: [{ url: 'u', severity: 'weird' }], nodes: ['n'] },
      y: {
        name: 'y',
        severity: 'moderate',
        via: [{ url: 'v', severity: 'moderate' }],
        nodes: ['m'],
      },
    },
  };
  assert.deepEqual(
    evaluateAudit(odd, { packages: { n: { dev: true }, m: { dev: true } } }, NOW).blocking.map(
      (x) => x.name,
    ),
    ['x'],
  );
  // ‏تقريرُ القفلِ الحاليِّ بعدَ السحب (‏0 ثغرات) يمرّ.
  assert.deepEqual(evaluateAudit({ vulnerabilities: {} }, { packages: {} }, NOW), {
    blocking: [],
    excused: [],
  });
});

// ── WL-572: الفحصُ كان يمرُّ على تقريرٍ لا يفهمُه — خطأُ npm (‏{message, error} بلا vulnerabilities، مقيسٌ بسجلٍّ لا يُجيب)
// ‏أو شدّةُ عقدةٍ غيرُ معروفة («Critical»، «HIGH»، فارغة، غائبة) ⇒ 0 ثغرات ⇒ ✅ وخروجٌ 0، وR3 يقبلُ التقريرَ المحفوظ. ──

const AUDIT_CHECK = fileURLToPath(new URL('../../scripts/audit-check.mjs', import.meta.url));
/** خطأُ `npm audit --json` المقيسُ حرفيّاً حينَ لا يُجيبُ السجلّ (‏ECONNREFUSED). */
const NPM_AUDIT_ERROR = {
  message:
    'request to http://127.0.0.1:9/-/npm/v1/security/audits/quick failed, reason: connect ECONNREFUSED 127.0.0.1:9',
  error: { summary: '', detail: '' },
};

test('WL-572: تقريرُ تدقيقٍ لا يُفهَمُ يُسقِطُ الفحص — خطأُ npm، وغيابُ vulnerabilities أو شكلُها، وما ليس كائناً', async () => {
  const { evaluateAudit } = await import('../../scripts/audit-check.mjs');
  const lock = { packages: {} };
  for (const [label, audit] of /** @type {Array<[string, any]>} */ ([
    ['خطأُ npm المقيس', NPM_AUDIT_ERROR],
    ['error مع vulnerabilities فارغة', { error: { code: 'EAUDITNOLOCK' }, vulnerabilities: {} }],
    ['بلا vulnerabilities', { auditReportVersion: 2, metadata: {} }],
    ['vulnerabilities مصفوفة', { vulnerabilities: [] }],
    ['vulnerabilities نصّ', { vulnerabilities: 'none' }],
    ['vulnerabilities null', { vulnerabilities: null }],
    ['null', null],
    ['مصفوفة', []],
    ['نصّ', 'ok'],
  ])) {
    const r = evaluateAudit(audit, lock, NOW);
    assert.equal(r.blocking.length, 1, label);
    assert.match(String(r.blocking[0]?.reason), /تقريرُ تدقيقٍ غيرُ صالح/, label);
    assert.deepEqual(r.excused, [], label);
  }
  // ‏والتقريرُ السليمُ الفارغُ يمرّ (‏لا إنذارَ كاذب).
  assert.deepEqual(evaluateAudit({ auditReportVersion: 2, vulnerabilities: {} }, lock, NOW), {
    blocking: [],
    excused: [],
  });
});

test('WL-572: شدّةُ عقدةٍ غيرُ معروفةٍ تُعامَلُ حرجةً (‏فشلٌ مغلق) — إنتاجيّةً وتطويريّة، ولا يُعذِرُها إعذار', async () => {
  const { evaluateAudit } = await import('../../scripts/audit-check.mjs');
  for (const severity of ['Critical', 'HIGH', 'severe', '', undefined, null, 7]) {
    for (const dev of [true, false]) {
      const audit = {
        vulnerabilities: {
          p: {
            name: 'p',
            severity,
            via: [{ url: PICO_URL, severity }],
            nodes: ['node_modules/p'],
          },
        },
      };
      const lock = { packages: { 'node_modules/p': dev ? { dev: true } : {} } };
      const label = `${JSON.stringify(severity)}/${dev}`;
      assert.deepEqual(
        evaluateAudit(audit, lock, NOW).blocking.map((x) => x.name),
        ['p'],
        label,
      );
      assert.deepEqual(
        evaluateAudit(audit, lock, NOW, PICO_EXC).blocking.map((x) => x.name),
        ['p'],
        `${label} مع إعذار`,
      );
    }
  }
  // ‏المعروفةُ دونَ «عالية» لا تُسقِط (‏الحدُّ نفسُه).
  for (const severity of ['info', 'low', 'moderate']) {
    const audit = {
      vulnerabilities: {
        p: { name: 'p', severity, via: [{ url: 'u', severity }], nodes: ['node_modules/p'] },
      },
    };
    assert.deepEqual(evaluateAudit(audit, { packages: {} }, NOW).blocking, [], severity);
  }
});

test('WL-572: audit:check يخرجُ بـ1 حينَ لا يُجيبُ سجلُّ npm، وR3 يرفضُ تقريرَ الخطأِ المحفوظ', () => {
  const tmp = makeTempRoot();
  try {
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
      JSON.stringify({
        name: 't',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': { name: 't', version: '1.0.0', dependencies: { pg: '8.23.0' } },
          'node_modules/pg': { version: '8.23.0' },
        },
      }),
    );
    const r = spawnSync(process.execPath, [AUDIT_CHECK, '--root', tmp], {
      cwd: tmp,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_registry: 'http://127.0.0.1:9',
        npm_config_fetch_retries: '0',
      },
      timeout: 60000,
    });
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /تقريرُ تدقيقٍ غيرُ صالح/);
    assert.doesNotMatch(r.stdout, /✅/);
    // ‏التقريرُ المحفوظُ (‏خطأُ npm) يرفضُه R3 كذلك.
    mkdirSync(path.join(tmp, 'node_modules'), { recursive: true });
    writeFileSync(
      path.join(tmp, 'sbom.cdx.json'),
      JSON.stringify({ bomFormat: 'CycloneDX', components: [{ name: 'pg' }] }),
    );
    writeFileSync(path.join(tmp, '.gitignore'), 'node_modules\n');
    writeFileSync(path.join(tmp, 'audit-report.json'), JSON.stringify(NPM_AUDIT_ERROR));
    const g = runGuard(tmp);
    assert.equal(g.ok, false, g.output);
    assert.match(g.stderr || g.output, /R3/);
  } finally {
    cleanup(tmp);
  }
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
    JSON.stringify(
      stampedSbom(tmp, {
        bomFormat: 'CycloneDX',
        specVersion: '1.4',
        components: [{ name: 'ajv', version: '8.20.0' }],
      }),
    ),
  );
  writeFileSync(
    path.join(tmp, 'audit-report.json'),
    JSON.stringify(stamped(tmp, { vulnerabilities: {} })),
  );
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

// ── WL-574: R3 كان يقبلُ أيَّ audit-report.json بشكلٍ صالح — قديماً أو لقفلٍ آخر (‏مقيسٌ: تقريرٌ بتاريخِ 2026-01-01 ⇒ خروجٌ 0).
// ‏الآن: `xuuxAudit` = { version: 1, generatedAt: ISO-8601 UTC بالميلي‌ثانية و«Z»، lockfileSha256: SHA-256 لبايتاتِ القفلِ الخام }،
// ‏عمرٌ ≤ 7 أيّام، ومستقبلٌ ≤ 5 دقائق (‏سماحيّةُ انحرافِ الساعة — مقبولٌ بالسياسةِ الموثَّقة)، وبصمةٌ مطابقةٌ تماماً. ──

/** جذرٌ صالحٌ لـ R3 بتقريرٍ نظيفٍ يكتبُه المُستدعي. */
function r3Root() {
  const tmp = floorRoot({});
  rmSync(path.join(tmp, 'audit-report.json'), { force: true });
  return tmp;
}
const UNTRUSTED = /R3: تقريرُ التدقيقِ غيرُ موثوقِ المنشأ/;
const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;

test('WL-574: R3 عبرَ CLI — تقريرٌ حديثٌ مربوطٌ بالقفلِ يمرّ، وكلُّ منشأٍ غائبٍ أو مشوّهٍ أو قديمٍ أو مستقبليٍّ أو لقفلٍ آخرَ يُرفَض', () => {
  const tmp = r3Root();
  try {
    const now = new Date();
    const good = stamped(tmp, { vulnerabilities: {} }, now);
    const prov = good.xuuxAudit;
    /** @type {Array<[string, any, boolean]>} */
    const cases = [
      ['حديثٌ صالح', good, true],
      ['xuuxAudit غائب', { vulnerabilities: {} }, false],
      [
        'xuuxAudit تحتَ metadata بدلَه',
        { vulnerabilities: {}, metadata: { xuuxAudit: prov } },
        false,
      ],
      ['xuuxAudit null', { ...good, xuuxAudit: null }, false],
      ['xuuxAudit مصفوفة', { ...good, xuuxAudit: [prov] }, false],
      ['xuuxAudit نصّ', { ...good, xuuxAudit: JSON.stringify(prov) }, false],
      ['حقلٌ غيرُ متوقَّع', { ...good, xuuxAudit: { ...prov, extra: 1 } }, false],
      [
        'version غائب',
        {
          ...good,
          xuuxAudit: { generatedAt: prov.generatedAt, lockfileSha256: prov.lockfileSha256 },
        },
        false,
      ],
      ['version 2', { ...good, xuuxAudit: { ...prov, version: 2 } }, false],
      ['version نصّيّ', { ...good, xuuxAudit: { ...prov, version: '1' } }, false],
      [
        'generatedAt غائب',
        { ...good, xuuxAudit: { version: 1, lockfileSha256: prov.lockfileSha256 } },
        false,
      ],
      ['generatedAt رقم', { ...good, xuuxAudit: { ...prov, generatedAt: now.getTime() } }, false],
      ['generatedAt null', { ...good, xuuxAudit: { ...prov, generatedAt: null } }, false],
      [
        'generatedAt نصٌّ ليس وقتاً',
        { ...good, xuuxAudit: { ...prov, generatedAt: 'yesterday' } },
        false,
      ],
      ['generatedAt فارغ', { ...good, xuuxAudit: { ...prov, generatedAt: '' } }, false],
      [
        'generatedAt تاريخٌ مستحيل',
        { ...good, xuuxAudit: { ...prov, generatedAt: '2026-02-30T00:00:00.000Z' } },
        false,
      ],
      [
        'generatedAt بإزاحةٍ لا UTC',
        { ...good, xuuxAudit: { ...prov, generatedAt: prov.generatedAt.replace('Z', '+03:00') } },
        false,
      ],
      [
        'generatedAt بلا منطقة',
        { ...good, xuuxAudit: { ...prov, generatedAt: prov.generatedAt.replace('Z', '') } },
        false,
      ],
      [
        'generatedAt بلا ميلي‌ثوانٍ',
        {
          ...good,
          xuuxAudit: { ...prov, generatedAt: prov.generatedAt.replace(/\.\d{3}Z$/, 'Z') },
        },
        false,
      ],
      [
        'generatedAt بمسافة',
        { ...good, xuuxAudit: { ...prov, generatedAt: prov.generatedAt.replace('T', ' ') } },
        false,
      ],
      [
        'أقدمُ من 7 أيّامٍ بدقيقة',
        stamped(tmp, { vulnerabilities: {} }, new Date(now.getTime() - 7 * DAY - MIN)),
        false,
      ],
      [
        'تقريرُ 2026-01-01 المقيس',
        stamped(tmp, { vulnerabilities: {} }, new Date('2026-01-01T00:00:00.000Z')),
        false,
      ],
      [
        'أحدثُ من 7 أيّامٍ بدقيقة',
        stamped(tmp, { vulnerabilities: {} }, new Date(now.getTime() - 7 * DAY + MIN)),
        true,
      ],
      [
        'مستقبليٌّ بـ 6 دقائق',
        stamped(tmp, { vulnerabilities: {} }, new Date(now.getTime() + 6 * MIN)),
        false,
      ],
      [
        'مستقبليٌّ بسنة',
        stamped(tmp, { vulnerabilities: {} }, new Date(now.getTime() + 365 * DAY)),
        false,
      ],
      [
        'مستقبليٌّ بـ 4 دقائق (‏داخلَ السماحيّة)',
        stamped(tmp, { vulnerabilities: {} }, new Date(now.getTime() + 4 * MIN)),
        true,
      ],
      [
        'بصمةُ قفلٍ آخر',
        {
          ...good,
          xuuxAudit: { ...prov, lockfileSha256: createHash('sha256').update('{}').digest('hex') },
        },
        false,
      ],
      [
        'بصمةٌ بأحرفٍ كبيرة',
        { ...good, xuuxAudit: { ...prov, lockfileSha256: prov.lockfileSha256.toUpperCase() } },
        false,
      ],
      [
        'بصمةٌ مقصوصة',
        { ...good, xuuxAudit: { ...prov, lockfileSha256: prov.lockfileSha256.slice(1) } },
        false,
      ],
      ['بصمةٌ غائبة', { ...good, xuuxAudit: { version: 1, generatedAt: prov.generatedAt } }, false],
      ['بصمةٌ رقم', { ...good, xuuxAudit: { ...prov, lockfileSha256: 0 } }, false],
    ];
    for (const [label, report, ok] of cases) {
      writeFileSync(path.join(tmp, 'audit-report.json'), JSON.stringify(report));
      const r = runGuard(tmp);
      assert.equal(r.ok, ok, `${label}: ${r.stderr || r.output}`);
      if (!ok) assert.match(r.stderr ?? '', UNTRUSTED, label);
      else assert.doesNotMatch(`${r.stderr ?? ''}${r.output}`, /R3/, label);
    }
  } finally {
    cleanup(tmp);
  }
});

test('WL-574: البصمةُ لبايتاتِ القفلِ الخام — قفلٌ بالمعنى نفسِه وتنسيقٍ آخرَ أو سطرٍ زائدٍ بعدَ الختمِ يُرفَض', () => {
  const tmp = r3Root();
  try {
    const lockPath = path.join(tmp, 'package-lock.json');
    writeFileSync(
      path.join(tmp, 'audit-report.json'),
      JSON.stringify(stamped(tmp, { vulnerabilities: {} })),
    );
    assert.equal(runGuard(tmp).ok, true);
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8'));
    for (const [label, bytes] of /** @type {Array<[string, string]>} */ ([
      ['إعادةُ تسلسلٍ بمسافات', JSON.stringify(parsed, null, 2)],
      ['سطرٌ أخيرٌ زائد', `${readFileSync(lockPath, 'utf8')}\n`],
    ])) {
      writeFileSync(lockPath, bytes);
      const r = runGuard(tmp);
      assert.equal(r.ok, false, label);
      assert.match(r.stderr ?? '', UNTRUSTED, label);
      assert.match(r.stderr ?? '', /package-lock\.json/, label);
    }
    // ‏قفلٌ غائبٌ لا يُطابِقُ شيئاً.
    rmSync(lockPath);
    const r = runGuard(tmp);
    assert.equal(r.ok, false);
  } finally {
    cleanup(tmp);
  }
});

test('WL-574: حدودُ checkProvenance بالضبط — 7 أيّامٍ مقبولة و+1ms مرفوض، و+5 دقائقَ مقبولة و+1ms مرفوض', async () => {
  const m = await import('../../scripts/audit-check.mjs');
  assert.equal(m.AUDIT_MAX_AGE_MS, 7 * DAY);
  assert.equal(m.AUDIT_FUTURE_SKEW_MS, 5 * MIN);
  const lockBytes = Buffer.from('{"lockfileVersion":3,"packages":{}}');
  const sha = createHash('sha256').update(lockBytes).digest('hex');
  assert.equal(m.lockDigest(lockBytes), sha);
  const now = new Date('2026-11-19T12:00:00.000Z');
  /** @param {number} dt */
  const at = (dt) => ({
    vulnerabilities: {},
    xuuxAudit: {
      version: 1,
      generatedAt: new Date(now.getTime() + dt).toISOString(),
      lockfileSha256: sha,
    },
  });
  assert.equal(m.checkProvenance(at(0), lockBytes, now), '');
  assert.equal(m.checkProvenance(at(-7 * DAY), lockBytes, now), '');
  assert.match(m.checkProvenance(at(-7 * DAY - 1), lockBytes, now), /7 أيّام/);
  assert.equal(m.checkProvenance(at(5 * MIN), lockBytes, now), '');
  assert.match(m.checkProvenance(at(5 * MIN + 1), lockBytes, now), /مستقبل/);
  assert.match(m.checkProvenance(at(0), null, now), /package-lock\.json/);
  assert.match(m.checkProvenance(at(0), Buffer.from('{}'), now), /package-lock\.json/);
  // ‏كلُّ شرطٍ يُرفَضُ لسببِه هو لا لغيرِه — وقتٌ «قريبٌ» من now لكنّه مستحيلٌ يُطبِّعُه Date.parse بصمت، أو بصيغةٍ موسَّعةٍ للسنة.
  /** @param {string} g */
  const withG = (g) => ({
    vulnerabilities: {},
    xuuxAudit: { version: 1, generatedAt: g, lockfileSha256: sha },
  });
  for (const [g, n] of /** @type {Array<[string, string]>} */ ([
    ['2026-02-30T00:00:00.000Z', '2026-03-02T00:00:00.000Z'],
    ['2026-02-29T12:00:00.000Z', '2026-03-01T12:00:00.000Z'],
    ['2026-11-19T24:00:00.000Z', '2026-11-20T00:00:00.000Z'],
    ['+010000-01-01T00:00:00.000Z', '+010000-01-01T00:00:00.000Z'],
  ])) {
    assert.match(m.checkProvenance(withG(g), lockBytes, new Date(n)), /UTC صريحاً/, g);
  }
  for (const bad of [
    'A'.repeat(64),
    sha.toUpperCase(),
    `${sha}0`,
    sha.slice(1),
    ` ${sha.slice(1)}`,
  ]) {
    const a = {
      vulnerabilities: {},
      xuuxAudit: { version: 1, generatedAt: now.toISOString(), lockfileSha256: bad },
    };
    assert.match(m.checkProvenance(a, lockBytes, now), /ليس SHA-256 بـ 64/, bad);
  }
  for (const bad of [null, [], 'x', 1, { vulnerabilities: {} }]) {
    assert.notEqual(m.checkProvenance(bad, lockBytes, now), '', JSON.stringify(bad));
  }
  // ‏الختمُ نفسُه يُنتجُ ما يقبلُه الفحص، ولا يمسُّ بقيّةَ التقرير.
  const s = m.stampProvenance({ auditReportVersion: 2, vulnerabilities: {} }, lockBytes, now);
  assert.deepEqual(s, {
    auditReportVersion: 2,
    vulnerabilities: {},
    xuuxAudit: { version: 1, generatedAt: '2026-11-19T12:00:00.000Z', lockfileSha256: sha },
  });
  assert.equal(m.checkProvenance(s, lockBytes, now), '');
});

test('WL-574: evaluateAudit والإعذاراتُ ورتبُ الشدّةِ لم تتغيّر — xuuxAudit لا يُغيّرُ الحكم، والحكمُ لا يقرأُ المنشأ', async () => {
  const { evaluateAudit, AUDIT_EXCEPTIONS, checkProvenance } =
    await import('../../scripts/audit-check.mjs');
  assert.ok(Object.isFrozen(AUDIT_EXCEPTIONS));
  assert.deepEqual(AUDIT_EXCEPTIONS, []);
  const prov = { version: 1, generatedAt: NOW.toISOString(), lockfileSha256: '0'.repeat(64) };
  for (const [label, audit, lock, exc] of /** @type {Array<[string, any, any, any]>} */ ([
    ['picomatch مُعذَرة', picoAudit(), picoLock(true), PICO_EXC],
    ['picomatch بلا إعذار', picoAudit(), picoLock(true), undefined],
    ['picomatch إنتاجيّة', picoAudit(), picoLock(false), PICO_EXC],
    ['نظيف', { vulnerabilities: {} }, { packages: {} }, undefined],
    ['خطأُ npm', NPM_AUDIT_ERROR, { packages: {} }, undefined],
  ])) {
    const plain = evaluateAudit(audit, lock, NOW, exc);
    const withProv = evaluateAudit({ ...audit, xuuxAudit: prov }, lock, NOW, exc);
    assert.deepEqual(withProv, plain, label);
  }
  // ‏رتبُ الشدّة: «Critical»/«HIGH»/فارغة ما تزالُ حرجةً (‏WL-572)، وmoderate لا تُسقِط.
  for (const sev of ['Critical', 'HIGH', '', 'high', 'critical']) {
    const r = evaluateAudit(
      {
        vulnerabilities: {
          a: {
            name: 'a',
            severity: sev,
            via: [{ url: 'u', severity: sev }],
            nodes: ['node_modules/a'],
          },
        },
      },
      { packages: { 'node_modules/a': {} } },
      NOW,
    );
    assert.equal(r.blocking.length, 1, sev);
  }
  assert.deepEqual(
    evaluateAudit(
      { vulnerabilities: { a: { name: 'a', severity: 'moderate', via: [] } } },
      { packages: {} },
      NOW,
    ).blocking,
    [],
  );
  assert.equal(typeof checkProvenance, 'function');
});

// ── WL-574: دورةُ الإنتاج عبرَ CLI الحقيقيّ — سجلٌّ محلّيٌّ (‏HTTP) يُجيبُ نقطةَ `advisories/bulk`، فـ npm audit يعملُ فعلاً. ──

/**
 * @param {string} cwd @param {string} registry
 * @returns {Promise<{ status: number, stdout: string, stderr: string }>}
 */
function runAuditCheckAsync(cwd, registry) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [AUDIT_CHECK, '--root', cwd],
      {
        cwd,
        encoding: 'utf8',
        timeout: 90000,
        env: {
          ...process.env,
          npm_config_registry: registry,
          npm_config_fetch_retries: '0',
          npm_config_audit_level: '',
        },
      },
      (error, stdout, stderr) => {
        const code = /** @type {any} */ (error)?.code;
        resolve({ status: error ? (typeof code === 'number' ? code : -1) : 0, stdout, stderr });
      },
    );
  });
}

/**
 * سجلٌّ محلّيٌّ يُجيبُ كلَّ طلبٍ بـ body؛ `onRequest` يُنفَّذُ قبلَ الإجابة (‏لمحاكاةِ تغيّرِ القفلِ أثناءَ التدقيق).
 * @param {string} body @param {() => void} [onRequest]
 * @returns {Promise<{ url: string, hits: string[], close: () => Promise<void> }>}
 */
function fakeRegistry(body, onRequest) {
  /** @type {string[]} */
  const hits = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      hits.push(`${req.method} ${req.url}`);
      onRequest?.();
      res.setHeader('content-type', 'application/json');
      res.end(body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        hits,
        close: () => new Promise((r) => server.close(() => r(undefined))),
      });
    });
  });
}

/** جذرٌ بقفلٍ حقيقيٍّ صغيرٍ يقبلُه npm audit، وصالحٌ لـ R3 فيما عدا التقرير. */
function auditableRoot() {
  const tmp = makeTempRoot();
  writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 't', version: '1.0.0', private: true, dependencies: { pg: '8.23.0' } }),
  );
  writeFileSync(
    path.join(tmp, 'package-lock.json'),
    JSON.stringify({
      name: 't',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name: 't', version: '1.0.0', dependencies: { pg: '8.23.0' } },
        'node_modules/pg': { version: '8.23.0' },
      },
    }),
  );
  mkdirSync(path.join(tmp, 'node_modules'), { recursive: true });
  writeFileSync(
    path.join(tmp, 'sbom.cdx.json'),
    JSON.stringify(stampedSbom(tmp, { bomFormat: 'CycloneDX', components: [{ name: 'pg' }] })),
  );
  writeFileSync(path.join(tmp, '.gitignore'), 'node_modules\n');
  return tmp;
}

test('WL-574: audit:check الحقيقيُّ يكتبُ تقريراً مختوماً — وقتُ البدءِ UTC وبصمةُ القفلِ الخام — يقبلُه R3', async () => {
  const tmp = auditableRoot();
  const reg = await fakeRegistry('{}');
  try {
    const before = Date.now();
    const r = await runAuditCheckAsync(tmp, reg.url);
    const after = Date.now();
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.ok(
      reg.hits.some((h) => h.includes('/-/npm/v1/security/advisories/bulk')),
      reg.hits.join(','),
    );
    const report = JSON.parse(readFileSync(path.join(tmp, 'audit-report.json'), 'utf8'));
    assert.equal(report.auditReportVersion, 2);
    assert.deepEqual(report.vulnerabilities, {});
    assert.equal(typeof report.metadata, 'object');
    assert.equal('xuuxAudit' in report.metadata, false, 'لا شيءَ تحتَ metadata');
    assert.deepEqual(Object.keys(report.xuuxAudit).sort(), [
      'generatedAt',
      'lockfileSha256',
      'version',
    ]);
    assert.equal(report.xuuxAudit.version, 1);
    assert.match(report.xuuxAudit.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const t = Date.parse(report.xuuxAudit.generatedAt);
    assert.ok(t >= before && t <= after, `${report.xuuxAudit.generatedAt} ∉ [${before}, ${after}]`);
    const sha = createHash('sha256')
      .update(readFileSync(path.join(tmp, 'package-lock.json')))
      .digest('hex');
    assert.equal(report.xuuxAudit.lockfileSha256, sha);
    const g = runGuard(tmp);
    assert.equal(g.ok, true, g.stderr || g.output);
    assert.equal(
      readdirSync(tmp).filter((f) => f.startsWith('audit-report.json.')).length,
      0,
      'لا ملفَّ مؤقّتاً متبقّياً',
    );
  } finally {
    await reg.close();
    cleanup(tmp);
  }
});

test('WL-574: تغيّرُ القفلِ أثناءَ التدقيقِ يُفشِلُ audit:check بوضوحٍ ولا يتركُ تقريراً — ولا القديمَ الصالح', async () => {
  for (const [label, mutate] of /** @type {Array<[string, (p: string, o: string) => void]>} */ ([
    // ‏تغييرٌ في البايتاتِ لا في المعنى (‏سطرٌ زائد) — يكشفُه الفحصُ بالبصمةِ الخامِ وحدَها.
    ['سطرٌ زائد', (p, o) => writeFileSync(p, `${o}\n`)],
    // ‏تغييرٌ ثمّ عودةٌ إلى البايتاتِ نفسِها (‏ABA) — البصمةُ تتطابق؛ توقيعُ stat (‏mtime) يكشفُه.
    [
      'تغييرٌ ثمّ عودة (‏ABA)',
      (p, o) => {
        writeFileSync(p, `${o}\n`);
        writeFileSync(p, o);
      },
    ],
  ])) {
    const tmp = auditableRoot();
    const lockPath = path.join(tmp, 'package-lock.json');
    const original = readFileSync(lockPath, 'utf8');
    // ‏تقريرٌ سابقٌ صالحٌ تماماً لهذا القفل — كان سيمرُّ R3 لو بقي.
    writeFileSync(
      path.join(tmp, 'audit-report.json'),
      JSON.stringify(stamped(tmp, { vulnerabilities: {} })),
    );
    assert.equal(runGuard(tmp).ok, true, `${label}: التقريرُ السابقُ صالحٌ قبلَ التشغيل`);
    const reg = await fakeRegistry('{}', () => mutate(lockPath, original));
    try {
      const r = await runAuditCheckAsync(tmp, reg.url);
      assert.ok(reg.hits.length > 0, `${label}: التدقيقُ وصلَ السجلّ`);
      assert.equal(r.status, 1, `${label}: ${r.stdout}\n${r.stderr}`);
      assert.match(r.stderr, /package-lock\.json تغيّرَ أثناءَ التدقيق/, label);
      assert.doesNotMatch(r.stdout, /✅/, label);
      assert.equal(
        existsSync(path.join(tmp, 'audit-report.json')),
        false,
        `${label}: لا تقريرَ بعدَ السباق`,
      );
      const g = runGuard(tmp);
      assert.equal(g.ok, false, label);
      assert.match(g.stderr ?? '', /R3: `audit-report\.json` غائبٌ/, label);
    } finally {
      await reg.close();
      cleanup(tmp);
    }
  }
});

test('WL-574: فشلُ التدقيقِ (‏سجلٌّ لا يُجيب، أو ثغرةٌ عالية) مع تقريرٍ قديمٍ صالحٍ — يُزالُ القديمُ فلا يقبلُه R3', async () => {
  const highAdvisory = JSON.stringify({
    pg: [
      {
        id: 1,
        url: 'https://github.com/advisories/GHSA-test-574',
        title: 'test',
        severity: 'high',
        vulnerable_versions: '<=99.0.0',
        cwe: [],
        cvss: { score: 7.5, vectorString: null },
      },
    ],
  });
  const reg = await fakeRegistry(highAdvisory);
  try {
    for (const [label, registry, msg] of /** @type {Array<[string, string, RegExp]>} */ ([
      ['سجلٌّ لا يُجيب', 'http://127.0.0.1:9', /تقريرُ تدقيقٍ غيرُ صالح/],
      ['ثغرةٌ عالية', reg.url, /ثغرةٌ حرجة\/عالية/],
    ])) {
      const tmp = auditableRoot();
      try {
        writeFileSync(
          path.join(tmp, 'audit-report.json'),
          JSON.stringify(stamped(tmp, { vulnerabilities: {} })),
        );
        assert.equal(runGuard(tmp).ok, true, `${label}: التقريرُ السابقُ صالحٌ قبلَ التشغيل`);
        const r = await runAuditCheckAsync(tmp, registry);
        assert.equal(r.status, 1, `${label}: ${r.stdout}\n${r.stderr}`);
        assert.match(r.stderr, msg, label);
        assert.equal(
          existsSync(path.join(tmp, 'audit-report.json')),
          false,
          `${label}: لا تقريرَ بعدَ الفشل`,
        );
        const g = runGuard(tmp);
        assert.equal(g.ok, false, label);
        assert.match(g.stderr ?? '', /R3: `audit-report\.json` غائبٌ/, label);
      } finally {
        cleanup(tmp);
      }
    }
  } finally {
    await reg.close();
  }
});

// ── WL-575: R2 كان يقبلُ أيَّ ملفِّ CycloneDX بمكوّنٍ واحدٍ — لا ربطَ بالقفلِ الحاليّ (‏مقيس: SBOM فيه `pg` وحدَه لقفلٍ بلا حزمٍ يمرّ).
// ‏الآن: `metadata.properties` (‏مسارُ الامتدادِ القياسيُّ في CycloneDX) تحملُ خاصّيّةً واحدةً بالضبط `xuux:lockfileSha256`
// ‏= SHA-256 لبايتاتِ `package-lock.json` الخامِ عندَ التوليد، مطابقةً للقفلِ الحاليّ تماماً. ──

const GEN_SBOM = fileURLToPath(new URL('../../scripts/generate-sbom.mjs', import.meta.url));
const UNBOUND = /R2: SBOM غيرُ مربوطٍ بالقفل/;

/** جذرٌ صالحٌ لكلِّ القواعد عدا SBOM الذي يكتبُه المُستدعي. */
function r2Root() {
  const tmp = floorRoot({});
  rmSync(path.join(tmp, 'sbom.cdx.json'), { force: true });
  return tmp;
}

test('WL-575: R2 عبرَ CLI — SBOM مربوطٌ بالقفلِ يمرّ، وكلُّ ربطٍ غائبٍ أو مشوّهٍ أو مكرّرٍ أو لقفلٍ آخرَ يُرفَض', () => {
  const tmp = r2Root();
  try {
    const base = {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      metadata: { timestamp: '2026-11-19T00:00:00.000Z', tools: [{ name: 'cli' }] },
      components: [{ name: 'ajv', version: '8.20.0' }],
    };
    const good = stampedSbom(tmp, base);
    const prop = good.metadata.properties[0];
    const sha = prop.value;
    const other = createHash('sha256').update('{}').digest('hex');
    /** @param {any} properties */
    const withProps = (properties) => ({ ...base, metadata: { ...base.metadata, properties } });
    /** @type {Array<[string, any, boolean]>} */
    const cases = [
      ['مربوطٌ صالح', good, true],
      ['مع خاصّيّاتٍ أخرى', withProps([{ name: 'cdx:x', value: 'y' }, prop]), true],
      ['بلا metadata', { ...base, metadata: undefined }, false],
      ['metadata null', { ...base, metadata: null }, false],
      ['metadata مصفوفة', { ...base, metadata: [] }, false],
      ['بلا properties', base, false],
      ['properties كائن', withProps({ 'xuux:lockfileSha256': sha }), false],
      ['properties null', withProps(null), false],
      ['properties فارغة', withProps([]), false],
      [
        'الخاصّيّةُ في مكوّنٍ لا في metadata',
        { ...base, components: [{ name: 'ajv', properties: [prop] }] },
        false,
      ],
      [
        'الخاصّيّةُ في metadata.component',
        { ...base, metadata: { ...base.metadata, component: { properties: [prop] } } },
        false,
      ],
      ['اسمٌ آخر', withProps([{ name: 'xuux:lockSha256', value: sha }]), false],
      ['مكرّرةٌ بالقيمةِ نفسِها', withProps([prop, prop]), false],
      ['مكرّرةٌ بقيمتين', withProps([prop, { name: prop.name, value: other }]), false],
      ['عنصرٌ ليس كائناً', withProps(['xuux:lockfileSha256', prop]), false],
      ['قيمةٌ غائبة', withProps([{ name: prop.name }]), false],
      ['قيمةٌ رقم', withProps([{ name: prop.name, value: 0 }]), false],
      ['قيمةٌ بأحرفٍ كبيرة', withProps([{ name: prop.name, value: sha.toUpperCase() }]), false],
      ['قيمةٌ مقصوصة', withProps([{ name: prop.name, value: sha.slice(1) }]), false],
      ['قيمةٌ بمسافة', withProps([{ name: prop.name, value: ` ${sha}` }]), false],
      ['بصمةُ قفلٍ آخر', withProps([{ name: prop.name, value: other }]), false],
    ];
    for (const [label, sbom, ok] of cases) {
      writeFileSync(path.join(tmp, 'sbom.cdx.json'), JSON.stringify(sbom));
      const r = runGuard(tmp);
      assert.equal(r.ok, ok, `${label}: ${r.stderr || r.output}`);
      if (!ok) assert.match(r.stderr ?? '', UNBOUND, label);
      else assert.doesNotMatch(`${r.stderr ?? ''}${r.output}`, /R2/, label);
    }
  } finally {
    cleanup(tmp);
  }
});

test('WL-575: ربطُ SBOM لبايتاتِ القفلِ الخام — إعادةُ تسلسلٍ أو سطرٌ زائدٌ بعدَ الختمِ يُرفَض، وشروطُ R2 السابقةُ قائمة', () => {
  const tmp = r2Root();
  try {
    const lockPath = path.join(tmp, 'package-lock.json');
    const sbomPath = path.join(tmp, 'sbom.cdx.json');
    const sbom = { bomFormat: 'CycloneDX', components: [{ name: 'ajv' }] };
    writeFileSync(sbomPath, JSON.stringify(stampedSbom(tmp, sbom)));
    assert.equal(runGuard(tmp).ok, true);
    // ‏الشروطُ السابقةُ لا تُرخى بالربط: صيغةٌ أخرى أو بلا مكوّناتٍ ⇒ رسالتُها كما هي.
    writeFileSync(sbomPath, JSON.stringify(stampedSbom(tmp, { ...sbom, bomFormat: 'SPDX' })));
    assert.match(runGuard(tmp).stderr ?? '', /R2: `sbom\.cdx\.json` ليس بصيغة CycloneDX/);
    writeFileSync(sbomPath, JSON.stringify(stampedSbom(tmp, { ...sbom, components: [] })));
    assert.match(runGuard(tmp).stderr ?? '', /R2: `sbom\.cdx\.json` بلا مكوّناتٍ/);
    writeFileSync(sbomPath, JSON.stringify(stampedSbom(tmp, sbom)));
    const original = readFileSync(lockPath, 'utf8');
    for (const [label, bytes] of /** @type {Array<[string, string]>} */ ([
      ['إعادةُ تسلسلٍ بمسافات', JSON.stringify(JSON.parse(original), null, 2)],
      ['سطرٌ أخيرٌ زائد', `${original}\n`],
    ])) {
      writeFileSync(lockPath, bytes);
      // ‏تقريرُ التدقيقِ يُعادُ ختمُه للقفلِ الجديدِ فيبقى R2 وحدَه سببَ الرفض.
      writeFileSync(
        path.join(tmp, 'audit-report.json'),
        JSON.stringify(stamped(tmp, { vulnerabilities: {} })),
      );
      const r = runGuard(tmp);
      assert.equal(r.ok, false, label);
      assert.match(r.stderr ?? '', UNBOUND, label);
      assert.doesNotMatch(r.stderr ?? '', /R3/, label);
    }
  } finally {
    cleanup(tmp);
  }
});

test('WL-575: checkSbomBinding وstampSbom — الأسبابُ لكلِّ شرطٍ وحدَه، والختمُ لا يمسُّ بقيّةَ SBOM', async () => {
  const m = await import('../../scripts/generate-sbom.mjs');
  assert.equal(m.SBOM_LOCK_PROPERTY, 'xuux:lockfileSha256');
  const lockBytes = Buffer.from('{\n  "lockfileVersion": 3,\n  "packages": {}\n}\n');
  const sha = createHash('sha256').update(lockBytes).digest('hex');
  /** @param {any} properties */
  const sb = (properties) => ({
    bomFormat: 'CycloneDX',
    metadata: { properties },
    components: [{}],
  });
  const ok = sb([{ name: 'xuux:lockfileSha256', value: sha }]);
  assert.equal(m.checkSbomBinding(ok, lockBytes), '');
  assert.match(m.checkSbomBinding(ok, null), /package-lock\.json/);
  assert.match(m.checkSbomBinding(ok, Buffer.from('{}')), /لا تطابقُ/);
  assert.match(m.checkSbomBinding(sb([]), lockBytes), /غائبة/);
  assert.match(
    m.checkSbomBinding(sb([7, ...ok.metadata.properties]), lockBytes),
    /عنصرٌ ليس كائناً/,
  );
  assert.match(
    m.checkSbomBinding(sb([{ value: 'x' }, ...ok.metadata.properties]), lockBytes),
    /عنصرٌ ليس كائناً/,
  );
  const dup = sb([
    { name: 'xuux:lockfileSha256', value: sha },
    { name: 'xuux:lockfileSha256', value: sha },
  ]);
  assert.match(m.checkSbomBinding(dup, lockBytes), /مكرّرة/);
  for (const bad of ['A'.repeat(64), sha.toUpperCase(), `${sha}0`, sha.slice(1), 7, null]) {
    assert.match(
      m.checkSbomBinding(sb([{ name: 'xuux:lockfileSha256', value: bad }]), null),
      /ليست SHA-256 بـ 64/,
      String(bad),
    );
  }
  for (const bad of [
    null,
    [],
    'x',
    1,
    {},
    { metadata: null },
    { metadata: [] },
    sb(null),
    sb({}),
  ]) {
    assert.notEqual(m.checkSbomBinding(bad, lockBytes), '', JSON.stringify(bad));
  }
  /** @type {any} */
  const npmLike = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    metadata: { timestamp: 't', tools: [{ name: 'cli' }], component: { name: 'c' } },
    components: [{ name: 'pg' }],
    dependencies: [],
  };
  const s = m.stampSbom(npmLike, lockBytes);
  assert.deepEqual(s, {
    ...npmLike,
    metadata: { ...npmLike.metadata, properties: [{ name: 'xuux:lockfileSha256', value: sha }] },
  });
  assert.equal(npmLike.metadata.properties, undefined, 'الأصلُ لم يُعدَّل');
  assert.equal(m.checkSbomBinding(s, lockBytes), '');
  // ‏خاصّيّاتٌ سابقةٌ تبقى؛ وخاصّيّةُ ربطٍ سابقةٌ (‏ليست من npm) تُرفَضُ لا تُستبدَل.
  const pre = {
    ...npmLike,
    metadata: { ...npmLike.metadata, properties: [{ name: 'cdx:a', value: 'b' }] },
  };
  assert.deepEqual(m.stampSbom(pre, lockBytes).metadata.properties, [
    { name: 'cdx:a', value: 'b' },
    { name: 'xuux:lockfileSha256', value: sha },
  ]);
  assert.throws(() => m.stampSbom(ok, lockBytes), /xuux:lockfileSha256/);
});

// ── WL-575: دورةُ التوليدِ عبرَ CLI الحقيقيّ — `npm sbom` على شجرةٍ مثبّتةٍ محلّيّاً (‏بلا شبكة). ──

/** جذرٌ بـ`pg` مثبّتةٍ في node_modules وقفلٍ يطابقُها، وتقريرِ تدقيقٍ مختوم — صالحٌ لكلِّ القواعد عدا SBOM. */
function sbomRoot() {
  const tmp = makeTempRoot();
  writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 't', version: '1.0.0', private: true, dependencies: { pg: '8.23.0' } }),
  );
  writeFileSync(
    path.join(tmp, 'package-lock.json'),
    // ‏بتنسيقِ npm (‏مسافتان وسطرٌ أخير) — فبصمةُ JSON المعادِ تسلسلُه تختلفُ عن بصمةِ البايتاتِ الخام.
    `${JSON.stringify(
      {
        name: 't',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': { name: 't', version: '1.0.0', dependencies: { pg: '8.23.0' } },
          'node_modules/pg': { version: '8.23.0' },
        },
      },
      null,
      2,
    )}\n`,
  );
  mkdirSync(path.join(tmp, 'node_modules', 'pg'), { recursive: true });
  writeFileSync(
    path.join(tmp, 'node_modules', 'pg', 'package.json'),
    JSON.stringify({ name: 'pg', version: '8.23.0' }),
  );
  writeFileSync(path.join(tmp, '.gitignore'), 'node_modules\n');
  writeFileSync(
    path.join(tmp, 'audit-report.json'),
    JSON.stringify(stamped(tmp, { vulnerabilities: {} })),
  );
  return tmp;
}

const REAL_NPM = spawnSync('sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).stdout.trim();

/**
 * يُشغّلُ generate-sbom.mjs؛ و`shim` يضعُ `npm` وسيطاً أوّلَ PATH (‏في مجلّدٍ مؤقّتٍ خارجَ الجذر) يُعدّلُ القفلَ أو يفشلُ
 * قبلَ تمريرِ الأمرِ إلى npm الحقيقيّ — فلا خطّافَ اختباريّاً في شفرةِ الإنتاج.
 * ‏`removed`: يُزيلُ القفلَ بعدَ npm (‏فيتعذّرُ فحصُه)، و`dirblock`: مجلّدٌ غيرُ فارغٍ مكانَ SBOM فيفشلُ rename.
 * @param {string} root @param {'' | 'append' | 'aba' | 'fail' | 'removed' | 'dirblock'} [shim]
 */
function runGenSbom(root, shim = '') {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env };
  const shimDir = `${root}-shim`;
  if (shim !== '') {
    mkdirSync(shimDir, { recursive: true });
    const step = {
      append: "printf '\\n' >> package-lock.json",
      aba: "cp package-lock.json .lk && printf '\\n' >> package-lock.json && cp .lk package-lock.json && rm .lk",
      fail: "echo 'shim: npm sbom فشل' >&2; exit 1",
      removed: '',
      dirblock: 'mkdir -p sbom.cdx.json/x',
    }[shim];
    const run =
      shim === 'removed'
        ? `"${REAL_NPM}" "$@"; rc=$?; rm package-lock.json; exit $rc`
        : `exec "${REAL_NPM}" "$@"`;
    writeFileSync(path.join(shimDir, 'npm'), `#!/bin/sh\n${step}\n${run}\n`, {
      mode: 0o755,
    });
    env.PATH = `${shimDir}${path.delimiter}${env.PATH ?? ''}`;
  }
  try {
    return spawnSync(process.execPath, [GEN_SBOM, '--root', root], {
      cwd: root,
      encoding: 'utf8',
      env,
      timeout: 60000,
    });
  } finally {
    rmSync(shimDir, { recursive: true, force: true });
  }
}

test('WL-575: gen:sbom الحقيقيُّ يختمُ SBOM ببصمةِ القفلِ الخام — ويبقى ما أنتجَه npm، ويقبلُه R2', () => {
  const tmp = sbomRoot();
  try {
    const r = runGenSbom(tmp);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const sbom = JSON.parse(readFileSync(path.join(tmp, 'sbom.cdx.json'), 'utf8'));
    assert.equal(sbom.bomFormat, 'CycloneDX');
    assert.deepEqual(
      sbom.components.map((/** @type {any} */ c) => `${c.name}@${c.version}`),
      ['pg@8.23.0'],
    );
    assert.equal(typeof sbom.metadata.timestamp, 'string', 'حقولُ npm باقية');
    assert.ok(Array.isArray(sbom.metadata.tools));
    const sha = createHash('sha256')
      .update(readFileSync(path.join(tmp, 'package-lock.json')))
      .digest('hex');
    assert.deepEqual(sbom.metadata.properties, [{ name: 'xuux:lockfileSha256', value: sha }]);
    assert.equal(
      readdirSync(tmp).filter((f) => f.startsWith('sbom.cdx.json.')).length,
      0,
      'لا ملفَّ مؤقّتاً',
    );
    const g = runGuard(tmp);
    assert.equal(g.ok, true, g.stderr || g.output);
  } finally {
    cleanup(tmp);
  }
});

test('WL-575: تغيّرُ القفلِ أثناءَ التوليدِ (‏سطرٌ زائد، وABA، وقفلٌ يتعذّرُ فحصُه بعدَه) يُفشِلُ gen:sbom بلا SBOM — ولا السابقَ الصالح', () => {
  for (const shim of /** @type {const} */ (['append', 'aba', 'removed'])) {
    const tmp = sbomRoot();
    try {
      writeFileSync(
        path.join(tmp, 'sbom.cdx.json'),
        JSON.stringify(stampedSbom(tmp, { bomFormat: 'CycloneDX', components: [{ name: 'pg' }] })),
      );
      assert.equal(runGuard(tmp).ok, true, `${shim}: السابقُ صالحٌ قبلَ التشغيل`);
      const r = runGenSbom(tmp, shim);
      assert.equal(r.status, 1, `${shim}: ${r.stdout}\n${r.stderr}`);
      assert.match(r.stderr, /package-lock\.json تغيّرَ أثناءَ توليدِ SBOM/, shim);
      assert.doesNotMatch(r.stdout, /✅/, shim);
      assert.equal(existsSync(path.join(tmp, 'sbom.cdx.json')), false, `${shim}: لا SBOM`);
      assert.deepEqual(
        readdirSync(tmp).filter((f) => f.startsWith('sbom.cdx.json')),
        [],
        shim,
      );
      assert.match(runGuard(tmp).stderr ?? '', /R2: `sbom\.cdx\.json` غائبٌ/, shim);
    } finally {
      cleanup(tmp);
    }
  }
});

// ‏WL-575: ABA كامل — يكتبُه وسيطُ npm بـNode: يحفظُ وقتَي القفلِ في ملفٍّ مرجعيٍّ (‏`touch -r`، بدقّةِ النانوثانية)،
// ‏فيُغيّرُ البايتاتِ في مكانِها (‏inode نفسُه)، فيُعيدُ البايتاتِ الأصليّة، فيستعيدُ mtime الأصليَّ (‏`touch -m -r`)،
// ‏ويسجّلُ stat ‏(bigint) قبلُ وبعدُ. لا يبقى فرقٌ إلّا ctimeNs — ولا تضبطُه واجهةُ مستخدم.
const ABA_SHIM = `import { readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const [lock, ref, report] = ['package-lock.json', '.lock-times', process.argv[2]];
const st = (p) => { const s = statSync(p, { bigint: true });
  return { dev: String(s.dev), ino: String(s.ino), size: String(s.size), mtimeNs: String(s.mtimeNs),
    ctimeNs: String(s.ctimeNs), mtimeMs: s.mtimeNs / 1000000n }; };
const before = st(lock);
const bytes = readFileSync(lock);
execFileSync('touch', ['-r', lock, ref]);
const tick = () => { const t = Date.now(); while (Date.now() - t < 20); };
tick();
writeFileSync(lock, Buffer.concat([bytes, Buffer.from('\\n')]));
const changedSize = String(statSync(lock, { bigint: true }).size);
tick();
writeFileSync(lock, bytes);
execFileSync('touch', ['-m', '-r', ref, lock]);
rmSync(ref);
const after = st(lock);
const ser = (o) => ({ ...o, mtimeMs: String(o.mtimeMs) });
writeFileSync(report, JSON.stringify({ before: ser(before), after: ser(after), changedSize,
  same: Buffer.compare(readFileSync(lock), bytes) === 0 }));
`;

test('WL-575: ABA كاملٌ أثناءَ التوليد — البايتاتُ والحجمُ وinode وmtime تعودُ كما كانت، وctimeNs يكشفُه فيفشلُ بلا SBOM', () => {
  const tmp = sbomRoot();
  const shimDir = `${tmp}-aba`;
  const report = `${tmp}-aba.json`;
  try {
    const sbomPath = path.join(tmp, 'sbom.cdx.json');
    writeFileSync(
      sbomPath,
      JSON.stringify(stampedSbom(tmp, { bomFormat: 'CycloneDX', components: [{ name: 'pg' }] })),
    );
    assert.equal(runGuard(tmp).ok, true, 'السابقُ صالحٌ قبلَ التشغيل');
    mkdirSync(shimDir, { recursive: true });
    writeFileSync(path.join(shimDir, 'aba.mjs'), ABA_SHIM);
    writeFileSync(
      path.join(shimDir, 'npm'),
      `#!/bin/sh\n"${process.execPath}" "${path.join(shimDir, 'aba.mjs')}" "${report}" || exit 9\nexec "${REAL_NPM}" "$@"\n`,
      { mode: 0o755 },
    );
    const r = spawnSync(process.execPath, [GEN_SBOM, '--root', tmp], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${shimDir}${path.delimiter}${process.env.PATH ?? ''}` },
      timeout: 60000,
    });
    const { before, after, changedSize, same } = JSON.parse(readFileSync(report, 'utf8'));
    // ‏الوسيطُ غيّرَ فعلاً ثمّ أعاد: حجمٌ آخرُ في الوسط، ثمّ البايتاتُ نفسُها والحجمُ وinode والجهازُ وmtime بالنانوثانية.
    assert.equal(changedSize, String(BigInt(before.size) + 1n), 'تغيّرَ المحتوى في الوسط');
    assert.equal(same, true, 'البايتاتُ الأصليّةُ نفسُها');
    for (const k of ['dev', 'ino', 'size', 'mtimeNs', 'mtimeMs']) {
      assert.equal(after[k], before[k], `${k} عادَ كما كان`);
    }
    // ‏فالتوقيعُ السابقُ (‏size:mtimeMs:ino) والبصمةُ لا يريانِ شيئاً — وحدَه ctimeNs تقدّم.
    assert.ok(
      BigInt(after.ctimeNs) > BigInt(before.ctimeNs),
      `ctimeNs ${before.ctimeNs} → ${after.ctimeNs}`,
    );
    const now = statSync(path.join(tmp, 'package-lock.json'), { bigint: true });
    assert.equal(String(now.mtimeNs), before.mtimeNs, 'mtime الأصليُّ باقٍ بعدَ التوليد');
    assert.equal(String(now.ctimeNs), after.ctimeNs, 'لا تغيّرَ آخرَ بعدَ الوسيط');
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /package-lock\.json تغيّرَ أثناءَ توليدِ SBOM/);
    assert.doesNotMatch(r.stdout, /✅/);
    assert.equal(existsSync(sbomPath), false, 'لا SBOM — ولا السابقُ الصالح');
    assert.deepEqual(
      readdirSync(tmp).filter((f) => f.startsWith('sbom.cdx.json')),
      [],
      'لا ملفَّ مؤقّتاً',
    );
    assert.match(runGuard(tmp).stderr ?? '', /R2: `sbom\.cdx\.json` غائبٌ/);
  } finally {
    cleanup(tmp);
    rmSync(shimDir, { recursive: true, force: true });
    rmSync(report, { force: true });
  }
});

test('WL-575: فشلُ التوليدِ (‏npm يفشل، أو شجرةٌ ناقصةٌ عن القفل) مع SBOM سابقٍ صالح — يُزالُ السابقُ فلا يقبلُه R2', () => {
  for (const label of /** @type {const} */ (['fail', 'missing'])) {
    const tmp = sbomRoot();
    try {
      writeFileSync(
        path.join(tmp, 'sbom.cdx.json'),
        JSON.stringify(stampedSbom(tmp, { bomFormat: 'CycloneDX', components: [{ name: 'pg' }] })),
      );
      assert.equal(runGuard(tmp).ok, true, `${label}: السابقُ صالحٌ قبلَ التشغيل`);
      // ‏«missing»: npm sbom الحقيقيُّ يرفضُ شجرةً تنقصُها حزمةٌ في القفل (‏ESBOMPROBLEMS).
      if (label === 'missing') rmSync(path.join(tmp, 'node_modules', 'pg'), { recursive: true });
      const r = runGenSbom(tmp, label === 'fail' ? 'fail' : '');
      assert.equal(r.status, 1, `${label}: ${r.stdout}\n${r.stderr}`);
      assert.match(r.stderr, /فشل توليد SBOM/, label);
      assert.equal(
        existsSync(path.join(tmp, 'sbom.cdx.json')),
        false,
        `${label}: لا SBOM بعدَ الفشل`,
      );
      assert.deepEqual(
        readdirSync(tmp).filter((f) => f.startsWith('sbom.cdx.json')),
        [],
        `${label}: لا مؤقّت`,
      );
      assert.match(runGuard(tmp).stderr ?? '', /R2: `sbom\.cdx\.json` غائبٌ/, label);
    } finally {
      cleanup(tmp);
    }
  }
});

test('WL-575: lockSignature — stat ‏bigint بالنانوثانية (‏dev وino وsize وmtimeNs وctimeNs)، ويرمي إن غابَ الملف؛ وفشلُ rename لا يتركُ مؤقّتاً', async () => {
  const { lockSignature } = await import(GEN_SBOM);
  const tmp = sbomRoot();
  try {
    const lock = path.join(tmp, 'package-lock.json');
    const s = statSync(lock, { bigint: true });
    assert.equal(lockSignature(lock), `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`);
    assert.throws(() => lockSignature(path.join(tmp, 'غائب.json')), /ENOENT/);
    const r = runGenSbom(tmp, 'dirblock');
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /فشل توليد SBOM/);
    assert.doesNotMatch(r.stdout, /✅/);
    assert.deepEqual(
      readdirSync(tmp).filter((f) => f.startsWith('sbom.cdx.json.')),
      [],
      'لا مؤقّتَ بعدَ فشلِ rename',
    );
    assert.equal(runGuard(tmp).ok, false, 'لا SBOM مقبول');
  } finally {
    cleanup(tmp);
  }
});

// ‏WL-575: سباقُ مرحلةِ المؤقّت — وحدةٌ تُحمَّلُ بـ`--import` (‏خارجَ شفرةِ الإنتاج) تلفُّ `fs.writeFileSync` و`fs.renameSync`
// ‏(‏`syncBuiltinESMExports` تُحدِّثُ الاستيرادَ المسمّى): بعدَ اكتمالِ كتابةِ `sbom.cdx.json.<pid>.tmp` وإغلاقِه — أي بعدَ
// ‏نجاحِ `npm sbom` الحقيقيّ وفحصِ ما بعدَه — تُغيّرُ القفل، وتسجّلُ أنَّ المؤقّتَ كُتِبَ مختوماً وهل نُفِّذَ rename. حتميٌّ بلا توقيت.
const TMP_RACE_PRELOAD = `import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const [mode, report] = [process.env.XUUX_TMP_RACE, process.env.XUUX_TMP_RACE_REPORT];
const write = fs.writeFileSync;
const rename = fs.renameSync;
const log = { hooked: false, renamed: false };
const save = () => write(report, JSON.stringify(log));
fs.writeFileSync = function (p, ...rest) {
  write(p, ...rest);
  if (typeof p !== 'string' || !/sbom\\.cdx\\.json\\.\\d+\\.tmp$/.test(p) || log.hooked) return;
  log.hooked = true;
  const body = JSON.parse(fs.readFileSync(p, 'utf8'));
  log.tmpStamped = body.metadata.properties.filter((x) => x.name === 'xuux:lockfileSha256').length;
  const lock = 'package-lock.json';
  const st = () => { const s = fs.statSync(lock, { bigint: true });
    return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].map(String); };
  if (mode === 'removed') {
    fs.rmSync(lock);
  } else {
    const bytes = fs.readFileSync(lock);
    log.before = st();
    if (mode === 'aba') execFileSync('touch', ['-r', lock, '.lock-times']);
    write(lock, Buffer.concat([bytes, Buffer.from('\\\\n')]));
    if (mode === 'aba') {
      write(lock, bytes);
      execFileSync('touch', ['-m', '-r', '.lock-times', lock]);
      fs.rmSync('.lock-times');
    }
    log.after = st();
    log.same = Buffer.compare(fs.readFileSync(lock), bytes) === 0;
  }
  save();
};
fs.renameSync = function (...args) {
  log.renamed = true;
  save();
  return rename(...args);
};
syncBuiltinESMExports();
`;

test('WL-575: تغيّرُ القفلِ بعدَ كتابةِ المؤقّتِ وقبلَ rename (‏سطرٌ زائد، وABA كامل، وإزالة) — يكشفُه الفحصُ النهائيُّ فلا rename ولا SBOM ولا مؤقّت', () => {
  for (const mode of /** @type {const} */ (['append', 'aba', 'removed'])) {
    const tmp = sbomRoot();
    const preDir = `${tmp}-pre`;
    const report = `${tmp}-pre.json`;
    try {
      const sbomPath = path.join(tmp, 'sbom.cdx.json');
      writeFileSync(
        sbomPath,
        JSON.stringify(stampedSbom(tmp, { bomFormat: 'CycloneDX', components: [{ name: 'pg' }] })),
      );
      assert.equal(runGuard(tmp).ok, true, `${mode}: السابقُ صالحٌ قبلَ التشغيل`);
      mkdirSync(preDir, { recursive: true });
      const pre = path.join(preDir, 'tmp-race.mjs');
      writeFileSync(pre, TMP_RACE_PRELOAD);
      const r = spawnSync(
        process.execPath,
        ['--import', pathToFileURL(pre).href, GEN_SBOM, '--root', tmp],
        {
          cwd: tmp,
          encoding: 'utf8',
          env: { ...process.env, XUUX_TMP_RACE: mode, XUUX_TMP_RACE_REPORT: report },
          timeout: 60000,
        },
      );
      const log = JSON.parse(readFileSync(report, 'utf8'));
      // ‏npm sbom الحقيقيُّ نجحَ وفحصُ ما بعدَه مرّ (‏وإلّا لما كُتِبَ المؤقّت)، والمؤقّتُ كُتِبَ مختوماً مرّةً واحدة.
      assert.equal(log.hooked, true, `${mode}: كُتِبَ المؤقّت`);
      assert.equal(log.tmpStamped, 1, `${mode}: المؤقّتُ مختوم`);
      if (mode === 'aba') {
        assert.equal(log.same, true, 'البايتاتُ الأصليّةُ نفسُها');
        assert.deepEqual(
          log.after.slice(0, 4),
          log.before.slice(0, 4),
          'dev/ino/size/mtimeNs عادت',
        );
        assert.ok(BigInt(log.after[4]) > BigInt(log.before[4]), 'ctimeNs تقدّم');
      }
      if (mode === 'append') assert.notEqual(log.after[2], log.before[2], 'الحجمُ تغيّر');
      assert.equal(log.renamed, false, `${mode}: لا rename`);
      assert.equal(r.status, 1, `${mode}: ${r.stdout}\n${r.stderr}`);
      assert.match(r.stderr, /package-lock\.json تغيّرَ أثناءَ كتابةِ SBOM/, mode);
      assert.doesNotMatch(r.stderr, /تغيّرَ أثناءَ توليدِ SBOM/, `${mode}: فحصُ ما بعدَ npm مرّ`);
      assert.doesNotMatch(r.stdout, /✅/, mode);
      assert.equal(existsSync(sbomPath), false, `${mode}: لا SBOM — ولا السابقُ الصالح`);
      assert.deepEqual(
        readdirSync(tmp).filter((f) => f.startsWith('sbom.cdx.json')),
        [],
        `${mode}: لا مؤقّت`,
      );
      assert.match(runGuard(tmp).stderr ?? '', /R2: `sbom\.cdx\.json` غائبٌ/, mode);
    } finally {
      cleanup(tmp);
      rmSync(preDir, { recursive: true, force: true });
      rmSync(report, { force: true });
    }
  }
});
