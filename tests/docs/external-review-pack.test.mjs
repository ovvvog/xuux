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
// **توسعةُ `WL-122` — وهي تشديدٌ لا تخفيفٌ:** لمّا أَذِنَ المالكُ بقيدِ نتائجِ
// الجولةِ الرابعةِ كما كتبَها العضوانِ، صارَ قفلُ `findings: []` وقفلُ `executedBy: null`
// ممّا يمنعُ قيداً صادقاً. ولم يُحلَّ القفلانِ حلّاً مُجرّداً؛ بل استُبدِلا بقُيودٍ أقوى:
//   — مفرداتُ الحالةِ محصورةٌ، ولا تحملُ واحدةٌ منها لفظَ اعتمادٍ ذاتيٍّ (تُفحَصُ نصّاً).
//   — مَن نفّذَ المراجعةَ مجلسٌ بعضوينِ من مزوّدينَ مختلفينَ، ولا يدخلُ المنفِّذُ قائمتَهم.
//   — كلُّ نتيجةٍ منسوبةٌ إلى مَن أثارَها، ولها تقريرٌ خامٌّ **موجودٌ على القرصِ**.
//   — كلُّ إغلاقٍ يطلبُ كوميتَ إصلاحٍ ودليلَ إعادةِ اختبارٍ وعضوينِ أعادا الاختبارَ.
//   — وقيدُ النتائجِ لا يفتحُ بوابةً: خطواتُ `M11.04`–`M11.06` تبقى `⬜` في الخارطةِ.
// ولم يُحذفْ قيدٌ واحدٌ من القُيودِ السابقةِ: ما لم تُطلَقْ مراجعتُه يبقى `null` وبلا نتائجَ.
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
const AWAITING = 'awaiting-model-council';
const RECORDED = 'council-findings-recorded';
const ALLOWED_STATUSES = [AWAITING, RECORDED];
const ALLOWED_SEVERITIES = ['high', 'medium', 'low'];
const ALLOWED_FINDING_STATES = ['open', 'closed'];
// ألفاظُ الاعتمادِ الذاتيِّ — لا تدخلُ مفرداتَ الحالةِ أبداً، ولو أَذِنَ المالكُ بقيدِ النتائجِ.
const FORBIDDEN_STATUS_WORDS = [
  'verified',
  'approved',
  'complete',
  'completed',
  'done',
  'passed',
  'secure',
  'ready',
];

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

test('لا حالةَ إلا ممّا يُعلنُه العقدُ — ولا مفردةَ «مُنجَزٍ» في المفرداتِ أصلاً', () => {
  const contract = readContract();
  assert.deepEqual(contract.statusVocabulary, ALLOWED_STATUSES);
  assert.equal(contract.resultAuthority, 'model-council');
  assert.deepEqual(
    contract.forbiddenStatusVocabulary,
    FORBIDDEN_STATUS_WORDS,
    'قائمةُ الألفاظِ المحرَّمةِ في العقدِ لا تُطابقُ ما يحرسُه الاختبارُ',
  );
  // مفردةُ حالةٍ تُقرأُ اعتماداً تُرَدُّ حتى لو أُعلِنتْ — وهذا ما يمنعُ نموَّ المفرداتِ إلى حكمٍ.
  for (const status of ALLOWED_STATUSES) {
    for (const word of FORBIDDEN_STATUS_WORDS) {
      assert.ok(
        !status.toLowerCase().includes(word),
        `المفردةُ «${status}» تحملُ لفظَ اعتمادٍ ذاتيٍّ «${word}»`,
      );
    }
  }
  for (const engagement of readEngagements()) {
    const id = String(engagement.id);
    assert.ok(
      ALLOWED_STATUSES.includes(String(engagement.status)),
      `حالةُ «${id}» خارجَ المفرداتِ المُعلَنةِ — وهذا انتحالُ حكمٍ`,
    );
  }
});

