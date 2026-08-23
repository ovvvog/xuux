// اختبار فاحص مادة المفاتيح الخاصة — حراسة معيار M2.03.
//
// فاحصٌ لا يُختبر كشفه هو وعدٌ لا ضابط: يكفي خطأ في تعبير نمطي واحد ليصير
// الفحص أخضر دائماً بلا أن يكشف شيئاً. ولذلك تُزرع هنا **مادة مفاتيح حقيقية**
// مولَّدة في العملية (لا مادة ثابتة في المستودع) بكل شكل يعرفه المشروع، ويُثبت
// أن كل كاشف يُطلق فعلاً، وأن النظيف يبقى نظيفاً، وأن رمز الخروج يميّز الحالتين.
// التشغيل: node --test tests/tooling/scan-private-keys.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import {
  DETECTORS,
  RUNTIME_ENV_VARS,
  RUNTIME_PATHS,
  partitionBySeverity,
  resolveScanRoots,
  scanPathForKeys,
  scanTextForKeys,
} from '../../scripts/scan-private-keys.mjs';

const repoRoot = new URL('../..', import.meta.url).pathname;
const scanner = join(repoRoot, 'scripts', 'scan-private-keys.mjs');

/**
 * مجلد مؤقت يُنظَّف بنهاية الاختبار.
 * @param {(dir: string) => void} body - العمل داخل المجلد
 */
function withTempDir(body) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-keys-'));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ed = generateKeyPairSync('ed25519');
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

/** أشكال المادة الخاصة المزروعة، كل شكل مع الكاشف المتوقَّع له. */
const SAMPLES = [
  {
    file: 'ed25519.txt',
    id: 'PEM_PRIVATE_KEY',
    body: String(ed.privateKey.export({ type: 'pkcs8', format: 'pem' })),
  },
  {
    file: 'rsa.txt',
    id: 'PEM_PRIVATE_KEY',
    body: String(rsa.privateKey.export({ type: 'pkcs1', format: 'pem' })),
  },
  {
    file: 'ed25519-der.json',
    id: 'PKCS8_ED25519_DER',
    body: JSON.stringify({
      material: Buffer.from(
        /** @type {Buffer} */ (ed.privateKey.export({ type: 'pkcs8', format: 'der' })),
      ).toString('base64'),
    }),
  },
  {
    file: 'rsa-der.json',
    id: 'DER_PRIVATE_KEY_HEADER',
    body: JSON.stringify({
      material: Buffer.from(
        /** @type {Buffer} */ (rsa.privateKey.export({ type: 'pkcs8', format: 'der' })),
      ).toString('base64'),
    }),
  },
  {
    file: 'ec-der.json',
    id: 'DER_PRIVATE_KEY_HEADER',
    body: JSON.stringify({
      material: Buffer.from(
        /** @type {Buffer} */ (ec.privateKey.export({ type: 'sec1', format: 'der' })),
      ).toString('base64'),
    }),
  },
  {
    file: 'jwk.json',
    id: 'JWK_PRIVATE_KEY',
    body: JSON.stringify(ed.privateKey.export({ format: 'jwk' })),
  },
  {
    file: 'config.mjs',
    id: 'RAW_PRIVATE_MATERIAL_ASSIGNMENT',
    body: `export const signingKey = '${Buffer.from(randomUUID() + randomUUID()).toString('base64url')}';\n`,
  },
];

test('كل كاشف يُطلق على مادة حقيقية مولَّدة في العملية', () => {
  for (const sample of SAMPLES) {
    const findings = scanTextForKeys(sample.body, sample.file);
    assert.ok(
      findings.some((f) => f.id === sample.id),
      `${sample.file}: الكاشف ${sample.id} لم يُطلق ⇒ حراسته دعوى. ما أُطلق: ${
        findings.map((f) => f.id).join(',') || 'لا شيء'
      }`,
    );
  }
});

