/**
 * استخراجُ مواضع نشر الأحداث من الشيفرة نفسها — الخطوة `M7.07`.
 *
 * لماذا مُستخرَجاً لا مكتوباً بيد؟ لأن عقدَ قناةٍ يُكتب بيدٍ ويُقاس بيدٍ عقدٌ
 * على الورق: يجفّ حين يُضيف أحدٌ حقلاً إلى `log.append(...)` ولا يُحدِّث الملف،
 * فيصير المستهلك يقرأ حقلاً غيرَ معلَنٍ في العقد أو يفتقد حقلاً معلَناً. فالمصدرُ
 * هنا **الشيفرة**: نُحلِّل شجرتها (لا نطابق نصّها بتعبيرٍ نمطي) ونستخرج لكل نداءٍ
 * نوعَ الحدث ومفاتيح حِمْله، ثم يُقايس الحاجزُ ذلك بالعقود المعلَنة في
 * `config/events.yaml`. فأي انحرافٍ بين ما تنشره الشيفرة وما يعلنه العقد يسقط
 * في `npm run validate` لا في الإنتاج.
 *
 * **وحدودُه معلَنة:** ما لا يكون نوعُه نصاً حرفياً (قوالبُ نصّية مثل
 * `` `agent.${state}` ``) يُستخرج **نمطاً** (`agent.*`) لا نوعاً واحداً، وما لا
 * يكون حِمْلُه كائناً حرفياً (متغيّرٌ أو نشرٌ `...`) يُعلَن **مفتوحاً**
 * (`payloadOpen`) فيُعفى من مقايسة المفاتيح ويبقى مقيساً على أن نوعه معلَن. أي
 * أن الاستخراج **لا يزعم** معرفةَ ما لا يستطيع قراءته سكونياً.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * @typedef {object} EventEmission
 * @property {string} type نوع الحدث، أو نمطٌ ينتهي بـ`.*` إن كان قالباً نصّياً.
 * @property {boolean} pattern هل النوع نمطٌ لا نصٌّ حرفي.
 * @property {string[]} payloadKeys مفاتيح الحِمْل المقروءة سكونياً.
 * @property {boolean} payloadOpen حِمْلٌ لا يُقرأ سكونياً (متغيّر أو نشر).
 * @property {string} file المسار النسبي.
 * @property {number} line رقم السطر (من 1).
 */

/** الملفات التي لا تُقرأ: مُخرَجات البناء ونظائرُها المصدرية المزدوجة. */
const SKIP_SUFFIXES = Object.freeze(['.d.mts', '.mjs.map', '.js.map']);

/**
 * يجمع ملفات المصدر القابلة للتحليل تحت مجلد.
 * @param {string} dir
 * @param {string} root
 * @returns {string[]}
 */
function collectSources(dir, root) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectSources(full, root));
      continue;
    }
    if (SKIP_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
    if (!entry.name.endsWith('.mjs') && !entry.name.endsWith('.mts')) continue;
    // ملفُ `.mjs` مولَّدٌ من `.mts` مجاورٍ له: يُقرأ المصدر وحده كي لا يُحصى
    // الموضعُ مرّتين فيبدو الانحرافُ ضِعف حجمه.
    if (entry.name.endsWith('.mjs')) {
      const twin = full.replace(/\.mjs$/, '.mts');
      if (found.includes(twin) || existsQuiet(twin)) continue;
    }
    found.push(full);
  }
  return found.map((path) => path).sort();
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function existsQuiet(path) {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * يستخرج نصّ النوع من الوسيط الأول: نصاً حرفياً أو نمطاً من قالب.
 * @param {ts.Expression} node
 * @returns {{ type: string, pattern: boolean }[]}
 */
function readTypeArgument(node) {
  if (ts.isStringLiteralLike(node)) return [{ type: node.text, pattern: false }];
  if (ts.isTemplateExpression(node)) {
    const head = node.head.text;
    // قالبٌ بلا بادئةٍ ثابتة لا يُنسب إلى قناة، فيُعلَن نمطاً عامّاً يسقط في الحاجز.
    return [{ type: `${head}*`, pattern: true }];
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) return [{ type: node.text, pattern: false }];
  if (ts.isConditionalExpression(node)) {
    return [...readTypeArgument(node.whenTrue), ...readTypeArgument(node.whenFalse)];
  }
  return [];
}

/**
 * يستخرج مفاتيح الحِمْل من الوسيط الثالث.
 * @param {ts.Expression | undefined} node
 * @returns {{ keys: string[], open: boolean }}
 */
function readPayloadArgument(node) {
  if (node === undefined) return { keys: [], open: false };
  if (!ts.isObjectLiteralExpression(node)) return { keys: [], open: true };
  /** @type {string[]} */
  const keys = [];
  let open = false;
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      open = true;
      continue;
    }
    const name = property.name;
    if (name === undefined) continue;
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) keys.push(name.text);
    else open = true;
  }
  return { keys: keys.sort(), open };
}

/**
 * يقرأ مواضع نشر الأحداث في شجرة مصدر.
 * @param {string} root جذر المستودع.
 * @param {string} [sourceDir] مجلد المصدر.
 * @returns {EventEmission[]}
 */
export function collectEventEmissions(root, sourceDir = join(root, 'src')) {
  /** @type {EventEmission[]} */
  const emissions = [];
  for (const file of collectSources(sourceDir, root)) {
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true);
    /** @param {ts.Node} node */
    const walk = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'append' &&
        node.arguments.length >= 3
      ) {
        const types = readTypeArgument(/** @type {ts.Expression} */ (node.arguments[0]));
        if (types.length > 0) {
          const payload = readPayloadArgument(/** @type {ts.Expression} */ (node.arguments[2]));
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          for (const entry of types) {
            emissions.push({
              type: entry.type,
              pattern: entry.pattern,
              payloadKeys: payload.keys,
              payloadOpen: payload.open,
              file: relative(root, file),
              line: line + 1,
            });
          }
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
  }
  return emissions.sort((a, b) => a.type.localeCompare(b.type) || a.file.localeCompare(b.file));
}
