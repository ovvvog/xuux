/**
 * src/production/entrypoint.mjs
 *
 * نقطةُ الدخولِ الإنتاجيّةُ الموثوقةُ — الربطُ بين جذرِ الثقةِ الإنتاجيِّ
 * وسلسلةِ الإنفاذِ والنواةِ.
 *
 * هذا الملفُّ هو **الموضعُ الواحدُ** الذي يربط:
 *   Production Root of Trust (HSM, sealed log, command ledger, halt switch, freshness)
 *        ↓
 *   Enforcement Chain (identity, policy, quarantine)
 *        ↓
 *   Execution Kernel (crown gateway, enforcement point, audit)
 *
 * قبلَ هذا الملفِّ كان `createProductionRootOfTrust` يُستدعى من الاختباراتِ
 * وحدَها، وكان `composeEnforcementChain` يُستدعى من `scripts/serve-state.mjs`
 * بلا جذرِ ثقةٍ. فكان مسارُ الإنتاجِ قادراً على تجاوزِ جذرِ الثقةِ بالكاملِ.
 *
 * **الحدُّ المُعلَنُ:** هذا الملفُّ **لا يُكملُ Royal Cryptographic Auth**.
 * يُحدِّدُ موضعَ الدمجِ ويُوثِّقُه (`royalCommandVerifier` موصولٌ من التوكنِ
 * داخلَ `production-runtime`، لكنّ التوقيعَ الكاملَ للسلوكِ الملكيِّ خطوةٌ لاحقةٌ).
 * وكذلك Safe-mode Authorization وDurability وLegal Hold — لاحقةٌ لا تُدَّعى هنا.
 *
 * **Invariant:**
 *   No production-sensitive operation can execute unless it has passed
 *   through the authoritative Production Root of Trust, with mandatory
 *   freshness enforcement and the required trusted security dependencies.
 */

import { isProductionRuntime } from '../root-of-trust/production-boot.mjs';
import { createProductionRootOfTrust } from '../root-of-trust/production-runtime.mjs';
import { CrownGateway } from '../root-of-trust/crown.mjs';
import { ExecutionKernel } from '../core/execution-kernel.mjs';
import { composeEnforcementChain } from '../core/composition-root.mjs';
import { loadPolicyBundle } from '../policy/loader.mjs';
import { createRoyalAuthorization } from '../root-of-trust/royal-authorization.mjs';
import { sealedAudit } from '../root-of-trust/sealed-audit.mjs';
import { kingIdentityFromPublicKey, CertificateAuthority } from '../root-of-trust/identity.mjs';
import { SovereignClock } from '../root-of-trust/clock.mjs';
import { AttestedClock } from '../time/attested-clock.mjs';
import { loadTimePolicy } from '../time/policy.mjs';

/**
 * أخطاءُ نقطةِ الدخولِ الإنتاجيّةِ — كلُّ رمزٍ مُختومٌ في العقدِ.
 */
export const PRODUCTION_ENTRYPOINT_ERRORS = Object.freeze([
  'PRODUCTION_ENTRYPOINT_NOT_PRODUCTION_ENV',
  'PRODUCTION_ENTRYPOINT_FRESHNESS_SOCKET_NULL',
  'PRODUCTION_ENTRYPOINT_ATTESTED_TIME_REQUIRED',
]);

/**
 * التركيبُ الإنتاجيُّ الكاملُ — كلُّ ما تحتاجُه نقطةُ الدخولِ من مكوّناتٍ.
 * @typedef {object} ProductionSystem
 * @property {ReturnType<typeof createProductionRootOfTrust> extends Promise<infer T> ? T : never} rootOfTrust
 * @property {ReturnType<typeof composeEnforcementChain>} chain
 * @property {InstanceType<typeof CrownGateway>} crown
 * @property {InstanceType<typeof ExecutionKernel>} kernel
 * @property {import('../root-of-trust/persistent-log.mjs').PersistentEventLog} auditLog
 * @property {() => Promise<void>} close
 */

