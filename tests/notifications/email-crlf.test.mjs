// LIVE-53/LIVE-54 (WL-429 — من ملاحظاتِ جولتَي WL-426/WL-427) — اختبارُ رجوعٍ
// لقيدِ CR/LF على مسارِ البريدِ.
//
// **LIVE-53 (قيدٌ واجبٌ على أيِّ نقلِ SMTP يُكتبُ في موقعِ التركيبِ):** حقنُ
// أوامرِ SMTP بـCRLF يقعُ **بعدَ** بوابةِ الخروجِ — البوابةُ تفحصُ الحمولةَ
// والوجهةَ، والنقلُ (كودُ المُركِّبِ) هو من يُركِّبُ أوامرَ البروتوكولِ من
// العنوانِ. فالعقدُ المفروضُ هنا: **القناةُ نفسُها ترفضُ وجهةً تحملُ CR أو LF
// رفضًا مغلقًا مسمّى قبلَ أيِّ نداءٍ للبوابةِ** — فلا يصلُ إلى أيِّ نقلٍ (في
// موقعِ التركيبِ أو غيرِهِ) عنوانٌ يحملُ سطرًا محقونًا. وأيُّ نقلٍ يُكتبُهُ
// المُركِّبُ لاحقًا يبقى مُلزَمًا بالقيدِ نفسِهِ (رفضٌ أو ترميزٌ مع تهريبِ
// النقطةِ) — القناةُ تُنفِّذُ الشقَّ الأقوى: الرفضُ من المنبعِ.
//
// **LIVE-54 (دقّةُ وصفٍ في المسارِ المطبوعِ):** `maskEmail` كانت تُخرِجُ
// عنوانًا مخفًى **يحملُ CRLF** معَ مستلِمٍ ملغومٍ — فالسطرُ المطبوعُ في
// السجلِّ ينقسمُ على أسطرِ المحقونِ. المعيارُ: المخرجُ المطبوعُ لا يحملُ
// أسطرًا محقونةً (تعقيمُ محارفِ التحكّمِ قبلَ الإخفاءِ).
//
// **الحدُّ معلَن:** هذا إثباتُ إنفاذٍ على سطحِ القناةِ — وصلاحيّةُ إغلاقِ
// الدينينِ للمجلسِ لا للمنفِّذِ (المادةُ 11).

import assert from 'node:assert/strict';
import test from 'node:test';

import { EmailChannel } from '../../src/notifications/channels/email.mjs';

/** @returns {{ ownerId: string, channel: string, subject: string, body: string, sentAtMs: number }} */
function makeMessage() {
  return {
    ownerId: 'owner:probe',
    channel: 'email',
    subject: 'اختبار',
    body: 'رسالة اختبار',
    sentAtMs: Date.now(),
  };
}

const SMTP_CONFIG = {
  host: 'smtp.internal.example',
  port: 587,
  user: 'user',
  password: 'pass',
};

/** مستلمٌ ملغومٌ بـCRLF — نمطُ جولتَي WL-426/WL-427 (أمرُ SMTP محقونٌ بعدَ البوابةِ). */
const POISONED = 'user@example.com\r\nBCC: victim@evil.example';

/**
 * بوابةُ عدٍّ — لا تُفتحُ اتصالًا وترفعُ نجاحًا كاذبًا لو استُدعِيَت: الاختبارُ
 * يقيسُ أنَّ الرفضَ يقعُ **قبلَ** أيِّ نداءٍ للبوابةِ فلا يصلُ العنوانُ الملغومُ
 * إلى أيِّ نقلٍ أصلاً.
 * @returns {{ gate: { send: (request: unknown) => Promise<{ bytes: number, destination: string, policyId: string, result: { messageId: string } }> }, calls: () => number }}
 */
function countingGate() {
  let calls = 0;
  const gate = {
    async send() {
      calls += 1;
      return {
        bytes: 1,
        destination: 'smtp.internal.example',
        policyId: 'pol:egress-approved-destinations',
        result: { messageId: 'must-not-happen' },
      };
    },
  };
  return { gate, calls: () => calls };
}

