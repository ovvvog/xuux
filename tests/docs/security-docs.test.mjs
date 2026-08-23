// حرس صدق الوثائق الأمنية — الخطوة M2.10.
//
// المشكلة التي يحلّها: وثيقة أمنية تُكتب مرة ثم يتقدّم الكود دونها فتصير تصف
// ماضياً — وهذا ما وقع فعلاً في `docs/ROOT_OF_TRUST.md` (أربعة عشر سطراً تقول
// «نواة محلية أولية» بعد السجل الدائم والتثبيت والدفتر والإيقاف والساعة). ووثيقةٌ
// كاذبة أسوأ من غيابها لأنها تُطمئن.
//
// فالحل ليس مراجعةً دورية بالنية، بل **ربط الوثيقة بشيء يفشل**: كل مسار مذكور
// فيها يجب أن يوجد، وكل رمز خطأ يجب أن يكون في المصدر، وكل `npm run` يجب أن يكون
// في `package.json`، وكل صف تهديد يجب أن يحمل ضابطاً ودليلاً وخطراً متبقياً.
// فمن حذف ضابطاً أو أعاد تسمية رمزه كسر البوابة ولم يترك الوثيقة تكذب بصمت.
//
// التشغيل: node --test tests/docs/security-docs.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** الوثائق الثلاث التي يطلبها معيار M2.10 بأسمائها. */
const DOCS = ['SECURITY.md', 'docs/THREAT_MODEL.md', 'docs/ROOT_OF_TRUST.md'];

/** @param {string} rel */
function readDoc(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** كل ما بين علامتي ` في نص. @param {string} text @returns {string[]} */
function backticked(text) {
  return [...text.matchAll(/`([^`\n]+)`/g)].map((m) => /** @type {string} */ (m[1]));
}

/** مصدرُ الحقيقة الذي تُقاس عليه الرموز: الكود نفسه لا وثيقةٌ أخرى. */
function sourceCorpus() {
  const files = execFileSync(
    'git',
    ['ls-files', 'src', 'scripts', 'tests', 'package.json', 'tsconfig.json'],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .split('\n')
    .filter((line) => line.length > 0);
  return files.map((file) => readFileSync(join(ROOT, file), 'utf8')).join('\n');
}

/**
 * صفوف جدول Markdown داخل قسمٍ يبدأ بعنوانه: تُرجع الخلايا مقصوصة.
 * @param {string} text - نص الوثيقة
 * @param {string} idPrefix - بادئة المعرّف في العمود الأول (مثل `T` أو `A`)
 * @returns {string[][]} صفوف، كل صف مصفوفة خلايا
 */
function tableRows(text, idPrefix) {
  const rows = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed
      .slice(1, trimmed.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((cell) => cell.trim());
    const first = cells[0];
    if (first && new RegExp(`^${idPrefix}\\d+$`).test(first)) rows.push(cells);
  }
  return rows;
}

test('الوثائق الأمنية الثلاث موجودة ولها متنٌ حقيقي لا عنوانٌ فارغ', () => {
  for (const rel of DOCS) {
    assert.ok(existsSync(join(ROOT, rel)), `مفقودة: ${rel}`);
    const text = readDoc(rel);
    const substantive = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line !== '---');
    // الحدّ ليس جمالياً: وثيقة أمنية دون ستين سطراً جوهرياً لا تحمل نموذج تهديد
    // ولا إجراءات طوارئ، وكانت هذه بالضبط حالة `ROOT_OF_TRUST.md` قبل M2.10.
    assert.ok(substantive.length >= 60, `${rel}: ${substantive.length} سطراً جوهرياً فقط`);
  }
});

test('لا صيغ قوالب ولا فراغات مؤجَّلة في الوثائق الأمنية', () => {
  // «سيُكتب لاحقاً» في وثيقة أمنية هو أسوأ من غيابها: يُقرأ ضابطاً موجوداً.
  const forbidden = [/\bTODO\b/, /\bTBD\b/, /\bFIXME\b/, /\bXXX\b/, /<[أ-ي\s]*أدخل[^>]*>/];
  for (const rel of DOCS) {
    const text = readDoc(rel);
    for (const pattern of forbidden) {
      assert.equal(pattern.test(text), false, `${rel} يحمل ${pattern}`);
    }
  }
});

test('كل مسار مذكور في الوثائق الأمنية موجود فعلاً على القرص', () => {
  const missing = [];
  for (const rel of DOCS) {
    for (const token of backticked(readDoc(rel))) {
      const isPath =
        /^[\w./-]+\.(mts|mjs|md|json|jsonl|txt|yaml)$/.test(token) && !token.includes(' ');
      // تُستثنى الأمثلة التشغيلية بمسارات وهمية (‏`/var/lib/...`) فهي إعداد المشغّل
      // لا ملفٌ في المستودع، وتُميَّز بأنها مطلقة.
      if (!isPath || token.startsWith('/')) continue;
      if (!existsSync(join(ROOT, token))) missing.push(`${rel} ⇒ ${token}`);
    }
  }
  assert.deepEqual(missing, [], `مسارات مذكورة غير موجودة:\n${missing.join('\n')}`);
});