/**
 * خياراتُ نقطةِ الدخولِ الإنتاجيّةِ.
 * @typedef {object} ProductionEntrypointOptions
 * @property {string} root
 * @property {import('../root-of-trust/freshness-socket.mjs').FreshnessSocket | null} freshnessSocket
 * @property {((command: unknown) => boolean) | null} [royalCommandVerifier]
 *   اختبارٌ فقط — لا يُمرَّرُ في الإنتاج. `production-runtime` يَشتقُّه من HSM.
 * @property {{ now(): number, assertTrusted(): void, attestation(): { atMs: number, radiusMs: number, ageMs: number, sources: readonly string[], localSkewMs: number } | null } | null} [clock]
 *   اختبارٌ فقط — لا يُمرَّرُ في الإنتاج. الإنتاج يَبني `AttestedClock` من السياسة.
 */

/**
 * يبني النظامَ الإنتاجيَّ الكاملَ: من جذرِ الثقةِ إلى نواةِ التنفيذِ.
 *
 * @param {NodeJS.ProcessEnv} env - بيئةُ التشغيلِ (يُفحصُ أنّها إنتاجٌ)
 * @param {ProductionEntrypointOptions} options - جذرُ الحالةِ ومقبسُ الحداثةِ
 * @param {import('../root-of-trust/production-runtime.mjs').ProductionRuntimeDeps} [deps] - بدائلُ الحقنِ للاختبارِ
 * @returns {Promise<ProductionSystem>}
 * @throws {Error} إن لم تكن البيئةُ إنتاجاً، أو غابَ مقبسُ الحداثةِ، أو غابَ النصابُ الزمنيُّ
 */
