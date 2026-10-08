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
import { execFileSync } from 'node:child_process';
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

// ——————————————————————————————————————————————————————————————————————
// `R6-A-10` (الشقُّ الثاني) — قياسُ حضورِ الدليلِ يقعُ على **المستودعِ** لا على
// نسخةِ القرصِ وحدَها.
//
// العيبُ كما قِيسَ في الجولةِ: المنفِّذُ حذفَ ثمانيةَ تقاريرَ من الشجرةِ التي
// سُلِّمتْ للعضوِ «أ»، فخرجَ `npm run validate` عندَه بـ`1` وعندَ غيرِه بـ`0`
// لنفسِ الكوميتِ. والسببُ الجذريُّ ليس الحذفَ وحدَه: الحارسُ كان يقيسُ **شجرةَ
// العملِ**، والدليلُ المُقيَّدُ في العقدِ دليلٌ يحملُه المستودعُ لا نسخةٌ عارضةٌ.
// فصارَ عطبُ نسخةٍ يُقرأُ عطباً في الجودةِ، وهو أسوأُ من ثغرةٍ: يُعلِّمُ المراجِعَ
// أنّ سقوطَ البوابةِ ضجيجٌ.
//
// والقياسُ الآن: الدليلُ حاضرٌ إن كان في شجرةِ العملِ **أو** في `HEAD`. فحذفٌ
// **مُلتزَمٌ** يُسقِطُ الحارسَ كما كان (هذا ما يُقاسُ في المسارِ)، ونقصُ نسخةٍ
// لا يُسقِطُه بل **يُعلَنُ** سطراً مقروءاً فلا يُسكَتُ عنه. وملفٌّ جديدٌ قبلَ
// الالتزامِ يكفيه القرصُ فلا يُعطَّلُ عملٌ مشروعٌ.
//
// وتعذُّرُ القياسِ التاريخيِّ (شجرةٌ بلا `.git`) يُسقِطُ القياسَ إلى شجرةِ العملِ
// وحدَها — وهو الأشدُّ لا الأخفُّ، فلا يصيرُ التعذُّرُ بواباً مفتوحاً.
/** @type {string[]} */
const PRUNED_TREE_NOTICES = [];

