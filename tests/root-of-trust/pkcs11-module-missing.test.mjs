// @ts-nocheck
// tests/root-of-trust/pkcs11-module-missing.test.mjs
// OPS-1/M6 — قياسُ سقوطِ استيراد pkcs11js (المسار البديل المُعلَن).
//
// pkcs11js تبعيّةٌ اختياريّة: قد لا تُبنَى في بيئةٍ ما فيُتجاوَزها npm ci صامتاً.
// العقدُ الحاكمُ: غيابُ pkcs11js فشلٌ مغلقٌ برمز MODULE_MISSING لا تخطٍّ صامت.
// هذا الملفُّ يقيسُ سقوطَين:
//   ١. import('pkcs11js') يفشل → MODULE_MISSING
//   ٢. pkcs11js يُصدَّر بلا PKCS11 → MODULE_MISSING
// وكلاهما يُقاسُ في عمليّةٍ ابنةٍ عبر محمّلِ ESM مخصّص يُعترضُ الاستيراد.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

const PROVIDER_URL = new URL('../../src/root-of-trust/pkcs11-provider.mjs', import.meta.url).href;

describe('OPS-1/M6 — المسار البديل عند غياب pkcs11js', () => {
  const workDir = registerTmpRoot(mkdtempSync(join(tmpdir(), 'pkcs11-missing-')));

  test('import(pkcs11js) يفشل → HsmError MODULE_MISSING', () => {
    // محمّلُ ESM يُعترضُ استيراد pkcs11js ويرمي خطأً.
    const loaderPath = join(workDir, 'block-loader.mjs');
    writeFileSync(
      loaderPath,
      [
        'export async function resolve(specifier, context, nextResolve) {',
        "  if (specifier === 'pkcs11js') {",
        "    throw new Error('mock: pkcs11js blocked by test loader');",
        '  }',
        '  return nextResolve(specifier, context);',
        '}',
      ].join('\n'),
    );

    // السكربتُ الابنُ: يُسجّلُ المحمّلَ ثم يحاول create().
    const scriptPath = join(workDir, 'attempt-create.mjs');
    writeFileSync(
      scriptPath,
      [
        "import { register } from 'node:module';",
        `register(new URL('./block-loader.mjs', import.meta.url), import.meta.url);`,
        `const { Pkcs11HsmProvider, HsmError } = await import('${PROVIDER_URL}');`,
        'try {',
        '  await Pkcs11HsmProvider.create({',
        "    modulePath: '/dummy/libsofthsm2.so',",
        "    tokenLabel: 'test',",
        "    pin: '1234',",
        '  });',
        '  process.stdout.write(JSON.stringify({ ok: true }));',
        '} catch (e) {',
        '  process.stdout.write(JSON.stringify({ ok: false, name: e.name, code: e.code, msg: e.message }));',
        '}',
      ].join('\n'),
    );

    const out = execFileSync('node', [scriptPath], {
      encoding: 'utf8',
      env: { ...process.env, XUUX_HSM_TEST: '' },
    });
    const result = JSON.parse(out);
    assert.equal(result.ok, false, 'create() must fail when pkcs11js is absent');
    assert.equal(result.name, 'HsmError', 'error must be HsmError');
    assert.equal(result.code, 'MODULE_MISSING', 'error code must be MODULE_MISSING');
  });

  test('pkcs11js بلا تصدير PKCS11 → HsmError MODULE_MISSING', () => {
    // محمّلُ ESM يُوفّرُ وحدةً وهميّةً بلا PKCS11.
    const loaderPath = join(workDir, 'empty-loader.mjs');
    writeFileSync(
      loaderPath,
      [
        'export async function resolve(specifier, context, nextResolve) {',
        "  if (specifier === 'pkcs11js') {",
        '    return {',
        '      url: new URL("./mock-pkcs11-empty.mjs", import.meta.url).href,',
        '      shortCircuit: true,',
        '    };',
        '  }',
        '  return nextResolve(specifier, context);',
        '}',
      ].join('\n'),
    );
    // الوحدةُ الوهميّةُ تُصدِّرُ كائناً فارغاً.
    const mockPath = join(workDir, 'mock-pkcs11-empty.mjs');
    writeFileSync(mockPath, 'export default {};\n');

    const scriptPath = join(workDir, 'attempt-create-empty.mjs');
    writeFileSync(
      scriptPath,
      [
        "import { register } from 'node:module';",
        `register(new URL('./empty-loader.mjs', import.meta.url), import.meta.url);`,
        `const { Pkcs11HsmProvider, HsmError } = await import('${PROVIDER_URL}');`,
        'try {',
        '  await Pkcs11HsmProvider.create({',
        "    modulePath: '/dummy/libsofthsm2.so',",
        "    tokenLabel: 'test',",
        "    pin: '1234',",
        '  });',
        '  process.stdout.write(JSON.stringify({ ok: true }));',
        '} catch (e) {',
        '  process.stdout.write(JSON.stringify({ ok: false, name: e.name, code: e.code, msg: e.message }));',
        '}',
      ].join('\n'),
    );

    const out = execFileSync('node', [scriptPath], {
      encoding: 'utf8',
      env: { ...process.env, XUUX_HSM_TEST: '' },
    });
    const result = JSON.parse(out);
    assert.equal(result.ok, false, 'create() must fail when PKCS11 export is absent');
    assert.equal(result.name, 'HsmError', 'error must be HsmError');
    assert.equal(result.code, 'MODULE_MISSING', 'error code must be MODULE_MISSING');
  });

  test('fromEnv ترمي MODULE_MISSING عند غياب المتغيّرات (قياسٌ مُستقل)', async () => {
    const { Pkcs11HsmProvider, HsmError } =
      await import('../../src/root-of-trust/pkcs11-provider.mjs');
    await assert.rejects(
      () => Pkcs11HsmProvider.fromEnv({}),
      (e) => e instanceof HsmError && e.code === 'MODULE_MISSING',
    );
  });
});