export async function createProductionSystem(env, options, deps = {}) {
  // 1. البيئةُ إنتاجٌ — هذا الملفُّ لا يخدمُ التطويرَ.
  if (!isProductionRuntime(env)) {
    throw new Error('PRODUCTION_ENTRYPOINT_NOT_PRODUCTION_ENV');
  }
  // 2. مقبسُ الحداثةِ ليس null — ضمانٌ إضافيٌّ أنّ المكوّنَ الموصولَ فعليٌّ.
  //    P0-C: لا يُقبَلُ `InMemoryFreshnessSocket` كإثباتِ حداثةٍ في الإنتاجِ —
  //    هو تركيبيٌّ للاختبارِ لا مصدرُ حداثةٍ إنتاجيٌّ.
  if (options.freshnessSocket === null || options.freshnessSocket === undefined) {
    throw new Error('PRODUCTION_ENTRYPOINT_FRESHNESS_SOCKET_NULL');
  }
  if (
    'testFixture' in options.freshnessSocket &&
    /** @type {any} */ (options.freshnessSocket).testFixture === true
  ) {
    throw new Error('PRODUCTION_ENTRYPOINT_FRESHNESS_SOCKET_TEST_FIXTURE');
  }

  // 3. جذرُ الثقةِ الإنتاجيُّ — يفرضُ HSM والبيانَ المختومَ والحداثةَ.
  //    `royalCommandVerifier` يُشتَقُّ داخلَ `production-runtime` من مفتاحِ HSM
  //    العامِّ ويُوصَلُ إلى `HaltSwitch` عندَ إنشائِه — لا من callback اختياري.
  //    إن وُجدَ `options.royalCommandVerifier` (اختبارٌ) يُمرَّرُ بدلاً منه.
  const rootOfTrust = await createProductionRootOfTrust(
    env,
    {
      root: options.root,
      fsync: true,
      freshnessSocket: options.freshnessSocket,
      royalCommandVerifier: options.royalCommandVerifier ?? null,
    },
    deps,
  );

  // 4. هويةُ الملكِ من HSM — المفتاحُ العامُّ وحدَه، بلا مفتاحٍ خاصٍّ في الذاكرةِ.
  const kingIdentity = kingIdentityFromPublicKey(rootOfTrust.anchorSigner.publicKeyPem);
  // `LIVE-24` (‏`WL-303`): هويّةُ العُقدةِ (‏مفتاحُ المرساةِ `06`) تُصدِرُ شهاداتِ الوكلاءِ،
  // و**الهويّةُ الملكيّةُ** (‏مفتاحٌ عامٌّ مُثبَّتٌ لا خاصَّ له على العُقدة) وحدَها تُجيزُ
  // الأوامرَ السياديّةَ عندَ التاجِ وحدِّ التفويض. فلا يُقبَلُ توقيعُ العُقدةِ أمراً.
  const royalIdentity = kingIdentityFromPublicKey(rootOfTrust.royalPublicKeyPem);

  // 5. سلطةُ التصديقِ من جذرِ الثقةِ — مخزنُ سحبٍ دائمٌ لا ذاكرةٌ.
  const authority = new CertificateAuthority(kingIdentity, {
    revocationStore: rootOfTrust.revocationStore,
    env,
    // `WL-303`: الإصدارُ عبرَ التوكنِ — لا مفتاحَ خاصَّ في الذاكرة.
    signer: rootOfTrust.anchorSigner,
  });

  // 7. الساعةُ الموثوقةُ — في الإنتاجِ يلزمُها `CrownGateway`.
  //    P0-C: `options.clock` مسارُ اختبارٍ فقط — مُشغِّلُ الإنتاجِ لا يُمرِّرُهُ.
  //    إن لم يُحقَنْ، يُنشأُ `AttestedClock` من سياسةِ الوقتِ ويُطلَبُ النصابُ.
  //    `AttestedClock` يَفشلُ مغلقاً إن لم يَتحقَّقْ نصابُ المصادرَ — لا يَسقُطُ إلى `Date.now()`.
  //    إن لم تُتوفَّرْ سياسةُ وقتٍ، يَسقُطُ إلى `SovereignClock` (الذي يَفشلُ
  //    بـ`ATTESTED_TIME_REQUIRED` لأنّه بلا `attestation()`).
  let clock = options.clock ?? null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let attestationRenewalTimer = null;

  if (clock === null) {
    try {
      const timePolicy = loadTimePolicy({ dir: 'config' });
      const attestedClock = new AttestedClock({ policy: timePolicy });
      // P0-B: اطلب النصابَ قبلَ إعلانِ الجاهزيةِ — لا تَعُدْ ناجحاً بلا بُرهانِ وقتٍ.
      await attestedClock.attest();
      // تحقق من أنّ البرهانَ فعليٌّ — attest() قد يَرجعُ بلا خطأٍ لكنّ attestation() null
      if (attestedClock.attestation() === null) {
        throw new Error('PRODUCTION_ENTRYPOINT_ATTESTED_TIME_REQUIRED');
      }
      clock = attestedClock;
      // آليةُ تجديدٍ قبلَ انتهاءِ البرهانِ: نِصفُ maxAgeMs.
      const renewalMs = Math.max(1000, Math.floor(timePolicy.maxAgeMs / 2));
      attestationRenewalTimer = setInterval(() => {
        attestedClock.attest().catch(() => {
          // فشلَ التجديدُ — attestation() سيُرجعُ null فتُرفَضُ الأوامرُ مغلقاً.
          // لا يُستبدَلُ بساعةِ الجهازِ.
        });
      }, renewalMs);
    } catch (err) {
      if (err instanceof Error && err.message === 'PRODUCTION_ENTRYPOINT_ATTESTED_TIME_REQUIRED') {
        throw err;
      }
      // لا توجد سياسةُ وقتٍ — الساعةُ غيرُ موثوقةٍ.
      clock = /** @type {never} */ (
        new SovereignClock({ statePath: options.root + '/clock-state.json' })
      );
    }
  }

  // 6. سلسلةُ الإنفاذِ — هويّةٌ وسياسةٌ وحَجرٌ ونقطةُ تفويضٍ، وحدُّ السلطةِ الملكيّة.
  //    `R6-A-07` (‏`WL-303`): كانت نقطةُ الإنفاذِ الإنتاجيّةُ بلا مُحقِّقٍ فتُرَدُّ كلُّ
  //    الأفعالِ السياديّةِ مغلقةً بلا مسارٍ مشروعٍ، وكانَ أيُّ مُحقِّقٍ يُحقَنُ
  //    (‏ولو `() => true`) يُقبَلُ. الآنَ الحدُّ الواحدُ: المفتاحُ الملكيُّ المُثبَّتُ
  //    (‏مصادقة) ← الربطُ والعتبةُ والحداثةُ بالساعةِ الموثوقةِ ومنعُ الإعادةِ
  //    بالدفترِ الدائمِ (‏تفويض) ← ثمّ السياسةُ قبلَه والتنفيذُ بعدَه.
  // سجلُّ السلسلةِ: الإلحاقُ مختومٌ مرتَّبٌ، والتذكرةُ تنتظرُ ختمَ قيدِها.
  const enforcementLog = sealedAudit(/** @type {never} */ (rootOfTrust.log));
  const royalAuthorization = createRoyalAuthorization({
    king: royalIdentity,
    clock: /** @type {{ now(): number }} */ (clock),
    commandLedger: rootOfTrust.ledger,
    sovereignActions: loadPolicyBundle().threshold.map((entry) => entry.action),
    log: enforcementLog,
  });
  const chain = composeEnforcementChain({
    log: /** @type {never} */ (enforcementLog),
    withLegislation: false,
    crown: null,
    haltSwitch: rootOfTrust.haltSwitch,
    kingIdentity,
    authority,
    royalCommandVerifier: /** @type {never} */ (royalAuthorization),
  });

  // 7ب. `WL-302`: حداثةُ الأمرِ الملكيِّ على مفتاحِ الإيقافِ تُقاسُ بالساعةِ
  //     الموثوقةِ نفسِها لا بساعةِ الجهاز — وبلاها يُرفَضُ كلُّ أمرٍ في الإنتاج.
  rootOfTrust.haltSwitch.useTrustedClock(/** @type {{ now(): number }} */ (clock));

  // 8. بوابةُ التاجِ — من جذرِ الثقةِ: السجلُّ المختومُ ودفترُ الأوامرِ ومفتاحُ الإيقافِ والساعةُ.
  //    `LIVE-25` (‏`WL-304`): التاجُ والنواةُ على **السجلِّ المختومِ نفسِه** عبرَ مُحوِّلِ
  //    السلسلةِ (‏`enforcementLog`): ترتيبٌ واحدٌ للقيود، والقبولُ يُختَمُ قبلَ أن يُرجَع،
  //    والمُعالِجُ لا يُنادى قبلَ الختم. لا سجلَّ غيرَ مختومٍ في الإنتاج.
  const crown = new CrownGateway(royalIdentity, authority, /** @type {never} */ (enforcementLog), {
    commandLedger: rootOfTrust.ledger,
    haltSwitch: rootOfTrust.haltSwitch,
    clock,
    env,
    requireCommandLedger: true,
    requireHaltSwitch: true,
  });

  // 9. نواةُ التنفيذِ — من بوابةِ التاجِ والسلسلةِ والسجلِّ المختومِ.
  const kernel = new ExecutionKernel({
    crown,
    log: /** @type {never} */ (enforcementLog),
    enforcement: chain.enforcementPoint,
    haltSwitch: rootOfTrust.haltSwitch,
    env,
  });

  return {
    rootOfTrust,
    chain,
    crown,
    kernel,
    auditLog: rootOfTrust.log,
    close: async () => {
      if (attestationRenewalTimer !== null) {
        clearInterval(attestationRenewalTimer);
      }
      rootOfTrust.log.close?.();
      await rootOfTrust.close();
    },
  };
}
