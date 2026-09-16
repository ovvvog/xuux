// اختبارُ سدادِ الشطرِ الأخيرِ من الدَينِ `D-1`: **الكتابةُ من الديوانِ بتوقيعٍ
// من وحدةِ أمانٍ، وباختبارٍ يُثبِتُ رفضَ غيرِ الموقَّعِ.**
//
// وما يُقاسُ هنا أربعةُ أشقٍّ لا شقٌّ واحد، وكلٌّ يفشلُ وحدَه إن انكسر:
//   ١. **الموقِّعُ في وحدةِ أمانٍ:** التوقيعُ يُطلَبُ من مَقبضِ توكنٍ يُحقِّقُ عقدَ
//      `HsmKeySource` حرفيّاً — يوقّعُ ولا يُخرِجُ المادّةَ الخاصّةَ — ويُفتَحُ عليه
//      `HsmSigner` وهو كودُ الإنتاجِ نفسُه لا مزيَّفٌ صُنعَ ليوافق.
//   ٢. **الأمرُ يُنفَّذُ ويُرى:** الأثرُ يُقرأُ من العالمِ (‏حقُّ النقضِ مغلقٌ عندَ
//      البوابةِ) والقيدُ يُقرأُ من **ملفِّ** السجلِّ الدائمِ على القرصِ نصّاً — لا
//      من لقطةٍ في الذاكرةِ، فلو كانَ السجلُّ ذاكريّاً لمرَّ الاختبارُ وسقطَ الوعد.
//   ٣. **غيرُ الموقَّعِ يُرَدُّ:** أمرٌ يبلُغُ الديوانَ بلا توقيعٍ يُرَدُّ
//      بـ`CONSOLE_SIGNATURE_INVALID` — وهذا هو الشاهدُ الحرفيُّ الذي يطلبُه
//      معيارُ `D-1`.
//   ٤. **لا مسارَ يُلتَفُّ به على الوحدةِ:** توقيعٌ يأتي من المُنادي يُرَدُّ،
//      وموقِّعٌ يُصدِّرُ مادّتَه يُرَدُّ، وموقِّعٌ لا يُعلِنُ نفسَه يُرَدُّ، وموقِّعٌ
//      غيرُ إنتاجيٍّ يُرَدُّ في الإنتاجِ، ووحدةٌ تُرجِعُ بايتاتٍ فاسدةً يُرَدُّ
//      **ولا يبلُغُ الديوانَ أصلاً**.
//
// **حدٌّ معلَنٌ أوّل:** التوكنُ هنا بديلٌ في العمليّةِ لا عتادٌ. وسببُه هو سببُ
// `tests/root-of-trust/hsm-binding.test.mjs` حرفيّاً: اختباراتُ `SoftHSM` تُتجاوَزُ
// كلُّها في CI، واختبارٌ يُتجاوَزُ لا يحمي شيئاً. والمادّةُ الخاصّةُ محصورةٌ في
// البديلِ نفسِه: `SovereignWriter` لا يراها ولا يستطيعُ بلوغَها، وهو يوقّعُ
// بـ`signAsync` وحدَها.
//
// **حدٌّ معلَنٌ ثانٍ:** لا طبقةَ نقلٍ في هذا الملفِّ ولا متصفِّح — الكتابةُ على
// السلكِ مقيسةٌ في `tests/transport/server.test.mjs` و`tests/tooling/serve-state-boot.test.mjs`.
// فما يُقاسُ هنا **مِقبضُ الكتابةِ وموقِّعُه**، لا العنوانُ الذي يبلُغُه.
//
// **حدٌّ معلَنٌ ثالث:** `gateway` هنا `null` قصداً: مشهدُ القراءةِ ليس موضوعَ هذا
// الملفِّ وهو مقيسٌ في `tests/console/royal-console.test.mjs`. و`issue` لا تمسُّ
// البوابةَ، فتمريرُ بوابةٍ لا تُقرأُ كانَ سيوهِمُ بقياسٍ لا يقع.

import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as softwareSign } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

