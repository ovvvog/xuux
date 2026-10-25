/**
 * WL-465 — اختبارُ سكربتِ CI محاكي TPM (scripts/tpm-sim-ci.sh): أثرُ TAP المتقادمُ لا
 * يُحتسَبُ دليلًا للتشغيلةِ الحاليةِ.
 *
 * **العلّةُ التي يغلقُها:** السكربتُ كانَ يُنشئُ مجلدَ الأثرِ بـ`mkdir -p` دونَ محوِ ملفِّ
 * `sim.tap` قديمٍ إن وُجد، ولا يكتبُ الملفَّ إلا عندَ سطرِ `tee` (بعدَ نجاحِ تجهيزِ المحاكي
 * كلِّه). فلو فشلَ السكربتُ قبلَ ذلك (فشلُ تثبيتِ swtpm أو بدئِه مثلًا) بقيَ الملفُّ
 * المتقادمُ في مكانِه، وخطوةُ رفعِ الأثرِ — التي تعملُ دائمًا (`if: always()`) وترفضُ
 * غيابَ الملفِّ (`if-no-files-found: error`) — سترفعُ أثرَ تشغيلةٍ سابقةٍ بوصفِهِ دليلَ هذهِ
 * التشغيلةِ. الإصلاحُ: `rm -f` في رأسِ السكربتِ قبلَ أيّ مسارِ فشلٍ؛ وهذا الاختبارُ يقيسُ
 * **السكربتَ الفعليَّ نفسَه** (لا نسخةً منه) بأدواتٍ مُزوَّدةٍ (stubs) في مسارٍ مؤقتٍ.
 *
 * **حدٌّ معلَن:** الأدواتُ مزيّفةٌ (swtpm وnode وtpm2_*) — هذا اختبارُ سلوكِ السكربتِ في
 * حراسةِ الأثرِ، لا اختبارَ محاكاةٍ حيّةٍ (ذاك في tests/sim/ فوقَ swtpm حقيقيّ، وتخطّي
 * المحاكي هناك يُسقِطُ الخطوةَ صراحةً).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

const repoRoot = process.cwd();
const script = join(repoRoot, 'scripts', 'tpm-sim-ci.sh');

/**
 * تشغيلُ السكربتِ الفعليِّ بأدواتٍ مزيّفةٍ في مسارٍ مؤقتٍ.
 * @param {Record<string, string>} env @returns {{ status: number, stdout: string, stderr: string }}
 */
