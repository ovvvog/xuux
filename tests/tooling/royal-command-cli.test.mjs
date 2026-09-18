// اختبارُ أداةِ جانبِ الملكِ: **الخَتمُ حيثُ المفتاحُ، والإرسالُ على السلكِ،
// والبابُ يتحقَّقُ ولا يوقِّعُ** — الشاهدُ الأخيرُ على معيارِ `D-1`.
//
// وما يُقاسُ هنا أربعةُ أشقٍّ، كلٌّ يفشلُ وحدَه إن انكسر:
//   ١. **أمرٌ مختومٌ يُقبَلُ على السلكِ:** الأداةُ تختِمُ ثم تُرسِلُ إلى بابٍ
//      حقيقيٍّ (`createStateServer` بمساراتٍ مُشتقّةٍ من `config/royal-console.yaml`)،
//      فيُقرأُ `200` و`executed` من ردِّ الشبكةِ لا من ادّعاءِ الأداةِ.
//   ٢. **وأمرٌ بلا جلسةٍ قويّةٍ يُرَدُّ من البابِ لا من الأداةِ:** الأداةُ لا
//      تفحصُ ما ليس لها، فالجلسةُ حكمُ الديوانِ (`G-CONSOLE-STRONG-AUTH`).
//   ٣. **ولا مسارَ يوقّعُ بغيرِ وحدةِ أمانٍ في الإنتاجِ:** `--key` في بيئةِ إنتاجٍ
//      يُرَدُّ برمزٍ مُسمَّىً، ولا موقِّعَ ضِمنيَّ يُختلَقُ عندَ غيابِ المفتاحِ.
//   ٤. **ولا مادّةَ خاصّةً في المخرَجِ:** ما يُطبَعُ يُقرأُ ويُتحقَّقُ أنّه خالٍ
//      من مفتاحٍ خاصٍّ ومن توقيعٍ كاملٍ — فأداةٌ تطبعُ ما وقّعت به أداةُ تسريبٍ.
//
// **حدٌّ معلَنٌ:** الموقِّعُ هنا موقِّعُ تطويرٍ من ملفٍّ لأنّ سبيلَ الإنتاجِ
// (`openProductionSigners`) يحتاجُ توكنَ PKCS#11، واختباراتُ `SoftHSM` تُتجاوَزُ في
// CI. ومسارُ الإنتاجِ مقيسٌ رفضاً لا قبولاً: يُثبَتُ أنّ الملفَّ يُرَدُّ فيه.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import { run } from '../../scripts/royal-command.mjs';
import { compileCommandRoutes, createStateServer } from '../../src/transport/index.mjs';
import { DEV_ENV, PRODUCTION_ENV, royalCourt } from '../helpers/royal-court.mjs';

/**
 * بابٌ حقيقيٌّ على منفذٍ عابرٍ، ديوانُهُ ديوانُ المحكمةِ المؤقّتةِ.
 * @param {Awaited<ReturnType<typeof royalCourt>>} room - المحكمةُ
 * @returns {Promise<{ origin: string, close: () => Promise<void> }>} الأصلُ وإغلاقُه
 */
