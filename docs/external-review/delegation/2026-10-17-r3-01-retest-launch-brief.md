# حزمةُ إطلاقِ جولةِ تحقُّقِ المجلسِ المستقلِّ — CO55-M11.05-R3-01 (إعادةُ اختبارِ إصلاحِ بوابةِ خروجِ Email)

**التاريخ:** 2026-10-17 (توقيتُ الرياضِ)
**الكوميتُ المُراجَعُ:** `ca134f8939eafb4d77e5eb537775e7b113ce0d26` — رأسُ `main` بعدَ دمجِ WL-407 (#372) وWL-408 (#373) وأثرِ خطِّ أساسِ التخطّي (#374)
**CI:** أخضر على الرأسِ المُثبَّتِ — تشغيلُ «CI» `39005598253` (push على main) `completed success`
**الأعضاءُ:** عضوانِ مستقلّانِ من مزوّدينِ مختلفينِ — الترشيحُ: `gpt_6_1_sol` (OPENAI) و`claude_opus_5_5` (ANTHROPIC) — مَن أطلقَ الجولةَ الخامسةَ وأصدرَ النتيجةَ (المادةُ 11: لا يجتمعُ الدورانِ في جهةٍ واحدةٍ، والمنفِّذُ ليسَ مراجعاً)

---

## التعليماتُ لكلِّ عضوٍ

أنتَ عضوٌ مستقلٌّ في مجلسِ نماذجَ. النتيجةُ `CO55-M11.05-R3-01` (شدةٌ حرجةٌ — بعينِ سجلِّ الديونِ) وُلدتْ في الجولةِ الخامسةِ (WL-383) على `main@e0ded6f5`: قناةُ Email كانت تُرسِلُ إلى الخارجِ بلا بوابةِ خروجٍ — مسلكُ `getSmtpConfig` معَ خادمِ SMTP محليٍّ كانَ يُخرِجُ EHLO/STARTTLS/AUTH/MAIL/RCPT/DATA بلا بوابةٍ. ونُفِّذَ الإصلاحُ في WL-402/WL-406 (PR #363/#369) وأُعيدَ فحصُهُ من المنفِّذِ — **والحكمُ في الإغلاقِ لكَ وحدَكَ لا لهُ**.

مهمتُكَ:

1. **اقرأْ** المستودعَ على الكوميتِ المُثبَّتِ أعلاهُ من `/home/user/workspace/xuux`.
2. **أعدْ إنتاجَ مسلكَ الهجومِ الأصليَّ:** ابنِ `EmailChannel` بـ`getSmtpConfig` يُشيرُ إلى خادمِ SMTP محليٍّ وهميٍّ يَعُدُّ اتصالاتِهِ **بلا `egressGate`** — واقرأْ: الحالةَ وسببَ الفشلِ وعددَ الاتصالاتِ.
3. **تحققْ من سطحِ الوحدةِ:** `sendSmtp` لم يعدْ مُصدَّراً خاماً — استيرادٌ مسمًّى لهُ يفشلُ عندَ الربطِ؛ والمُتاحُ للمُركِّبِ `createSmtpEgressTransport` الذي يُنتجُ نقلَ بوابةٍ (توقيعُهُ سجلُّ البوابةِ).
4. **تحققْ من الأثرِ السلوكيِّ:** بلا بوابةٍ ⇒ رفضٌ بـ`EGRESS_GATE_REQUIRED` **قبلَ أيِّ اتصالٍ أو بايتٍ** (عدّادُ الاتصالاتِ = 0 على خادمٍ حقيقيٍّ)؛ ورفضُ البوابةِ ⇒ `EGRESS_REFUSED` معَ رمزِ البوابةِ، مميَّزاً عن `EGRESS_TRANSPORT_FAILED`؛ والوجهةُ المعتمدةُ تُنقلُ عبرَ البوابةِ بحمولةٍ كاملةٍ.
5. **تحققْ من أنَّ مسارَ البوابةِ ليسَ التفافاً جديداً:** القناةَ لا تفتحُ اتصالاً خارجياً إلّا عبرَ النقلِ المارِّ بالبوابةِ، وأنَّ أيَّ بوابٍ (gating) لا يمكنُ تعطيلُهُ من تركيبِ القناةِ.
6. **شغّلْ الاختباراتِ:** `node --test tests/notifications/r5-b-04-email-egress.test.mjs` (8 اختباراتٍ) و`node --test tests/notifications/external-delivery.test.mjs` (اختبارانِ يُتخطّيانِ ببياناتِ اعتمادٍ حقيقيةٍ — عَلِّنْ تخطّيهُما في قسمِ الحدودِ لا أن تُخفيَهُ).
7. **احكمْ:** `closed` (الإصلاحُ يسدُّ المسارَ) أو `open` (المسارُ ما زالَ نافذاً). **مفرداتُ الحكمِ `closed` و`open` وحدَهما.**
8. **اكتبْ تقريراً خامّاً** في `docs/external-review/reports/M11.05-round-6-model-council-report-<معرّفك>.md` يحوي: مُعرِّفَكَ ومزوِّدَك، زمنَ التشغيلِ، الكوميتَ المُراجَعَ، بيئةَ التشغيلِ، تصريحَ استقلالٍ، سجلَّ أدلّةٍ بالأوامرِ ورموزِ الخروجِ، جدولَ الأحكامِ، نتائجَ جديدةً (إن وُجِدَت)، قسمَ حدودٍ.

### ما لا تفعلهُ

- **لا تُؤلِّفُ نتائجَ غيركَ ولا تقرأُ تقريرَهُ.**
- **لا تُعدِّلُ `config/external-review.yaml`** ولا تُغيِّرُ حالةَ النتيجةِ — الحكمُ يُنقَلُ إلى العقدِ بعدَ الجولةِ.
- **لا ترفعُ نسبةً ولا تُغلِقُ خطوةً ولا تُثبِّتُ `verified`/`approved`/`secure`/`ready`.**

### البيئةُ

- Node على `.nvmrc`، و`npm ci` و`npm run build` منفَّذانِ مسبقاً.
- الاختباراتُ بـ`env -u DATABASE_URL` — ما احتاجَ قاعدةً يُعلَنُ تخطّيهُ حدّاً.
- لا SoftHSM ولا TPM ولا Docker — وكلُّ حكمٍ يقومُ على مسارٍ لم يُشغَّلْ يُعلَنُ في قسمِ الحدودِ.
- المستودعُ في `/home/user/workspace/xuux` على الكوميتِ المُثبَّتِ.

---

## ما جهَّزَهُ المنفِّذُ (دليلُ لا حكمٌ)

- **مسلكُ الهجومِ الأصليُّ أُعيدَ إنتاجُهُ على `main@a93a8732` ثمّ على الرأسِ المُثبَّتِ `ca134f89`** (و`git diff a93a8732 ca134f89 -- src/notifications/ tests/notifications/` فارغٌ): `state=failed` وسببُ الفشلِ `EGRESS_GATE_REQUIRED` وعددُ الاتصالاتِ بـ0 — **محجوزٌ قبلَ أيِّ بايتٍ** (المجسُّ في الملحقِ أدناهُ).
- **سطحُ الوحدةِ:** `sendSmtp` غيرُ مُصدَّرٍ — استيرادٌ مسمًّى يفشلُ عندَ الربطِ.
- **الاختباراتُ:** `r5-b-04-email-egress.test.mjs` ⇒ 8/8 ناجحةٌ (البوابةُ شرطٌ، النقلُ عبرَها، الرفضُ المميَّزُ، الحمولةُ الكاملةُ، الحالاتُ السلبيةُ)؛ و`external-delivery.test.mjs` ⇒ اختبارانِ مُتخطّيانِ بعلّةٍ موثَّقةٍ (بياناتُ اعتمادٍ حقيقيةٌ + قرارُ مالكٍ في حزمةِ السياساتِ).
- **حدودٌ معلَنةٌ:** هذا إثباتُ إنفاذٍ على محاكاةٍ وخادمٍ محليٍّ — صلاحيّةُ الإغلاقِ للمجلسِ، ولا يُدَّعى فحصٌ على SMTP إنتاجيٍّ حقيقيٍّ (يحتاجُ بياناتِ اعتمادٍ وسياسةَ مالكٍ).

## المعاييرُ المُتوقَّعةُ (للعضوِ — لا تُلزِمُهُ)

| الفحصُ | المُتوقَّعُ إن كانَ الإصلاحُ سادّاً |
| --- | --- |
| `EmailChannel` بلا `egressGate` | `state=failed` و`failureReason` يحملُ `EGRESS_GATE_REQUIRED` وعدّادُ اتصالاتِ الخادمِ = 0 |
| استيرادُ `sendSmtp` المسمًّى | فشلٌ عندَ الربطِ (غيرُ مُصدَّرٍ) |
| بوابةٌ ترفضُ | `EGRESS_REFUSED` معَ رمزِ البوابةِ |
| بوابةٌ تُذِنُ | `state=sent` والحمولةُ كاملةً عبرَ النقلِ |
| `r5-b-04-email-egress.test.mjs` | 8/8 ناجحةٌ |

## ملحقٌ: مجسُّ المنفِّذِ (يُشغَّلُ من جذرِ المستودعِ بعدَ `npm run build`)

المخرَجُ المقيسُ على `ca134f89`: `state: failed` · `failureReason: EGRESS_GATE_REQUIRED: …` · `connections to SMTP host: 0` · رمزُ الخروجِ 0. وصادراتُ الوحدةِ: `EmailChannel,createSmtpEgressTransport`.

```js
// مسلكُ الهجومِ الأصليُّ للنتيجةِ CO55-M11.05-R3-01 على main@a93a8732:
// بناءُ EmailChannel بـgetSmtpConfig (بلا egressGate) وإرسالٌ إلى خادمِ SMTP
// محليٍّ حقيقيٍّ. القديمُ: state=sent والبايتُ يغادرُ الحدَّ. المطلوبُ: رفضٌ
// بـEGRESS_GATE_REQUIRED وصفرُ اتصالاتٍ.
import net from 'node:net';
import { EmailChannel } from './src/notifications/channels/email.mjs';

const smtp = await new Promise((resolve) => {
  let count = 0;
  const server = net.createServer((socket) => { count += 1; socket.destroy(); });
  server.listen(0, '127.0.0.1', () => resolve({ server, connections: () => count }));
});
const address = smtp.server.address();
try {
  const channel = EmailChannel({
    getSmtpConfig: () => ({ host: '127.0.0.1', port: address.port, user: 'user', password: 'pass' }),
  });
  const result = await channel.send(
    { ownerId: 'owner:probe', channel: 'email', subject: 'اختبار', body: 'رسالة اختبار', sentAtMs: Date.now() },
    'test@example.com',
  );
  console.log('state:', result.state);
  console.log('failureReason:', result.failureReason);
  console.log('connections to SMTP host:', smtp.connections());
  const ok =
    result.state === 'failed' &&
    result.failureReason !== null &&
    result.failureReason.includes('EGRESS_GATE_REQUIRED') &&
    smtp.connections() === 0;
  console.log(ok ? 'PROBE: BLOCKED (no connection, no byte left the boundary)' : 'PROBE: BYPASS — the path is OPEN');
  process.exit(ok ? 0 : 1);
} finally {
  await new Promise((done) => smtp.server.close(() => done()));
}
```

**المجسُّ دليلُ المنفِّذِ لا حكمُ المجلسِ** — وللعضوِ أن يكتبَ مجسَّهُ بنفسِهِ.