test('مَن نفّذَ المراجعةَ مجلسٌ لا مُنفِّذٌ — وبمزوّدينَ مختلفينَ', () => {
  for (const engagement of readEngagements()) {
    const id = String(engagement.id);
    const executedBy = engagement.executedBy;
    // ما لم تُطلَقْ مراجعتُه يبقى `null` — ولا يُسنَدُ تنفيذُه إلى أحدٍ.
    if (String(engagement.status) === AWAITING) {
      assert.equal(executedBy, null, `«${id}» تنتظرُ المجلسَ وقد أُسنِدَ تنفيذُها إلى أحدٍ`);
      continue;
    }
    const council = /** @type {Record<string, unknown>} */ (executedBy);
    assert.ok(council, `«${id}» قُيّدتْ نتائجُها ولا جهةَ منفِّذةً مُعلَنةً`);
    assert.equal(council.kind, 'model-council', `«${id}» نفّذَها غيرُ مجلسِ نماذجٍ`);
    const members = /** @type {{ id: string; provider: string }[]} */ (council.members ?? []);
    assert.ok(members.length >= 2, `«${id}» نفّذَها أقلُّ من عضوينِ`);
    const providers = new Set(members.map((member) => String(member.provider)));
    assert.ok(
      providers.size >= 2,
      `«${id}» أعضاؤها من مزوّدٍ واحدٍ — والاستقلالُ يطلبُ مزوّدينَ مختلفينَ`,
    );
    // لفظُ المنفِّذِ لا يدخلُ قائمةَ مَن نفّذَ المراجعةَ — ولو باسمٍ مُستعارٍ.
    for (const member of members) {
      const memberId = String(member.id).toLowerCase();
      assert.ok(
        !['executor', 'self', 'المنفذ', 'المنفّذ'].some((bad) => memberId.includes(bad)),
        `«${id}» يُدرجُ المنفِّذَ عضواً — والمنفِّذُ ليسَ المراجِعَ (المادة 11/1)`,
      );
    }
  }
});

test('قيدُ النتائجِ لا يفتحُ بوابةً — خطوةُ الخارطةِ تبقى ⬜', () => {
  const roadmap = readFileSync(join(ROOT, 'docs/roadmap/03-roadmap-to-100.md'), 'utf8');
  for (const engagement of readEngagements()) {
    const id = String(engagement.id);
    const row = roadmap.split('\n').find((line) => line.includes(`| ${id} |`));
    assert.ok(row, `بندُ «${id}» ليس صفّاً في لوحةِ الخطواتِ`);
    assert.ok(
      row.includes('⬜'),
      `«${id}» لم تبقَ ⬜ في الخارطةِ — وقيدُ نتائجٍ ليس إغلاقاً ولا إنجازاً`,
    );
  }
});

test('سلطةُ المراجعةِ مُعرَّفةٌ ومستقلّةٌ عن المنفِّذِ', () => {
  const contract = readContract();
  const council = /** @type {Record<string, unknown>} */ (contract.councilAuthority);
  assert.ok(council, 'لا تعريفُ لسلطةِ المراجعةِ في العقدِ');
  assert.equal(council.kind, 'model-council');
  assert.ok(Number(council.minModels) >= 2, 'مجلسُ النماذجِ يطلبُ نموذجينِ حدوديّينِ على الأقلّ');
  assert.equal(council.distinctProviders, true, 'النماذجُ يجبُ أن تكونَ من مزوّدينَ مختلفينَ');
  assert.ok(
    typeof council.reportArtifactPattern === 'string' &&
      council.reportArtifactPattern.includes('<id>'),
    'نمطُ التقريرِ الخامِّ غيرُ مُعرَّفٍ',
  );
  assert.ok(
    Array.isArray(council.completionRequires) && council.completionRequires.length >= 3,
    'شروطُ اكتمالِ المراجعةِ غيرُ مُعلَنةٍ',
  );
});

