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
 * يُحدِّدُ موضعَ الدمجِ ويُوثِّقُه (`royalCommandVerifier` موصولٌ من التوكنِ،
 * لكنّ التوقيعَ الكاملَ للسلوكِ الملكيِّ خطوةٌ لاحقةٌ). وكذلك Safe-mode
 * Authorization وDurability وLegal Hold — لاحقةٌ لا تُدَّعى هنا.
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
import { kingIdentityFromPublicKey, CertificateAuthority } from '../root-of-trust/identity.mjs';
import { SovereignClock } from '../root-of-trust/clock.mjs';
import { AttestedClock } from '../time/attested-clock.mjs';
import { loadTimePolicy } from '../time/policy.mjs';
import { createHash, verify as cryptoVerify, createPublicKey } from 'node:crypto';

/**
 * أخطاءُ نقطةِ الدخولِ الإنتاجيّةِ — كلُّ رمزٍ مُختومٌ في العقدِ.
 */
export const PRODUCTION_ENTRYPOINT_ERRORS = Object.freeze([
  'PRODUCTION_ENTRYPOINT_NOT_PRODUCTION_ENV',
  'PRODUCTION_ENTRYPOINT_FRESHNESS_SOCKET_NULL',
  'PRODUCTION_ROYAL_COMMAND_VERIFIER_REQUIRED',
  'PRODUCTION_ROYAL_COMMAND_SIGNATURE_INVALID',
]);

/**
 * يَبني مُتحقِّقاً تشفيرياً للأوامرِ الملكيّةِ على halt/resume.
 *
 * يرفضُ كلَّ أمرٍ بلا توقيعٍ، ويتحققُ من التوقيعِ بالمفتاحِ العامِّ للملكِ.
 * يربطُ `operation` بجسمِ الأمرِ فلا يقبلُ توقيعَ halt لـ resume أو العكس.
 * لا يثقُ بوجودِ objectٍ أو اسمِ callbackٍ — التحققُ تشفيرياً فقط.
 *
 * @param {string} kingPublicKeyPem - المفتاحُ العامُّ للملكِ بترميز PEM
 * @returns {(command: unknown) => boolean} مُتحقِّقٌ تشفيريٌّ للأوامرِ الملكيّةِ
 */
export function createRoyalCommandVerifier(kingPublicKeyPem) {
  const publicKey = createPublicKey(kingPublicKeyPem);
  const kingId =
    'king:' +
    createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex')
      .slice(0, 24);

  return (command) => {
    if (typeof command !== 'object' || command === null) return false;
    const cmd = /** @type {Record<string, unknown>} */ (command);
    // التوقيعُ إلزاميٌّ — لا يُقبلُ أمرٌ بلا توقيعٍ
    if (typeof cmd.signature !== 'string' || cmd.signature === '') return false;
    // operation إلزاميٌّ ومُختومٌ في الجسمِ — لا يُفكُّ توقيعُ halt لـ resume
    if (
      typeof cmd.operation !== 'string' ||
      (cmd.operation !== 'halt' && cmd.operation !== 'resume')
    )
      return false;
    // signerId إلزاميٌّ — يجبُ أن يطابقَ الملكَ
    if (typeof cmd.signerId !== 'string' || cmd.signerId !== kingId) return false;
    // بناءُ الجسمِ الأساسيِّ للتحققِ — كلُّ الحقولِ ما عدا التوقيعِ
    const body = {
      operation: cmd.operation,
      signerId: cmd.signerId,
      reason: cmd.reason ?? '',
      at: cmd.at ?? '',
    };
    try {
      return cryptoVerify(
        null,
        Buffer.from(JSON.stringify(body)),
        publicKey,
        Buffer.from(cmd.signature, 'base64url'),
      );
    } catch {
      return false;
    }
  };
}

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
 * @property {{ now(): number, assertTrusted(): void, attestation(): { atMs: number, radiusMs: number, ageMs: number, sources: readonly string[], localSkewMs: number } | null } | null} [clock]
 */

/**
 * يبني النظامَ الإنتاجيَّ الكاملَ: من جذرِ الثقةِ إلى نواةِ التنفيذِ.
 *
 * @param {NodeJS.ProcessEnv} env - بيئةُ التشغيلِ (يُفحصُ أنّها إنتاجٌ)
 * @param {ProductionEntrypointOptions} options - جذرُ الحالةِ ومقبسُ الحداثةِ
 * @param {import('../root-of-trust/production-runtime.mjs').ProductionRuntimeDeps} [deps] - بدائلُ الحقنِ للاختبارِ
 * @returns {Promise<ProductionSystem>}
 * @throws {Error} إن لم تكن البيئةُ إنتاجاً، أو غابَ مقبسُ الحداثةِ
 */
