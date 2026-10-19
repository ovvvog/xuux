// WL-421 — محمِّلُ ESM للمقارنةِ قبل/بعد: يستبدلُ مساعدَ دورةِ حياةِ swtpm الذي يستوردُه ملفُّ الاختبارِ
// بالمساعدِ في XUUX_OLD_HELPER (مسارٌ مطلق)، دونَ لمسِ ملفِّ الاختبارِ نفسِه.
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('/helpers/ceremony-swtpm.mjs') && process.env.XUUX_OLD_HELPER) {
    return { url: 'file://' + process.env.XUUX_OLD_HELPER, shortCircuit: true };
  }
  return next(specifier, context);
}
