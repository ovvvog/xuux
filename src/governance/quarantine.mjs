/**
 * الحجر الصحّي التلقائي — M6.09
 *
 * العيب الذي يعالجه: كانت الشذوذات تُرفض واحدةً واحدة — رفضُ خروج، تبدّلُ بصمة،
 * منعُ سياسة — ثم يُترك الفاعل يعيد المحاولة إلى ما لا نهاية. فالرفض المتكرّر
 * كان يُسجَّل ولا يُغيّر شيئاً، ومعنى ذلك أن الحاجز يقيس الاعتداء ولا يوقفه.
 *
 * فالحاجب هنا يجمع الإشارات ويعزل تلقائياً عند العتبة، ويفتح حادثة في السجل.
 * والقرارات المقصودة فيه أربعة:
 *
 *   1. **العتبة لكل نوع لا عتبة واحدة**: تبدّلُ بصمة أوزانٍ شذوذٌ من المرّة
 *      الأولى، ورفضُ خروجٍ قد يكون خطأ إعداد فيُحتمل مرّات معدودة. عتبةٌ واحدة
 *      تعني إما عزلاً على خطأٍ بريء أو تسامحاً مع اعتداء بيّن.
 *   2. **الإشارة المجهولة تُرفض بخطأ مُسمّى** لا تُتجاهل: حاجبٌ يهمل ما لا يعرف
 *      يصير مسارَ تمريرٍ لكل شذوذ جديد لم يُسجَّل نوعه بعد.
 *   3. **العزل قبل انتظار نتيجة العازل**: الحالة تُحدَّث في الحاجب فوراً، ثم
 *      يُنفَّذ العزل الدائم (تعليق الهوية في القاعدة) وقد يفشل فيُسجَّل فشله —
 *      والمحجور يبقى محجوراً. فشل العازل لا يُقرأ إذناً.
 *   4. **الإخراج من الحجر بسبب مسجَّل وبيدٍ بشرية**: لا يخرج المحجور تلقائياً
 *      بمرور الوقت، وإلا صار الحجر تأجيلاً لا قراراً.
 *
 * حدود معلنة: العدّادات وحالة الحجر في الذاكرة. وحالةُ الحجرِ في الإنتاجِ تُعادُ عندَ
 * الإقلاعِ من السجلِّ المختومِ (‏`quarantineFromSealedLog` ثمّ `restore`، `R6-A-05`،
 * `WL-305`)؛ والعدّاداتُ دونَ العتبةِ تُصفَّرُ بإعادةِ التشغيلِ عمداً (‏نافذةٌ زمنيّة).
 * والحاجب لا يقطع اتصالاً جارياً ولا يقتل عملية — ذلك عزلٌ حقيقي (M6.04) وهو غير
 * منفَّذ.
 */

import { IncidentSeverity } from '../identity/incident-register.mjs';

const DEFAULT_WINDOW_MS = 600_000;

export const QUARANTINE_ERRORS = Object.freeze({
  DEPENDENCY_MISSING: 'QUARANTINE_DEPENDENCY_MISSING',
  SIGNAL_KIND_UNKNOWN: 'QUARANTINE_SIGNAL_KIND_UNKNOWN',
  SUBJECT_REQUIRED: 'QUARANTINE_SUBJECT_REQUIRED',
  RELEASE_REASON_REQUIRED: 'QUARANTINE_RELEASE_REASON_REQUIRED',
  NOT_QUARANTINED: 'QUARANTINE_SUBJECT_NOT_QUARANTINED',
  REPORT_REQUIRES_SEALED: 'QUARANTINE_REPORT_REQUIRES_SEALED',
});

/** خطأ مُسمّى: الرمز للأتمتة والنص للقارئ. */
export class QuarantineError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'QuarantineError';
    /** @type {string} */
    this.code = code;
  }
}

/**
 * أنواع الشذوذ المعروفة بعتباتها وخطورتها. القيم بياناتٌ في مكان واحد كي يكون
 * تعديل العتبة تعديلَ سطرٍ مقروء لا تعديلَ منطق موزَّع.
 * @type {Readonly<Record<string, { threshold: number, severity: string, reason: string }>>}
 */
