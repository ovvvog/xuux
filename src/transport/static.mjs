/**
 * خدمةُ ملفّاتِ الواجهةِ — سدادُ `D-1`، وبلا اعتمادِ npm واحدٍ (عهدُ `M10`).
 *
 * خادمُ ملفّاتٍ مكتوبٌ يداً موضعُ عَيبٍ مشهورٍ واحدٍ: **الخروجُ من الجذرِ**
 * (`../../etc/passwd` وصورُه المُرمَّزةُ). فالحمايةُ هنا ليست بترشيحِ نصٍّ — لأنّ
 * الترشيحَ يُخدَعُ بترميزٍ — بل بـ**تحقيقِ المسارِ ثمَّ التحقُّقِ أنّه تحتَ الجذرِ
 * حقّاً** بعدَ التحقيقِ. وما لم يكنْ تحتَه لا يُخدَمُ ولو كان موجوداً.
 *
 * وثانياً: **لا يُخدَمُ إلا ما امتدادُه مُعلَنٌ** بنوعِه. فامتدادٌ مجهولٌ يُخدَمُ
 * بنوعٍ مخمَّنٍ باب رفعِ محتوىً يُنفَّذُ في المتصفِّحِ، ولا حاجةَ إليه أصلاً.
 */

import fs from 'node:fs';
import path from 'node:path';

/** الأنواعُ المُعلَنةُ — وما ليس فيها لا يُخدَمُ. */
const TYPE_BY_EXTENSION = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
});

// ولا `.json` في القائمةِ عن قصدٍ: بياناتُ الدولةِ لا تُخدَمُ ملفّاتٍ ساكنةً بحالٍ.
// كلُّ بياناتٍ تمرُّ بالبوابةِ وعقباتِها الخمسِ، فملفُّ JSON ساكنٌ بابُ نسخةٍ من
// البياناتِ تُقرأُ بلا جلسةٍ ولا تفويضٍ ولا قيدٍ في سجلِّ الأحداثِ.

/**
 * يحلُّ عنواناً وارداً إلى ملفٍّ تحتَ الجذرِ، أو `null` إن لم يجزْ.
 * @param {string} root الجذرُ المُعلَنُ (مسارٌ مُطلَقٌ).
 * @param {string} pathname
 * @returns {{ file: string, type: string } | null}
 */
export function resolveStaticFile(root, pathname) {
  const rootReal = path.resolve(root);
  const requested = pathname === '/' ? '/index.html' : pathname;
  // `decodeURIComponent` قبلَ التحقيقِ لا بعدَه: ترميزٌ مثلُ `%2e%2e` يُفَكُّ هنا
  // فيراهُ التحقيقُ صعوداً، ولو فُكَّ بعدَ التحقيقِ لعبرَ.
  /** @type {string} */
  let decoded;
  try {
    decoded = decodeURIComponent(requested);
  } catch {
    return null;
  }
  if (decoded.includes('\u0000')) return null;
  const candidate = path.resolve(rootReal, `.${path.posix.normalize(decoded)}`);
  // التحقُّقُ بعدَ التحقيقِ: يجبُ أن يكونَ الناتجُ الجذرَ نفسَه أو تحتَه بفاصلٍ.
  if (candidate !== rootReal && !candidate.startsWith(rootReal + path.sep)) return null;
  const types = /** @type {Readonly<Record<string, string>>} */ (TYPE_BY_EXTENSION);
  const type = types[path.extname(candidate).toLowerCase()];
  if (type === undefined) return null;
  let stat;
  try {
    stat = fs.statSync(candidate);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  return { file: candidate, type };
}
