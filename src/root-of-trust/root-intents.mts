// src/root-of-trust/root-intents.mts
//
// `D6` (‏`WL-326`، `LIVE-28` الخيار ب): **كاتبٌ إنتاجيٌّ واحد**. كلُّ تبديلٍ في حالةِ الإنتاجِ
// — ومنه `nodes/` و`acks/` (‏`P8`/`P9`) ومخزنُ المراسي — يقعُ في عمليةِ الجذرِ وحدَها وعبرَ
// حاجزِ الالتزامِ (‏`commit-barrier.mts`). والعملياتُ الأخرى (‏أداةُ الإيقاف، أداةُ التثبيت،
// العقد) لا تكتبُ ملفّاتِ الحالة: تُودِعُ **قصداً مُصادَقاً** في صندوقِ الجذر، فيتحقّقُ منه
// الكاتبُ الواحدُ ويُطبِّقُه ثمَّ يكتبُ النتيجةَ بعدَ أن يرجعَ الحاجزُ (‏بعدَ الدوامِ والتقدُّمِ
// والترقية — `D3`).
//
// المصادقةُ لكلِّ نوعٍ بما يملكُه صاحبُه لا بما يدّعيه:
//   halt/resume   أمرٌ ملكيٌّ موقَّعٌ يتحقّقُ منه مُحقِّقُ الجذرِ الملكيُّ (‏لا مفتاحُ `06`).
//   confirm       إقرارٌ موقَّعٌ بمفتاحِ العقدةِ المسجَّلِ (‏`GPT-F05`).
//   register      إثباتُ حيازةِ المفتاحِ الجديد؛ وعقدةٌ قائمةٌ بمفتاحٍ آخرَ لا
//                 يُقبَلُ تسجيلُها إلا بتوقيعِ المفتاحَينِ معاً: القديمِ المسجَّلِ
//                 (‏إذنُ التدوير) والجديد (‏إثباتُ الحيازة) — `LIVE-40` (أ).
//   unregister    توقيعُ العقدةِ نفسِها على شطبِها في العهدِ الحاضر.
//   anchor        توقيعٌ بمفتاحِ المرساةِ (‏`06`) على القصدِ بنطاقٍ مستقلّ،
//                 وفترةُ التثبيتِ جزءٌ من مادتِهِ الموقَّعة — `LIVE-40` (ب).
//
// الصندوقُ ليس حالةً: لا يدخلُ بصمةَ الحالة، ولا يُقرأُ منه شيءٌ إلّا بعدَ التحقّق. وقصدٌ
// طُبِّقَ ثمَّ تعطّلَ الجذرُ قبلَ كتابةِ نتيجتِه يُعادُ عرضُه، فيُرَدُّ بحمايةِ الإعادةِ في
// المُستقبِل (‏معرّفُ الأمرِ الملكيِّ مُستهلَكٌ) — فلا يُنفَّذُ مرّتين.

import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

import { verifyHaltAckProof } from './halt-switch.mjs';

/** اسمُ صندوقِ القصودِ تحتَ جذرِ الحالة. */
export const ROOT_INTENTS_DIR = 'root-of-trust.intents';

/** أنواعُ القصود. */
export const RootIntentKinds = [
  'halt',
  'resume',
  'confirm',
  'register',
  'unregister',
  'anchor',
] as const;
export type RootIntentKind = (typeof RootIntentKinds)[number];

/** رموزُ الرفض. */
export const RootIntentErrorCodes = [
  'ROOT_INTENT_INVALID',
  'ROOT_INTENT_UNAUTHENTICATED',
  'ROOT_INTENT_NODE_KEY_CONFLICT',
  'ROOT_INTENT_NODE_UNKNOWN',
  'ROOT_INTENT_TIMEOUT',
  'ROOT_INTENT_REJECTED',
] as const;
export type RootIntentErrorCode = (typeof RootIntentErrorCodes)[number];

/** خطأُ القصدِ برمزِه. */
export class RootIntentError extends Error {
  readonly code: string;
  readonly detail: string | undefined;
  constructor(code: string, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = 'RootIntentError';
    this.code = code;
    this.detail = detail;
  }
}

/** القصدُ كما يُودَع. */
export interface RootIntent {
  v: 1;
  id: string;
  kind: RootIntentKind;
  at: string;
  payload: Record<string, unknown>;
}

/** النتيجةُ كما يكتبُها الجذر — بعدَ رجوعِ الحاجزِ لا قبلَه. */
export interface RootIntentResult {
  v: 1;
  id: string;
  kind: string;
  ok: boolean;
  at: string;
  result?: unknown;
  code?: string;
  detail?: string;
}

