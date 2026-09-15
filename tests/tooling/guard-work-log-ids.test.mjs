// اختباراتُ حاجزِ اتّصالِ ترقيمِ سجلِّ الأعمالِ — `WL-178` (إغلاقُ `DOC-8`).
//
// **ما تقيسه:** أنّ الحاجزَ يرفعُ العيبَ الذي أُنشئَ لأجلِه (‏فجوةٌ من حذفٍ سهوٍ،
// وتكرارٌ من لصقٍ مزدوجٍ)، **وأنّه لا يُسكَتُ بعُذرٍ فقدَ محلَّه** (‏القاعدةُ `R4`).

import test from 'node:test';
import assert from 'node:assert/strict';

import { auditWorkLogIds, collectHeadings } from '../../scripts/guard-work-log-ids.mjs';

/**
 * @param {number} n رقمُ المُدخلةِ.
 * @param {string} extra زيادةٌ على العنوانِ.
 * @returns {string} عنوانُ مُدخلةٍ بقالبٍ صحيحٍ.
 */
const HEAD = (n, extra = '') =>
  `### [2026-09-15] — WL-${String(n).padStart(3, '0')} — موضوعٌ${extra}\n\n- **المنفّذ:** فلانٌ\n\n---\n`;

/**
 * @param {number[]} numbers أرقامُ المُدخلاتِ بالترتيبِ.
 * @returns {string} سجلٌّ مُصطنَعٌ للاختبارِ.
 */
const logOf = (numbers) => numbers.map((n) => HEAD(n)).join('\n');

const EMPTY_CONFIG = 'allowed_gaps: []\nallowed_duplicates: []\n';

test('R1: العنوانُ الذي لا يحملُ معرِّفاً في صدرِه ولا في ذيلِه يُرفَضُ', () => {
  const logText = `### [2026-09-15] — بلا معرِّفٍ\n\n---\n${HEAD(1)}`;
  const { failures } = auditWorkLogIds({ logText, configText: EMPTY_CONFIG });
  assert.ok(failures.some((message) => message.startsWith('R1:')));
});

test('R1: الشكلُ القديمُ — المعرِّفُ في ذيلِ العنوانِ — مقبولٌ ويُحسَبُ', () => {
  const logText = '### [2026-09-11] — موضوعٌ قديمٌ (WL-001)\n\n---\n';
  const headings = collectHeadings(logText);
  assert.equal(headings.length, 1);
  assert.equal(headings[0]?.id, 1);
  const { failures } = auditWorkLogIds({ logText, configText: EMPTY_CONFIG });
  assert.deepEqual(failures, []);
});

test('R1: معرِّفٌ مذكورٌ في عنوانِ تصحيحٍ لا يُملَكُ — الأوّلُ وحدَه هو المُدخلةُ', () => {
  const logText = `${HEAD(1)}\n### [2026-09-15] — WL-002 — تصحيحُ حقلِ الكوميتِ في \`WL-001\`\n\n---\n`;
  const { failures, unique } = auditWorkLogIds({ logText, configText: EMPTY_CONFIG });
  assert.deepEqual(failures, []);
  assert.equal(unique, 2);
});

test('R2: تكرارٌ غيرُ مُعلَنٍ يُرفَضُ — وهو صنفُ عيبِ اللصقِ المزدوجِ', () => {
  const logText = logOf([1, 2, 2, 3]);
  const { failures } = auditWorkLogIds({ logText, configText: EMPTY_CONFIG });
  assert.ok(failures.some((message) => message.startsWith('R2:')));
});

test('R2: تكرارٌ مُعلَنٌ بعددِه يُقبَلُ', () => {
  const logText = logOf([1, 2, 2, 3]);
  const configText =
    'allowed_gaps: []\nallowed_duplicates:\n  - id: WL-002\n    count: 2\n    reason: مُدخلةٌ وتصحيحُها\n';
  const { failures } = auditWorkLogIds({ logText, configText });
  assert.deepEqual(failures, []);
});

test('R3: فجوةٌ غيرُ مُعلَنةٍ تُرفَضُ — وهي صنفُ عيبِ الحذفِ السهوِ', () => {
  const logText = logOf([1, 2, 4]);
  const { failures } = auditWorkLogIds({ logText, configText: EMPTY_CONFIG });
  assert.ok(failures.some((message) => message.startsWith('R3:') && message.includes('WL-003')));
});

test('R3: فجوةٌ مُعلَنةٌ بسببٍ مكتوبٍ تُقبَلُ', () => {
  const logText = logOf([1, 2, 4]);
  const configText =
    'allowed_gaps:\n  - id: WL-003\n    reason: استُهلِكَ في رسالةِ كوميتٍ ووُثِّقَ جماعةً\nallowed_duplicates: []\n';
  const { failures } = auditWorkLogIds({ logText, configText });
  assert.deepEqual(failures, []);
});

test('R4: استثناءُ فجوةٍ صارَ له عنوانٌ يُرفَضُ — لا مقبرةَ أعذارٍ', () => {
  const logText = logOf([1, 2, 3]);
  const configText =
    'allowed_gaps:\n  - id: WL-003\n    reason: سببٌ قديمٌ لم يبقَ له محلٌّ\nallowed_duplicates: []\n';
  const { failures } = auditWorkLogIds({ logText, configText });
  assert.ok(failures.some((message) => message.startsWith('R4:')));
});

test('R4: تكرارٌ مُعلَنٌ بعددٍ يخالفُ المقيسَ يُرفَضُ', () => {
  const logText = logOf([1, 2, 3]);
  const configText =
    'allowed_gaps: []\nallowed_duplicates:\n  - id: WL-002\n    count: 2\n    reason: سببٌ\n';
  const { failures } = auditWorkLogIds({ logText, configText });
  assert.ok(failures.some((message) => message.startsWith('R4:')));
});

test('R5: استثناءٌ بلا سببٍ مكتوبٍ يُرفَضُ', () => {
  const logText = logOf([1, 2, 4]);
  const configText = 'allowed_gaps:\n  - id: WL-003\n    reason: "   "\nallowed_duplicates: []\n';
  const { failures } = auditWorkLogIds({ logText, configText });
  assert.ok(failures.some((message) => message.startsWith('R5:')));
});

test('R5: استثناءٌ غيرُ مشروحٍ في خريطةِ المعرِّفاتِ يُرفَضُ', () => {
  const logText = logOf([1, 2, 4]);
  const configText =
    'allowed_gaps:\n  - id: WL-003\n    reason: سببٌ مكتوبٌ\nallowed_duplicates: []\n';
  const withoutMap = auditWorkLogIds({ logText, configText, mapText: 'خريطةٌ لا تذكرُ شيئاً' });
  assert.ok(withoutMap.failures.some((message) => message.includes('WL-003')));
  const withMap = auditWorkLogIds({
    logText,
    configText,
    mapText: 'الفجوةُ `WL-003` مشروحةٌ هنا بسببِها',
  });
  assert.deepEqual(withMap.failures, []);
});

test('السجلُّ الحقيقيُّ في المستودعِ يمرُّ بالحاجزِ', async () => {
  const { readFile } = await import('node:fs/promises');
  const [logText, configText, mapText] = await Promise.all([
    readFile('docs/roadmap/05-work-log.md', 'utf8'),
    readFile('config/work-log-ids.yaml', 'utf8'),
    readFile('docs/audit/work-log-id-map.md', 'utf8'),
  ]);
  const { failures, total, unique } = auditWorkLogIds({ logText, configText, mapText });
  assert.deepEqual(failures, []);
  assert.ok(total >= unique);
});