async function door(room) {
  // **وبوابةُ القراءةِ لا تُقاسُ هنا فلا تُدَّعى:** الخادمُ يُرفَضُ مُغلَقاً بلا
  // بوابةٍ (`TRANSPORT_GATEWAY_REQUIRED`)، فتُعطى بوابةٌ بلا مساراتٍ **ونداؤها
  // يرفعُ خطأً** — فلو انزلقَ نداءُ قراءةٍ إلى هذا الاختبارِ سقطَ ولم يمرَّ صامتاً.
  const server = createStateServer({
    gateway: /** @type {never} */ ({
      call: () => {
        throw new Error('READ_PATH_NOT_MEASURED_IN_THIS_FILE');
      },
      routes: () => [],
    }),
    routes: [],
    commandRoutes: compileCommandRoutes(),
    console: /** @type {never} */ (room.console),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object', 'البابُ لم يُنصِتْ على منفذٍ معلومٍ.');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
}

/**
 * ملفُّ مفتاحٍ خاصٍّ مؤقّتٌ — يُمحى في نهايةِ كلِّ اختبارٍ.
 * @param {import('node:crypto').KeyObject} privateKey - المفتاحُ
 * @returns {{ file: string, cleanup: () => void }} المسارُ وإغلاقُه
 */
function keyFileFor(privateKey) {
  const directory = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'royal-command-cli-')));
  const file = path.join(directory, 'king.pem');
  fs.writeFileSync(
    file,
    /** @type {string} */ (privateKey.export({ type: 'pkcs8', format: 'pem' })),
    { mode: 0o600 },
  );
  return { file, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('أمرٌ مختومٌ من الأداةِ يُقبَلُ على السلكِ، ولا مادّةَ خاصّةً في مخرَجِها', async () => {
  const room = await royalCourt();
  const opened = await door(room);
  const key = keyFileFor(room.kingPair.privateKey);
  try {
    const verdict = await run(
      [
        '--url',
        opened.origin,
        '--command',
        'cmd:veto',
        '--reason',
        'فحصُ سلطةٍ',
        '--session',
        room.sovereignSession,
        '--key',
        key.file,
      ],
      DEV_ENV,
    );
    const printed = JSON.parse(verdict.text);
    assert.equal(printed.status, 200, 'أمرٌ مختومٌ لم يُقبَلْ على السلكِ.');
    assert.equal(printed.body.status, 'executed', 'ردُّ البابِ ليس تنفيذاً.');
    assert.equal(verdict.ok, true, 'حكمُ الأداةِ خالفَ ردَّ البابِ.');
    // والأثرُ يُقرأُ من العالمِ لا من الردِّ: حقُّ النقضِ مغلقٌ عندَ البوابةِ.
    assert.equal(room.crown.veto.enabled, false, 'الأمرُ نُفِّذَ في الردِّ ولا أثرَ له.');
    assert.equal(printed.signer, 'dev-loopback-signer', 'الموقِّعُ لم يُعلَنْ في المخرَجِ.');
    // **ولا تسريبَ:** لا مادّةَ خاصّةً ولا توقيعاً كاملاً في ما يُطبَعُ.
    assert.ok(!verdict.text.includes('PRIVATE KEY'), 'مخرَجُ الأداةِ حملَ مادّةَ مفتاحٍ خاصٍّ.');
    assert.ok(!('signature' in printed), 'مخرَجُ الأداةِ حملَ التوقيعَ كاملاً.');
  } finally {
    key.cleanup();
    await opened.close();
    room.cleanup();
  }
});

test('وأمرٌ بلا جلسةٍ قويّةٍ يُرَدُّ من البابِ ‏401 ولا أثرَ له', async () => {
  const room = await royalCourt();
  const opened = await door(room);
  const key = keyFileFor(room.kingPair.privateKey);
  try {
    const verdict = await run(
      ['--url', opened.origin, '--command', 'cmd:veto', '--key', key.file],
      DEV_ENV,
    );
    const printed = JSON.parse(verdict.text);
    assert.equal(printed.status, 401, 'أمرٌ بلا جلسةٍ قويّةٍ لم يُرَدَّ رفضَ مصادقةٍ.');
    assert.equal(
      printed.code,
      'CONSOLE_AUTHENTICATION_REQUIRED',
      'الرفضُ لم يُسمَّ باسمِ الجلسةِ.',
    );
    assert.equal(verdict.ok, false, 'الأداةُ عدَّت المردودَ مقبولاً.');
    assert.equal(room.crown.veto.enabled, true, 'أمرٌ مردودٌ أحدثَ أثراً.');
  } finally {
    key.cleanup();
    await opened.close();
    room.cleanup();
  }
});

test('ومعرّفُ أمرٍ غيرُ مُعلَنٍ في الوثيقةِ يُرَدُّ قبلَ أيِّ نداءٍ شبكيٍّ', async () => {
  await assert.rejects(
    () => run(['--url', 'http://127.0.0.1:1', '--command', 'cmd:مُختلَق'], DEV_ENV),
    /ROYAL_COMMAND_UNDECLARED:cmd:مُختلَق:cmd:halt,cmd:resume,cmd:veto,cmd:veto\.clear/u,
    'أمرٌ غيرُ مُعلَنٍ مرَّ، أو رُفض بلا أسماءِ المُعلَنِ.',
  );
});

test('ولا موقِّعَ ضِمنيَّ: بلا `--key` يُرَدُّ، و`--key` في الإنتاجِ يُرَدُّ', async () => {
  await assert.rejects(
    () => run(['--url', 'http://127.0.0.1:1', '--command', 'cmd:veto'], DEV_ENV),
    /ROYAL_COMMAND_SIGNER_REQUIRED/u,
    'غيابُ الموقِّعِ مرَّ بلا رفضٍ — وذاك خَتمٌ بلا مفتاحٍ مُعلَنٍ.',
  );
  await assert.rejects(
    () =>
      run(['--url', 'http://127.0.0.1:1', '--command', 'cmd:veto', '--key', '/dev/null'], {
        ...PRODUCTION_ENV,
      }),
    /ROYAL_COMMAND_KEY_FILE_IN_PRODUCTION/u,
    'ملفُّ مفتاحٍ مرَّ في بيئةِ إنتاجٍ.',
  );
});

test('ووسيطٌ بلا قيمةٍ أو غيرُ معروفٍ يُرَدُّ باسمِه لا يُخمَّنُ', async () => {
  await assert.rejects(
    () => run(['--url'], DEV_ENV),
    /ROYAL_COMMAND_ARG_WITHOUT_VALUE:--url/u,
    'وسيطٌ بلا قيمةٍ لم يُرَدَّ.',
  );
  await assert.rejects(
    () => run(['--أمرٌ', 'شيء'], DEV_ENV),
    /ROYAL_COMMAND_UNKNOWN_ARG/u,
    'وسيطٌ غيرُ معروفٍ مرَّ بلا رفضٍ.',
  );
});