import {
  CONSOLE_ERRORS,
  SovereignWriteError,
  SovereignWriter,
  WRITER_ERRORS,
  moduleSignerFromHsm,
} from '../../src/console/index.mjs';
import { HsmSigner, createRoyalCommand } from '../../src/root-of-trust/index.mjs';
import {
  CONSOLE_POLICY,
  DEV_ENV,
  PRODUCTION_ENV,
  onDisk,
  royalCourt,
  signingToken,
} from '../helpers/royal-court.mjs';

/**
 * @param {unknown} error
 * @returns {string}
 */
function codeOf(error) {
  return error !== null && typeof error === 'object' && 'code' in error
    ? String(/** @type {{ code: unknown }} */ (error).code)
    : `بلا رمز: ${String(error)}`;
}

/**
 * @param {() => unknown | Promise<unknown>} work
 * @param {string} expected
 * @param {string} what
 */
async function refuses(work, expected, what) {
  try {
    await work();
    assert.fail(`${what}: مرّ ولم يُرفض — والمرورُ هنا هو العيبُ نفسُه.`);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.equal(codeOf(error), expected, `${what}: رُفض برمزٍ آخر`);
  }
}

test('أمرٌ موقَّعٌ في وحدةِ الأمانِ يُنفَّذُ، وأثرُه وقيدُه يُقرآنِ من العالمِ ومن قرصِ السجلّ', async () => {
  const room = await royalCourt();
  try {
    const result = await room.writer.issue({
      command: 'cmd:veto',
      royalCommand: /** @type {Record<string, unknown>} */ (
        /** @type {unknown} */ (createRoyalCommand('veto-commands', 'crown:gateway', {}))
      ),
      sovereignSession: room.sovereignSession,
    });
    assert.equal(result['status'], 'executed', 'الأمرُ لم يُعلَنْ منفَّذاً.');
    // الأثرُ في العالمِ: البوابةُ صارت مغلقةً بحقِّ النقضِ.
    assert.equal(room.crown.veto.enabled, false, 'النقضُ لم يقعْ في البوابةِ فعلاً.');
    // والقيدُ على القرصِ: القبولُ يكتبه التاجُ والتنفيذُ يكتبه الديوانُ — حدثانِ
    // لا حدثٌ واحد، ولو كتبَ الديوانُ التنفيذَ بلا قبولِ التاجِ لكانَ أثرٌ بلا سلطة.
    const types = onDisk(room.logFile).map((entry) => entry.type);
    assert.ok(types.includes('crown.command.accepted'), 'لا قيدَ قبولٍ من التاجِ في ملفِّ السجلّ.');
    assert.ok(
      types.includes(CONSOLE_POLICY.audit.commandExecutedEvent),
      'لا قيدَ تنفيذٍ من الديوانِ في ملفِّ السجلّ.',
    );
    // وهويّةُ الموقِّعِ مشتقّةٌ من مفتاحِ التوكنِ لا مخترَعةً، وهي هويّةُ الملكِ نفسُها.
    assert.equal(room.hsmSigner.id, room.king.id, 'مفتاحُ الوحدةِ ليس مفتاحَ الملكِ.');
  } finally {
    room.cleanup();
  }
});

test('غيرُ الموقَّعِ يُرَدُّ: أمرٌ يبلُغُ الديوانَ بلا توقيعٍ يُرفَضُ برمزِه ولا يقعُ أثرُه', async () => {
  const room = await royalCourt();
  try {
    await refuses(
      () =>
        room.console.issue({
          command: 'cmd:veto',
          royalCommand: /** @type {Record<string, unknown>} */ (
            /** @type {unknown} */ (createRoyalCommand('veto-commands', 'crown:gateway', {}))
          ),
          signature: '',
          sovereignSession: room.sovereignSession,
        }),
      CONSOLE_ERRORS.SIGNATURE_INVALID,
      'أمرٌ بلا توقيعٍ',
    );
    assert.equal(room.crown.veto.enabled, true, 'النقضُ وقعَ بأمرٍ غيرِ موقَّعٍ!');
    const types = onDisk(room.logFile).map((entry) => entry.type);
    assert.ok(
      types.includes(CONSOLE_POLICY.audit.commandRefusedEvent),
      'الرفضُ لم يُقيَّدْ في السجلِّ الدائمِ؛ ورفضٌ لا يُرى لا يُدقَّق.',
    );
    assert.ok(
      !types.includes(CONSOLE_POLICY.audit.commandExecutedEvent),
      'قيدُ تنفيذٍ لأمرٍ غيرِ موقَّعٍ!',
    );
  } finally {
    room.cleanup();
  }
});

