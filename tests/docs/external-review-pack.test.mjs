// حزمةُ المراجعةِ الخارجيّةِ المستقلّةِ — إنفاذُ أنها **مُدخلاتٌ لا نتائجُ**.
//
// المشكلةُ التي يحلُّها هذا الاختبارُ: حزمةُ مراجعةٍ يكتبُها مَن سيُراجَعُ عملُه
// هي أخطرُ ملفٍّ في المستودعِ، لأنّ أسهلَ شيءٍ فيها أن تنمو سطراً سطراً حتى تصيرَ
// **حكماً منتحلاً**: حالةٌ تُقرأ «مُنجَزٌ»، أو نتيجةٌ تُقيَّد بلا جهةٍ، أو لفظُ
// `VERIFIED` يُوضَعُ نيابةً عن مراجعٍ لم يوقّعْ. والمادة 8 تمنعُ ذلك نصّاً — وهذا
// الاختبارُ يجعلُ المنعَ **شيئاً يفشلُ** لا نيّةً حسنةً.
//
// وما لا يفعلُه: لا يقيسُ كفايةَ الأدلّةِ — الكفايةُ حكمُ الجهةِ المستقلّةِ.
//
// التشغيل: node --test tests/docs/external-review-pack.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CONTRACT_PATH = 'config/external-review.yaml';
const DOC_PATH = 'docs/EXTERNAL_REVIEW_PACK.md';
const EXPECTED_ENGAGEMENTS = ['M11.04', 'M11.05', 'M11.06'];
const ONLY_STATUS = 'awaiting-independent-party';

/**
 * @returns {Record<string, unknown>}
 */
function readContract() {
  return /** @type {Record<string, unknown>} */ (
    parse(readFileSync(join(ROOT, CONTRACT_PATH), 'utf8'))
  );
}

/**
 * @returns {Record<string, unknown>[]}
 */
function readEngagements() {
  const contract = readContract();
  const engagements = contract.engagements;
  assert.ok(Array.isArray(engagements), 'عقدُ المراجعةِ بلا قائمةِ ارتباطاتٍ');
  return /** @type {Record<string, unknown>[]} */ (engagements);
}

test('الارتباطاتُ الثلاثةُ هي بنودُ الخارطةِ نفسُها لا قائمةٌ ثانيةٌ', () => {
  const ids = readEngagements().map((engagement) => String(engagement.id));
  assert.deepEqual(ids, EXPECTED_ENGAGEMENTS);
  const roadmap = readFileSync(join(ROOT, 'docs/roadmap/03-roadmap-to-100.md'), 'utf8');
  for (const id of ids) {
    assert.ok(roadmap.includes(`| ${id} |`), `بندُ «${id}» ليس صفّاً في لوحةِ الخطواتِ`);
  }
});

test('لا حالةَ إلا انتظارُ الجهةِ المستقلّةِ — ولا مفردةَ «مُنجَزٍ» في المفرداتِ أصلاً', () => {
  const contract = readContract();
  assert.deepEqual(contract.statusVocabulary, [ONLY_STATUS]);
  assert.equal(contract.resultAuthority, 'independent-third-party');
  for (const engagement of readEngagements()) {
    assert.equal(
      engagement.status,
      ONLY_STATUS,
      `حالةُ «${String(engagement.id)}» ليست انتظارَ الجهةِ المستقلّةِ — وهذا انتحالُ حكمٍ`,
    );
    assert.equal(
      engagement.executedBy,
      null,
      `«${String(engagement.id)}» أُسنِدَ تنفيذُها إلى أحدٍ — والمراجعةُ لا يُنفِّذُها المُنفِّذُ`,
    );
  }
});

test('سجلُّ النتائجِ فارغٌ: لا نتيجةَ تُقيَّدُ قبلَ أن تصدُرَ من جهةٍ مستقلّةٍ', () => {
  const contract = readContract();
  assert.deepEqual(contract.findings, [], 'نتيجةُ مراجعةٍ مُقيَّدةٌ ولا مراجعةَ وقعتْ');
});