test('LIVE-53: وجهةٌ تحمل CRLF تُرفَضُ رفضًا مغلقًا مسمّى قبلَ أيِّ نداءٍ للبوابةِ', async () => {
  /** @type {Array<[string, string]>} */
  const cases = [
    ['CRLF كامل', POISONED],
    ['CR وحده', 'user@example.com\rBCC: victim@evil.example'],
    ['LF وحده', 'user@example.com\nBCC: victim@evil.example'],
  ];
  for (const [label, destination] of cases) {
    const { gate, calls } = countingGate();
    const channel = EmailChannel({
      getSmtpConfig: () => SMTP_CONFIG,
      egressGate: gate,
    });
    const result = await channel.send(makeMessage(), destination);
    assert.equal(result.state, 'failed', `${label}: الرفضُ مغلقٌ لا إرسال`);
    assert.ok(
      result.failureReason !== null &&
        result.failureReason.includes('SMTP_DESTINATION_CRLF_FORBIDDEN'),
      `${label}: رمزُ الرفضِ SMTP_DESTINATION_CRLF_FORBIDDEN لا «${result.failureReason}»`,
    );
    assert.equal(
      calls(),
      0,
      `${label}: لا نداءَ للبوابةِ — الرفضُ يقعُ قبلَها فلا يبلغُ النقلَ (في موقعِ التركيبِ أو غيرِهِ) عنوانٌ ملغومٌ`,
    );
  }
});

test('LIVE-53: الرفضُ حتميٌّ ولو لم تُضبَطِ القناةُ — لا يُقرأُ الإعدادُ بديلًا عن الحكمِ', async () => {
  const { gate, calls } = countingGate();
  const channel = EmailChannel({
    getSmtpConfig: () => null,
    egressGate: gate,
  });
  const result = await channel.send(makeMessage(), POISONED);
  assert.equal(result.state, 'failed');
  assert.ok(
    result.failureReason !== null &&
      result.failureReason.includes('SMTP_DESTINATION_CRLF_FORBIDDEN'),
    `الرفضُ برمزِهِ المسمّى لا «${result.failureReason}»`,
  );
  assert.equal(calls(), 0, 'لا نداءَ للبوابةِ');
});

test('LIVE-54: المخرجُ المخفّى لا يحملُ أسطرًا محقونةً — تعقيمُ محارفِ التحكّمِ قبلَ الإخفاءِ', async () => {
  const { gate, calls } = countingGate();
  const channel = EmailChannel({
    getSmtpConfig: () => SMTP_CONFIG,
    egressGate: gate,
  });
  const result = await channel.send(makeMessage(), POISONED);
  assert.equal(result.state, 'failed', 'الوجهةُ الملغومةُ مرفوضةٌ (LIVE-53)');
  assert.ok(result.maskedDestination.length > 0, 'المخرجُ المخفّى حاضرٌ');
  // فحصُ محارفِ التحكّمِ برموزِها لا بنمطٍ يحملُها حرفيًّا (قاعدةُ العدّ
  // `no-control-regex` ترفضُ النمطَ الحاملَ لمحارفِ التحكّمِ الخامِ).
  const controlChars = [...result.maskedDestination].filter((ch) => {
    const code = ch.codePointAt(0);
    return code !== undefined && (code < 0x20 || code === 0x7f);
  });
  assert.ok(
    controlChars.length === 0,
    `العنوانُ المطبوعُ لا يحملُ أسطرًا محقونةً ولا محارفَ تحكّمٍ — «${JSON.stringify(
      result.maskedDestination,
    )}»`,
  );
  // والتعقيمَ لا يُخفي أثرَ المحاولةِ: النصُّ المحقونُ يبقى مرئيًّا في سطرٍ واحدٍ
  // لا سطرينِ — فالتشخيصُ باقٍ والتزويرُ مفقودٌ.
  assert.ok(
    result.maskedDestination.includes('example.comBCC'),
    'المحتوى المحقونُ مرئيٌّ في سطرٍ واحدٍ (تشخيصٌ لا إخفاءٌ)',
  );
  assert.equal(calls(), 0, 'لا نداءَ للبوابةِ');
});

test('LIVE-54: التعقيمُ لا يغيّرُ سلوكَ الإخفاءِ على العناوينِ السليمةِ', async () => {
  const { gate } = countingGate();
  const channel = EmailChannel({
    getSmtpConfig: () => SMTP_CONFIG,
    egressGate: gate,
  });
  const result = await channel.send(makeMessage(), 'test@example.com');
  assert.equal(result.state, 'sent', `العنوانُ السليمُ يمرُّ كما كان: ${result.failureReason}`);
  assert.equal(result.maskedDestination, 't***t@example.com');
});
