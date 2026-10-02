#!/usr/bin/env node
/**
 * scripts/production-entry.mjs
 *
 * المُشغِّلُ الإنتاجيُّ — نقطةُ الدخولِ الحقيقيّةُ لبيئةِ الإنتاجِ.
 *
 * هذا السكربتُ هو **المسارُ الإنتاجيُّ الموثوقُ** الذي يربط:
 *   1. `createProductionSystem()` — التي تُركِّبُ جذرَ الثقةِ الإنتاجيَّ
 *      (HSM، السجلَّ المختومَ، دفترَ الأوامرِ، مفتاحَ الإيقافِ، الحداثةَ).
 *   2. `ExecutionKernel` — التي تُنفِّذُ الأوامرَ عبرَ بوابةِ التاجِ وسلسلةِ الإنفاذِ.
 *
 * **حدودُ الحمايةِ المُعلَنة:**
 *
 * 1. **الساعةُ الموثوقةُ:** هذا المُشغِّلُ **لا يُولِّدُ ساعةً موثوقةً ولا بُرهاناً**.
 *    في الإنتاجِ الحقيقيِّ يلزمُ مصدرُ وقتٍ موقَّعٌ (HSM، NTS، أو مصدرٌ موثوقٌ آخر).
 *    إن لم يُتوفَّرْ، يَفشلُ المُشغِّلُ مغلقاً بـ`ATTESTED_TIME_REQUIRED` —
 *    ولا يَسقُطُ إلى `Date.now()` ولا يَختلِقُ بُرهاناً.
 *
 * 2. **الهويّةُ الملكيّةُ:** المفتاحُ الخاصُّ يبقى في HSM. لا يُصدَّرُ إلى الذاكرةِ.
 *    `kingIdentityFromPublicKey()` تُنشئُ هويّةً للتحقُّقِ فقط.
 *
 * 3. **مقبسُ الحداثةِ:** لا يُنشأُ `InMemoryFreshnessSocket` في الإنتاجِ — يلزمُ backend
 *    دائمٌ موثوقٌ. غيابُه يُفشِلُ المُشغِّلَ مغلقاً.
 *
 * 4. **إصدارُ الشهاداتِ:** `CertificateAuthority.issue()` يحتاجُ توقيعاً متزامناً
 *    (`king.sign()`)، وهو **مُعطَّلٌ** في الإنتاجِ لأنّ المسارَ الإنتاجيَّ للتوقيعِ
 *    يمرُّ عبر `HsmSigner.signAsync` (غير متزامن). هذا حدٌّ مُعلَنٌ: إصدارُ الشهاداتِ
 *    الإنتاجيِّ يتطلَّبُ مساراً غيرَ متزامنٍ للتوقيعِ، وهو **خارجُ نطاقِ هذا PR**.
 *
 * الاستعمال:
 *   NODE_ENV=production STATE_ENV=production \
 *   XUUX_PKCS11_MODULE=... XUUX_PKCS11_TOKEN=... XUUX_PKCS11_PIN=... \
 *   XUUX_STATE_ROOT=/var/lib/xuux \
 *   node scripts/production-entry.mjs
 */
import { resolve } from 'node:path';
import { createProductionSystem } from '../src/production/entrypoint.mjs';

async function main() {
  const env = process.env;

  if (env.NODE_ENV !== 'production' && env.STATE_ENV !== 'production') {
    console.error(
      'ERROR: production-entry.mjs requires NODE_ENV=production or STATE_ENV=production',
    );
    process.exit(1);
  }

  const root = env.XUUX_STATE_ROOT ?? resolve(process.cwd(), '.state');

  // مقبسُ الحداثةِ — في الإنتاجِ الحقيقيِّ يلزمُ backend دائمٌ موثوقٌ (لا ذاكرةٌ).
  // هذا المُشغِّلُ لا يَختلِقُ مقبسَ ذاكرةٍ ولا يقبلُ backend غيرَ مدعومٍ.
  // إن لم يُتوفَّرْ backend مدعومٌ، يَفشلُ مغلقاً برسالةٍ واضحةٍ قبلَ إنشاءِ النظامِ.
  /** @type {Set<string>} */
  const SUPPORTED_FRESHNESS_BACKENDS = new Set([]); // لا backend مدعومٌ في هذه البيئةِ
  const freshnessBackend = env.XUUX_FRESHNESS_BACKEND ?? '';
  if (!freshnessBackend) {
    console.error('ERROR: XUUX_FRESHNESS_BACKEND not set.');
    console.error(
      '  Production requires a durable freshness backend (not InMemoryFreshnessSocket).',
    );
    console.error(
      '  No backend is supported in this environment — production boot is refused closed.',
    );
    process.exit(1);
  }
  if (!SUPPORTED_FRESHNESS_BACKENDS.has(freshnessBackend)) {
    console.error(`ERROR: XUUX_FRESHNESS_BACKEND="${freshnessBackend}" is not supported.`);
    console.error('  Supported backends: (none in this environment)');
    console.error(
      '  Production requires a durable freshness backend with proven anti-rollback properties.',
    );
    process.exit(1);
  }

  // مقبسُ الحداثةِ من backend موثوق — يُحقَنُ من خارج العمليةِ.
  // لا يُنشأُ هنا: الإنشاءُ مسؤوليّةُ بيئةِ الإنتاجِ لا المُشغِّلِ.
  const freshnessSocket = null;

  // الساعةُ الموثوقةُ — في الإنتاجِ الحقيقيِّ تأتي من HSM أو مصدرٍ موقَّعٍ.
  // إن لم توجد، يَفشلُ النظامُ مغلقاً بـATTESTED_TIME_REQUIRED.
  // لا يُختلَقُ بُرهانُ وقتٍ ولا يُسقَطُ الضمانُ.
  const clock = null;

  try {
    const system = await createProductionSystem(env, {
      root,
      freshnessSocket,
      clock,
    });

    console.log('Production system initialized successfully.');
    console.log('  Root of Trust: active');
    console.log('  King identity:', system.crown.king?.id ?? 'N/A');
    console.log('  Audit log:', system.auditLog?.constructor?.name ?? 'N/A');

    // الانتظار حتى إشارة الإيقاف
    process.on('SIGTERM', async () => {
      console.log('SIGTERM received, shutting down...');
      await system.close();
      process.exit(0);
    });
    process.on('SIGINT', async () => {
      console.log('SIGINT received, shutting down...');
      await system.close();
      process.exit(0);
    });
  } catch (err) {
    const e = /** @type {{ message?: string, code?: string }} */ (err);
    console.error('ERROR: Production boot failed:', e.message ?? 'unknown');
    if (e.code) console.error('  Code:', e.code);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