test('المقتطف في التقرير محجوب فلا يُطبع السر في السجلات', () => {
  const material = String(ed.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const [finding] = scanTextForKeys(material, 'x.pem');
  assert.ok(finding, 'لا مخالفة');
  assert.ok(finding.excerpt.includes('*'), 'المقتطف غير محجوب');
  assert.equal(material.includes(finding.excerpt), false, 'المقتطف مطابق للمادة الأصلية');
});

test('الفحص على مجلد كامل يكشف كل الأشكال، وامتداد ملف المفاتيح مخالفة بذاته', () => {
  withTempDir((dir) => {
    mkdirSync(join(dir, 'nested', 'deeper'), { recursive: true });
    for (const sample of SAMPLES) writeFileSync(join(dir, 'nested', sample.file), sample.body);
    writeFileSync(join(dir, 'nested', 'deeper', 'server.pem'), 'محتوى لا يُقرأ أصلاً\n');

    const ids = new Set(scanPathForKeys(dir).map((f) => f.id));
    for (const sample of SAMPLES) assert.ok(ids.has(sample.id), `${sample.id} غاب`);
    assert.ok(ids.has('FORBIDDEN_KEY_FILE'), 'ملف .pem مرّ بلا مخالفة');
  });
});

test('المجلد النظيف نظيف: لا إنذار كاذب على تجزئات وتوقيعات ومفاتيح عامة', () => {
  withTempDir((dir) => {
    writeFileSync(
      join(dir, 'clean.json'),
      JSON.stringify({
        publicKey: String(ed.publicKey.export({ type: 'spki', format: 'pem' })),
        publicJwk: ed.publicKey.export({ format: 'jwk' }),
        hash: Buffer.from(randomUUID()).toString('base64'),
        signature: Buffer.from(randomUUID() + randomUUID()).toString('base64url'),
        derPublic: Buffer.from(
          /** @type {Buffer} */ (rsa.publicKey.export({ type: 'spki', format: 'der' })),
        ).toString('base64'),
      }),
    );
    assert.deepEqual(scanPathForKeys(dir), []);
  });
});

test('علامة التجاوز تُحترم للتوثيق، ولا تُلغي بقية السطور', () => {
  withTempDir((dir) => {
    const material = String(ed.privateKey.export({ type: 'pkcs8', format: 'pem' }))
      .split('\n')
      .filter(Boolean);
    writeFileSync(
      join(dir, 'doc.md'),
      `${material[0]} private-key-scan:allow\n${material[0]}\n`,
      'utf8',
    );
    const findings = scanPathForKeys(dir);
    assert.equal(findings.length, 1, 'التجاوز شمل أكثر من سطره أو لم يُحترم');
    assert.equal(findings[0]?.line, 2);
  });
});

test('المشفَّر على القرص: يُذكر في التطوير ويُفشل في الإنتاج', () => {
  withTempDir((dir) => {
    writeFileSync(
      join(dir, 'king-signing-key.key.json'),
      JSON.stringify({
        name: 'king-signing-key',
        salt: 'c2FsdA',
        iv: 'aXY',
        tag: 'dGFn',
        data: 'ZGF0YQ',
      }),
    );
    const findings = scanPathForKeys(dir);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.id, 'ENCRYPTED_KEY_AT_REST');
    assert.equal(findings[0]?.severity, 'production');

    assert.deepEqual(partitionBySeverity(findings, false).blocking, []);
    assert.equal(partitionBySeverity(findings, false).noted.length, 1);
    assert.equal(partitionBySeverity(findings, true).blocking.length, 1);
  });
});

test('رمز الخروج يميّز الحالتين، والتقرير لا يطبع مادة صريحة', () => {
  withTempDir((dir) => {
    const clean = spawnSync(process.execPath, [scanner, '--path', dir], { encoding: 'utf8' });
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /✅/);

    const material = String(ed.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    writeFileSync(join(dir, 'leaked.txt'), material);
    const dirty = spawnSync(process.execPath, [scanner, '--path', dir], { encoding: 'utf8' });
    assert.equal(dirty.status, 1, 'الفاحص لم يفشل على مادة مزروعة');
    assert.match(dirty.stderr, /PEM_PRIVATE_KEY/);
    const printed = dirty.stdout + dirty.stderr;
    for (const line of material.split('\n').filter((l) => l.length > 20)) {
      assert.equal(printed.includes(line), false, 'سطر من المادة طُبع كما هو');
    }
  });
});

