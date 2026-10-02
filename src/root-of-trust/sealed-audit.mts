// src/root-of-trust/sealed-audit.mts
//
// `WL-303`: سجلُّ الإنتاجِ مختومٌ ويرفضُ الإلحاقَ المتزامنَ (‏`SEALED_LOG_REQUIRES_ASYNC_APPEND`)،
// وسلسلةُ الإنفاذِ (‏الهويّةُ، السجلُّ، نقطةُ الإنفاذ) تُلحِقُ متزامنةً. فكانت كلُّ
// محاولةِ تفويضٍ في الإنتاجِ تسقطُ قبلَ أن تبلغَ السياسةَ — فشلٌ مغلقٌ صحيحٌ، لكنّه
// لا يتركُ مساراً مشروعاً، ولا يُقاسُ عليه أنّ حدَّ السلطةِ يعمل.
//
// هذا المُحوِّلُ يُلحِقُ كلَّ واقعةٍ **مختومةً بترتيبِها** (‏سلسلةُ وعودٍ واحدة)،
// و`flush()` ينتظرُ آخرَها ويرفعُ أوّلَ فشلٍ. ومن يُصدِرُ أثراً (‏تذكرةَ قرار) **ينتظرُ
// `flush()` قبلَ الإصدار**: لا أثرَ قبلَ أن يُختَمَ قيدُه. وبعدَ أوّلِ فشلٍ يُرفَضُ
// كلُّ إلحاقٍ تالٍ — فلا يمضي السجلُّ بثقبٍ صامت.

export interface SealedLogLike {
  appendSealed(type: string, actor: string, data: object): Promise<unknown>;
}

export interface SealedAudit {
  append(type: string, actor: string, data: object): void;
  appendSealed(type: string, actor: string, data: object): Promise<unknown>;
  flush(): Promise<void>;
  readonly sealed: SealedLogLike;
}

/**
 * يلفُّ سجلّاً مختوماً بإلحاقٍ متزامنِ الواجهةِ مرتَّبٍ يُنتظَرُ بـ`flush`.
 * @param log - السجلُّ المختوم
 * @returns المُحوِّل
 */
export function sealedAudit(log: SealedLogLike): SealedAudit {
  if (typeof log?.appendSealed !== 'function') throw new Error('SEALED_AUDIT_LOG_REQUIRED');
  let tail: Promise<unknown> = Promise.resolve();
  let failure: unknown = null;
  const enqueue = (type: string, actor: string, data: object): Promise<unknown> => {
    if (failure !== null) return Promise.reject(failure);
    const write = tail.then(() => log.appendSealed(type, actor, data));
    tail = write.then(
      () => undefined,
      (error: unknown) => {
        failure = failure ?? error;
      },
    );
    return write;
  };
  return {
    sealed: log,
    append(type, actor, data) {
      if (failure !== null) throw failure;
      enqueue(type, actor, data).catch(() => undefined);
    },
    appendSealed: enqueue,
    async flush() {
      await tail;
      if (failure !== null) throw failure;
    },
  };
}