test('كل رمز خطأ أو متغيّر بيئة مذكور في الوثائق موجود في المصدر', () => {
  const corpus = sourceCorpus();
  const missing = [];
  for (const rel of DOCS) {
    for (const token of backticked(readDoc(rel))) {
      // الرموز ومتغيّرات البيئة وحدها: حروف كبيرة بشُرطة سفلية واحدة على الأقل.
      if (!/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(token)) continue;
      if (!corpus.includes(token)) missing.push(`${rel} ⇒ ${token}`);
    }
  }
  // هذا الفحص كشف فعلاً خطأً وقعتُ فيه عند كتابة `SECURITY.md`: وثّقتُ متغيّر
  // البيئة `KING_KEY_TOKEN` وليس له وجود، واسمه الحقيقي `KING_KEY_STORE_TOKEN`.
  // ومشغّلٌ يتبع الوثيقة في طارئة كان يقرأ «المخزن غير مُهيَّأ» ولا يعرف السبب.
  assert.deepEqual(missing, [], `رموز موثَّقة لا وجود لها في الكود:\n${missing.join('\n')}`);
});

test('كل أمر npm مذكور في الوثائق الأمنية معرَّف في package.json', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const scripts = Object.keys(pkg.scripts);
  const missing = [];
  for (const rel of DOCS) {
    const text = readDoc(rel);
    for (const match of text.matchAll(/npm run ([\w:-]+)/g)) {
      const name = /** @type {string} */ (match[1]);
      if (!scripts.includes(name)) missing.push(`${rel} ⇒ npm run ${name}`);
    }
  }
  assert.deepEqual(missing, [], `أوامر موثَّقة غير معرَّفة:\n${missing.join('\n')}`);
});

test('جدول التهديدات كامل الأعمدة: لكل تهديد ضابط ودليل وخطر متبقٍّ', () => {
  const rows = tableRows(readDoc('docs/THREAT_MODEL.md'), 'T');
  assert.ok(rows.length >= 25, `عدد التهديدات ${rows.length} — أقل مما يوصّفه النظام`);
  for (const cells of rows) {
    const [id, threat, adversary, control, path, evidence, residual] = cells;
    assert.equal(cells.length, 7, `${id}: عدد الأعمدة ${cells.length} لا 7`);
    assert.ok(adversary && adversary.length > 0, `${id}: العمود «الخصم» فارغ`);
    for (const [name, value] of [
      ['التهديد', threat],
      ['الضابط', control],
      ['المسار', path],
      ['الدليل', evidence],
      ['الخطر المتبقي', residual],
    ]) {
      assert.ok(value && value.length > 2, `${id}: العمود «${name}» فارغ`);
    }
    // درجة الخصم من الدرجات المعلنة لا نصاً حرّاً.
    assert.match(/** @type {string} */ (adversary), /^X[1-4]$/, `${id}: درجة خصم غير معلنة`);
  }
});

test('معرّفات التهديدات متسلسلة بلا تكرار ولا ثغرة', () => {
  const ids = tableRows(readDoc('docs/THREAT_MODEL.md'), 'T').map((cells) => cells[0]);
  assert.deepEqual([...new Set(ids)], ids, 'معرّف تهديد مكرَّر');
  // التسلسل يمنع «دمج» تهديدٍ جديد في صفٍّ قائم كي يبقى العدّ صادقاً.
  const expected = ids.map((_, index) => `T${String(index + 1).padStart(2, '0')}`);
  assert.deepEqual(ids, expected, 'ثغرة في تسلسل معرّفات التهديدات');
});

test('كل تهديد بلا ضابط مُعلَن مفتوحاً لا مُغطّى بلغة عامة', () => {
  const rows = tableRows(readDoc('docs/THREAT_MODEL.md'), 'T');
  const open = rows.filter((cells) => /لا ضابط|⛔/.test(/** @type {string} */ (cells[3])));
  // ليس المطلوب أن تكون القائمة فارغة — النظام ناقص وذلك مُقرٌّ به — بل أن يكون
  // كل ناقص **مسمّى** في باب «تهديدات معروفة بلا ضابط» فلا يُقرأ مغطّى.
  const section = readDoc('docs/THREAT_MODEL.md');
  assert.ok(section.includes('## 7. تهديدات معروفة بلا ضابط'));
  for (const cells of open) {
    assert.match(
      /** @type {string} */ (cells[6]),
      /مفتوح/,
      `${cells[0]}: ضابط غائب وخطرٌ متبقٍّ لا يقول «مفتوح»`,
    );
  }
});

