// src/root-of-trust/royal-authorization.mts
//
// حدُّ السلطةِ الملكيّةِ عندَ نقطةِ الإنفاذِ (‏`R6-A-07`، `WL-303`).
//
// أربعةُ أسئلةٍ مختلفةٍ لا يُغني جوابُ واحدٍ منها عن غيرِه، وكلٌّ في موضعِه:
//
//   ١ — **المصادقةُ (authentication):** هل وقّعَ هذا الأمرَ بعينِه المفتاحُ الملكيُّ
//       المُثبَّتُ في جذرِ الثقة؟ — `king.verify(command, signature)` هنا.
//   ٢ — **التفويضُ الملكيُّ (royal authorization):** هل هذا الأمرُ الموقَّعُ يُجيزُ
//       **هذا** الفعلَ على **هذا** المورد **الآن** ولم يُستعمَلْ قبلُ؟ — الربطُ بالمعرّفِ
//       والملخّصِ والفعلِ والمورد، والفعلُ في العتبةِ السياديّة، والحداثةُ بالساعةِ
//       الموثوقة، ومنعُ الإعادةِ بدفترِ الأوامرِ الدائمِ وبحجزٍ في العمليّة — هنا.
//   ٣ — **قرارُ السياسة (policy decision):** هل يأذنُ الدستورُ والسياساتُ للفاعلِ
//       المُصادَقِ بالفعل؟ — `PolicyDecisionPoint.evaluate` في `EnforcementPoint` **قبلَ** هذا.
//   ٤ — **التنفيذ (execution):** `ExecutionKernel.submit` يتحقّقُ من تذكرةِ القرارِ
//       المربوطةِ بالأمرِ ثمّ `CrownGateway.command` يستهلكُ معرّفَه في الدفتر.
//
// فالتوقيعُ وحدَه لا يُجيزُ، ونصُّ فاعلٍ (‏`actorId = 'crown'`) أو معرّفُ أمرٍ أو
// ملخّصُه وحدَها لا تُجيزُ: لا يُقبَلُ إلّا الأمرُ نفسُه بتوقيعِه، مربوطاً بالطلب.
//
// وكلُّ قبولٍ ورفضٍ يُسجَّلُ (‏مختوماً في الإنتاج) **بلا توقيعٍ ولا مادّةِ مفتاح**.

import { createHash } from 'node:crypto';

/** رموزُ رفضِ التفويضِ الملكيّ — مُسمّاةٌ لتُقرأَ في الأثرِ لا لتُخمَّن. */
export const ROYAL_AUTHORIZATION_CODES = [
  'ROYAL_AUTH_COMMAND_MISSING',
  'ROYAL_AUTH_MALFORMED',
  'ROYAL_AUTH_SIGNATURE_INVALID',
  'ROYAL_AUTH_BINDING_MISMATCH',
  'ROYAL_AUTH_ACTION_NOT_SOVEREIGN',
  'ROYAL_AUTH_CLOCK_UNAVAILABLE',
  'ROYAL_AUTH_EXPIRED',
  'ROYAL_AUTH_FROM_FUTURE',
  'ROYAL_AUTH_REPLAYED',
  'ROYAL_AUTH_AUDIT_FAILED',
] as const;

export type RoyalAuthorizationCode = (typeof ROYAL_AUTHORIZATION_CODES)[number];

/** ما تُقدِّمُه نقطةُ الإنفاذِ للحدّ: الطلبُ مربوطاً، والأمرُ الموقَّعُ إن حُمِل. */
export interface RoyalAuthorizationRequest {
  id: string;
  digest?: string;
  action: string;
  resource?: string;
  command?: unknown;
  signature?: unknown;
}

export interface RoyalAuthorizationVerdict {
  ok: boolean;
  code: RoyalAuthorizationCode | null;
}

export type RoyalAuthorization = (
  request: RoyalAuthorizationRequest,
) => Promise<RoyalAuthorizationVerdict>;