test('كلُّ دليلٍ مُشارٍ إليه موجودٌ على القرصِ أو مولَّدٌ بأمرٍ معلَنٍ', () => {
  const packageJson = /** @type {{ scripts?: Record<string, string> }} */ (
    JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  );
  // `sbom.cdx.json` لا يوجد قبلَ توليدِه، فيُقبَل بشرطِ وجودِ أمرِ توليدِه معلَناً.
  const generated = new Map([['sbom.cdx.json', 'gen:sbom']]);
  const missing = [];
  for (const engagement of readEngagements()) {
    const artifacts = /** @type {string[]} */ (engagement.artifacts ?? []);
    assert.ok(artifacts.length > 0, `«${String(engagement.id)}» بلا دليلٍ واحدٍ`);
    for (const artifact of artifacts) {
      const script = generated.get(artifact);
      if (script !== undefined) {
        assert.ok(
          packageJson.scripts?.[script] !== undefined,
          `الدليلُ «${artifact}» مولَّدٌ بأمرٍ غيرِ معلَنٍ في package.json`,
        );
        continue;
      }
      if (!existsSync(join(ROOT, artifact))) missing.push(`${String(engagement.id)}: ${artifact}`);
    }
  }
  assert.deepEqual(missing, [], `أدلّةٌ مذكورةٌ لا موضعَ لها:\n${missing.join('\n')}`);
});

test('كلُّ ارتباطٍ له معيارُ قبولٍ ومُخرَجاتٌ ونطاقٌ وما خرجَ منه', () => {
  for (const engagement of readEngagements()) {
    const id = String(engagement.id);
    for (const field of [
      'kind',
      'title',
      'acceptanceCriteria',
      'scope',
      'outOfScope',
      'deliverables',
    ]) {
      const value = engagement[field];
      const filled = Array.isArray(value)
        ? value.length > 0
        : String(value ?? '').trim().length > 0;
      assert.ok(filled, `«${id}» بلا «${field}» — نطاقٌ ناقصٌ يُنتِج مراجعةً بلا حدٍّ`);
    }
  }
});

test('الوثيقةُ تُصرِّح بما لا تقولُه ولا تحمل لفظَ اعتمادٍ ذاتيٍّ', () => {
  const doc = readFileSync(join(ROOT, DOC_PATH), 'utf8');
  for (const needle of [
    'ما لا تقولُه هذه الوثيقةُ',
    'الحدودُ المعلَنةُ',
    'awaiting-independent-party',
  ]) {
    assert.ok(doc.includes(needle), `الوثيقةُ لا تُصرِّح بحدِّها: «${needle}»`);
  }
  for (const id of EXPECTED_ENGAGEMENTS) {
    assert.ok(doc.includes(id), `الوثيقةُ لا تذكر الارتباطَ «${id}»`);
  }
  // لفظُ الاعتمادِ يُرَدُّ إلا في سطرٍ ينفيهِ صراحةً.
  const forbidden = [/\bVERIFIED\b/, /\bAPPROVED\b/, /النظامُ آمنٌ/, /جاهزٌ للإطلاق/];
  const offences = [];
  for (const [index, line] of doc.split('\n').entries()) {
    for (const pattern of forbidden) {
      if (!pattern.test(line)) continue;
      if (/لا\s|ليس|ممنوع|غير|يُرَدُّ|تمنع/.test(line)) continue;
      offences.push(`${DOC_PATH}:${String(index + 1)} «${line.trim().slice(0, 60)}»`);
    }
  }
  assert.deepEqual(offences, [], `لفظُ اعتمادٍ ذاتيٍّ في حزمةِ المراجعةِ:\n${offences.join('\n')}`);
});

test('الوثيقةُ لا تُصرِّح بأمرٍ غيرِ موجودٍ في package.json', () => {
  const doc = readFileSync(join(ROOT, DOC_PATH), 'utf8');
  const packageJson = /** @type {{ scripts?: Record<string, string> }} */ (
    JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  );
  const scripts = packageJson.scripts ?? {};
  const claimed = new Set(
    [...doc.matchAll(/npm run ([a-z0-9:-]+)/g)].map((match) => String(match[1])),
  );
  const unknown = [...claimed].filter((script) => scripts[script] === undefined);
  assert.deepEqual(unknown, [], `أوامرُ مذكورةٌ لا وجودَ لها: ${unknown.join('، ')}`);
});