export const ANOMALY_KINDS = Object.freeze({
  'model-fingerprint-mismatch': Object.freeze({
    threshold: 1,
    severity: IncidentSeverity.CRITICAL,
    reason: 'بصمة أوزان النموذج لا تطابق المسجَّل عند التنشيط',
  }),
  'identity-unverified': Object.freeze({
    threshold: 1,
    severity: IncidentSeverity.CRITICAL,
    reason: 'هوية الفاعل لا يؤكّدها جذر الثقة',
  }),
  'clearance-denied': Object.freeze({
    threshold: 3,
    severity: IncidentSeverity.HIGH,
    reason: 'محاولات وصولٍ إلى بيانات بلا تخليص كافٍ — تكرارُها مسحٌ لا خطأ',
  }),
  'egress-refused': Object.freeze({
    threshold: 3,
    severity: IncidentSeverity.HIGH,
    reason: 'محاولات خروج خارجي مرفوضة متكرّرة',
  }),
  'authorization-denied': Object.freeze({
    threshold: 10,
    severity: IncidentSeverity.MEDIUM,
    reason: 'رفضُ تفويضٍ متكرّر يشبه المسح لا الخطأ',
  }),
  'budget-exceeded': Object.freeze({
    threshold: 3,
    severity: IncidentSeverity.MEDIUM,
    reason: 'تجاوز ميزانية التنفيذ مرّات متتابعة',
  }),
});

export class QuarantineWarden {
  /**
   * @param {{ incidents?: { open: (spec: { type: string, subject: string, severity?: any, detail?: Record<string, unknown> }) => { id: string }, close: (id: string, reason: string) => unknown }, log?: { append: (type: string, actor: string, payload: object) => unknown }, isolate?: ((subject: string, reason: string) => Promise<unknown>) | null, thresholds?: Record<string, number>, windowMs?: number, now?: () => Date }} [deps]
   */
  constructor({ incidents, log, isolate = null, thresholds = {}, windowMs, now } = {}) {
    if (!incidents || !log) {
      throw new QuarantineError(
        QUARANTINE_ERRORS.DEPENDENCY_MISSING,
        'الحجر يحتاج سجل حوادث وسجل أحداث: عزلٌ بلا حادثةٍ مفتوحة عزلٌ لا يراجعه أحد.',
      );
    }
    this.incidents = incidents;
    this.log = log;
    this.isolate = isolate;
    this.windowMs = windowMs ?? DEFAULT_WINDOW_MS;
    this.now = now ?? (() => new Date());
    /** @type {Record<string, number>} عتبات تتغلّب على المعلَنة لكل نوع */
    this.thresholds = { ...thresholds };
    /** @type {Map<string, number[]>} أوقات الإشارات لكل «نوع|موضوع» */
    this.signals = new Map();
    /** @type {Map<string, { incidentId: string, kind: string, at: string }>} */
    this.quarantined = new Map();
    /** @type {Set<string>} محجورونَ أُعيدوا من السجلِّ المختومِ (‏`R6-A-05`) */
    this.restoredSubjects = new Set();
    /** `LIVE-27`: سجلٌّ مختومٌ مؤجَّلٌ (‏`sealedAudit`) — الإبلاغُ فيه يُنتظَرُ ختمُه. */
    const candidate = /** @type {{ flush?: unknown, appendSealed?: unknown }} */ (
      /** @type {unknown} */ (log)
    );
    this.sealedLog =
      typeof candidate.flush === 'function' && typeof candidate.appendSealed === 'function';
    /** @type {Promise<unknown>[]} أعمال العزل الجارية؛ تُنتظر بـ`settle` */
    this.pending = [];
  }

  /**
   * العتبة الفعلية لنوعٍ ما.
   * @param {string} kind
   * @returns {number}
   */
  thresholdFor(kind) {
    const declared = ANOMALY_KINDS[kind];
    if (declared === undefined) {
      throw new QuarantineError(
        QUARANTINE_ERRORS.SIGNAL_KIND_UNKNOWN,
        `نوع الشذوذ «${kind}» غير معلَن في ANOMALY_KINDS؛ الحاجب لا يتجاهل ما لا يعرف.`,
      );
    }
    return this.thresholds[kind] ?? declared.threshold;
  }

  /**
   * @param {string} subject
   * @returns {boolean}
   */
  isQuarantined(subject) {
    return this.quarantined.has(subject);
  }

