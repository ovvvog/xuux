// اختبارُ حاجزِ الوقتِ المُبرهَنِ — إغلاقُ الدَّينِ `D-7` (‏`WL-192`).
//
// حاجزٌ يُقاسُ بنجاحِه وحدَه ليس دليلاً: النجاحُ قد يكونُ لأنّه لا يفحصُ شيئاً.
// فالمقيسُ هنا أنّه **يفشلُ حينَ يجبُ**: تُنسخُ الشجرةُ إلى مجلَّدٍ مؤقّتٍ، وتُزرَعُ
// في كلِّ مرّةٍ طفرةٌ واحدةٌ من نفسِ الطرقِ التي كانَ الوقتُ السياديُّ يعودُ بها
// إلى ساعةِ الجهازِ، ويُطلَبُ من الحاجزِ أن يرفضَ برقمِ قاعدتِه.
//
// وأخصُّها `T7`: إعادةُ العيبِ الأصليِّ — قياسُ طزاجةِ البُرهانِ بساعةِ الجهازِ.
// وهي طفرةٌ **تعبرُ كلَّ اختبارِ نوعٍ**: لا خطأَ ولا تحذيرَ، ويبقى بُرهانٌ عمرُه
// أسبوعٌ «طازَجاً» لمن يُرجِعُ ساعةَ جهازِه.
//
// WL-545 (‏G1): مُدمَجٌ من tests/tooling/time-attest-cli.test.mjs — أداةُ إبرهانِ الوقت (‏D-7)
// أداةُ إبرهانِ الوقتِ تُقاسُ بتشغيلِها لا بقراءتِها — `D-7` (‏`WL-192`).
//
// المقيسُ: `--self-check` يمرُّ على مِقبسِ UDP حقيقيٍّ ويُخرِجُ `0` مع إثباتِ
// رفضِ شاهدٍ كاذبٍ ومصدرٍ صامتٍ، و`--describe` يُخرِجُ السياسةَ المُعلَنةَ،
// و`--once` على سياسةٍ مُعطَّبةٍ يفشلُ برمزٍ لا برسالةٍ عامّةٍ، وطَورٌ مجهولٌ
// يُرفَضُ برمزِ استعمالٍ لا يُنفَّذُ على أنّه الطَّورُ الافتراضيُّ.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = join(ROOT, 'scripts', 'guard-time.mjs');

/**
 * ينسخُ ما يقرؤه الحاجزُ وحدَه: السياسةُ والشفرةُ والمتَّجهاتُ واختبارُها.
 * @returns {{ dir: string, cleanup: () => void }}
 */