/**
 * مساراتُ الصندوق.
 * @param root - جذرُ الحالة
 * @returns مجلّدا الطلباتِ والنتائج
 */
export function rootIntentPaths(root: string): { requests: string; results: string } {
  const base = join(root, ROOT_INTENTS_DIR);
  return { requests: join(base, 'requests'), results: join(base, 'results') };
}

/**
 * مادةُ إثباتِ الحيازةِ لتسجيلِ عقدة.
 * @param nodeId - معرّفُ العقدة
 * @param publicKeyPem - المفتاحُ العامُّ المطلوبُ تسجيلُه
 * @returns المادةُ الموقَّعة
 */
export function registerPossessionPayload(nodeId: string, publicKeyPem: string): object {
  return ['xuux/halt/register/v1', nodeId, publicKeyPem];
}

/**
 * مادةُ إذنِ تدويرِ مفتاحِ عقدةٍ قائمةٍ (‏`LIVE-40` أ): يوقّعها المفتاحُ **القديمُ
 * المسجَّلُ** فيُثبتُ مالكُ العهدةِ السابقةِ تسليمَهُ العقدةَ إلى المفتاحِ الجديد.
 * ربطُها بـ(‏المعرّف، المفتاحِ الجديد) هو ما يجعلُ إعادةَ عرضِها بعدَ تدويرٍ لاحقٍ
 * بلا أثر: المسجَّلَ حينها مفتاحٌ آخرُ فلا يَصِحُّ توقيعُها ضدَّه.
 * @param nodeId - معرّفُ العقدة
 * @param newPublicKeyPem - المفتاحُ العامُّ الجديدُ المطلوبُ التدويرُ إليه
 * @returns المادةُ الموقَّعة
 */
export function registerRotationPayload(nodeId: string, newPublicKeyPem: string): object {
  return ['xuux/halt/rotate/v1', nodeId, newPublicKeyPem];
}

/**
 * مادةُ توقيعِ العقدةِ على شطبِها.
 * @param nodeId - معرّفُ العقدة
 * @param epoch - العهدُ الحاضر
 * @returns المادةُ الموقَّعة
 */
export function unregisterProofPayload(nodeId: string, epoch: number): object {
  return ['xuux/halt/unregister/v1', nodeId, epoch];
}

/**
 * مادةُ توقيعِ قصدِ التثبيتِ بمفتاحِ المرساة — نطاقٌ مستقلٌّ (‏`purpose`) فلا يُقرأُ
 * توقيعُ مرساةٍ أو مفتاحُ دفترِ رفعٍ قصداً، ولا العكس. وفترةُ التثبيتِ (‏`intervalMs`)
 * جزءٌ من المادةِ الموقَّعةِ (‏`LIVE-40` ب): فلا يأخذَ الجذرُ فترتَهُ الافتراضيّةَ
 * مكانَ فترةِ الأداةِ إلا أن تكونَ موقَّعةً بها.
 * @param intent - القصدُ بلا توقيعِه
 * @param intent.id - معرّفُه
 * @param intent.at - وقتُه
 * @param intent.force - تثبيتٌ قسريّ
 * @param intent.intervalMs - فترةُ التثبيتِ الموقَّعةُ بالمللي ثانية
 * @returns المادةُ الموقَّعة
 */
export function anchorIntentSigningBody(intent: {
  id: string;
  at: string;
  force: boolean;
  intervalMs: number;
}): object {
  return {
    purpose: 'xuux/root-intent/anchor/v1',
    id: intent.id,
    at: intent.at,
    force: intent.force,
    intervalMs: intent.intervalMs,
  };
}

/**
 * كتابةٌ ذرّيّةٌ دائمة: ملفٌّ مؤقّتٌ ثمَّ `fsync` ثمَّ إعادةُ تسمية ثمَّ `fsync` المجلد.
 * @param path - المسار
 * @param text - المحتوى
 * @param fsync - مزامنةُ القرص
 */
