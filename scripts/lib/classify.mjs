// منطق التصنيف المشترك بين أداة الجرد (M1.01) وحاجز القوالب (M1.08).
// مصدر واحد للحقيقة: أي تعديل على قواعد التصنيف يسري على الأداتين معاً.

import path from 'node:path';

export const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'dist', 'build', 'coverage']);

export const CODE_EXT = new Set(['.ts', '.tsx', '.mjs', '.cjs', '.js', '.jsx', '.py', '.sh']);
export const DATA_EXT = new Set(['.yaml', '.yml', '.json', '.sql', '.csv', '.toml', '.ini']);
export const DOC_EXT = new Set(['.md', '.txt', '.rst', '.adoc']);
export const DOC_NAMES = new Set(['LICENSE', 'CODEOWNERS', 'NOTICE', 'AUTHORS']);
export const DATA_NAMES = new Set([
  '.gitignore',
  '.gitattributes',
  '.nvmrc',
  '.editorconfig',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierignore',
  '.eslintignore',
  '.npmrc',
  '.dockerignore',
]);

// بصمة القوالب المولّدة، مستخلصة من فحص الشجرة الفعلية لا من الافتراض:
// كل سطر مستقل يبدأ بـ «الحالة: » في هذا المستودع كان أحد 12 صيغة مولّدة آلياً،
// ومجموع تلك الصيغ ساوى تماماً عدد الملفات الحاوية لها (12,804)، فلا إيجاب زائف.
export const TEMPLATE_LINE_RE = /^الحالة:\s/m;
export const TEMPLATE_TITLE_RE = /^#\s*تعريف\s/m;
export const TEMPLATE_LEAK_RE = /domain name ar/;

/** إزالة التعليقات والأسطر الفارغة، وإرجاع الأسطر الجوهرية. */
export function substantiveLines(text, ext) {
  const lineComment =
    ext === '.sql' ? ['--'] : ext === '.py' || ext === '.sh' ? ['#'] : ['//', '#'];
  let body = text;
  if (!['.py', '.sh', '.yaml', '.yml'].includes(ext)) {
    body = body.replace(/\/\*[\s\S]*?\*\//g, '');
  }
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !lineComment.some((c) => l.startsWith(c)))
    .filter((l) => l !== '---' && l !== '...');
}

/** هل النص يحمل بصمة قالب مولّد؟ */
export function hasTemplateSignature(text) {
  return TEMPLATE_LINE_RE.test(text) || TEMPLATE_TITLE_RE.test(text) || TEMPLATE_LEAK_RE.test(text);
}

/**
 * يصنّف ملفاً إلى إحدى أربع فئات حصرية: real | data | doc | template
 * @returns {{category:'real'|'data'|'doc'|'template', reason:string, substantive:number}}
 */
export function classify(relPath, text) {
  const base = path.basename(relPath);
  const ext = path.extname(base).toLowerCase();
  const sub = substantiveLines(text, ext);
  const n = sub.length;

  if (CODE_EXT.has(ext)) {
    return n > 0
      ? { category: 'real', reason: `كود فيه ${n} سطر جوهري`, substantive: n }
      : { category: 'template', reason: 'ملف كود لا يحتوي إلا تعليقات', substantive: 0 };
  }
  if (DATA_EXT.has(ext) || DATA_NAMES.has(base)) {
    return n > 0
      ? { category: 'data', reason: `بيانات فيها ${n} سطر جوهري`, substantive: n }
      : { category: 'template', reason: 'ملف بيانات لا يحتوي إلا تعليقات', substantive: 0 };
  }
  if (DOC_EXT.has(ext) || DOC_NAMES.has(base)) {
    if (hasTemplateSignature(text)) {
      return { category: 'template', reason: 'وثيقة تحمل بصمة قالب مولّد', substantive: n };
    }
    return n > 0
      ? { category: 'doc', reason: `وثيقة يقرأها إنسان (${n} سطر)`, substantive: n }
      : { category: 'template', reason: 'وثيقة فارغة فعلياً', substantive: 0 };
  }
  return n > 0
    ? {
        category: 'data',
        reason: `امتداد غير مصنّف (${ext || 'بلا امتداد'}) فيه محتوى`,
        substantive: n,
      }
    : {
        category: 'template',
        reason: `امتداد غير مصنّف (${ext || 'بلا امتداد'}) بلا محتوى`,
        substantive: 0,
      };
}