test('توقيعٌ يأتي من المُنادي يُرَدُّ: الكاتبُ ليس ممرّاً يُمرِّرُ توقيعَ غيرِه', async () => {
  const room = await royalCourt();
  try {
    const royal = createRoyalCommand('veto-commands', 'crown:gateway', {});
    await refuses(
      () =>
        room.writer.issue(
          /** @type {never} */ ({
            command: 'cmd:veto',
            royalCommand: royal,
            signature: room.king.sign(royal),
            sovereignSession: room.sovereignSession,
          }),
        ),
      WRITER_ERRORS.SIGNATURE_NOT_ACCEPTED,
      'توقيعٌ من المُنادي',
    );
    assert.equal(room.crown.veto.enabled, true, 'الأثرُ وقعَ بتوقيعٍ من المُنادي!');
  } finally {
    room.cleanup();
  }
});

test('موقِّعٌ يُعلِنُ أنّ مادّتَه تُصدَّرُ يُرَدُّ في كلِّ بيئةٍ، ومَن لا يُعلِنُ نفسَه يُرَدُّ', async () => {
  const room = await royalCourt();
  try {
    const pem = /** @type {string} */ (
      room.kingPair.publicKey.export({ type: 'spki', format: 'pem' })
    );
    await refuses(
      () =>
        new SovereignWriter({
          console: room.console,
          signer: {
            describe: () => ({ kind: 'local-encrypted', canExport: true, productionReady: false }),
            signAsync: async () => 'x',
            publicKeyPem: pem,
          },
          env: DEV_ENV,
        }),
      WRITER_ERRORS.SIGNER_EXPORTS_MATERIAL,
      'موقِّعٌ يُصدِّرُ مادّتَه (‏في التطويرِ أيضاً)',
    );
    await refuses(
      () =>
        new SovereignWriter({
          console: room.console,
          signer: /** @type {never} */ ({ signAsync: async () => 'x', publicKeyPem: pem }),
          env: DEV_ENV,
        }),
      WRITER_ERRORS.SIGNER_UNDECLARED,
      'موقِّعٌ بلا إعلانٍ',
    );
    await refuses(
      () => new SovereignWriter({ console: room.console, signer: null, env: DEV_ENV }),
      WRITER_ERRORS.SIGNER_REQUIRED,
      'كاتبٌ بلا موقِّعٍ',
    );
    await refuses(
      () =>
        new SovereignWriter({
          console: null,
          signer: moduleSignerFromHsm(room.hsmSigner),
          env: DEV_ENV,
        }),
      WRITER_ERRORS.CONSOLE_REQUIRED,
      'كاتبٌ بلا ديوانٍ',
    );
  } finally {
    room.cleanup();
  }
});

