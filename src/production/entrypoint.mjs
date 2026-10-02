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

/**
 * أخطاءُ نقطةِ الدخولِ الإنتاجيّةِ — كلُّ رمزٍ مُختومٌ في العقدِ.
 */
export const PRODUCTION_ENTRYPOINT_ERRORS = Object.freeze([
  'PRODUCTION_ENTRYPOINT_NOT_PRODUCTION_ENV',
  'PRODUCTION_ENTRYPOINT_FRESHNESS_SOCKET_NULL',
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
  const rootOfTrust = await createProductionRootOfTrust(
    env,
    {
      root: options.root,
      fsync: true,
      freshnessSocket: options.freshnessSocket,
      royalCommandVerifier: options.royalCommandVerifier ?? (() => true),
    },
    deps,
  );

  // 4. سلسلةُ الإنفاذِ — هويّةٌ وسياسةٌ وحَجرٌ ونقطةُ تفويضٍ.
  //    السجلُّ المختومُ من جذرِ الثقةِ هو سجلُّ الحوادثِ الموثوقُ.
  const chain = composeEnforcementChain({
    log: rootOfTrust.log,
    withLegislation: false,
    crown: null,
    haltSwitch: rootOfTrust.haltSwitch,
    royalCommandVerifier: options.royalCommandVerifier ?? null,
  });

  // 5. بوابةُ التاجِ — من جذرِ الثقةِ: السجلُّ المختومُ ودفترُ الأوامرِ ومفتاحُ الإيقافِ.
  const crown = new CrownGateway(chain.kingIdentity, chain.authority, rootOfTrust.log, {
    commandLedger: rootOfTrust.ledger,
    haltSwitch: rootOfTrust.haltSwitch,
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