  /**
   * يبلّغ عن شذوذ. يعيد ما جرى: عدد الإشارات في النافذة، وهل عُزل الموضوع الآن.
   * @param {{ kind: string, subject: string, detail?: Record<string, unknown> }} signal
   * @returns {{ kind: string, subject: string, count: number, threshold: number, isolated: boolean, incidentId: string | null }}
   */
  report(signal) {
    // `LIVE-27` (‏`WL-306`): على السجلِّ المختومِ (‏مُحوِّلُ `sealedAudit` في الإنتاج) يُرجِعُ الإبلاغُ
    // المتزامنُ قبلَ أن يُختَمَ قيدُ `quarantine.isolated`، فما يقعُ بعدَ رجوعِه (‏سقوطُ العمليّةِ،
    // فقدُ التوكن) يُسقِطُ القيدَ ويُطلِقُ المحجورَ بالإقلاعِ التالي. فيُرَدُّ هنا قبلَ أيِّ أثرٍ،
    // والمسارُ في الإنتاجِ `reportSealed` — كما رُدَّ `CrownGateway.command` في `WL-304`.
    if (this.sealedLog) {
      throw new QuarantineError(
        QUARANTINE_ERRORS.REPORT_REQUIRES_SEALED,
        'السجلُّ مختومٌ: الإبلاغُ يُنتظَرُ ختمُه (`reportSealed`) ولا يُرجَعُ قبلَه.',
      );
    }
    return this.#record(signal);
  }

  /**
   * `LIVE-27` (‏`WL-306`): الإبلاغُ نفسُه (‏العتبةُ والحادثةُ والحالةُ في الذاكرةِ فوراً)، ثمّ
   * **ينتظرُ ختمَ** قيودِه بالترتيب (‏`quarantine.signal` ثمّ `quarantine.isolated`) قبلَ أن يُرجِع.
   * وفشلُ الختمِ يُرفَعُ ولا يُخرِجُ أحداً: المحجورُ يبقى محجوراً في الذاكرة، والمُحوِّلُ يرفضُ
   * كلَّ إلحاقٍ بعدَه (‏فشلٌ مغلقٌ للنظام).
   * @param {{ kind: string, subject: string, detail?: Record<string, unknown> }} signal
   * @returns {Promise<{ kind: string, subject: string, count: number, threshold: number, isolated: boolean, incidentId: string | null }>}
   */
  async reportSealed(signal) {
    const result = this.#record(signal);
    const sealed = /** @type {{ flush?: () => Promise<void> }} */ (
      /** @type {unknown} */ (this.log)
    );
    if (typeof sealed.flush === 'function') await sealed.flush();
    return result;
  }

  /**
   * جسمُ الإبلاغِ المشتركُ بين المسارَين.
   * @param {{ kind: string, subject: string, detail?: Record<string, unknown> }} signal
   * @returns {{ kind: string, subject: string, count: number, threshold: number, isolated: boolean, incidentId: string | null }}
   */
  #record({ kind, subject, detail = {} }) {
    if (typeof subject !== 'string' || subject.trim() === '') {
      throw new QuarantineError(
        QUARANTINE_ERRORS.SUBJECT_REQUIRED,
        'الإشارة بلا موضوع لا تُعزل أحداً ولا تُراجع.',
      );
    }
    const threshold = this.thresholdFor(kind);
    const nowMs = this.now().getTime();
    const key = `${kind}|${subject}`;
    const window = (this.signals.get(key) ?? []).filter((at) => at > nowMs - this.windowMs);
    window.push(nowMs);
    this.signals.set(key, window);
    const count = window.length;
    this.log.append('quarantine.signal', subject, { kind, count, threshold, ...detail });

    const existing = this.quarantined.get(subject);
    if (existing !== undefined) {
      // المحجور يبقى محجوراً بحادثته الأولى: حادثةٌ جديدة لكل إشارة تُغرق الفرز.
      return { kind, subject, count, threshold, isolated: false, incidentId: existing.incidentId };
    }
    if (count < threshold) {
      return { kind, subject, count, threshold, isolated: false, incidentId: null };
    }