test('وضع الإنتاج يُفشل على المشفَّر عبر العلم وعبر متغيّر البيئة معاً', () => {
  withTempDir((dir) => {
    writeFileSync(
      join(dir, 'k.key.json'),
      JSON.stringify({ name: 'k', salt: 's', iv: 'i', tag: 't', data: 'd' }),
    );
    const dev = spawnSync(process.execPath, [scanner, '--path', dir], { encoding: 'utf8' });
    assert.equal(dev.status, 0);
    assert.match(dev.stdout, /ℹ/);

    const byFlag = spawnSync(process.execPath, [scanner, '--path', dir, '--production'], {
      encoding: 'utf8',
    });
    assert.equal(byFlag.status, 1);

    const byEnv = spawnSync(process.execPath, [scanner, '--path', dir], {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production' },
    });
    assert.equal(byEnv.status, 1);
  });
});

test('جذور الفحص تشمل مسارات التشغيل ومتغيّرات البيئة، لا المستودع وحده', () => {
  withTempDir((dir) => {
    const keyDir = join(dir, 'external-keys');
    mkdirSync(keyDir, { recursive: true });
    writeFileSync(
      join(keyDir, 'leaked.txt'),
      String(ed.privateKey.export({ type: 'pkcs8', format: 'pem' })),
    );

    // المجلد ليس تحت المستودع ولا تحت المسار المطلوب: لا يُفحص إلا بإعلانه.
    const withoutEnv = spawnSync(process.execPath, [scanner, '--path', join(dir, 'empty')], {
      encoding: 'utf8',
    });
    assert.equal(withoutEnv.status, 0);

    const withEnv = spawnSync(process.execPath, [scanner, '--path', join(dir, 'empty')], {
      encoding: 'utf8',
      env: { ...process.env, KING_KEY_DIR: keyDir },
    });
    assert.equal(withEnv.status, 1, 'مجلد مفاتيح معلَن بمتغيّر بيئة لم يُفحص');
    assert.match(withEnv.stderr, /PEM_PRIVATE_KEY/);

    assert.ok(RUNTIME_ENV_VARS.includes('KING_KEY_DIR'));
    assert.ok(RUNTIME_PATHS.includes('secrets'));
    assert.deepEqual(resolveScanRoots([join(dir, 'لا-وجود-له')]), []);
  });
});

test('الفاحص موصول بالبوابة وبـ CI فلا يبقى أداةً تُنادى باليد', () => {
  const pkg = JSON.parse(
    spawnSync(process.execPath, ['-p', 'JSON.stringify(require("./package.json"))'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).stdout,
  );
  assert.equal(pkg.scripts['scan:keys'], 'node scripts/scan-private-keys.mjs');
  assert.match(pkg.scripts.validate, /npm run scan:keys/);

  const workflow = spawnSync('cat', [join(repoRoot, '.github', 'workflows', 'ci.yml')], {
    encoding: 'utf8',
  }).stdout;
  assert.match(
    workflow,
    /npm run scan:keys -- --production/,
    'الفاحص غائب عن CI أو يعمل فيه بوضع التطوير فيسمح بمادة مشفَّرة في المستودع',
  );
});

test('كل كاشف معلَن بمعرّف وسبب ودرجة خطورة معروفة', () => {
  assert.ok(DETECTORS.length >= 6);
  for (const d of DETECTORS) {
    assert.match(d.id, /^[A-Z0-9_]+$/);
    assert.ok(d.reason.length > 10, `الكاشف ${d.id} بلا سبب مفهوم`);
    assert.ok(['error', 'production'].includes(d.severity));
    assert.ok(d.re instanceof RegExp);
  }
});
