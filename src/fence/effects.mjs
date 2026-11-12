/**
 * إيقافُ الآثارِ خارجَ قاعدةِ البيانات (`WL-532`، §9). `DB_FENCED` لا يكفي: عمليةٌ ابنةٌ
 * يتيمةٌ أو طلبُ HTTPS جارٍ أو رسالةُ Outbox قديمةٌ أثرٌ دائمٌ لا يراه زنادُ القاعدة.
 *
 * ما هنا:
 *  - `CgroupScope` — نطاقُ cgroup v2 لكلِّ إقلاع: كلُّ عمليةٍ ابنةٍ تُطلَقُ داخلَه، والإيقافُ
 *    `cgroup.kill` ثمّ **تحقُّقٌ** أنّ `cgroup.procs` فارغ (لا يُفترَضُ الموت). (E6)
 *  - `HaltFencedTransport` — ناقلٌ يُركَّبُ في `EgressGate` القائمة (لا بوّابةَ موازية): يُغلَقُ
 *    فيُجهِضُ الجاري ويرفضُ الجديد، ودليلُه عددُ الجاري صفراً. (E9، E10)
 *  - `fencingToken`/`FencingReceiver` — كلُّ رسالةٍ خارجةٍ تحملُ عهدَها ومفتاحَ تكرارٍ، والمستقبِلُ
 *    يرفضُ عهداً غيرَ الجاري أو أقدمَ مما رأى، ويرفضُ الإعادة. (E15، E16)
 *  - `buildEffectsStopper` — يجمعُ ما سبق في خطوةِ الإيقافِ 11 ويُخرجُ دليلاً يُختَمُ في القاعدة.
 *
 * حدودٌ معلنة: نطاقُ cgroup يتطلّبُ تفويضاً (`Delegate=yes` أو ما يعادله)؛ بلا تفويضٍ يُعلَنُ
 * `CGROUP_UNAVAILABLE` ولا يُدّعى الإيقاف. وعمليةٌ بالـUID نفسِه خارجَ النطاق — أو root —
 * خارجَ ما يضمنُه هذا الملف.
 *
 * @module fence/effects
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const EFFECTS_ERRORS = Object.freeze({
  CGROUP_UNAVAILABLE: 'EFFECTS_CGROUP_UNAVAILABLE',
  SCOPE_CLOSED: 'EFFECTS_SCOPE_CLOSED',
  EGRESS_CLOSED: 'EFFECTS_EGRESS_CLOSED',
  STALE_EPOCH: 'EFFECTS_STALE_EPOCH',
  NOT_RUNNING: 'EFFECTS_NOT_RUNNING',
  REPLAY: 'EFFECTS_REPLAY',
});

export class EffectsError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'EffectsError';
    this.code = code;
  }
}

// ── E6: العمليات الابنة ──────────────────────────────────────────────────────

/**
 * @param {string} parent - مسارُ cgroup مفوَّضٍ (يملكُه المستخدمُ ويستطيعُ نقلَ العملياتِ إليه)
 * @returns {{ ok: boolean, reason?: string }}
 */