    const declared = /** @type {{ severity: string, reason: string }} */ (ANOMALY_KINDS[kind]);
    const incident = this.incidents.open({
      type: `quarantine:${kind}`,
      subject,
      severity: declared.severity,
      detail: { ...detail, kind, count, threshold, reason: declared.reason },
    });
    this.quarantined.set(subject, {
      incidentId: incident.id,
      kind,
      at: this.now().toISOString(),
    });
    this.log.append('quarantine.isolated', subject, {
      kind,
      count,
      threshold,
      incidentId: incident.id,
      severity: declared.severity,
    });
    if (this.isolate !== null) {
      const reason = `${declared.reason} (${count}/${threshold})`;
      this.pending.push(
        Promise.resolve(this.isolate(subject, reason)).catch((error) => {
          // فشل العزل الدائم لا يُقرأ إذناً: الحالة في الحاجب تبقى محجورة،
          // والفشل يُسجَّل كي يُرى لا كي يُنسى.
          this.log.append('quarantine.isolation-failed', subject, {
            kind,
            incidentId: incident.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }),
      );
    }
    return { kind, subject, count, threshold, isolated: true, incidentId: incident.id };
  }

  /**
   * ينتظر أعمال العزل الجارية. للاختبار ولمن يريد ضماناً قبل الإجابة.
   * @returns {Promise<void>}
   */
  async settle() {
    const pending = this.pending;
    this.pending = [];
    await Promise.all(pending);
  }

  /**
   * يخرج موضوعاً من الحجر بسبب مسجَّل ويغلق حادثته.
   * @param {string} subject
   * @param {string} reason
   * @returns {{ subject: string, incidentId: string }}
   */
  release(subject, reason) {
    const current = this.quarantined.get(subject);
    if (current === undefined) {
      throw new QuarantineError(
        QUARANTINE_ERRORS.NOT_QUARANTINED,
        `الموضوع ${subject} ليس محجوراً؛ إخراجُ من ليس محجوراً يُخفي خطأً في الفرز.`,
      );
    }
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new QuarantineError(
        QUARANTINE_ERRORS.RELEASE_REASON_REQUIRED,
        'الإخراج من الحجر بلا سبب مسجَّل لا يُراجع.',
      );
    }
    // `R6-A-05` (‏`WL-305`): محجورٌ أُعيدَ من السجلِّ المختومِ بعدَ إعادةِ التشغيلِ حادثتُه
    // في السجلِّ لا في سجلِّ الحوادثِ الحيِّ؛ فلا يُحبَسُ أبداً لغيابِها — يُخرَجُ بالسببِ
    // المسجَّلِ نفسِه، وإغلاقُ ما في الذاكرةِ يبقى لمن لم يُستعَد.
    if (this.restoredSubjects.has(subject)) {
      try {
        this.incidents.close(current.incidentId, reason);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'INCIDENT_NOT_FOUND') throw error;
      }
      this.restoredSubjects.delete(subject);
    } else {
      this.incidents.close(current.incidentId, reason);
    }
    this.quarantined.delete(subject);
    for (const key of [...this.signals.keys()]) {
      if (key.endsWith(`|${subject}`)) this.signals.delete(key);
    }
    this.log.append('quarantine.released', subject, {
      incidentId: current.incidentId,
      kind: current.kind,
      reason,
    });
    return { subject, incidentId: current.incidentId };
  }

  /**
   * قائمة المحجورين الآن.
   * @returns {Array<{ subject: string, kind: string, incidentId: string, at: string }>}
   */
  list() {
    return [...this.quarantined.entries()].map(([subject, entry]) => ({ subject, ...entry }));
  }

  /**
   * لقطةٌ من حالة الحجر تُستعمَلُ لإعادةِ البناءِ بعدَ إعادةِ التشغيلِ (R6-A-05).
   * تُعيدُ قائمةً من المحجورين بتفاصيلهم. لا تُخزَّنُ الإشاراتُ (signals)
   * لأنّها نافذةٌ زمنيّةٌ تنتهي، والمحجورُ هو من يدوم.
   * @returns {Array<{ subject: string, kind: string, incidentId: string, at: string }>}
   */
  snapshot() {
    return [...this.quarantined.entries()].map(([subject, entry]) => ({ subject, ...entry }));
  }

  /**
   * يُعيدُ بناءَ حالة الحجر من لقطةٍ بعدَ إعادةِ التشغيلِ (R6-A-05).
   * يُسجِّلُ كلَّ مستردٍّ في سجلِّ الأحداثِ بـ`quarantine.restored`.
   * @param {ReadonlyArray<{ subject: string, kind: string, incidentId?: string, at?: string }>} entries
   * @returns {number} عددُ المسترجَعين
   */
  restore(entries) {
    if (!Array.isArray(entries)) return 0;
    let count = 0;
    for (const entry of entries) {
      if (!entry || typeof entry.subject !== 'string' || typeof entry.kind !== 'string') continue;
      if (this.quarantined.has(entry.subject)) continue;
      this.restoredSubjects.add(entry.subject);
      this.quarantined.set(entry.subject, {
        incidentId: entry.incidentId ?? '',
        kind: entry.kind,
        at: entry.at ?? this.now().toISOString(),
      });
      this.log.append('quarantine.restored', entry.subject, {
        kind: entry.kind,
        incidentId: entry.incidentId ?? '',
      });
      count++;
    }
    return count;
  }
}

/**
 * @param {ConstructorParameters<typeof QuarantineWarden>[0]} deps
 * @returns {QuarantineWarden}
 */
export function createQuarantineWarden(deps) {
  return new QuarantineWarden(deps);
}