export async function createProductionSystem(env, options, deps = {}) {
  // 1. البيئةُ إنتاجٌ — هذا الملفُّ لا يخدمُ التطويرَ.
  if (!isProductionRuntime(env)) {
    throw new Error('PRODUCTION_ENTRYPOINT_NOT_PRODUCTION_ENV');
  }
  // 2. مقبسُ الحداثةِ ليس null — ضمانٌ إضافيٌّ أنّ المكوّنَ الموصولَ فعليٌّ.
  if (options.freshnessSocket === null || options.freshnessSocket === undefined) {
    throw new Error('PRODUCTION_ENTRYPOINT_FRESHNESS_SOCKET_NULL');
  }

  // 3. جذرُ الثقةِ الإنتاجيُّ — يفرضُ HSM والبيانَ المختومَ والحداثةَ.
  //    لا يُمرَّرُ `royalCommandVerifier` إلى `production-runtime` هنا —
  //    يُشتَقُّ بعدَ فتحِ الجذرِ من مفتاحِ HSM العامِّ في الخطوةِ التاليةِ.
  const rootOfTrust = await createProductionRootOfTrust(
    env,
    {
      root: options.root,
      fsync: true,
      freshnessSocket: options.freshnessSocket,
      royalCommandVerifier: null,
    },
    deps,
  );

  // 4. مُتحقِّقُ الأمرِ الملكيِّ — تشفيريٌّ، مُشتَقٌّ من مفتاحِ HSM العامِّ.
  //    لا يُمرَّرُ `() => true` إطلاقاً — التحققُ تشفيريٌّ أو الفشلُ مغلقٌ.
  //    يُحقَنُ في `composeEnforcementChain` التي تُمرِّرُهُ إلى `HaltSwitch`.
  const royalCommandVerifier =
    options.royalCommandVerifier ??
    createRoyalCommandVerifier(rootOfTrust.anchorSigner.publicKeyPem);

  // 4. هويةُ الملكِ من HSM — المفتاحُ العامُّ وحدَه، بلا مفتاحٍ خاصٍّ في الذاكرةِ.
  //    `anchorSigner` هو موقّعُ F06 من التوكنِ، وعامُّه يُصدَّرُ للتحقُّقِ.
  //    لا يُستدعى `new KingIdentity()` هنا إطلاقاً — ذاك يَرفضُ الإنتاجَ.
  const kingIdentity = kingIdentityFromPublicKey(rootOfTrust.anchorSigner.publicKeyPem);

  // 5. سلطةُ التصديقِ من جذرِ الثقةِ — مخزنُ سحبٍ دائمٌ لا ذاكرةٌ.
  const authority = new CertificateAuthority(kingIdentity, {
    revocationStore: rootOfTrust.revocationStore,
    env,
  });

  // 6. سلسلةُ الإنفاذِ — هويّةٌ وسياسةٌ وحَجرٌ ونقطةُ تفويضٍ.
  //    الهويّةُ والسلطةُ مُحقَنتانِ من جذرِ الثقةِ، لا مُولَّدتانِ برمجيّاً.
  const chain = composeEnforcementChain({
    log: rootOfTrust.log,
    withLegislation: false,
    crown: null,
    haltSwitch: rootOfTrust.haltSwitch,
    royalCommandVerifier,
    kingIdentity,
    authority,
  });

  // 7. الساعةُ الموثوقةُ — في الإنتاجِ يلزمُها `CrownGateway`.
  //    الأولويّةُ: clock مُحقَنٌ (اختبارٌ)، ثم `AttestedClock` من سياسةِ الوقتِ،
  //    ثم `SovereignClock` (الذي يَفشلُ في الإنتاجِ لأنّه بلا `attestation()`).
  //    `AttestedClock` يَفشلُ مغلقاً إن لم يَتحقَّقْ نصابُ المصادرَ — لا يَسقُطُ إلى `Date.now()`.
  let clock = options.clock ?? null;
  if (clock === null) {
    try {
      const timePolicy = loadTimePolicy({ dir: 'config' });
      clock = new AttestedClock({ policy: timePolicy });
    } catch {
      // لا توجد سياسةُ وقتٍ — الساعةُ غيرُ موثوقةٍ، والـ CrownGateway سيرفضُها.
      // SovereignClock لا يملك attestation() — CrownGateway سيرفضه بـ ATTESTED_TIME_REQUIRED
      clock = /** @type {never} */ (
        new SovereignClock({ statePath: options.root + '/clock-state.json' })
      );
    }
  }

  // 8. بوابةُ التاجِ — من جذرِ الثقةِ: السجلُّ المختومُ ودفترُ الأوامرِ ومفتاحُ الإيقافِ والساعةُ.
  const crown = new CrownGateway(kingIdentity, authority, rootOfTrust.log, {
    commandLedger: rootOfTrust.ledger,
    haltSwitch: rootOfTrust.haltSwitch,
    clock,
    env,
    requireCommandLedger: true,
    requireHaltSwitch: true,
  });

  // 6. نواةُ التنفيذِ — من بوابةِ التاجِ والسلسلةِ والسجلِّ المختومِ.
  const kernel = new ExecutionKernel({
    crown,
    log: rootOfTrust.log,
    enforcement: chain.enforcementPoint,
    haltSwitch: rootOfTrust.haltSwitch,
  });

  return {
    rootOfTrust,
    chain,
    crown,
    kernel,
    auditLog: rootOfTrust.log,
    close: async () => {
      rootOfTrust.log.close?.();
      await rootOfTrust.close();
    },
  };
}