test('موقِّعٌ غيرُ إنتاجيٍّ يُقبَلُ في التطويرِ ويُرَدُّ في الإنتاجِ بحاكمِ مخازنِ المفاتيحِ نفسِه', async () => {
  const room = await royalCourt();
  try {
    const pem = /** @type {string} */ (
      room.kingPair.publicKey.export({ type: 'spki', format: 'pem' })
    );
    /** @type {{ describe: () => { kind: string, canExport: boolean, productionReady: boolean }, signAsync: (payload: object) => Promise<string>, publicKeyPem: string }} */
    const devSigner = {
      describe: () => ({
        kind: 'dev-loopback-signer',
        canExport: false,
        productionReady: false,
      }),
      signAsync: async (payload) =>
        softwareSign(
          null,
          Buffer.from(JSON.stringify(payload), 'utf8'),
          room.kingPair.privateKey,
        ).toString('base64url'),
      publicKeyPem: pem,
    };
    // في التطويرِ يُقبَلُ: البديلُ عن قبولِه أن يعملَ المطوِّرُ بلا كتابةٍ أصلاً،
    // وهو نفسُ حُكمِ `key-provider-local` في `M2.03`.
    const devWriter = new SovereignWriter({
      console: room.console,
      signer: devSigner,
      env: DEV_ENV,
    });
    const result = await devWriter.issue({
      command: 'cmd:veto',
      royalCommand: /** @type {Record<string, unknown>} */ (
        /** @type {unknown} */ (createRoyalCommand('veto-commands', 'crown:gateway', {}))
      ),
      sovereignSession: room.sovereignSession,
    });
    assert.equal(result['status'], 'executed', 'موقِّعُ التطويرِ لم يُنفِّذْ في التطوير.');
    assert.equal(
      devWriter.describe().productionReady,
      false,
      'أعلنَ نفسَه إنتاجيّاً وهو ليس كذلك.',
    );
    // وفي الإنتاجِ يُرَدُّ عندَ **التركيبِ** لا عندَ أوّلِ أمرٍ.
    await refuses(
      () => new SovereignWriter({ console: room.console, signer: devSigner, env: PRODUCTION_ENV }),
      WRITER_ERRORS.SIGNER_FORBIDDEN_IN_PRODUCTION,
      'موقِّعُ تطويرٍ في بيئةِ إنتاجٍ',
    );
  } finally {
    room.cleanup();
  }
});

test('وحدةٌ تُرجِعُ بايتاتٍ فاسدةً: يُرَدُّ ولا يبلُغُ الأمرُ الديوانَ أصلاً', async () => {
  const room = await royalCourt({ corrupt: true });
  try {
    await refuses(
      () =>
        room.writer.issue({
          command: 'cmd:veto',
          royalCommand: /** @type {Record<string, unknown>} */ (
            /** @type {unknown} */ (createRoyalCommand('veto-commands', 'crown:gateway', {}))
          ),
          sovereignSession: room.sovereignSession,
        }),
      WRITER_ERRORS.SIGNATURE_UNVERIFIED,
      'توقيعٌ فاسدٌ من الوحدةِ',
    );
    assert.equal(room.crown.veto.enabled, true, 'الأثرُ وقعَ بتوقيعٍ فاسدٍ!');
    const types = onDisk(room.logFile).map((entry) => entry.type);
    assert.ok(
      !types.includes(CONSOLE_POLICY.audit.commandRefusedEvent),
      'الأمرُ بلغَ الديوانَ ورُدَّ عندَه؛ والمقصودُ أنّه لا يُرسَلُ أصلاً — فالفرقُ بين «رُدَّ قبلَ الإرسالِ» و«رُدَّ بعدَه» فرقُ ما يُقاس.',
    );
  } finally {
    room.cleanup();
  }
});

test('مفتاحُ وحدةٍ لا يُطابِقُ مفتاحَ الملكِ يُرَدُّ عندَ التاجِ: الكاتبُ لا يمنحُ سلطةً بمفتاحٍ آخر', async () => {
  const room = await royalCourt();
  try {
    const stranger = generateKeyPairSync('ed25519');
    const strangerSigner = await HsmSigner.open(signingToken(stranger), 'kingSigning', {
      env: DEV_ENV,
    });
    const writer = new SovereignWriter({
      console: room.console,
      signer: moduleSignerFromHsm(strangerSigner),
      env: DEV_ENV,
    });
    await refuses(
      () =>
        writer.issue({
          command: 'cmd:veto',
          royalCommand: /** @type {Record<string, unknown>} */ (
            /** @type {unknown} */ (createRoyalCommand('veto-commands', 'crown:gateway', {}))
          ),
          sovereignSession: room.sovereignSession,
        }),
      // والرمزُ `SIGNATURE_INVALID` لا `COMMAND_REJECTED`: بوابةُ التاجِ تُميّزُ
      // «توقيعٌ لا يُطابِقُ مفتاحَ الملكِ» من «أمرٌ رُدَّ لسببٍ آخرَ»، والديوانُ
      // يَنقُلُ التمييزَ كما هو. فمن قرأَ الرمزَ عرفَ أنّ المفتاحَ غريبٌ.
      CONSOLE_ERRORS.SIGNATURE_INVALID,
      'وحدةٌ بمفتاحٍ غريبٍ',
    );
    assert.equal(room.crown.veto.enabled, true, 'الأثرُ وقعَ بمفتاحٍ غريبٍ!');
  } finally {
    room.cleanup();
  }
});