/** @param {string} path @returns {boolean} */
function existsAtHead(path) {
  try {
    execFileSync('git', ['cat-file', '-e', `HEAD:${path}`], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
function headReadable() {
  return existsAtHead('package.json');
}

/**
 * هل الدليلُ يحملُه المستودعُ — قرصاً أو تاريخاً.
 * @param {string} path - مسارُ الدليلِ من جذرِ المستودعِ
 * @param {(path: string) => boolean} [onDisk] - مقياسُ القرصِ (يُحقَنُ للاختبارِ)
 * @param {string[]} [notices] - سجلُّ ما نقصَ من شجرةِ العملِ
 * @returns {boolean} هل يحملُه المستودعُ
 */
function evidenceExists(path, onDisk = (item) => existsSync(join(ROOT, item)), notices) {
  if (onDisk(path)) return true;
  if (!headReadable()) return false;
  if (!existsAtHead(path)) return false;
  const sink = notices ?? PRUNED_TREE_NOTICES;
  // النقصُ يُعلَنُ مرّةً واحدةً: مسارٌ يُشارُ إليه من نتائجَ كثيرةٍ عطبُ نسخةٍ
  // واحدٌ لا أربعةَ عشرَ، وتكرارُه يُضخِّمُ القياسَ فيُقرأُ أسوأَ ممّا هو.
  if (!sink.includes(path)) sink.push(path);
  return true;
}

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
        evidenceExists(path),
        `تقريرُ «${modelId}» في «${fid}» لا يحملُه المستودعُ لا قرصاً ولا تاريخاً: ${path}`,
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
      if (!evidenceExists(artifact)) missing.push(`${String(engagement.id)}: ${artifact}`);
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

// النتيجة `R6-A-10` — خطّةُ الجولةِ يجبُ أن تكونَ في الشجرةِ التي راجعَها المجلسُ.
//
// العيبُ المُقَرُّ به (‏`executorPreparationDefects` في العقدِ، و§5 من مصفوفةِ
// المقارنةِ): خطّةُ جولةِ `M11.06` كُتِبت **بعدَ** استنساخِ الشجرةِ للأعضاءِ، فلم
// تصلْ إليهم، وبنى أحدُهم أقسامَ تقريرِه من العقدِ نفسِه. وخطّةٌ لا يراها المراجِعُ
// ليست خطّةَ مراجعةٍ بل سرداً لاحقاً — والمراجعةُ حينَها تُقاسُ بما اختارَه المُراجَعُ
// عملُه أن يُريَه.
//
// ولم يكنْ في المستودعِ شيءٌ يفشلُ لهذا. فهذا الحارسُ يجعلُه يفشلُ:
//   1. كلُّ جولةٍ مُقيَّدةٍ لها ملفُّ خطّةٍ على القرصِ.
//   2. وإن صرّحَ الارتباطُ بكوميتِ المراجعةِ، فالخطّةُ يجبُ أن تكونَ **موجودةً في
//      ذلكَ الكوميتِ نفسِه** لا في `main` بعدَه.
// والقصورُ التاريخيُّ لا يُمحى ولا يُسكَتُ عنه: يُقيَّدُ استثناءً مُسمّىً بسببِه،
// **ويُقاسُ الاستثناءُ نفسُه** — فإن زالَ سببُه سقطَ الاختبارُ حتى يُرفَعَ من القائمةِ،
// فلا يبقى استثناءٌ ميتٌ يُوسِّعُ ثغرةً.
const PLAN_DEFICIENCIES = [
  {
    engagement: 'M11.04',
    round: 1,
    kind: 'missing-file',
    reason: 'جولةٌ أولى جرت قبلَ أن تُكتَبَ خطّةُ جولةٍ أصلاً — القصورُ مُقَرٌّ به لا مُبرَّرٌ',
  },
  {
    engagement: 'M11.04',
    round: 2,
    kind: 'missing-file',
    reason: 'الجولةُ الثانيةُ وُجِّهت بمصفوفةِ النتائجِ لا بخطّةٍ مستقلّةٍ',
  },
  {
    engagement: 'M11.06',
    round: 1,
    kind: 'absent-from-reviewed-commit',
    reason: 'الخطّةُ كُتِبت بعدَ الاستنساخِ فلم تصلِ الأعضاءَ — عينُ النتيجةِ `R6-A-10`',
  },
  {
    engagement: 'M11.06',
    round: 2,
    kind: 'absent-from-reviewed-commit',
    reason: 'الخطّةُ وُجدتْ في استنساخِ العضوينِ لا في الكوميتِ المُراجَعِ — نفسُ عينِ `R6-A-10`',
  },
  {
    engagement: 'M11.06',
    round: 7,
    kind: 'absent-from-reviewed-commit',
    reason:
      'خطّةُ الجولةِ السابعةِ وصلَتِ الأعضاءَ عبرَ حزمةِ الإطلاقِ (‏`delegation/2026-10-08-round-12-7-launch-brief.md`) لا في كوميتِ الجولةِ الأولى — عينُ النتيجةِ `R6-A-10` نفسُها، وحُكِمَت `open` بإجماعِ الجولةِ',
  },
];

/** @param {string} engagement @param {number} round @param {string} kind */
function isExcused(engagement, round, kind) {
  return PLAN_DEFICIENCIES.some(
    (item) => item.engagement === engagement && item.round === round && item.kind === kind,
  );
}

/** @param {string} commit @param {string} path @returns {boolean} */
function existsAtCommit(commit, path) {
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}:${path}`], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** @returns {{ id: string, rounds: number[], reviewedCommit: string | null }[]} */
function executedEngagements() {
  const contract = readContract();
  const engagements = /** @type {Record<string, unknown>[]} */ (contract['engagements'] ?? []);
  const rows = [];
  for (const engagement of engagements) {
    const executedBy = /** @type {Record<string, unknown> | null} */ (
      engagement['executedBy'] ?? null
    );
    if (executedBy === null) continue;
    const members = /** @type {Record<string, unknown>[]} */ (executedBy['members'] ?? []);
    const rounds = new Set();
    for (const member of members) {
      for (const round of /** @type {number[]} */ (member['rounds'] ?? [])) rounds.add(round);
    }
    rows.push({
      id: String(engagement['id']),
      rounds: [...rounds].sort((a, b) => a - b),
      reviewedCommit:
        typeof executedBy['reviewedCommit'] === 'string' ? executedBy['reviewedCommit'] : null,
    });
  }
  return rows;
}

test('R6-A-10: كلُّ جولةٍ مُقيَّدةٍ لها خطّةٌ على القرصِ', () => {
  const offences = [];
  for (const engagement of executedEngagements()) {
    for (const round of engagement.rounds) {
      const path = `docs/external-review/${engagement.id}-round-${String(round)}-plan.md`;
      if (evidenceExists(path)) continue;
      if (isExcused(engagement.id, round, 'missing-file')) continue;
      offences.push(path);
    }
  }
  assert.deepEqual(offences, [], `جولاتٌ مُقيَّدةٌ بلا خطّةٍ:\n${offences.join('\n')}`);
});

test('R6-A-10: خطّةُ الجولةِ موجودةٌ في الكوميتِ الذي راجعَه المجلسُ', () => {
  const offences = [];
  for (const engagement of executedEngagements()) {
    if (engagement.reviewedCommit === null) continue;
    assert.ok(
      existsAtCommit(engagement.reviewedCommit, 'package.json'),
      `كوميتُ المراجعةِ ${engagement.reviewedCommit} غيرُ مقروءٍ هنا — ` +
        'بعضُ كوميتاتِ المراجعةِ يَسكُنُ `refs/pull/<n>/head` لا فرعاً، فلا يُبلِّغُه استنساخٌ كاملٌ لـ`main` ' +
        'ولا `fetch-depth: 0` — يُجلَبُ بـ`npm run fetch:reviewed-commits` (‏`R10-F-06`)، ولا يُقرأُ تعذُّرُ القراءةِ نجاحاً',
    );
    for (const round of engagement.rounds) {
      const path = `docs/external-review/${engagement.id}-round-${String(round)}-plan.md`;
      if (!evidenceExists(path)) continue;
      if (existsAtCommit(engagement.reviewedCommit, path)) continue;
      if (isExcused(engagement.id, round, 'absent-from-reviewed-commit')) continue;
      offences.push(`${path} ليست في ${engagement.reviewedCommit}`);
    }
  }
  assert.deepEqual(offences, [], `خططُ جولاتٍ لم تصلِ المراجِعينَ:\n${offences.join('\n')}`);
});

test('R6-A-10: استثناءُ قصورٍ لا يبقى بعدَ زوالِ سببِه', () => {
  const stale = [];
  for (const item of PLAN_DEFICIENCIES) {
    const path = `docs/external-review/${item.engagement}-round-${String(item.round)}-plan.md`;
    const onDisk = evidenceExists(path);
    if (item.kind === 'missing-file' && onDisk) {
      stale.push(`${path}: صارَ موجوداً فالاستثناءُ ميتٌ`);
      continue;
    }
    if (item.kind !== 'absent-from-reviewed-commit') continue;
    const engagement = executedEngagements().find((row) => row.id === item.engagement);
    if (engagement === undefined || engagement.reviewedCommit === null) continue;
    if (onDisk && !existsAtCommit(engagement.reviewedCommit, path)) continue;
    stale.push(`${path}: لم يعدْ ينطبقُ عليه سببُ الاستثناءِ`);
  }
  assert.deepEqual(stale, [], `استثناءاتٌ ميتةٌ تُوسِّعُ الثغرةَ:\n${stale.join('\n')}`);
});

test('R6-A-10: قياسُ الدليلِ يقعُ على المستودعِ لا على نسخةِ القرصِ وحدَها', () => {
  /** @type {string[]} */
  const notices = [];
  if (headReadable()) {
    // دليلٌ مُلتزَمٌ وغائبٌ عن شجرةِ العملِ: حاضرٌ في القياسِ ومُعلَنٌ في السجلِّ.
    assert.equal(
      evidenceExists(CONTRACT_PATH, () => false, notices),
      true,
      'دليلٌ يحملُه تاريخُ المستودعِ سقطَ لأنّ نسخةَ القرصِ منقوصةٌ',
    );
    assert.deepEqual(notices, [CONTRACT_PATH], 'النقصُ لم يُعلَنْ — وهذا إسكاتٌ لا قياسٌ');
    // وما لا يحملُه المستودعُ لا يُقرأُ دليلاً بحالٍ.
    assert.equal(
      evidenceExists('docs/external-review/لا-وجودَ-لهذا-التقريرِ.md', () => false, []),
      false,
      'مسارٌ لا في القرصِ ولا في التاريخِ قُرئَ دليلاً',
    );
  } else {
    // تعذُّرُ القياسِ التاريخيِّ يُسقِطُ القياسَ إلى القرصِ وحدَه — الأشدُّ لا الأخفُّ.
    assert.equal(
      evidenceExists(CONTRACT_PATH, () => false, []),
      false,
      'بلا تاريخٍ مقروءٍ يجبُ أن يبقى القياسُ على القرصِ وحدَه',
    );
  }
  // وملفٌّ جديدٌ قبلَ الالتزامِ يكفيه القرصُ، فلا يُعطَّلُ عملٌ مشروعٌ ولا يُخفَى نقصٌ.
  assert.equal(
    evidenceExists('docs/external-review/تقريرٌ-جديدٌ.md', () => true, notices),
    true,
    'ملفٌّ حاضرٌ على القرصِ قبلَ الالتزامِ يجبُ أن يُقرأَ دليلاً',
  );
  assert.deepEqual(notices.length, 1, 'ما كان على القرصِ لا يُعَدُّ نقصاً في الشجرةِ');
});

test('R6-A-10: نقصُ شجرةِ العملِ يُعلَنُ سطراً مقروءاً لا يُسكَتُ عنه', () => {
  const count = PRUNED_TREE_NOTICES.length;
  // القياسُ يُعلَنُ في الحالينِ: صفراً كان أو أكثرَ. وسطرُ «صفرٍ» ليس زينةً —
  // به يُعرَفُ أنّ الحارسَ قاسَ الشجرةَ ولم يسكتْ عنها.
  console.error(
    count === 0
      ? 'ℹ️ شجرةُ العملِ كاملةٌ: كلُّ دليلٍ مُقيَّدٍ حاضرٌ على القرصِ.'
      : `⚠️ ${String(count)} دليلاً مُقيَّداً في تاريخِ المستودعِ وغائباً عن شجرةِ العملِ:\n` +
          PRUNED_TREE_NOTICES.map((path) => `  - ${path}`).join('\n') +
          '\nوهذا نقصُ نسخةٍ لا عطبُ جودةٍ — والقياسُ وقعَ على تاريخِ المستودعِ.',
  );
  assert.ok(Array.isArray(PRUNED_TREE_NOTICES));
});