test('النتائجُ فارغةٌ ما دامت المراجعةُ تنتظرُ — وكلُّ نتيجةٍ مُقيَّدةٍ منسوبةٌ ومُدلَّلةٌ', () => {
  const contract = readContract();
  const engagements = readEngagements();
  const awaiting = engagements.filter((e) => String(e.status) === AWAITING);
  // ما دام كلُّ ارتباطٍ في انتظارِ المجلسِ، فلا نتيجةَ تُقيَّدُ بعدُ.
  if (awaiting.length === engagements.length) {
    assert.deepEqual(contract.findings, [], 'نتيجةُ مراجعةٍ مُقيَّدةٌ ولا مراجعةَ وقعتْ');
    return;
  }
  const findings = /** @type {Record<string, any>[]} */ (contract.findings);
  assert.ok(
    Array.isArray(findings) && findings.length > 0,
    'قُيّدتْ حالةُ نتائجٍ ولا نتائجَ في العقدِ',
  );
  const declaredIds = new Set(engagements.map((e) => String(e.id)));
  const recorded = new Set(
    engagements.filter((e) => String(e.status) === RECORDED).map((e) => String(e.id)),
  );
  // خريطةُ العضوِ إلى مزوّدِه، من إعلانِ المجلسِ نفسِه — تُستعملُ لقياسِ تعدُّدِ المزوّدينَ.
  /** @type {Map<string, string>} */
  const memberProvider = new Map();
  for (const engagement of engagements) {
    const council = /** @type {{ members?: { id: string; provider: string }[] }} */ (
      engagement.executedBy ?? {}
    );
    for (const member of council.members ?? []) {
      memberProvider.set(String(member.id), String(member.provider));
    }
  }
  /** @type {Map<string, Set<string>>} */
  const providersPerEngagement = new Map();
  const seen = new Set();
  for (const finding of findings) {
    const fid = String(finding.id ?? '');
    assert.ok(fid, 'نتيجةٌ بلا معرِّفٍ');
    assert.ok(!seen.has(fid), `معرِّفٌ مكرّرٌ «${fid}» — والقيدُ واحدٌ لكلِّ نتيجةٍ`);
    seen.add(fid);
    const engagementId = String(finding.engagement ?? '');
    assert.ok(declaredIds.has(engagementId), `«${fid}» تُشيرُ إلى ارتباطٍ غيرِ مُعلَنٍ`);
    assert.ok(
      recorded.has(engagementId),
      `«${fid}» مُقيَّدةٌ على ارتباطٍ لم تُعلَنْ فيه حالةُ قيدِ النتائجِ`,
    );
    // الشدّةُ: لفظُ العضوِ محفوظٌ، والتطبيعُ محصورٌ ومُعلَنٌ.
    assert.ok(finding.severityAsWritten, `«${fid}» بلا شدّةٍ بلفظِ العضوِ`);
    assert.ok(
      ALLOWED_SEVERITIES.includes(String(finding.severity)),
      `«${fid}» شدّتُها المُطبَّعةُ خارجَ المفرداتِ`,
    );
    assert.ok(finding.reproductionPath, `«${fid}» بلا مسارِ إعادةِ إنتاجٍ`);
    assert.ok(
      ALLOWED_FINDING_STATES.includes(String(finding.status)),
      `«${fid}» حالُها ليس open ولا closed`,
    );
    // مَن أثارَ النتيجةَ مُسمّى — فلا نتيجةَ بلا نسبٍ.
    const raisedBy = /** @type {string[]} */ (finding.raisedBy ?? []);
    assert.ok(raisedBy.length >= 1, `«${fid}» بلا نسبٍ إلى مَن أثارَها`);
    // التقريرُ الخامُّ ليس إشارةً نصّيّةً — لا بدَّ أن يكونَ ملفّاً على القرصِ.
    const rawReports = /** @type {Record<string, string>} */ (finding.rawReports ?? {});
    const reportIds = Object.keys(rawReports);
    // نتيجةٌ أثارَها عضوٌ واحدٌ لها تقريرٌ واحدٌ صادقاً — وإلزامُها تقريرينِ يُنتجُ قيداً كاذباً.
    // وتعدُّدُ المزوّدينَ يُقاسُ على مستوى الارتباطِ لا على مستوى النتيجةِ المُفرَدةِ.
    assert.ok(reportIds.length >= 1, `«${fid}» بلا تقريرٍ خامٍّ — والتوليفُ ليس دليلاً`);
    const engagementProviders = providersPerEngagement.get(engagementId) ?? new Set();
    providersPerEngagement.set(engagementId, engagementProviders);
    for (const modelId of reportIds) {
      const provider = memberProvider.get(String(modelId));
      if (provider !== undefined) engagementProviders.add(provider);
    }
    for (const modelId of reportIds) {
      const path = String(rawReports[modelId]);
      assert.ok(path, `تقريرُ نموذجٍ «${modelId}» غيرُ مُشارٍ إليه في «${fid}»`);
      assert.ok(
        existsSync(join(ROOT, path)),
        `تقريرُ «${modelId}» في «${fid}» لا موضعَ له على القرصِ: ${path}`,
      );
    }
    // مَن أثارَ نتيجةً في الجولةِ المُقيَّدةِ يجبُ أن يكونَ له تقريرٌ خامٌّ مُشارٌ إليه.
    if (String(finding.origin ?? '') === 'round-4') {
      for (const member of raisedBy) {
        assert.ok(
          reportIds.includes(String(member)),
          `«${fid}» أثارَها «${String(member)}» ولا تقريرَ خامَّ له في قيدِها`,
        );
      }
    }
    // والإغلاقُ لا يُكتبُ دعوى — إصلاحٌ بكوميتٍ وإعادةُ اختبارٍ من عضوينِ (المادة 11/3).
    if (String(finding.status) === 'closed') {
      const closure = /** @type {Record<string, unknown>} */ (finding.closure);
      assert.ok(closure, `«${fid}» مُغلَقةٌ بلا سجلِّ إغلاقٍ`);
      assert.ok(closure.fixCommit, `«${fid}» مُغلَقةٌ بلا كوميتِ إصلاحٍ`);
      assert.ok(closure.retestEvidence, `«${fid}» مُغلَقةٌ بلا دليلِ إعادةِ اختبارٍ`);
      const retestedBy = /** @type {string[]} */ (closure.retestedBy ?? []);
      assert.ok(
        retestedBy.length >= 2,
        `«${fid}» أُغلِقَتْ بأقلَّ من عضوينِ — وحكمُ الإغلاقِ للمجلسِ لا لواحدٍ`,
      );
    }
  }
  // ولا قيدَ نتائجٍ على ارتباطٍ إلا بتقايريرَ خامّةٍ من مزوّدينَ مختلفينَ.
  for (const [engagementId, providers] of providersPerEngagement) {
    assert.ok(
      providers.size >= 2,
      `قُيّدتْ نتائجُ «${engagementId}» بتقايريرَ من مزوّدٍ واحدٍ — والاستقلالُ يطلبُ مزوّدينَ مختلفينَ`,
    );
  }
  // وكلُّ تقاطُعٍ مُسجَّلٍ يُشيرُ إلى قيدٍ قائمٍ — فلا إحالةَ إلى معدومٍ.
  for (const finding of findings) {
    for (const other of /** @type {string[]} */ (finding.overlapsWith ?? [])) {
      assert.ok(
        seen.has(String(other)),
        `«${String(finding.id)}» تُشيرُ إلى تقاطُعٍ مع «${String(other)}» ولا قيدَ له`,
      );
    }
  }
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
    'awaiting-model-council',
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
