// اختبارُ إقلاعٍ تشغيليٍّ لبابِ التطويرِ — `WL-179` (إغلاقُ الدَينِ `LIVE-1`).
//
// **لِمَ وُجِدَ:** كان `scripts/serve-state.mjs` **يموتُ قبلَ الإنصاتِ** بـ
// `POP_REQUIRED`، ولم يكن في المستودعِ اختبارٌ واحدٌ **يُشغِّلُه فعلاً**؛ فمرَّ
// العَطَبُ بينَ ألفٍ وثمانِ مئةٍ من الاختباراتِ كلُّها خضراءُ. **فالوحداتُ لا
// تُثبِتُ إقلاعاً، والإقلاعُ يُقاسُ بتشغيلٍ لا بقراءةِ نصٍّ.**
//
// **وما يقيسه هذا الاختبارُ صراحةً:** أنّ العمليّةَ تُقلِعُ وتُنصِتُ (‏رمزُ استجابةٍ
// حقيقيٌّ لا فشلُ اتّصالٍ)، **وأنّ إثباتَ الحيازةِ لم يُسقَطْ لِتُقلِعَ**: نداءٌ بلا
// توقيعٍ يُرَدُّ، ونداءٌ موقَّعٌ يُقبَلُ بـ`200`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';

const SCRIPT = path.join(process.cwd(), 'scripts', 'serve-state.mjs');

/** @returns {Promise<number>} منفَذٌ حرٌّ يُطلبُ من النظامِ لا يُخمَّنُ رقمُه. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => (port === 0 ? reject(new Error('لا منفَذَ')) : resolve(port)));
    });
  });
}

/**
 * يُشغِّلُ النصَّ بفحصِه الذاتيِّ ويعيدُ رمزَ الخروجِ ومخرَجَه.
 * @param {number} port
 * @returns {Promise<{ code: number | null, out: string }>}
 */
function runSelfCheck(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [SCRIPT, '--port', String(port), '--host', '127.0.0.1', '--self-check'],
      { cwd: process.cwd(), env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    child.stdout.on('data', (chunk) => (out += String(chunk)));
    child.stderr.on('data', (chunk) => (out += String(chunk)));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`لم ينتهِ الفحصُ في مهلتِه؛ المخرَجُ:\n${out}`));
    }, 60_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

test('بابُ التطويرِ يُقلِعُ ويُنصِتُ، وإثباتُ الحيازةِ قائمٌ لا مُسقَطٌ', async () => {
  const port = await freePort();
  const { code, out } = await runSelfCheck(port);
  assert.equal(code, 0, `أخفقَ الفحصُ الذاتيُّ؛ المخرَجُ:\n${out}`);
  // إنصاتٌ مُثبَتٌ برمزِ استجابةٍ حقيقيٍّ على المشهدِ الساكنِ.
  assert.match(out, /مشهدٌ ساكنٌ: ‏200 على/u);
  // والحمايةُ قائمةٌ في الاتّجاهَينِ: بلا توقيعٍ يُرَدُّ، وبتوقيعٍ يُقبَلُ.
  assert.match(out, /نداءٌ بلا توقيعٍ: ‏\d{3} — مردودٌ كما يجبُ/u);
  assert.match(out, /نداءٌ بتوقيعٍ صحيحٍ: ‏200 — مقبولٌ/u);
  // ولا يُقالُ «مُعطَّلٌ» بعدَ اليومَ: الإعلانُ القديمُ نُقِضَ بقياسٍ.
  assert.doesNotMatch(out, /ولا إثباتَ حيازةٍ في هذا التركيبِ/u);
});