test('الأصول وحدود الثقة والمفترضات كلها معرَّفة بمعرّفات مرقَّمة', () => {
  const text = readDoc('docs/THREAT_MODEL.md');
  assert.ok(tableRows(text, 'A').length >= 5, 'الأصول أقل من خمسة');
  assert.ok(tableRows(text, 'TB').length >= 5, 'حدود الثقة أقل من خمسة');
  assert.ok(tableRows(text, 'AS').length >= 6, 'المفترضات أقل من ستة');
  // ولكل مفترض ثمنٌ مكتوب: مفترض بلا «ما يسقط إن سقط» أملٌ لا مفترض.
  for (const cells of tableRows(text, 'AS')) {
    assert.ok(cells[2] && cells[2].length > 10, `${cells[0]}: بلا أثرٍ لسقوطه`);
  }
});

test('إجراءات الطوارئ مرقَّمة، ولكل إجراء أمرٌ وحدٌّ لما لا يفعله', () => {
  const text = readDoc('SECURITY.md');
  const ids = [...text.matchAll(/^### (R\d+) /gm)].map((m) => m[1]);
  assert.ok(ids.length >= 6, `عدد الإجراءات ${ids.length} — دون ما يوصّفه نموذج التهديد`);
  assert.deepEqual(
    ids,
    ids.map((_, index) => `R${index + 1}`),
    'ثغرة في تسلسل إجراءات الطوارئ',
  );
  // إجراءٌ لا يُعلن حدّه يُقرأ حلاً كاملاً، فمن ينفّذه في طارئة يظن أنه انتهى.
  const sections = text.split(/^### R\d+ /gm).slice(1);
  for (const [index, body] of sections.entries()) {
    assert.match(body, /ما لا يفعله|حدٌّ|لا يُبرهن|لا تُخمّن/, `R${index + 1}: بلا حدٍّ معلن`);
  }
});

test('الوثائق تُحيل إلى بعضها فلا تُقرأ واحدةٌ منها وحدها', () => {
  assert.match(readDoc('SECURITY.md'), /docs\/THREAT_MODEL\.md/);
  assert.match(readDoc('docs/THREAT_MODEL.md'), /tests\/docs\/security-docs\.test\.mjs/);
  assert.match(readDoc('docs/ROOT_OF_TRUST.md'), /docs\/THREAT_MODEL\.md/);
});

test('كل مُدخلة سجل أعمال مذكورة في الوثائق موجودة في سجلٍّ فعلاً', () => {
  // المُدخلات الحديثة عنواناً في سجل الأعمال، والقديمة صفّاً في دفتر خط الأساس.
  // والمطلوب أن يكون للمعرّف **موضع**، لا مجرّد ذكرٍ عابر في وثيقة أخرى.
  const log = readDoc('docs/roadmap/05-work-log.md');
  const ledger = readDoc('docs/roadmap/02-baseline-audit.md');
  const missing = [];
  for (const rel of DOCS) {
    for (const match of readDoc(rel).matchAll(/WL-\d{3}/g)) {
      const id = match[0];
      const inLog = log.includes(`\u2014 ${id} \u2014`);
      const inLedger = ledger.includes(`| \`${id}\` |`);
      if (!inLog && !inLedger) missing.push(`${rel} \u21d2 ${id}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `\u0645\u064f\u062f\u062e\u0644\u0627\u062a \u0645\u0630\u0643\u0648\u0631\u0629 \u0644\u0627 \u0645\u0648\u0636\u0639 \u0644\u0647\u0627:\n${missing.join('\n')}`,
  );
});

test('عدد ملفات الاختبار المذكور في وثيقة جذر الثقة ليس رقماً متروكاً', () => {
  const text = readDoc('docs/ROOT_OF_TRUST.md');
  const claim = text.match(/npm test\s+#\s*(\d+)\s*ملف اختبار/);
  assert.ok(claim, 'وثيقة جذر الثقة لا تُصرّح بحجم حزمة الاختبارات');
  // الرقم يُشتق من القرص لا من ذاكرة الكاتب. والفارق المسموح صفر: رقمٌ في وثيقة
  // أمنية إما أن يكون صحيحاً أو أن يُحذف — وهذا ما جعل هذه الوثيقة تصف ماضياً.
  const actual = execFileSync('git', ['ls-files', 'tests'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((file) => file.endsWith('.test.mjs')).length;
  assert.equal(Number(claim[1]), actual, `الوثيقة تقول ${claim[1]} والقرص فيه ${actual}`);
});