function runScript(env) {
  try {
    const stdout = execFileSync('bash', [script], {
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, ...env },
      // WL-466: بلا هذا القيدِ يَرِثُ الابنُ stderr الوكيلَ فيتسربُ خرجُ السكربتِ (رسائلُ
      // `::error::` وأسطرُ `# SKIP` التي يطبعُها حارسُ التخطّي) إلى stderr عمليةِ الاختبارِ
      // نفسِها، فيظهرُ «سببُ تخطٍّ» وهميٌّ في تيارِ TAP الخارجيّ ويُصنّفُه قياسُ خطِّ
      // الأساسِ سببًا مجهولًا للقالبِ (S8/UNKNOWN_REASON) — قِيسَ فعلًا بعدَ دمجِ WL-465
      // حينَ أسقطَ حاجزُ النشرِ التشغيلةَ، فأُغلقَ التسربُ عندَ منبعِهِ لا عندَ قالبِ القياس.
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = /** @type {{ status?: number, stdout?: string, stderr?: string }} */ (
      /** @type {unknown} */ (error)
    );
    return {
      status: failure.status ?? 1,
      stdout: String(failure.stdout ?? ''),
      stderr: String(failure.stderr ?? ''),
    };
  }
}

/**
 * هيئةُ تشغيلةٍ واحدةٍ: عدّاءٌ مزيّفٌ (أدواتٌ في `bin/`) وملفُّ TAP متقادمٌ مزروعٌ مسبقًا
 * في `RUNNER_TEMP/xuux-sim-tap/sim.tap` — كما لو أنَّ عدّاءً مقيمًا أعادَ استخدامَ
 * `RUNNER_TEMP` بينَ وظيفتينِ.
 * @returns {{ tapFile: string, staleMarker: string, env: Record<string, string> }}
 */
function makeRun() {
  const root = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-tap-ci-')));
  const runnerTemp = join(root, 'runner-temp');
  const tapDir = join(runnerTemp, 'xuux-sim-tap');
  mkdirSync(tapDir, { recursive: true });
  const tapFile = join(tapDir, 'sim.tap');
  const staleMarker = 'STALE-RUN-TAP-FROM-A-PREVIOUS-JOB';
  writeFileSync(tapFile, `TAP version 13\n# ${staleMarker}\n`);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  /** @param {string} name @param {string} body */
  const stub = (name, body) => {
    const p = join(bin, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
  };
  // swtpm: ينجحُ في كلِّ شيءٍ إلا إن طُلبَ فشلُهُ (STUB_SWTPM_FAIL) في سطرِ --version.
  stub(
    'swtpm',
    'if [ "$1" = "--version" ]; then [ -z "$STUB_SWTPM_FAIL" ] || exit 1; echo "stub-swtpm 0.0"; exit 0; fi\nexit 0',
  );
  stub('tpm2_nvincrement', 'exit 0');
  stub('tpm2_getcap', 'exit 0');
  // node: يطبعُ TAP صغرى بدلَ تشغيلِ الحزمةِ — عاديًا ناجحًا، أو بتخطٍّ (STUB_NODE_SKIP)
  // لقياسِ حارسِ التخطّي في السكربتِ.
  stub(
    'node',
    'if [ -n "$STUB_NODE_SKIP" ]; then printf "TAP version 13\\n1..1\\nok 1 stub\\n# SKIP stub-skip\\n# tests 1\\n# pass 0\\n# fail 0\\n# skipped 1\\n# todo 0\\n"; exit 0; fi\nprintf "TAP version 13\\n1..1\\nok 1 stub-pass\\n# tests 1\\n# pass 1\\n# fail 0\\n# skipped 0\\n# todo 0\\n"',
  );
  const env = {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    RUNNER_TEMP: runnerTemp,
  };
  return { tapFile, staleMarker, env };
}

test('التشغيلةُ الناجحةُ: أثرُ TAP الجديدُ يحلُّ محلَّ المتقادمِ — القديمُ لا يُحتسَبُ دليلًا', () => {
  const { tapFile, staleMarker, env } = makeRun();
  const result = runScript(env);
  assert.equal(
    result.status,
    0,
    `script must exit 0\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  const content = readFileSync(tapFile, 'utf8');
  assert.match(content, /ok 1 stub-pass/, 'the tap file must carry the current run TAP');
  assert.ok(!content.includes(staleMarker), 'the stale marker must be gone from the evidence file');
});

test('الفشلُ المبكرُ قبلَ إنتاجِ TAP: لا ملفَّ أصلًا — المتقادمُ لا يُرفَعُ دليلًا لهذهِ التشغيلةِ', () => {
  const { tapFile, env } = makeRun();
  const result = runScript({ ...env, STUB_SWTPM_FAIL: '1' });
  assert.notEqual(result.status, 0, 'script must fail when swtpm --version fails');
  assert.ok(
    !existsSync(tapFile),
    'no tap file may remain — the always-run upload step must error loudly instead of carrying stale evidence',
  );
});

test('حارسُ التخطّي باقٍ: TAP فيها تخطٍّ لغيرِ مسارِ القناةِ يُسقِطُ الخطوةَ', () => {
  const { env } = makeRun();
  const result = runScript({ ...env, STUB_NODE_SKIP: '1' });
  assert.notEqual(result.status, 0, 'script must fail on a skip that is not the channel path');
  assert.match(
    `${result.stderr}${result.stdout}`,
    /::error::/,
    'the failure must be an explicit step error',
  );
});
