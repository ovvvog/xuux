// أداةُ إبرهانِ الوقتِ تُقاسُ بتشغيلِها لا بقراءتِها — `D-7` (‏`WL-192`).
//
// المقيسُ: `--self-check` يمرُّ على مِقبسِ UDP حقيقيٍّ ويُخرِجُ `0` مع إثباتِ
// رفضِ شاهدٍ كاذبٍ ومصدرٍ صامتٍ، و`--describe` يُخرِجُ السياسةَ المُعلَنةَ،
// و`--once` على سياسةٍ مُعطَّبةٍ يفشلُ برمزٍ لا برسالةٍ عامّةٍ، وطَورٌ مجهولٌ
// يُرفَضُ برمزِ استعمالٍ لا يُنفَّذُ على أنّه الطَّورُ الافتراضيُّ.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const dir = mkdtempSync(join(tmpdir(), 'xuux-time-cli-'));
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