test('الخَتمُ يُرجِعُ ظرفاً بصيغةِ السلكِ ولا يُحدِثُ أثراً: يَختِمُ ولا يُرسِلُ', async () => {
  const room = await royalCourt();
  try {
    const royal = /** @type {Record<string, unknown>} */ (
      /** @type {unknown} */ (createRoyalCommand('veto-commands', 'crown:gateway', {}))
    );
    const envelope = await room.writer.seal({
      command: 'cmd:veto',
      royalCommand: royal,
      sovereignSession: room.sovereignSession,
    });
    assert.equal(
      typeof envelope.signature,
      'string',
      'الظرفُ بلا توقيعٍ نصّيٍ، وطبقةُ النقلِ ترُدُّ ما ليس نصّاً.',
    );
    assert.notEqual(envelope.signature, '', 'توقيعٌ فارغٌ في الظرفِ.');
    assert.equal(envelope.sovereignSession, room.sovereignSession, 'الجلسةُ لم تُنقَلْ في الظرفِ.');
    // **والخَتمُ وحدَه لا يُحدِثُ أثراً:** لو أحدثَ لكانَ توقيعُ أمرٍ للمراجعةِ
    // تنفيذاً له — وذاكَ أخطرُ ما يكونُ في مِقبضٍ يُناديه مَن لم يُرِدِ الإرسالَ.
    assert.equal(room.crown.veto.enabled, true, 'الخَتمُ وحدَه أوقعَ الأثرَ!');
    assert.equal(
      fs.readFileSync(room.logFile, 'utf8').includes('console.command'),
      false,
      'الخَتمُ قَيَّدَ أمراً في الديوانِ ولمّا يُرسَل.',
    );
    // وما خُتِمَ يُقبَلُ عندَ الديوانِ حرفيّاً — وهو ما ستفعلُه طبقةُ النقلِ بالظرفِ نفسِه.
    const result = await room.console.issue(envelope);
    assert.equal(result['status'], 'executed', 'الظرفُ المختومُ رُدَّ عندَ الديوانِ.');
    assert.equal(room.crown.veto.enabled, false, 'قُبِلَ الأمرُ ولم يقعِ الأثرُ.');
  } finally {
    room.cleanup();
  }
});

test('مفتاحُ دفترِ الأوامرِ لا يُصدِرُ أمراً ملكيّاً: الدورُ يُقاسُ لا يُفترَض', async () => {
  const room = await royalCourt();
  try {
    const ledgerSigner = await HsmSigner.open(signingToken(room.kingPair), 'commandLedgerSigning', {
      env: DEV_ENV,
    });
    assert.throws(
      () => moduleSignerFromHsm(ledgerSigner),
      (error) =>
        error instanceof SovereignWriteError && error.code === WRITER_ERRORS.SIGNER_REQUIRED,
      'موقِّعُ الدفترِ مُرِّرَ كموقِّعِ ملكٍ ولم يُرَدَّ.',
    );
  } finally {
    room.cleanup();
  }
});