function copyTree() {
  const dir = mkdtempSync(join(tmpdir(), 'xuux-time-guard-'));
  for (const entry of ['config', 'src', 'scripts']) {
    cpSync(join(ROOT, entry), join(dir, entry), { recursive: true });
  }
  cpSync(
    join(ROOT, 'tests', 'fixtures', 'roughtime'),
    join(dir, 'tests', 'fixtures', 'roughtime'),
    {
      recursive: true,
    },
  );
  cpSync(join(ROOT, 'tests', 'time'), join(dir, 'tests', 'time'), { recursive: true });
  // الحاجزُ **يُحمِّلُ** السياسةَ من الشجرةِ المنسوخةِ (قاعدةُ `T1`)، فيلزمُه ما
  // تلزمُه `policy.mjs` من حزمٍ؛ ووصلةٌ إلى `node_modules` أرخصُ من نسخةٍ.
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir');
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * @param {string} dir
 * @returns {{ status: number, output: string }}
 */
function runGuard(dir) {
  try {
    return {
      status: 0,
      output: execFileSync(process.execPath, [GUARD, '--root', dir], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    };
  } catch (error) {
    const failure = /** @type {{ status?: number, stdout?: string, stderr?: string }} */ (error);
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

/**
 * @param {string} dir
 * @param {string} relative
 * @param {(source: string) => string} rewrite
 */
function seed(dir, relative, rewrite) {
  const file = join(dir, relative);
  const source = readFileSync(file, 'utf8');
  const mutated = rewrite(source);
  assert.notEqual(mutated, source, `الطفرةُ لم تُزرع في ${relative}: نصُّ الاستبدالِ غيرُ موجودٍ.`);
  writeFileSync(file, mutated);
}

/**
 * @param {string} rule
 * @param {string} relative
 * @param {(source: string) => string} rewrite
 */
function expectRejection(rule, relative, rewrite) {
  const { dir, cleanup } = copyTree();
  try {
    seed(dir, relative, rewrite);
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, `الطفرةُ عبرت الحاجزَ: ${rule} في ${relative}\n${output}`);
    assert.match(output, new RegExp(`⛔ ${rule}:`), output);
  } finally {
    cleanup();
  }
}

test('الحاجزُ يمرُّ على شجرةِ المشروعِ كما هي', () => {
  const { status, output } = runGuard(ROOT);
  assert.equal(status, 0, output);
  assert.match(output, /حاجز الوقت/);
});

test('T1: سياسةٌ لا تتماسكُ تُسقِطُ الحاجزَ قبلَ بقيّةِ الفحوصِ', () => {
  expectRejection('T1', 'config/time.yaml', (source) => source.replace('quorum: 2', 'quorum: 9'));
});

test('T1: نِصابُ واحدٍ لا يُقبَلُ أصلاً — المخطَّطُ يحصرُه فيسقطُ التحميلُ', () => {
  // النِّصابُ الواحدُ يُرفَضُ **قبلَ** قاعدةِ `T2`: المخطَّطُ يحصرُ الحدَّ الأدنى،
  // فيسقطُ الحاجزُ عندَ التحميلِ. والمقيسُ أنّ الطريقَ مسدودٌ لا أيُّ قاعدةٍ
  // تسدُّه.
  expectRejection('T1', 'config/time.yaml', (source) => source.replace('quorum: 2', 'quorum: 1'));
});

test('T2: مصادرُ تشتركُ في مضيفٍ واحدٍ تُرفَضُ — نِصابٌ من خادمٍ واحدٍ اتّفاقٌ متوهَّمٌ', () => {
  expectRejection('T2', 'config/time.yaml', (source) =>
    // مضيفٌ واحدٌ ومنافذُ مختلفةٌ: عنوانٌ مكرَّرٌ ترفضُه السياسةُ عندَ التحميلِ،
    // فيُقاسُ اشتراكُ المضيفِ وحدَه.
    source
      .replace(
        'host: roughtime.int08h.com\n    port: 2002',
        'host: roughtime.cloudflare.com\n    port: 2004',
      )
      .replace(
        'host: roughtime.se\n    port: 2002',
        'host: roughtime.cloudflare.com\n    port: 2005',
      )
      .replace(
        'host: time.txryan.com\n    port: 2002',
        'host: roughtime.cloudflare.com\n    port: 2006',
      ),
  );
});

test('T2: إطفاءُ الإلزامِ في السياسةِ يُرفَضُ — وهو معيارُ الإغلاقِ نفسُه', () => {
  expectRejection('T2', 'config/time.yaml', (source) =>
    source.replace('requireAttestedTime: true', 'requireAttestedTime: false'),
  );
});

test('T3: مصدرٌ محليٌّ في السياسةِ يُرفَضُ — شهادةُ الجهازِ لنفسِه ليست بُرهاناً', () => {
  expectRejection('T3', 'config/time.yaml', (source) =>
    source.replace('roughtime.cloudflare.com', '127.0.0.1'),
  );
});

test('T3: مِفتاحُ شاهدٍ مثبَّتٌ بدلَ العابرِ يُرفَضُ', () => {
  expectRejection('T3', 'src/time/witness.mjs', (source) =>
    source.replace(/generateKeyPairSync/g, 'createKeyPairFromSeedSync'),
  );
});

test('T4: رمزُ رفضٍ مُعلَنٌ لا يُرفَعُ في أيِّ موضعٍ يُرفَضُ', () => {
  expectRejection('T4', 'src/time/errors.mjs', (source) =>
    source.replace(
      "  CONFIG_INVALID: 'TIME_CONFIG_INVALID',",
      "  CONFIG_INVALID: 'TIME_CONFIG_INVALID',\n  NEVER_RAISED: 'TIME_NEVER_RAISED',",
    ),
  );
});

test('T5: قراءةُ `process.env` في حزمةِ الوقتِ تُرفَضُ — حدٌّ يُطفَأُ بالبيئةِ لا يُراجَعُ', () => {
  expectRejection('T5', 'src/time/policy.mjs', (source) =>
    source.replace(
      'export function loadTimePolicy(',
      'const OVERRIDE = process.env.TIME_QUORUM;\n\nexport function loadTimePolicy(',
    ),
  );
});

test('T6: نزعُ فحصِ البُرهانِ من قراءةِ الوقتِ في البوابةِ يُرفَضُ', () => {
  expectRejection('T6', 'src/root-of-trust/crown.mts', (source) =>
    source.replace('    this.assertAttestedTime();\n', ''),
  );
});

test('T6: جعلُ الإلزامِ قابلاً للإطفاءِ في الإنتاجِ يُرفَضُ', () => {
  expectRejection('T6', 'src/root-of-trust/crown.mts', (source) =>
    source.replace("        ['requireAttestedTime', options.requireAttestedTime],\n", ''),
  );
});

test('T7: قياسُ الطزاجةِ بساعةِ الجهازِ يُرفَضُ — العيبُ الأصليُّ يُزرَعُ فيُكشَفُ', () => {
  expectRejection('T7', 'src/time/attested-clock.mjs', (source) =>
    source.replace(/this\.monotonic\(\)/g, 'BigInt(Date.now()) * 1000000n'),
  );
});

test('T7: قراءةُ ساعةِ الجهازِ في `now()` تُرفَضُ ولو بقيَ المقياسُ الرتيبُ في موضعٍ آخرَ', () => {
  const { dir, cleanup } = copyTree();
  try {
    const file = join(dir, 'src/time/attested-clock.mjs');
    const source = readFileSync(file, 'utf8');
    const nowBody = /\n {2}now\(\) \{\n([\s\S]*?)\n {2}\}/.exec(source);
    assert.ok(nowBody !== null, 'تعذَّرَ إيجادُ جسمِ `now()` لزرعِ الطفرةِ');
    const mutated = source.replace(
      String(nowBody[0]),
      '\n  now() {\n    this.assertTrusted();\n    return Date.now();\n  }',
    );
    assert.notEqual(mutated, source);
    writeFileSync(file, mutated);
    const { status, output } = runGuard(dir);
    assert.equal(status, 1, output);
    assert.match(output, /⛔ T7:/, output);
  } finally {
    cleanup();
  }
});

test('T8: متَّجهٌ خارجيٌّ مفقودٌ أو نسبةٌ بلا عنوانٍ تُرفَضُ', () => {
  const missing = copyTree();
  try {
    rmSync(join(missing.dir, 'tests/fixtures/roughtime/roughtime_response.vec'));
    assert.match(runGuard(missing.dir).output, /⛔ T8:/);
  } finally {
    missing.cleanup();
  }
  expectRejection('T8', 'tests/fixtures/roughtime/PROVENANCE.md', (source) =>
    source.replace(/https:\/\//g, 'hxxps://'),
  );
});

test('T8: اختبارٌ لا يقرأُ المتَّجهاتِ يُرفَضُ — متَّجهٌ محفوظٌ لا يُقرأُ ليس دليلاً', () => {
  expectRejection('T8', 'tests/time/roughtime.test.mjs', (source) =>
    source.replace(/roughtime_response\.vec/g, 'roughtime_absent.vec'),
  );
});

// ── WL-545 (‏G1): مُدمَجٌ من tests/tooling/time-attest-cli.test.mjs — أداةُ إبرهانِ الوقت (‏D-7) (‏كتلةٌ مستقلّةُ النطاق: أسماءٌ مشتركة) ──
{
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const CLI = join(ROOT, 'scripts', 'time-attest.mjs');

  /**
   * @param {string[]} args
   * @returns {{ status: number, output: string }}
   */
  function run(args) {
    try {
      return {
        status: 0,
        output: execFileSync(process.execPath, [CLI, ...args], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      };
    } catch (error) {
      const failure = /** @type {{ status?: number, stdout?: string, stderr?: string }} */ (error);
      return {
        status: failure.status ?? 1,
        output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
      };
    }
  }

  test('`--self-check` يُبرهِنُ وقتاً على سلكٍ حقيقيٍّ ويُثبتُ الرفضَينِ ويُخرِجُ صفراً', () => {
    const { status, output } = run(['--self-check', '--json']);
    assert.equal(status, 0, output);
    const report = JSON.parse(output);
    assert.equal(report.attested, true);
    assert.equal(report.wire, 'udp/127.0.0.1', 'الفحصُ على مِقبسٍ لا على نداءِ دالّةٍ');
    assert.equal(report.sources.length, 2);
    assert.equal(report.liarRejected, true);
    assert.equal(report.liarRejectionCode, 'TIME_SOURCES_DISAGREE');
    assert.equal(report.silentRejected, true);
    assert.equal(report.silentRejectionCode, 'TIME_QUORUM_NOT_MET');
    assert.ok(Math.abs(report.atMs - Date.now()) < 60000);
    assert.ok(report.radiusMs > 0);
  });

  test('`--describe` يُخرِجُ حدودَ السياسةِ ومصادرَها بلا سؤالِ أحدٍ', () => {
    const { status, output } = run(['--describe', '--json']);
    assert.equal(status, 0, output);
    const report = JSON.parse(output);
    assert.equal(report.requireAttestedTime, true);
    assert.ok(report.quorum >= 2);
    assert.ok(report.sources.length >= report.quorum);
    for (const source of report.sources) {
      assert.ok(!/localhost|127\.0\.0\.1/.test(String(source.endpoint)), 'لا مصدرَ محليٌّ مُعلَنٌ');
    }
    assert.ok(
      !output.includes('publicKey') || !/-----BEGIN/.test(output),
      'لا مادّةَ مفاتيحَ خاصّةٍ',
    );
  });

  test('`--root` يُوجِّهُ الأداةَ إلى شجرةٍ أخرى، وسياسةٌ مُعطَّبةٌ تُفشِلُها برمزٍ', () => {
    const dir = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-time-cli-')));
    try {
      cpSync(join(ROOT, 'config'), join(dir, 'config'), { recursive: true });
      const file = join(dir, 'config', 'time.yaml');
      writeFileSync(file, readFileSync(file, 'utf8').replace('quorum: 2', 'quorum: 9'));
      const { status, output } = run(['--describe', '--json', '--root', dir]);
      assert.equal(status, 1, output);
      assert.match(output, /TIME_CONFIG_INVALID/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('طَورٌ مجهولٌ يُرفَضُ برمزِ استعمالٍ ولا يُنفَّذُ على أنّه طَورٌ افتراضيٌّ', () => {
    const { status, output } = run(['--probably-fine']);
    assert.equal(status, 2, output);
    assert.match(output, /استعمالٌ/);
  });

  test('`--once` يسألُ المصادرَ المُعلَنةَ، وانقطاعُ الخروجِ على UDP يُعلَنُ لا يُكتَمُ', () => {
    // حدٌّ مُعلَنٌ: لا خروجَ على UDP في هذه البيئةِ، فالمقيسُ أنَّ الفشلَ **مُسمّى**
    // ورمزُ الخروجِ غيرُ صفرٍ — لا أنَّ الوقتَ يُبرهَنُ من الشبكةِ هنا. ولو صارَ
    // الخروجُ متاحاً فالنجاحُ مقبولٌ أيضاً، ويُفحَصُ شكلُ التقريرِ في الحالتَينِ.
    const { status, output } = run(['--once', '--json']);
    const report = JSON.parse(output);
    assert.equal(report.mode, 'once');
    if (report.attested === true) {
      assert.equal(status, 0, output);
      assert.ok(report.sources.length >= 2);
      assert.equal(typeof report.iso, 'string');
    } else {
      assert.equal(status, 1);
      assert.match(String(report.error), /^TIME_[A-Z_]+$/);
      assert.match(String(report.note), /UDP/);
    }
  });
}