export interface RoyalAuthorizationDeps {
  /** المفتاحُ الملكيُّ المُثبَّتُ — مفتاحٌ عامٌّ للتحقّقِ وحدَه. */
  king: { id: string; verify(payload: object, signature: string): boolean };
  /** الساعةُ الموثوقة؛ سقوطُها رفضٌ لا رجوعٌ إلى ساعةِ الجهاز. */
  clock: { now(): number };
  /** دفترُ الأوامرِ الدائمُ — ما ثُبِّتَ فيه لا يُجازُ ثانيةً ولو بعدَ إعادةِ التشغيل. */
  commandLedger: { has(id: string): boolean };
  /** العتبةُ السياديّةُ من `config/royal-authority.yaml`. */
  sovereignActions: Iterable<string>;
  /** سجلُّ الأثر: المختومُ غيرُ المتزامنِ في الإنتاج، والمتزامنُ خارجَه. */
  log: {
    appendSealed?: (type: string, actor: string, payload: object) => Promise<unknown>;
    append?: (type: string, actor: string, payload: object) => unknown;
  };
  maxCommandAgeMs?: number;
  maxCommandSkewMs?: number;
}

export const DEFAULT_ROYAL_AUTHORIZATION_MAX_AGE_MS = 5 * 60 * 1000;
export const DEFAULT_ROYAL_AUTHORIZATION_MAX_SKEW_MS = 30 * 1000;

/** علامةُ الثقة: كلُّ حدٍّ بُنيَ هنا يُعرَفُ بمعرّفِ مفتاحِه، والمُرتجَلُ لا علامةَ له. */
const TRUSTED = new WeakMap<object, string>();

/**
 * معرّفُ المفتاحِ الملكيِّ لحدٍّ مبنيٍّ بـ`createRoyalAuthorization`، أو `null`.
 * @param candidate - الدالّةُ المُمرَّرةُ مُحقِّقاً
 * @returns معرّفُ المفتاح أو `null`
 */
export function trustedRoyalAuthorizationKeyId(candidate: unknown): string | null {
  if (typeof candidate !== 'function') return null;
  return TRUSTED.get(candidate) ?? null;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}

/**
 * ملخّصُ الأمرِ الملكيِّ — مطابقٌ حرفاً لـ`royalCommandDigest` في `crown.mts`
 * (‏يُعادُ هنا كي لا تستوردَ وحدةُ الحدِّ البوابةَ كلَّها).
 * @param command - الأمر
 * @returns الملخّصُ السداسيُّ عشريّ
 */
function digestOf(command: Record<string, unknown>): string {
  return createHash('sha256')
    .update(
      canonical({
        id: command.id,
        action: command.action,
        target: command.target,
        payload: command.payload,
        issuedAt: command.issuedAt,
      }),
      'utf8',
    )
    .digest('hex');
}

/**
 * يبني حدَّ التفويضِ الملكيِّ الواحدَ لنقطةِ الإنفاذ.
 * @param deps - المفتاحُ والساعةُ والدفترُ والعتبةُ والسجلّ
 * @returns الحدّ
 */