export function cgroupDelegated(parent) {
  try {
    if (!existsSync(join(parent, 'cgroup.procs'))) return { ok: false, reason: 'لا cgroup.procs' };
    const probe = join(parent, `.probe-${process.pid}-${Date.now()}`);
    mkdirSync(probe);
    const hasKill = existsSync(join(probe, 'cgroup.kill'));
    rmdirSync(probe);
    return hasKill ? { ok: true } : { ok: false, reason: 'لا cgroup.kill (نواةٌ أقدمُ من 5.14)' };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export class CgroupScope {
  /**
   * @param {string} parent - cgroup مفوَّض
   * @param {string} bootId
   */
  constructor(parent, bootId) {
    const delegated = cgroupDelegated(parent);
    if (!delegated.ok) {
      throw new EffectsError(
        EFFECTS_ERRORS.CGROUP_UNAVAILABLE,
        `cgroup v2 غيرُ مفوَّض في ${parent}: ${delegated.reason}`,
      );
    }
    this.path = join(parent, `boot-${bootId}`);
    mkdirSync(this.path);
    this.closed = false;
  }

  /**
   * يُطلقُ عمليةً **داخلَ** النطاقِ قبلَ أن تُنفَّذَ أوّلُ تعليمةٍ منها: الغلافُ يكتبُ معرّفَه
   * في `cgroup.procs` ثمّ `exec` — فلا نافذةَ تفرُّ فيها ذريّتُه قبلَ الانضمام.
   * @param {string} command
   * @param {string[]} args
   * @param {import('node:child_process').SpawnOptions} [options]
   */
  spawn(command, args, options = {}) {
    if (this.closed)
      throw new EffectsError(EFFECTS_ERRORS.SCOPE_CLOSED, 'النطاقُ مغلق — لا إطلاقَ بعدَ الإيقاف');
    return spawn(
      '/bin/sh',
      ['-c', 'echo $$ > "$0" && exec "$@"', join(this.path, 'cgroup.procs'), command, ...args],
      options,
    );
  }

  /** @returns {number[]} */
  procs() {
    return readFileSync(join(this.path, 'cgroup.procs'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(Number);
  }

  /** @returns {boolean} */
  populated() {
    return /populated 1/.test(readFileSync(join(this.path, 'cgroup.events'), 'utf8'));
  }

  /**
   * يغلقُ النطاق ويقتلُ كلَّ ما فيه (ومنه اليتامى والأحفاد) ويتحقّقُ من الخلوّ.
   * @param {{ timeoutMs?: number }} [options]
   * @returns {Promise<{ ok: boolean, path: string, procsBefore: number[], procsAfter: number[], populated: boolean }>}
   */
  async kill(options = {}) {
    this.closed = true;
    const procsBefore = this.procs();
    writeFileSync(join(this.path, 'cgroup.kill'), '1');
    const deadline = Date.now() + (options.timeoutMs ?? 5_000);
    let procsAfter = this.procs();
    while ((procsAfter.length > 0 || this.populated()) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      procsAfter = this.procs();
    }
    const populated = this.populated();
    return {
      ok: procsAfter.length === 0 && !populated,
      path: this.path,
      procsBefore,
      procsAfter,
      populated,
    };
  }

  /** يحذفُ النطاقَ الفارغ (بعدَ الدليل). */
  remove() {
    rmdirSync(this.path);
  }
}

// ── E9/E10: الخروج الشبكيّ ────────────────────────────────────────────────────

/**
 * ناقلٌ مُسيَّجٌ **يُركَّبُ داخلَ** `EgressGate` القائمة (`src/egress/egress-gate.mjs`) بديلاً
 * عن ناقلِها — لا بوّابةَ موازية: التفويضُ والسجلُّ والمعدّلُ تبقى للبوّابة، وهذا يضيفُ
 * شرطَ الإيقاف: يقرأُ الحارسَ قبلَ كلِّ نقل، ويُغلَقُ في الخطوة 11 فيُجهِضُ الجاريَ
 * (عبرَ `signal` يُمرَّرُ إلى الناقلِ الأصليّ) ويرفضُ الجديد.
 */
export class HaltFencedTransport {
  /**
   * @param {{ assertOperational(): void }} haltGuard
   * @param {(record: Record<string, unknown> & { signal: AbortSignal }) => Promise<unknown>} inner - الناقلُ الأصليّ
   */
  constructor(haltGuard, inner) {
    this.haltGuard = haltGuard;
    this.inner = inner;
    this.open = true;
    /** @type {Set<AbortController>} */
    this.inflight = new Set();
    this.refused = 0;
    this.aborted = 0;
    /** الدالّةُ التي تُمرَّرُ إلى `new EgressGate({ transport })`. */
    this.transport = (/** @type {Record<string, unknown>} */ record) => this.send(record);
  }

  /** @param {Record<string, unknown>} record */
  async send(record) {
    if (!this.open) {
      this.refused++;
      throw new EffectsError(EFFECTS_ERRORS.EGRESS_CLOSED, 'الناقلُ مغلقٌ بالإيقاف — لا نقل');
    }
    try {
      this.haltGuard.assertOperational();
    } catch (error) {
      this.refused++;
      throw error;
    }
    const controller = new AbortController();
    this.inflight.add(controller);
    try {
      return await this.inner({ ...record, signal: controller.signal });
    } finally {
      this.inflight.delete(controller);
    }
  }

  /** @returns {{ ok: boolean, inflight: number, aborted: number, refused: number }} */
  close() {
    this.open = false;
    for (const controller of this.inflight) {
      controller.abort(new EffectsError(EFFECTS_ERRORS.EGRESS_CLOSED, 'أُجهِضَ بالإيقاف'));
      this.aborted++;
    }
    this.inflight.clear();
    return {
      ok: this.inflight.size === 0,
      inflight: this.inflight.size,
      aborted: this.aborted,
      refused: this.refused,
    };
  }
}

// ── E15/E16: Outbox والطوابير ─────────────────────────────────────────────────

/**
 * رمزُ سياجٍ لرسالةٍ خارجة.
 * @param {{ epoch: number, workerId: string, bootId: string, idempotencyKey: string }} fields
 */
export function fencingToken(fields) {
  if (!Number.isInteger(fields.epoch) || fields.epoch < 1) throw new TypeError('epoch');
  if (typeof fields.idempotencyKey !== 'string' || fields.idempotencyKey.length < 8)
    throw new TypeError('idempotencyKey');
  return Object.freeze({
    epoch: fields.epoch,
    worker_id: fields.workerId,
    boot_id: fields.bootId,
    idempotency_key: fields.idempotencyKey,
  });
}

/**
 * المستقبِلُ الخارجيُّ المرجعيّ: يقبلُ الرسالةَ فقط إن كان عهدُها هو العهدَ الجاريَ في
 * حالِ RUNNING (يُقرأُ من مصدرِ السياجِ لا من الرسالة)، ولم يرَ عهداً أعلى، ولم يرَ مفتاحَ
 * التكرار. المستقبِلُ الحقيقيُّ خارجَ المستودعِ يجبُ أن يُطبّقَ القاعدةَ نفسَها — وذلك
 * يتطلّبُ تعاونَه (حدٌّ معلن).
 */
export class FencingReceiver {
  /** @param {() => Promise<{ state: string, epoch: number }> | { state: string, epoch: number }} currentFence */
  constructor(currentFence) {
    this.currentFence = currentFence;
    this.highestEpoch = 0;
    /** @type {Set<string>} */
    this.seen = new Set();
    /** @type {unknown[]} */
    this.accepted = [];
  }

  /** @param {ReturnType<typeof fencingToken>} token @param {unknown} message */
  async accept(token, message) {
    const fence = await this.currentFence();
    if (fence.state !== 'RUNNING')
      throw new EffectsError(EFFECTS_ERRORS.NOT_RUNNING, `المصدرُ ${fence.state}`);
    if (token.epoch !== Number(fence.epoch) || token.epoch < this.highestEpoch) {
      throw new EffectsError(
        EFFECTS_ERRORS.STALE_EPOCH,
        `عهدُ الرسالة ${token.epoch} والجاري ${fence.epoch}`,
      );
    }
    if (this.seen.has(token.idempotency_key))
      throw new EffectsError(EFFECTS_ERRORS.REPLAY, 'مفتاحُ تكرارٍ مُستعمَل');
    this.seen.add(token.idempotency_key);
    this.highestEpoch = Math.max(this.highestEpoch, token.epoch);
    this.accepted.push({ token, message });
    return true;
  }
}

// ── الخطوة 11 ────────────────────────────────────────────────────────────────

/**
 * @param {{ scopes?: CgroupScope[], egress?: HaltFencedTransport[], extra?: Array<() => Promise<{ name: string, ok: boolean, detail?: unknown }>> }} parts
 * @returns {{ stop(): Promise<{ ok: boolean, detail: Record<string, unknown> }> }}
 */
export function buildEffectsStopper(parts) {
  return {
    async stop() {
      const egress = (parts.egress ?? []).map((gate) => gate.close());
      const scopes = [];
      for (const scope of parts.scopes ?? []) scopes.push(await scope.kill());
      const extra = [];
      for (const fn of parts.extra ?? []) extra.push(await fn());
      const ok =
        egress.every((e) => e.ok) &&
        scopes.every((s) => s.ok) &&
        extra.every((e) => e.ok) &&
        (parts.scopes ?? []).length + (parts.egress ?? []).length + (parts.extra ?? []).length > 0;
      return { ok, detail: { egress, scopes, extra } };
    },
  };
}