test('ووحدةٌ تعطَبُ أو تُرجِعُ فراغاً رفضٌ لا مسارٌ بديل، وأمرٌ بلا معرّفٍ يُرَدُّ', async () => {
  const room = await royalCourt();
  try {
    // **١. عَطَبُ الوحدةِ رفضٌ:** لو رجعَ الكاتبُ عندَ فشلِ التوكنِ إلى خَتمٍ
    // برمجيٍّ لكانَ وعدُ «التوقيعُ في وحدةِ أمانٍ» نصّاً بلا أثرٍ. فيُقاسُ أنّ
    // الفشلَ يُرفَعُ باسمِه ولا يبلُغُ الديوانَ أمرٌ.
    const before = onDisk(room.logFile).length;
    const broken = new SovereignWriter({
      console: room.console,
      signer: {
        signAsync: async () => {
          throw new Error('HSM_SESSION_LOST');
        },
        describe: () => ({ kind: 'pkcs11-hsm', canExport: false, productionReady: true }),
        publicKeyPem: /** @type {string} */ (
          room.kingPair.publicKey.export({ type: 'spki', format: 'pem' })
        ),
      },
      env: DEV_ENV,
    });
    await refuses(
      () =>
        broken.seal({
          command: 'cmd:veto',
          royalCommand: /** @type {Record<string, unknown>} */ (
            /** @type {unknown} */ (createRoyalCommand('veto-commands', 'crown:gateway', {}))
          ),
          sovereignSession: room.sovereignSession,
        }),
      WRITER_ERRORS.SIGNATURE_UNAVAILABLE,
      'وحدةٌ عاطبةٌ',
    );
    // **٢. ووحدةٌ تُرجِعُ فراغاً كذلك:** توقيعٌ فارغٌ يمرُّ لو قِيسَ الوجودُ لا
    // القيمةُ — وهو عينُ درسِ «فحصُ وجودٍ لا فحصُ صحّةٍ».
    const empty = new SovereignWriter({
      console: room.console,
      signer: {
        signAsync: async () => '',
        describe: () => ({ kind: 'pkcs11-hsm', canExport: false, productionReady: true }),
        publicKeyPem: /** @type {string} */ (
          room.kingPair.publicKey.export({ type: 'spki', format: 'pem' })
        ),
      },
      env: DEV_ENV,
    });
    await refuses(
      () =>
        empty.seal({
          command: 'cmd:veto',
          royalCommand: /** @type {Record<string, unknown>} */ (
            /** @type {unknown} */ (createRoyalCommand('veto-commands', 'crown:gateway', {}))
          ),
          sovereignSession: room.sovereignSession,
        }),
      WRITER_ERRORS.SIGNATURE_UNAVAILABLE,
      'وحدةٌ تُرجِعُ فراغاً',
    );
    // **٣. ومعرّفُ الأمرِ ومادّتُه لازمانِ:** الأوامرُ مُعلَنةٌ في الوثيقةِ ولا
    // يخترعُ المُنادي واحداً، ولا يُوقَّعُ على ما ليس أمراً.
    await refuses(
      () =>
        room.writer.seal({
          command: '   ',
          royalCommand: /** @type {Record<string, unknown>} */ (
            /** @type {unknown} */ (createRoyalCommand('veto-commands', 'crown:gateway', {}))
          ),
        }),
      WRITER_ERRORS.COMMAND_REQUIRED,
      'أمرٌ بلا معرّفٍ',
    );
    await refuses(
      () =>
        room.writer.seal({
          command: 'cmd:veto',
          royalCommand: /** @type {never} */ (/** @type {unknown} */ ('لا كائنَ')),
        }),
      WRITER_ERRORS.COMMAND_REQUIRED,
      'أمرٌ مادّتُه نصٌّ لا كائنٌ',
    );
    // **٤. ولا أثرَ لكلِّ ذلك:** لا قيدَ جديدٌ في السجلِّ، فلا شيءَ بلغَ الديوانَ.
    assert.equal(
      onDisk(room.logFile).length,
      before,
      'رفضٌ عندَ الكاتبِ ترك قيداً في سجلِّ الديوانِ — أي أنّه بلغَه.',
    );
    assert.equal(room.crown.veto.enabled, true, 'رفضٌ عندَ الكاتبِ أحدثَ أثراً في العالمِ.');
  } finally {
    room.cleanup();
  }
});