export function createRoyalAuthorization(deps: RoyalAuthorizationDeps): RoyalAuthorization {
  if (typeof deps?.king?.verify !== 'function' || typeof deps.king.id !== 'string') {
    throw new Error('ROYAL_AUTHORIZATION_KEY_REQUIRED');
  }
  if (typeof deps.clock?.now !== 'function') throw new Error('ROYAL_AUTHORIZATION_CLOCK_REQUIRED');
  if (typeof deps.commandLedger?.has !== 'function') {
    throw new Error('ROYAL_AUTHORIZATION_LEDGER_REQUIRED');
  }
  const sovereign = new Set(deps.sovereignActions);
  if (sovereign.size === 0) throw new Error('ROYAL_AUTHORIZATION_THRESHOLD_REQUIRED');
  const maxAgeMs = deps.maxCommandAgeMs ?? DEFAULT_ROYAL_AUTHORIZATION_MAX_AGE_MS;
  const maxSkewMs = deps.maxCommandSkewMs ?? DEFAULT_ROYAL_AUTHORIZATION_MAX_SKEW_MS;
  const king = deps.king;
  /** حجزٌ في العمليّة: أمرٌ أُجيزَ مرّةً لا يُجازُ ثانيةً قبلَ أن يستهلكَه الدفتر. */
  const reserved = new Set<string>();

  /** حوضُ الأثر: المختومُ غيرُ المتزامنِ إن وُجِدَ، وإلّا المتزامن. */
  const auditLog = {
    async append(type: string, actor: string, payload: object): Promise<void> {
      const log = deps.log;
      if (typeof log.appendSealed === 'function') {
        await log.appendSealed(type, actor, payload);
        return;
      }
      if (typeof log.append === 'function') {
        log.append(type, actor, payload);
        return;
      }
      throw new Error('ROYAL_AUTHORIZATION_AUDIT_SINK_REQUIRED');
    },
  };

  async function reject(
    request: RoyalAuthorizationRequest,
    code: RoyalAuthorizationCode,
  ): Promise<RoyalAuthorizationVerdict> {
    try {
      await auditLog.append('crown.authorization.rejected', 'unauthenticated', {
        commandId: typeof request?.id === 'string' ? request.id.slice(0, 128) : null,
        action: typeof request?.action === 'string' ? request.action : '',
        resource: typeof request?.resource === 'string' ? request.resource : null,
        code,
      });
    } catch {
      /* الرفضُ قائمٌ ولو تعذّرَ تسجيلُه */
    }
    return { ok: false, code };
  }

  const authorize: RoyalAuthorization = async (request) => {
    const command = request?.command;
    const signature = request?.signature;
    if (typeof command !== 'object' || command === null || typeof signature !== 'string') {
      return reject(request, 'ROYAL_AUTH_COMMAND_MISSING');
    }
    const c = command as Record<string, unknown>;
    if (
      typeof c.id !== 'string' ||
      c.id === '' ||
      typeof c.action !== 'string' ||
      typeof c.target !== 'string' ||
      typeof c.issuedAt !== 'string' ||
      typeof c.payload !== 'object' ||
      c.payload === null
    ) {
      return reject(request, 'ROYAL_AUTH_MALFORMED');
    }
    // ١ — المصادقة.
    if (!king.verify(c, signature)) return reject(request, 'ROYAL_AUTH_SIGNATURE_INVALID');
    // ٢ — التفويضُ الملكيُّ: الأمرُ نفسُه مربوطٌ بالطلبِ حقلاً حقلاً.
    if (
      c.id !== request.id ||
      digestOf(c) !== request.digest ||
      c.action !== request.action ||
      c.target !== request.resource
    ) {
      return reject(request, 'ROYAL_AUTH_BINDING_MISMATCH');
    }
    if (!sovereign.has(c.action)) return reject(request, 'ROYAL_AUTH_ACTION_NOT_SOVEREIGN');
    let nowMs: number;
    try {
      nowMs = deps.clock.now();
    } catch {
      return reject(request, 'ROYAL_AUTH_CLOCK_UNAVAILABLE');
    }
    const issued = Date.parse(c.issuedAt);
    if (!Number.isFinite(nowMs) || !Number.isFinite(issued)) {
      return reject(
        request,
        Number.isFinite(nowMs) ? 'ROYAL_AUTH_MALFORMED' : 'ROYAL_AUTH_CLOCK_UNAVAILABLE',
      );
    }
    if (issued - nowMs > maxSkewMs) return reject(request, 'ROYAL_AUTH_FROM_FUTURE');
    if (nowMs - issued > maxAgeMs) return reject(request, 'ROYAL_AUTH_EXPIRED');
    if (reserved.has(c.id) || deps.commandLedger.has(c.id)) {
      return reject(request, 'ROYAL_AUTH_REPLAYED');
    }
    reserved.add(c.id);
    try {
      await auditLog.append('crown.authorization.accepted', king.id, {
        commandId: c.id,
        action: c.action,
        resource: c.target,
        code: null,
      });
    } catch {
      // قبولٌ لا يُكتَبُ أثرُه لا يُعَدُّ قبولاً.
      reserved.delete(c.id);
      return { ok: false, code: 'ROYAL_AUTH_AUDIT_FAILED' };
    }
    return { ok: true, code: null };
  };
  TRUSTED.set(authorize, king.id);
  return authorize;
}