function writeDurable(path: string, text: string, fsync: boolean): void {
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const fd = openSync(temporary, 'w', 0o600);
  try {
    writeSync(fd, text);
    if (fsync) fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
  if (fsync) {
    const dir = openSync(join(path, '..'), 'r');
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  }
}

/**
 * يُودِعُ قصداً في صندوقِ الجذر — لا يكتبُ ملفَّ حالة. هذا كلُّ ما تملكُه عمليةٌ غيرُ
 * عمليةِ الجذرِ في الإنتاج.
 * @param root - جذرُ الحالة
 * @param kind - نوعُ القصد
 * @param payload - الحمولةُ المُصادَقة
 * @param options - خيارات
 * @param options.fsync - مزامنةُ القرص (‏افتراضاً نعم)
 * @param options.id - معرّفٌ مُعطى (‏لتوقيعِ قصدِ التثبيتِ قبلَ الإيداع)
 * @param options.at - وقتٌ مُعطى
 * @returns القصدُ المُودَع
 */
export function submitRootIntent(
  root: string,
  kind: RootIntentKind,
  payload: Record<string, unknown>,
  options: { fsync?: boolean; id?: string; at?: string } = {},
): RootIntent {
  if (!RootIntentKinds.includes(kind)) throw new RootIntentError('ROOT_INTENT_INVALID', kind);
  const { requests } = rootIntentPaths(root);
  mkdirSync(requests, { recursive: true });
  const intent: RootIntent = {
    v: 1,
    id: options.id ?? newRootIntentId(),
    kind,
    at: options.at ?? new Date().toISOString(),
    payload,
  };
  writeDurable(
    join(requests, `${intent.id}.json`),
    JSON.stringify(intent) + '\n',
    options.fsync ?? true,
  );
  return intent;
}

/**
 * معرّفُ قصدٍ جديد: وقتٌ مرتَّبٌ ثمَّ عشوائيّة، فيُطبَّقُ الصندوقُ بترتيبِ الإيداع.
 * @returns المعرّف
 */
export function newRootIntentId(): string {
  return `${Date.now().toString(36).padStart(10, '0')}-${randomBytes(12).toString('hex')}`;
}

/**
 * ينتظرُ نتيجةَ قصدٍ كتبَها الجذر. لا نتيجةَ في المهلةِ ⇒ رفضٌ برمزِه، والقصدُ يبقى
 * مُودَعاً (‏قد يُطبَّقُ لاحقاً) — فلا يُقرأُ غيابُ الجوابِ نجاحاً ولا فشلاً للحالة.
 * @param root - جذرُ الحالة
 * @param id - معرّفُ القصد
 * @param options - خيارات
 * @param options.timeoutMs - المهلة
 * @param options.pollMs - فترةُ الفحص
 * @returns النتيجة
 */
export async function awaitRootIntentResult(
  root: string,
  id: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<RootIntentResult> {
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  const path = join(rootIntentPaths(root).results, `${id}.json`);
  for (;;) {
    if (existsSync(path)) {
      const result = JSON.parse(readFileSync(path, 'utf8')) as RootIntentResult;
      rmSync(path, { force: true });
      return result;
    }
    if (Date.now() >= deadline) {
      throw new RootIntentError(
        'ROOT_INTENT_TIMEOUT',
        `${id}: لا نتيجةَ من عمليةِ الجذرِ في المهلة — القصدُ مُودَعٌ ولم يُقرأْ نجاحاً`,
      );
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, options.pollMs ?? 50));
  }
}

/** أقلُّ ما يلزمُ من مفتاحِ الإيقافِ للمعالِج. */
export interface IntentHaltSwitch {
  read(): { epoch: number; directive: { hash: string } | null };
  nodes(): { nodeId: string; nodeKeyPem?: string }[];
  haltAsync(reason: string, command: unknown): Promise<unknown>;
  resumeAsync(reason: string, command: unknown): Promise<unknown>;
  confirmHaltAsync(nodeId: string, proof?: string, detail?: string): Promise<unknown>;
  registerNodeAsync(
    nodeId: string,
    options: { pid?: number; nodeKey?: { publicKeyPem: string; sign(payload: object): string } },
  ): Promise<unknown>;
  unregisterNodeAsync(nodeId: string): Promise<void>;
}

/** خياراتُ المعالِج. */
export interface RootIntentProcessorOptions {
  root: string;
  haltSwitch: IntentHaltSwitch;
  anchor: (options: { force: boolean; intervalMs: number }) => Promise<unknown>;
  anchorVerifier: { verify(payload: object, signature: string): boolean };
  fsync?: boolean;
}

const isString = (value: unknown): value is string => typeof value === 'string' && value !== '';

/**
 * معالِجُ الصندوقِ في عمليةِ الجذر: يتحقّقُ ثمَّ يُطبِّقُ عبرَ المسارِ غيرِ المتزامنِ
 * (‏وهو الحاجز) ثمَّ يكتبُ النتيجةَ ثمَّ يحذفُ الطلب.
 */
export class RootIntentProcessor {
  readonly #options: RootIntentProcessorOptions;
  #draining: Promise<number> | null = null;

  constructor(options: RootIntentProcessorOptions) {
    this.#options = options;
  }

  /**
   * يُطبِّقُ كلَّ ما في الصندوقِ بترتيبِه. نداءانِ متداخلانِ يشتركانِ في تفريغٍ واحد.
   * @returns عددُ القصودِ المُعالَجة
   */
  drainAsync(): Promise<number> {
    if (this.#draining !== null) return this.#draining;
    this.#draining = this.#drain().finally(() => {
      this.#draining = null;
    });
    return this.#draining;
  }

  async #drain(): Promise<number> {
    const { requests, results } = rootIntentPaths(this.#options.root);
    if (!existsSync(requests)) return 0;
    mkdirSync(results, { recursive: true });
    const names = readdirSync(requests)
      .filter((name) => name.endsWith('.json'))
      .sort();
    let handled = 0;
    for (const name of names) {
      const path = join(requests, name);
      let intent: RootIntent | null = null;
      let outcome: RootIntentResult;
      try {
        intent = this.#parse(readFileSync(path, 'utf8'), name);
        const result = await this.#apply(intent);
        outcome = { v: 1, id: intent.id, kind: intent.kind, ok: true, at: now(), result };
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        // عطبُ حاجزٍ (‏`COMMIT_BARRIER_FENCED`/`CLOSED`) لا يُكتَبُ رفضاً للقصد: الحالةُ لم
        // تُحسَم، والقصدُ يبقى ليُعرَضَ على إقلاعٍ يحسمُها.
        if (code === 'COMMIT_BARRIER_FENCED' || code === 'COMMIT_BARRIER_CLOSED') throw error;
        outcome = {
          v: 1,
          id: intent?.id ?? name.replace(/\.json$/, ''),
          kind: intent?.kind ?? 'unknown',
          ok: false,
          at: now(),
          code: typeof code === 'string' ? code : 'ROOT_INTENT_REJECTED',
          detail: error instanceof Error ? error.message : String(error),
        };
      }
      // النتيجةُ بعدَ رجوعِ الحاجز (‏`ACK` بعدَ الدوام) ثمَّ يُحذَفُ الطلب. تعطُّلٌ بينهما يُعيدُ
      // العرضَ فيُرَدُّ بحمايةِ الإعادة — لا يُنفَّذُ مرّتين.
      writeDurable(
        join(results, `${outcome.id}.json`),
        JSON.stringify(outcome) + '\n',
        this.#options.fsync ?? true,
      );
      rmSync(path, { force: true });
      handled += 1;
    }
    return handled;
  }

  #parse(text: string, name: string): RootIntent {
    let intent: RootIntent;
    try {
      intent = JSON.parse(text) as RootIntent;
    } catch {
      throw new RootIntentError('ROOT_INTENT_INVALID', `${name}: ليس JSON`);
    }
    if (
      intent === null ||
      typeof intent !== 'object' ||
      intent.v !== 1 ||
      !isString(intent.id) ||
      `${intent.id}.json` !== name ||
      !RootIntentKinds.includes(intent.kind) ||
      !isString(intent.at) ||
      intent.payload === null ||
      typeof intent.payload !== 'object'
    ) {
      throw new RootIntentError('ROOT_INTENT_INVALID', name);
    }
    return intent;
  }

  async #apply(intent: RootIntent): Promise<unknown> {
    const halt = this.#options.haltSwitch;
    const payload = intent.payload;
    switch (intent.kind) {
      case 'halt':
      case 'resume': {
        // المصادقةُ هي الأمرُ الملكيُّ نفسُه: يتحقّقُ منه مُحقِّقُ الجذرِ داخلَ `haltAsync`.
        const command = payload['royalCommand'];
        const reason = payload['reason'];
        if (command === null || typeof command !== 'object' || !isString(reason)) {
          throw new RootIntentError(
            'ROOT_INTENT_INVALID',
            `${intent.kind}: أمرٌ ملكيٌّ أو سببٌ ناقص`,
          );
        }
        return intent.kind === 'halt'
          ? await halt.haltAsync(reason, command)
          : await halt.resumeAsync(reason, command);
      }
      case 'confirm': {
        const nodeId = payload['nodeId'];
        const proof = payload['proof'];
        if (!isString(nodeId) || !isString(proof)) {
          throw new RootIntentError('ROOT_INTENT_INVALID', 'confirm: معرّفٌ أو إثباتٌ ناقص');
        }
        const detail = isString(payload['detail']) ? payload['detail'] : 'إقرارٌ عبرَ صندوقِ الجذر';
        return await halt.confirmHaltAsync(nodeId, proof, detail);
      }
      case 'register': {
        const nodeId = payload['nodeId'];
        const publicKeyPem = payload['publicKeyPem'];
        const possession = payload['possession'];
        if (!isString(nodeId) || !isString(publicKeyPem) || !isString(possession)) {
          throw new RootIntentError('ROOT_INTENT_INVALID', 'register: حقلٌ ناقص');
        }
        if (
          !verifyHaltAckProof(
            publicKeyPem,
            registerPossessionPayload(nodeId, publicKeyPem),
            possession,
          )
        ) {
          throw new RootIntentError('ROOT_INTENT_UNAUTHENTICATED', `register ${nodeId}`);
        }
        const existing = halt.nodes().find((node) => node.nodeId === nodeId);
        if (existing?.nodeKeyPem !== undefined && existing.nodeKeyPem !== publicKeyPem) {
          // `LIVE-40` (أ): تدويرُ مفتاحِ عقدةٍ قائمة. لا يُقبَلُ بالمفتاحِ الجديدِ
          // وحدَه (‏إثباتُ الحيازةِ أعلاه)، بل بإذنِ المفتاحِ **القديمِ المسجَّلِ**
          // فوقَ مادةِ التدويرِ معه. غيابُ الإذنِ أو فسادُه يُبقيانِ الرفضَ كما كان.
          const rotation = payload['rotation'];
          if (
            !isString(rotation) ||
            !verifyHaltAckProof(
              existing.nodeKeyPem,
              registerRotationPayload(nodeId, publicKeyPem),
              rotation,
            )
          ) {
            throw new RootIntentError('ROOT_INTENT_NODE_KEY_CONFLICT', nodeId);
          }
        }
        const pid = typeof payload['pid'] === 'number' ? (payload['pid'] as number) : undefined;
        const options: { pid?: number; nodeKey: { publicKeyPem: string; sign(): string } } = {
          nodeKey: {
            publicKeyPem,
            sign: () => {
              throw new RootIntentError('ROOT_INTENT_INVALID', 'الجذرُ لا يملكُ مفتاحَ العقدة');
            },
          },
        };
        if (pid !== undefined) options.pid = pid;
        return await halt.registerNodeAsync(nodeId, options);
      }
      case 'unregister': {
        const nodeId = payload['nodeId'];
        const proof = payload['proof'];
        if (!isString(nodeId) || !isString(proof)) {
          throw new RootIntentError('ROOT_INTENT_INVALID', 'unregister: حقلٌ ناقص');
        }
        const existing = halt.nodes().find((node) => node.nodeId === nodeId);
        if (existing?.nodeKeyPem === undefined) {
          throw new RootIntentError('ROOT_INTENT_NODE_UNKNOWN', nodeId);
        }
        const epoch = halt.read().epoch;
        if (
          !verifyHaltAckProof(existing.nodeKeyPem, unregisterProofPayload(nodeId, epoch), proof)
        ) {
          throw new RootIntentError('ROOT_INTENT_UNAUTHENTICATED', `unregister ${nodeId}`);
        }
        await halt.unregisterNodeAsync(nodeId);
        return { unregistered: nodeId };
      }
      case 'anchor': {
        const signature = payload['signature'];
        const force = payload['force'] === true;
        const intervalMs = payload['intervalMs'];
        if (!isString(signature)) {
          throw new RootIntentError('ROOT_INTENT_INVALID', 'anchor: توقيعٌ ناقص');
        }
        // `LIVE-40` (ب): فترةُ التثبيتِ جزءٌ من القصدِ الموقَّعِ — لا افتراضَ للجذرِ
        // مكانَ فترةِ الأداةِ، ولا تثبيتَ بفترةٍ لم تُوقَّعْ.
        if (
          typeof intervalMs !== 'number' ||
          !Number.isSafeInteger(intervalMs) ||
          intervalMs <= 0
        ) {
          throw new RootIntentError('ROOT_INTENT_INVALID', 'anchor: فترةُ التثبيتِ ناقصة');
        }
        const body = anchorIntentSigningBody({ id: intent.id, at: intent.at, force, intervalMs });
        if (!this.#options.anchorVerifier.verify(body, signature)) {
          throw new RootIntentError('ROOT_INTENT_UNAUTHENTICATED', 'anchor');
        }
        const record = await this.#options.anchor({ force, intervalMs });
        return record ?? null;
      }
      default:
        throw new RootIntentError('ROOT_INTENT_INVALID', String(intent.kind));
    }
  }
}

/** @returns الوقتُ بصيغةِ ISO */
function now(): string {
  return new Date().toISOString();
}
