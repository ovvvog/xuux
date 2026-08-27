#!/usr/bin/env node
/**
 * يولّد `constitution/ARTICLES.md` من النصّ المؤسِّس مع تجزئةِ كلِّ مادة.
 *
 * ولمَ التوليد لا الكتابة اليدوية؟ لأن التجزئةَ لا تُكتب بيدٍ صحيحةً، ووثيقةٌ
 * تحمل تجزئةً خاطئةً تُوقِف الحاجزَ (R7) بلا سبب — أو أسوأ: تُقنع قارئاً بنصٍّ
 * ليس هو النافذ. فالوثيقةُ **مشتقّةٌ** من البيانات، والحاجزُ يتحقّق من الاشتقاق.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  articleHash,
  documentRoot,
  loadConstitutionPolicy,
} from '../src/constitution/constitution.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policy = loadConstitutionPolicy({ dir: path.join(ROOT, 'config') });

const lines = [];
lines.push('# موادُّ الدستور');
lines.push('');
lines.push(
  '> **وثيقةٌ مشتقّة لا مصدر.** المصدرُ `config/constitution.yaml`، وهذا الملفُّ يُولَّد منه بـ`node scripts/render-constitution-docs.mjs`. ويتحقّق `npm run guard:constitution` (القاعدة R7) من أنّ كلَّ مادةٍ هنا تحمل تجزئتَها الصحيحة؛ فالوثيقةُ لا تتخلّف عن النصّ في صمت.',
);
lines.push('');
lines.push(
  `النصُّ المؤسِّس: **${policy.articles.length}** مادة، منها **${policy.articles.filter((a) => a.entrenched).length}** مختومة. جذرُ النصّ: \`${documentRoot(/** @type {any} */ (policy.articles))}\``,
);
lines.push('');
lines.push('| المادة | العنوان | مرجع القانون | مختومة |');
lines.push('| --- | --- | --- | --- |');
for (const article of policy.articles) {
  lines.push(
    `| \`${article.id}\` | ${article.title} | \`${article.lawRef}\` | ${article.entrenched ? 'نعم' : 'لا'} |`,
  );
}
lines.push('');
lines.push('---');
lines.push('');

for (const article of policy.articles) {
  lines.push(`## ${article.id} — ${article.title}`);
  lines.push('');
  lines.push(article.text.trim().replace(/\s*\n\s*/g, ' '));
  lines.push('');
  lines.push(`- **مرجع القانون:** \`${article.lawRef}\``);
  const state = article.entrenched
    ? '**مختومة** — لا تُعدَّل ولو بالمسار كاملاً (CONSTITUTION_ARTICLE_ENTRENCHED)'
    : 'قابلةٌ للتعديل بالمسار الملكيّ الرباعيّ';
  lines.push(`- **الحالة:** ${state}`);
  lines.push(`- **مواضع الإنفاذ:** ${article.enforcedBy.map((file) => `\`${file}\``).join(' · ')}`);
  lines.push(`- **التجزئة:** \`${articleHash(article)}\``);
  lines.push('');
}

const target = path.join(ROOT, 'constitution', 'ARTICLES.md');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${lines.join('\n')}\n`, 'utf8');
process.stdout.write(`✅ كُتبت ${path.relative(ROOT, target)} بـ${policy.articles.length} مادة\n`);
