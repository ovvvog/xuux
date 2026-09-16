#!/usr/bin/env node
/**
 * حاجزُ تقريرِ الجاهزيّةِ بتأجيلاتٍ صريحةٍ — البوابةُ السادسةُ والأربعون في تسلسلِ
 * الحواجزِ المُعلَنِ في سجلِّ العمل (الخطوة `M11.08`).
 *
 * **رتبةٌ مقيسةٌ لا مُدَّعاة (المادة 4):** الرتبةُ أعلاه تتبع التسلسلَ المكتوبَ في
 * سجلِّ العملِ منذ `WL-043`، وهو تسلسلٌ **سرديٌّ** يختلف عن موضعِ الحاجزِ المقيسِ
 * في سلسلةِ `npm run validate`؛ وفارقُهما دَينُ توثيقٍ **سابقٌ** لهذه الخطوةِ
 * مسجَّلٌ في `WL-048` و`WL-050`–`WL-060`، ولا يُصلَح بتعديلِ سجلٍّ قديم.
 *
 * الحواجزُ قبلَها تحرس أن يعملَ النظامُ ويتعافى ويُوقَف. وهذه تحرس سؤالاً آخرَ:
 * **هل يُقال الناقصُ ناقصاً؟** فمعيارُ `M11.08` بحرفِه «صفرُ بندٍ بلا دليلٍ أو بلا
 * تأجيلٍ معلَنٍ» — وإحدى عشرةَ قاعدةً:
 *
 *   R0: `config/readiness-report.yaml` و`config/readiness-deferrals.yaml` تُحمَّلان
 *       بمخطَّطَيهما الصارمَين؛ ووثيقةٌ تُخالف مخطَّطَها تُوقف البوابةَ قبل كلِّ فحصٍ.
 *   R1: كلُّ حكمٍ وحدثٍ ورمزِ رفضٍ وضمانٍ ونوعِ دليلٍ ومصدرِ بنودٍ موثَّقٌ **بالاسمِ**
 *       في `docs/READINESS.md` (المادة 1).
 *   R2: التقابلُ في الاتجاهين بين `refusalCodes` في العقدِ و`READINESS_ERRORS`.
 *   R3: كلُّ رمزِ ضمانٍ (`G-READINESS-*`) حاضرٌ **نصّاً** في ملفِّ إنفاذِه المُعلَن.
 *   R4: **صفرُ بندٍ بلا تغطيةٍ**: عددُ البنودِ المقروءِ يطابق المُعلَنَ في العقدِ،
 *       وكلُّ بندٍ إمّا بدليلٍ يُشار إلى موضعِه أو بتأجيلٍ مُصرَّحٍ — وهذا هو معيارُ
 *       القبولِ نفسُه لا بديلٌ عنه.
 *   R5: كلُّ تأجيلٍ **مُصرَّحٌ كاملُ الحقولِ**، ومُدخلةُ إعلانِه موجودةٌ فعلاً في
 *       سجلِّ العملِ، وليس تأجيلاً يتيماً ولا تأجيلاً لبندٍ مُعلَنٍ مُنجَزاً.
 *   R6: لكلِّ حكمٍ رمزُ خروجٍ **مُفرَدٌ**، و`readiness:reported` وحدَه يخرج صفراً؛
 *       فتقريرٌ ناقصٌ يخرج صفراً بوابةٌ تقرأ النقصَ نجاحاً.
 *   R7: التقريرُ المُقيَّدُ في المستودعِ **غيرُ منزاحٍ** — يُقارَن بايتاً ببايتٍ
 *       بالمولَّدِ من الحقيقةِ الراهنةِ؛ فوثيقةُ جاهزيّةٍ قديمةٌ تكذبُ بصمتٍ.
 *   R8: **لا اعتمادَ ذاتيّاً ولا ادّعاءَ إطلاقٍ**: لا لفظَ `VERIFIED`/`APPROVED`
 *       ولا ما يوازيه في التقريرِ، ولا إعلانَ فتحِ `G11` ولا جاهزيّةِ إطلاقٍ ولا
 *       `100%` — فتلك قراراتٌ سياديّةٌ أو أحكامُ جهةٍ مستقلّةٍ لا يُنتحَل حكمُها؛
 *       وهنا يُنفَّذ الضمانان `G-READINESS-NO-SELF-APPROVAL` و
 *       `G-READINESS-NO-LAUNCH-CLAIM`.
 *   R10: **الحدُّ مقيسٌ في موضعِ قراءتِه لا موصوفٌ في تعليقٍ** (إغلاقُ `LIVE-2`):
 *       ترويسةُ «حكمُ تغطيةٍ لا اعتمادٍ» حاضرةٌ في **أوّلِ التقريرِ** قبلَ أيِّ
 *       مضمونٍ، ولاحقتُها **ملازمةٌ لقيمةِ الحكمِ** في خليّةِ الجدولِ، **والمَخرَجُ
 *       الآليُّ (`--json`) يحملُ الحدَّ معَ القيمةِ** — يُقاسُ بتشغيلِ المولِّدِ
 *       **عمليّةً منفصلةً** وقراءةِ مَخرَجِه لا بقراءةِ شفرتِه نصّاً. **وعلّةُ
 *       وجودِها:** الحدُّ كان مُعلَناً في متنِ §1 والتعليقاتِ والطرفيّةِ، ولا
 *       حاجزَ يقيسُ بقاءَه — **فحذفُه من المولِّدِ ثمّ إعادةُ التوليدِ تمُرُّ خضراءَ
 *       بالمقارنةِ بايتاً ببايتٍ** (R7) لأنّ المقارنةَ تقيسُ التطابُقَ لا المضمونَ.
 *       **وحدٌّ يُحذَفُ بلا أن يُسقِطَ بوابةً حدٌّ غيرُ مُنفَّذٍ.**
 *   R9: **الحكمُ نقيٌّ ومربوطٌ بالمسارِ**: وحداتُ `src/readiness/` (خلا `contract.mjs`
 *       الذي يقرأ العقدَ) لا تستورد `node:fs` ولا `node:child_process` ولا
 *       `node:process` ولا تقرأ ساعةً؛ و`npm run guard:readiness` مربوطٌ في
 *       `validate` وفي `.github/workflows/ci.yml`، و`readiness:report` أمرٌ واحدٌ،
 *       واختبارُ القبولِ يُنادي المولِّدَ **عمليّةً ابنةً** ويقرأ رمزَ خروجِه؛ وهنا
 *       يُنفَّذ الضمانُ `G-READINESS-PURE-JUDGEMENT` بنيةً لا نيّةً.
 *   R11: **الإسنادُ يُقرأ من حقلِه والسياقُ يُسمّى سياقاً** (إغلاقُ `LIVE-4`):
 *       موضعُ الإسنادِ وصيغةُ الإحالةِ المحيَّدةِ **مُعلَنانِ في العقدِ**
 *       (`attribution`) ومطابقانِ لما تقرأُه الشفرةُ — فمصدرانِ للصيغةِ
 *       ينزاحُ أحدُهما بصمتٍ؛ وموثّقانِ **بنصِّهما** في `docs/READINESS.md`
 *       وفي سجلِّ العملِ نفسِه (فمن يكتبُ المُدخلةَ يقرأُ القاعدةَ في
 *       موضعِ كتابتِه). **والتمييزُ مقيسٌ سلوكاً لا مقروءٌ نصّاً**:
 *       يُنادى `evidenceFor` على مُدخلاتٍ مصنوعةٍ فيُقاسُ أربعُ حالاتٍ:
 *       ذِكرٌ في الحقلِ يُقرأ إسناداً، وذِكرٌ في المتنِ يُقرأ ذِكراً **لا**
 *       إسناداً، وذِكرٌ محيَّدٌ في المتنِ **لا يُقرأ دليلاً أصلاً**، ومحيَّدٌ في
 *       الحقلِ كذلكَ. والتقريرُ يُسمّي القسمَينِ ويعدُّ ما لا إسنادَ له.
 *       **وعلّةُ وجودِها:** كان كلُّ ذِكرٍ دليلَ تنفيذٍ، فمُدخلةٌ تقولُ «هذه
 *       الخطوةُ محجوبةٌ» تُصيِّرُها ذاتَ دليلٍ — **وذِكرُ الحَجبِ ليس إنجازاً.**
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقيس **وجودَ الدليلِ وموضعَه لا كفايتَه**؛ فمُدخلةُ
 * سجلٍّ تذكر بنداً دليلٌ على توثيقِه لا شهادةٌ بأنّ ضابطَه كافٍ.
 *
 * **حدٌّ معلَن ثانٍ:** R8 يقيس النصَّ: ادّعاءُ اعتمادٍ بصياغةٍ لم تُعدَّ في قائمةِ
 * الألفاظِ لا يراه هذا الحاجزُ — وهو دَينٌ معلَنٌ في `docs/REMAINING_WORK.md`.
 *
 * **حدٌّ معلَن ثالث:** `readiness:reported` حكمُ **تغطيةٍ** لا اعتمادٌ: لا يفتح
 * `G11` ولا يُعلن جاهزيّةَ إطلاقٍ ولا `100%` ولا يقوم مقامَ `M11.04`–`M11.06`.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { collectReadinessFacts } from './lib/readiness-facts.mjs';
import { loadDeferrals, loadReadinessContract } from '../src/readiness/contract.mjs';
import { READINESS_ERRORS } from '../src/readiness/errors.mjs';
import {
  ATTRIBUTION_FIELD_TITLE,
  evidenceFor,
  NEUTRAL_REFERENCE_PREFIX,
  readWorkLogEntries,
} from '../src/readiness/evidence.mjs';
import {
  COVERAGE_BANNER_TITLE,
  NOT_APPROVAL_CLAIMS,
  renderReport,
  VERDICT_QUALIFIER,
} from '../src/readiness/render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DOC = 'docs/READINESS.md';

/** @param {string} relative @returns {string} */
function readOrEmpty(relative) {
  const file = path.join(ROOT, relative);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** @type {string[]} */
const violations = [];

/** وحداتُ الحكمِ التي يجب أن تبقى نقيّةً (R9). */
const PURE_FILES = [
  'src/readiness/errors.mjs',
  'src/readiness/items.mjs',
  'src/readiness/evidence.mjs',
  'src/readiness/deferrals.mjs',
  'src/readiness/judgement.mjs',
  'src/readiness/render.mjs',
];

// ── R0: العقدُ وسجلُّ التأجيلاتِ يُحمَّلان بمخطَّطَيهما ──
/** @type {Record<string, unknown> | null} */
let contract = null;
/** @type {import('../src/readiness/deferrals.mjs').DeferralRecord[]} */
let deferrals = [];
try {
  contract = loadReadinessContract();
  deferrals = loadDeferrals();
} catch (error) {
  violations.push(
    `R0: عقدُ تقريرِ الجاهزيّةِ أو سجلُّ التأجيلاتِ لا يُحمَّل: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

if (contract !== null) {
  const doc = readOrEmpty(DOC);
  const verdicts = /** @type {{ id: string, exitCode: number }[]} */ (contract.verdicts);
  const events = /** @type {string[]} */ (contract.events);
  const refusalCodes = /** @type {string[]} */ (contract.refusalCodes);
  const guarantees = /** @type {{ id: string, statement: string, enforcedBy: string }[]} */ (
    contract.guarantees
  );
  const evidenceKinds = /** @type {{ id: string }[]} */ (contract.evidenceKinds);
  const itemSources = /** @type {{ id: string, expected: number }[]} */ (contract.itemSources);

  // ── R1: كلُّ معرَّفٍ موثَّقٌ بالاسمِ ──
  if (doc === '') {
    violations.push(`R1: ${DOC} غائبةٌ — ولا عملَ بلا توثيقٍ (المادة 1).`);
  } else {
    /** @type {Array<[string, string]>} */
    const documented = [
      ...verdicts.map((verdict) => /** @type {[string, string]} */ (['الحكم', verdict.id])),
      ...events.map((event) => /** @type {[string, string]} */ (['حدث المساءلة', event])),
      ...refusalCodes.map((code) => /** @type {[string, string]} */ (['رمز الرفض', code])),
      ...guarantees.map((guarantee) => /** @type {[string, string]} */ (['الضمان', guarantee.id])),
      ...evidenceKinds.map((kind) => /** @type {[string, string]} */ (['نوع الدليل', kind.id])),
      ...itemSources.map((source) => /** @type {[string, string]} */ (['مصدر البنود', source.id])),
      ...deferrals.map(
        (deferral) => /** @type {[string, string]} */ (['البند المؤجَّل', deferral.id]),
      ),
    ];
    for (const [kind, id] of documented) {
      if (!doc.includes(id)) {
        violations.push(
          `R1: ${kind} «${id}» غيرُ موثَّقٍ بالاسمِ في ${DOC} — والعهدُ يُكتب لا يُفترَض.`,
        );
      }
    }
    for (const section of ['ما لا يقولُه', 'التأجيل المُصرَّح', 'حدود معلَنة']) {
      if (!doc.includes(section)) {
        violations.push(
          `R1: قسمُ «${section}» غائبٌ عن ${DOC} — وتقريرُ جاهزيّةٍ بلا حدودٍ مكتوبةٍ يُقرأ اعتماداً.`,
        );
      }
    }
  }

  // ── R2: تقابلُ رموزِ الرفضِ في الاتجاهين ──
  const declaredCodes = new Set(refusalCodes);
  const implementedCodes = new Set(/** @type {string[]} */ (Object.values(READINESS_ERRORS)));
  for (const code of declaredCodes) {
    if (!implementedCodes.has(code)) {
      violations.push(
        `R2: الرمز «${code}» معلَنٌ في العقدِ ولا وجودَ له في READINESS_ERRORS — وعدٌ لا يُرَدُّ به شيء.`,
      );
    }
  }
  for (const code of implementedCodes) {
    if (!declaredCodes.has(code)) {
      violations.push(
        `R2: الرمز «${code}» في READINESS_ERRORS ولا إعلانَ له في العقدِ — رفضٌ لا يجد قارئُ العقدِ معناه.`,
      );
    }
  }

  // ── R3: كلُّ ضمانٍ حاضرٌ نصّاً في ملفِّ إنفاذِه ──
  for (const guarantee of guarantees) {
    const enforcing = readOrEmpty(guarantee.enforcedBy);
    if (enforcing === '') {
      violations.push(`R3: ملفُّ إنفاذِ الضمان «${guarantee.id}» (${guarantee.enforcedBy}) غائب.`);
      continue;
    }
    if (!enforcing.includes(guarantee.id)) {
      violations.push(
        `R3: الضمان «${guarantee.id}» ليس حاضراً نصّاً في ملفِّ إنفاذِه ${guarantee.enforcedBy} — وضمانٌ لا يُشار إليه في منفِّذِه ضمانٌ يُنسى عند أوّلِ إعادةِ كتابة.`,
      );
    }
  }

  // ── R4 و R5: معيارُ القبولِ نفسُه مقيسٌ على القرصِ ──
  /** @type {ReturnType<typeof collectReadinessFacts> | null} */
  let facts = null;
  try {
    facts = collectReadinessFacts({ root: ROOT, contract, deferrals });
  } catch (error) {
    violations.push(
      `R4: وقائعُ الجاهزيّةِ لا تُقاس: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (facts !== null) {
    for (const fault of facts.judgement.faults) {
      const rule = fault.code === READINESS_ERRORS.ITEM_UNCOVERED ? 'R4' : 'R5';
      violations.push(`${rule}: ${fault.code} · ${fault.id} — ${fault.evidence}`);
    }
    if (facts.judgement.coverage.total === 0) {
      violations.push('R4: لم يُقرأ بندٌ واحدٌ — وتقريرٌ عن لا شيءٍ ليس قياساً.');
    }

    // ── R7: التقريرُ غيرُ منزاحٍ ──
    const outputRelative = /** @type {Record<string, string>} */ (contract.sources).output ?? '';
    const rendered = `${renderReport({
      items: facts.items,
      judgement: facts.judgement,
      deferrals,
      project: facts.project,
      contract:
        /** @type {{ objective: { statement: string, limit: string }, version: string }} */ (
          contract
        ),
    })}\n`;
    const onDisk = readOrEmpty(outputRelative);
    if (onDisk === '') {
      violations.push(`R7: ${outputRelative} غائبٌ — ومعيارٌ يوجب تقريراً لا يُوفى بغيابِه.`);
    } else if (onDisk !== rendered) {
      violations.push(
        `R7: ${READINESS_ERRORS.REPORT_DRIFT} — ${outputRelative} منزاحٌ عن الحقيقةِ الراهنةِ بايتاً ببايتٍ؛ شغِّلْ \`npm run readiness:report\`.`,
      );
    }

    // ── R8: لا اعتمادَ ذاتيّاً ولا ادّعاءَ إطلاقٍ ──
    /** @type {Array<[RegExp, string, string]>} */
    const forbiddenClaims = [
      [
        /\bVERIFIED\b/,
        READINESS_ERRORS.SELF_APPROVAL,
        'لفظُ اعتمادٍ لا يُوضَع نيابةً عن جهةٍ مستقلّةٍ.',
      ],
      [
        /\bAPPROVED\b/,
        READINESS_ERRORS.SELF_APPROVAL,
        'والموافقةُ قرارُ صاحبِها لا قرارُ مولِّدِ التقريرِ.',
      ],
      [/النظامُ آمنٌ/, READINESS_ERRORS.SELF_APPROVAL, 'و«آمنٌ» حكمُ مراجعةٍ مستقلّةٍ لم تقع.'],
      [/جاهزٌ للإطلاق/, READINESS_ERRORS.LAUNCH_CLAIM, 'وجاهزيّةُ الإطلاقِ قرارٌ سياديٌّ مؤجَّلٌ.'],
      [
        /(?:^|[^\d])100%/,
        READINESS_ERRORS.LAUNCH_CLAIM,
        'و«100%» إعلانُ اكتمالٍ لم تسمحْ به آلةُ الحالاتِ.',
      ],
      [/G11\s*مفتوح/, READINESS_ERRORS.LAUNCH_CLAIM, 'وفتحُ البوابةِ النهائيّةِ لا يُعلَن هنا.'],
    ];
    for (const [pattern, code, why] of forbiddenClaims) {
      const lines = onDisk.split('\n');
      for (const [index, line] of lines.entries()) {
        // السطورُ التي تُصرِّح بالنفي («لا يُعلِنُ… ولا 100%») مقصودةٌ فتُستثنى.
        if (!pattern.test(line)) continue;
        if (/\bلا\b|ليس|ممنوع|غيرُ/.test(line)) continue;
        violations.push(
          `R8: ${code} — ${outputRelative}:${String(index + 1)} «${line.trim().slice(0, 60)}» — ${why}`,
        );
      }
    }
  }

  // ── R6: رمزُ خروجٍ مُفرَدٌ لكلِّ حكمٍ، والصفرُ للتقريرِ وحدَه ──
  const exitCodes = verdicts.map((verdict) => verdict.exitCode);
  if (new Set(exitCodes).size !== exitCodes.length) {
    violations.push('R6: حكمانِ يتشاركانِ رمزَ خروجٍ — فلا يُميَّز أحدُهما من الآخرِ آلياً.');
  }
  for (const verdict of verdicts) {
    if (verdict.id === 'readiness:reported' && verdict.exitCode !== 0) {
      violations.push(
        'R6: حكمُ التقريرِ الكاملِ لا يخرج صفراً — والمسارُ الآليُّ يقرأ الصفرَ نجاحاً.',
      );
    }
    if (verdict.id !== 'readiness:reported' && verdict.exitCode === 0) {
      violations.push(
        `R6: الحكم «${verdict.id}» يخرج صفراً — وحكمٌ بالنقصِ يخرج صفراً حكمٌ لا يقرؤه مسارٌ آليّ.`,
      );
    }
  }

  // ── R9: نقاءُ الحكمِ وربطُ المسارِ واختبارُ القبولِ ──
  const FORBIDDEN_IMPORTS = ['node:fs', 'node:child_process', 'node:process'];
  for (const relative of PURE_FILES) {
    const source = readOrEmpty(relative);
    if (source === '') {
      violations.push(`R9: الوحدة ${relative} غائبةٌ فلا يُقاس نقاؤها.`);
      continue;
    }
    for (const specifier of FORBIDDEN_IMPORTS) {
      if (source.includes(`'${specifier}'`)) {
        violations.push(
          `R9: الوحدة ${relative} تستورد «${specifier}» — وحكمٌ يملك أن يكتب على ما يفحصه يملك أن يُصلِحه ثم يُثني عليه.`,
        );
      }
    }
    if (source.includes('Date.now(')) {
      violations.push(
        `R9: ${relative} يُنادي Date.now( — وتقريرٌ يحمل لحظةَ تشغيلِه يُبطِل قياسَ انزياحِه.`,
      );
    }
  }
  const manifest = readOrEmpty('package.json');
  const WIRE = 'npm run guard:readiness';
  if (!manifest.includes(WIRE)) {
    violations.push(`R9: «${WIRE}» غيرُ مربوطٍ في سلسلةِ validate — وبوابةٌ لا تُشغَّل نيّة.`);
  }
  if (!readOrEmpty('.github/workflows/ci.yml').includes(WIRE)) {
    violations.push(
      `R9: «${WIRE}» غيرُ مربوطٍ في .github/workflows/ci.yml — والأخضرُ المحليُّ ليس حكماً (المادة 2).`,
    );
  }
  if (!manifest.includes('"readiness:report"')) {
    violations.push(
      'R9: أمرُ «readiness:report» غيرُ مُعلَنٍ في package.json — وتقريرٌ يحتاج سلسلةَ أوامرَ يدويّةٍ تقريرٌ لا يُولَّد.',
    );
  }
  const generator = readOrEmpty('scripts/readiness-report.mjs');
  for (const needle of ['--write', '--json', 'ARGUMENT_UNKNOWN']) {
    if (!generator.includes(needle)) {
      violations.push(
        `R9: مولِّدُ التقريرِ لا يذكر «${needle}» — وأداةٌ تتجاهل وسيطاً لم تفهمْه قد تكون فهمت شيئاً آخرَ.`,
      );
    }
  }
  for (const needle of ['force-pass', 'process.stdin', 'prompt(']) {
    if (generator.includes(needle)) {
      violations.push(
        `R9: مولِّدُ التقريرِ يحمل «${needle}» — وخطوةٌ يدويّةٌ تنقض «أمراً واحداً».`,
      );
    }
  }
  const acceptance = readOrEmpty('tests/readiness/report.test.mjs');
  if (acceptance === '') {
    violations.push(
      'R9: tests/readiness/report.test.mjs غائب — ومعيارُ «صفرُ بندٍ بلا دليلٍ أو بلا تأجيلٍ معلَنٍ» بلا اختبارِ قبولٍ ادّعاء.',
    );
  } else {
    for (const needle of ['node:child_process', 'scripts/readiness-report.mjs', 'status']) {
      if (!acceptance.includes(needle)) {
        violations.push(
          `R9: اختبارُ القبولِ لا يذكر «${needle}» — ونداءُ دالّةٍ في العمليّةِ نفسِها لا يقيس أمراً واحداً يمشي بلا تدخّل.`,
        );
      }
    }
  }

  // ── R10: الحدُّ مقيسٌ في موضعِ قراءتِه — إغلاقُ `LIVE-2` ──
  const reportText = readOrEmpty(
    /** @type {Record<string, string>} */ (contract.sources).output ?? 'docs/READINESS_REPORT.md',
  );
  if (reportText === '') {
    violations.push(
      'R10: تقريرُ الجاهزيّةِ غائبٌ من موضعِه المُعلَنِ في العقدِ — وما لا يُقرأُ لا يُقاسُ حدُّه.',
    );
  } else {
    // الترويسةُ قبلَ أيِّ مضمونٍ: تُقاسُ في أوّلِ خمسةِ أسطرٍ لا في الملفِّ كلِّه،
    // فحدٌّ مدفونٌ في القاعِ حدٌّ لا يُقرأُ معَ الحكمِ.
    const head = reportText.split('\n').slice(0, 5).join('\n');
    if (!head.includes(COVERAGE_BANNER_TITLE)) {
      violations.push(
        `R10: ترويسةُ «${COVERAGE_BANNER_TITLE}» ليست في أوّلِ التقريرِ — ومن قرأَ العنوانَ ثمّ جدولَ الحكمِ قرأَ حكماً بلا حدَّه.`,
      );
    }
    for (const claim of NOT_APPROVAL_CLAIMS) {
      if (!reportText.includes(claim)) {
        violations.push(
          `R10: التقريرُ لا يحملُ نفيَ «${claim}» — وما لا يُنفَى نصّاً يُقرأُ مُثبَتاً ضمناً.`,
        );
      }
    }
    const verdictRow = reportText.split('\n').find((line) => line.startsWith('| الحكم |'));
    if (verdictRow === undefined || !verdictRow.includes(VERDICT_QUALIFIER)) {
      violations.push(
        `R10: قيمةُ الحكمِ في جدولِ §2 بلا لاحقةِ «${VERDICT_QUALIFIER}» — وخليّةٌ تقولُ «readiness:reported» وحدَها تُقرأُ اعتماداً.`,
      );
    }
  }

  // ── R11: الإسنادُ من حقلِه والسياقُ يُسمّى سياقاً — إغلاقُ `LIVE-4` ──
  const attribution = /** @type {{ fieldTitle: string, neutralReferencePrefix: string }} */ (
    /** @type {unknown} */ (contract.attribution)
  );
  if (attribution === undefined || attribution === null) {
    violations.push(
      'R11: العقدُ بلا قسمِ `attribution` — وقاعدةُ قراءةِ الدليلِ مدفونةٌ في شفرةٍ قاعدةٌ لا يقرأُها من يكتبُ السجلَّ.',
    );
  } else {
    if (attribution.fieldTitle !== ATTRIBUTION_FIELD_TITLE) {
      violations.push(
        `R11: حقلُ الإسنادِ في العقدِ «${attribution.fieldTitle}» وفي الشفرةِ «${ATTRIBUTION_FIELD_TITLE}» — ومصدرانِ للقاعدةِ ينزاحُ أحدُهما بصمتٍ.`,
      );
    }
    if (attribution.neutralReferencePrefix !== NEUTRAL_REFERENCE_PREFIX) {
      violations.push(
        `R11: صيغةُ الإحالةِ المحيَّدةِ في العقدِ «${attribution.neutralReferencePrefix}» وفي الشفرةِ «${NEUTRAL_REFERENCE_PREFIX}» — فمن حيّدَ بما في الوثيقةِ حيّدَ بما لا يُقرأ.`,
      );
    }
    // موضعُ الإعلانِ موضعُ الكتابةِ: من يكتبُ مُدخلةً يفتحُ سجلَّ العملِ لا العقدَ.
    /** @type {{ where: string, text: string }[]} */
    const declarationSites = [
      { where: DOC, text: readOrEmpty(DOC) },
      {
        where: 'docs/roadmap/05-work-log.md',
        text: readOrEmpty(/** @type {Record<string, string>} */ (contract.sources).workLog ?? ''),
      },
    ];
    for (const { where, text } of declarationSites) {
      if (text === '' || !text.includes(NEUTRAL_REFERENCE_PREFIX)) {
        violations.push(
          `R11: صيغةُ الإحالةِ المحيَّدةِ غيرُ موثّقةٍ بنصِّها في ${where} — وصيغةٌ لا يعلمُ بها الكاتبُ صيغةٌ لا تُستعمل.`,
        );
      }
    }

    // **والتمييزُ يُقاسُ سلوكاً:** مُدخلاتٌ مصنوعةٌ تُمرَّرُ على القارئِ نفسِه
    // الذي يقرأُ المستودعَ — فحاجزٌ يقرأُ تعليقاً يمرُّ على قاعدةٍ موصوفةٍ غيرِ مُنفَّذةٍ.
    const PROBE_ID = 'M4.03';
    /** @param {string} body @returns {string[]} */
    const kindsFor = (body) => {
      const entries = readWorkLogEntries(
        `### [2026-01-01] — WL-000 — مُدخلةُ قياسٍ
${body}
`,
      );
      return evidenceFor(PROBE_ID, {
        entries,
        roadmapRows: new Map(),
        workLogPath: 'probe',
        roadmapPath: 'probe',
      }).map((ref) => ref.kind);
    };
    /** @type {Array<[string, string, string[]]>} */
    const probes = [
      [
        'ذِكرٌ في حقلِ الإسنادِ',
        `- **${ATTRIBUTION_FIELD_TITLE}:** الخطوة ${PROBE_ID}\n- **الحالة:** تمّة`,
        ['evidence:worklog-attribution'],
      ],
      [
        'ذِكرٌ سياقيٌّ في المتنِ',
        `- **${ATTRIBUTION_FIELD_TITLE}:** الخطوة M9.09\n\nوالخطوة ${PROBE_ID} محجوبةٌ لا عملَ عليها هنا.`,
        ['evidence:worklog-mention'],
      ],
      [
        'ذِكرٌ محيَّدٌ في المتنِ',
        `- **${ATTRIBUTION_FIELD_TITLE}:** الخطوة M9.09\n\nووثيقةُ ${NEUTRAL_REFERENCE_PREFIX}\`${PROBE_ID}\` قديمةٌ.`,
        [],
      ],
      [
        'ذِكرٌ محيَّدٌ في حقلِ الإسنادِ',
        `- **${ATTRIBUTION_FIELD_TITLE}:** لا عملَ على ${NEUTRAL_REFERENCE_PREFIX}\`${PROBE_ID}\``,
        [],
      ],
    ];
    for (const [label, body, expected] of probes) {
      const measured = kindsFor(body);
      if (measured.join('|') !== expected.join('|')) {
        violations.push(
          `R11: ${label} يُقرأ «${measured.join('، ') || 'بلا دليلٍ'}» والمُعلَنُ «${expected.join('، ') || 'بلا دليلٍ'}» — وحكمٌ لا يفرِقُ الإسنادَ من السياقِ يقرأُ ذِكرَ الحَجبِ إنجازاً.`,
        );
      }
    }

    // والفرقُ **مرئيٌّ لمن يقرأُ التقريرَ** لا مدفونٌ في بنيةِ مُعطَياتٍ.
    if (reportText !== '') {
      for (const needle of ['إسناداً مُعلَناً', 'ذِكرٌ سياقيٌّ', NEUTRAL_REFERENCE_PREFIX]) {
        if (!reportText.includes(needle)) {
          violations.push(
            `R11: التقريرُ لا يذكرُ «${needle}» — وفرقٌ لا يُرى في موضعِ قراءةِ الدليلِ فرقٌ غيرُ مُعلَنٍ.`,
          );
        }
      }
    }
  }

  // وقارئُ الآلةِ يُقاسُ **على المَخرَجِ لا على الشفرةِ**: يُشغَّلُ المولِّدُ
  // عمليّةً منفصلةً ويُقرأُ ما يطبعُه فعلاً — فحاجزٌ يقرأُ نصَّ المولِّدِ يمرُّ
  // على حقلٍ مكتوبٍ ولا يُطبَعُ.
  const probe = spawnSync(process.execPath, ['scripts/readiness-report.mjs', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
  /** @type {Record<string, unknown> | null} */
  let emitted;
  try {
    emitted = /** @type {Record<string, unknown>} */ (JSON.parse(probe.stdout));
  } catch {
    emitted = null;
  }
  if (emitted === null) {
    violations.push(
      `R10: مَخرَجُ «readiness-report --json» لا يُقرأُ JSONاً (رمزُ خروجٍ ${String(probe.status)}) — وحكمٌ لا يُقرأُ برنامجيّاً لا يُقاسُ حدُّه.`,
    );
  } else {
    const objective = /** @type {{ objective: { limit: string } }} */ (
      /** @type {unknown} */ (contract)
    ).objective;
    if (emitted.verdictKind !== 'coverage-not-approval') {
      violations.push(
        'R10: المَخرَجُ الآليُّ بلا `verdictKind: "coverage-not-approval"` — وبرنامجٌ يقرأُ `readiness:reported` مُجرَّداً يبني عليه اعتماداً.',
      );
    }
    if (emitted.limit !== objective.limit) {
      violations.push(
        'R10: حدُّ المَخرَجِ الآليِّ لا يطابقُ `objective.limit` في العقدِ — ومصدرانِ للحدِّ ينزاحُ أحدُهما بصمتٍ.',
      );
    }
    const doesNotImply = Array.isArray(emitted.doesNotImply) ? emitted.doesNotImply : [];
    for (const claim of NOT_APPROVAL_CLAIMS) {
      if (!doesNotImply.includes(claim)) {
        violations.push(
          `R10: المَخرَجُ الآليُّ لا يحملُ «${claim}» — وما يُقالُ للإنسانِ ويُكتَمُ عن البرنامجِ حدٌّ ناقصٌ.`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز تقرير الجاهزية بتأجيلات صريحة رفض:');
  for (const violation of violations) {
    console.error(`   • ${violation}`);
  }
  process.exit(1);
}

const verdictCount = contract === null ? 0 : /** @type {unknown[]} */ (contract.verdicts).length;
const codeCount = contract === null ? 0 : /** @type {unknown[]} */ (contract.refusalCodes).length;
const guaranteeCount =
  contract === null ? 0 : /** @type {unknown[]} */ (contract.guarantees).length;
const eventCount = contract === null ? 0 : /** @type {unknown[]} */ (contract.events).length;
const facts = contract === null ? null : collectReadinessFacts({ root: ROOT, contract, deferrals });
const coverage = facts?.judgement.coverage ?? { total: 0, evidenced: 0, deferred: 0, uncovered: 0 };
console.log(
  `✅ حاجز تقرير الجاهزية بتأجيلات صريحة: ${String(coverage.total)} بنداً مقروءاً من مصدرِها لا مكتوبةً بيدٍ — ${String(coverage.evidenced)} بدليلٍ يُشار إلى ملفِّه ومُدخلتِه، و${String(coverage.deferred)} مؤجَّلةٌ تأجيلاً **مُصرَّحاً** بسببِه وحاجزِه ونوعِ حاجزِه وشرطِ فكِّه وصاحبِ قرارِه ومُدخلةِ إعلانٍ موجودةٍ فعلاً في سجلِّ العملِ، و${String(coverage.uncovered)} بلا دليلٍ ولا تأجيلٍ — فمعيارُ «صفرُ بندٍ بلا دليلٍ أو بلا تأجيلٍ معلَنٍ» مقيسٌ لا مُدَّعى؛ والتقريرُ مولَّدٌ بأمرٍ واحدٍ ويُقارَن بايتاً ببايتٍ فلا يبقى قديماً بصمتٍ، و${String(verdictCount)} أحكامٍ لكلٍّ رمزُ خروجٍ مُفرَدٌ لا يخرج صفراً إلا التقريرُ الكاملُ، و${String(eventCount)} أحداثِ مساءلةٍ و${String(codeCount)} رمزَ رفضٍ متقابلةً في الاتجاهين مع \`READINESS_ERRORS\`، و${String(guaranteeCount)} ضماناتٍ كلٌّ برمزٍ حاضرٍ نصّاً في ملفِّ إنفاذِه، ووحداتُ الحكمِ نقيّةٌ لا تلمس قرصاً ولا عمليّةً ولا ساعةً، و**حدُّ الحكمِ مقيسٌ في موضعِ قراءتِه لا موصوفٌ في تعليقٍ**: الترويسةُ «${COVERAGE_BANNER_TITLE}» في أوّلِ خمسةِ أسطرٍ من التقريرِ، ولاحقتُها ملازمةٌ لقيمةِ الحكمِ في خليّةِ §2، و${String(NOT_APPROVAL_CLAIMS.length)} نفياتٍ حاضرةٌ نصّاً في المتنِ **وفي المَخرَجِ الآليِّ** مع \`verdictKind\` و\`limit\` مطابقاً لـ\`objective.limit\` — مقيسةً بتشغيلِ \`readiness-report --json\` عمليّةً منفصلةً وقراءةِ ما طبعَه فعلاً. وحدٌّ معلَنٌ: التقريرُ يقيس **وجودَ الدليلِ وموضعَه لا كفايتَه**، و\`readiness:reported\` حكمُ تغطيةٍ لا اعتمادٌ — لا مراجعةً مستقلّةً (M11.04–M11.06) ولا قراراً ملكيّاً (M11.09) ولا فتحاً لـG11 ولا إذناً بإطلاق.`,
);
