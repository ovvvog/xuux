/**
 * صياغةُ تقريرِ الجاهزيّةِ نصّاً — الخطوة `M11.08`.
 *
 * **التقريرُ مُولَّدٌ لا مكتوبٌ:** يُشتَقُّ من اللوحةِ وسجلِّ العملِ وسجلِّ
 * التأجيلاتِ، فيُقارَن بايتاً ببايتٍ بالمُقيَّدِ في المستودعِ (الضمان
 * `G-READINESS-DRIFT-DETECTED`). ولذلك **لا تاريخَ توليدٍ فيه ولا ساعةَ**: خَرْجٌ
 * يحمل لحظةَ تشغيلِه يختلف في كلِّ تشغيلٍ فيصير الانزياحُ غيرَ قابلٍ للقياسِ،
 * ووثيقةٌ لا يُقاس انزياحُها تكذبُ بصمتٍ بعدَ أوّلِ تغييرٍ.
 *
 * والوحدةُ **نقيّةٌ**: وقائعٌ تدخل ونصٌّ يخرج.
 *
 * **وترويسةُ «حكمِ التغطيةِ لا الاعتمادِ» (`LIVE-2`):** كان الحدُّ مُعلَناً في
 * §1 من متنِ التقريرِ وفي تعليقاتِ الشفرةِ وفي مَخرَجِ الطرفيّةِ — **وثلاثتُها
 * لا يقرؤُها من يقرأُ الحكمَ**: من فتحَ الوثيقةَ رأى العنوانَ ثمّ جدولَ §2 وفيه
 * `readiness:reported` **مُجرَّداً**، ومن قرأَه برنامجاً رآه مُجرَّداً في
 * `--json`. **وحدٌّ يُعلَنُ بعيداً عن موضعِ قراءتِه حدٌّ غيرُ مُعلَنٍ.** فصارَ
 * الحدُّ **في الترويسةِ نفسِها** قبلَ كلِّ سطرٍ، **وملازماً لقيمةِ الحكمِ** في
 * خليّةِ الجدولِ، **ومصدرُه واحدٌ** (`NOT_APPROVAL_CLAIMS` أدناه) يُقرأُ منه
 * المتنُ والمَخرَجُ الآليُّ معاً — فلا يفترقُ نصّانِ يقولانِ الشيءَ نفسَه.
 *
 * **وتمييزُ الإسنادِ من السياقِ (`LIVE-4`):** كان عمودُ الدليلِ يسرُدُ المُدخلاتِ
 * سرداً واحداً، فمُدخلةٌ ذكرَت البندَ في سياقِ «هذه الوثيقةُ قديمةٌ» تُقرأ في
 * الجدولِ كمُدخلةٍ أُسنِدَ إليها العملُ. **فصارَ للعمودِ قسمانِ مُسمَّيانِ**:
 * «إسناداً مُعلَناً» و«ذِكراً سياقيّاً»، وصارَ في §2 عدُّ البنودِ التي **لا إسنادَ
 * مُعلَنَ لها** — فمن قرأَ الجدولَ رأى الفرقَ بلا أن يفتحَ الشفرةَ.
 *
 * @module readiness/render
 */

import { NEUTRAL_REFERENCE_PREFIX } from './evidence.mjs';

/**
 * عنوانُ الترويسةِ الحاكمةِ — **يُقاسُ حضورُه في أوّلِ التقريرِ** بالقاعدةِ `R10`
 * في `scripts/guard-readiness.mjs`، فلا يُحذَفُ بصمتٍ ثمّ يُعادُ التوليدُ أخضرَ.
 */
export const COVERAGE_BANNER_TITLE = '⛔ حكمُ تغطيةٍ لا اعتمادٍ';

/** لاحقةٌ تُلازِمُ قيمةَ الحكمِ في خليّةِ الجدولِ فلا تُقرأُ القيمةُ مُجرَّدةً. */
export const VERDICT_QUALIFIER = 'حكمُ تغطيةٍ لا اعتمادٍ';

/**
 * ما **لا** يعنيه الحكمُ — **مصدرٌ واحدٌ** يقرأُ منه متنُ التقريرِ والمَخرَجُ
 * الآليُّ (`--json`) معاً. ونسخُ هذه العبارةِ في موضعَينِ يجعلُ لها مصدرَينِ
 * للحقيقةِ فينزاحُ أحدُهما عن الآخرِ بصمتٍ.
 */
export const NOT_APPROVAL_CLAIMS = Object.freeze([
  'لا يُعلِنُ اعتماداً أمنياً ولا قانونياً ولا أخلاقياً',
  'لا يُقرأُ مراجعةً مستقلّةً — وكفايةُ الضابطِ شأنُ `M11.04`–`M11.06` وحدَها',
  'لا يفتحُ البوابةَ النهائيّةَ `G11`',
  'لا يُعلِنُ جاهزيّةَ إطلاقٍ ولا يُقيمُ مقامَ القرارِ الملكيِّ `M11.09`',
  // ولا يُكتَبُ الرمزُ «مئةٌ بالمئةِ» هنا رقماً: القاعدةُ `R8` تمنعُ ورودَه في
  // الوثيقةِ حتّى منفيّاً، ومنعُ اللفظِ أضيقُ من منعِ المعنى فيُقالُ المعنى.
  'لا يرفعُ نسبةَ الإنجازِ إلى التمامِ — والتمامُ قرارُ المالكِ وحدَه',
]);

const AUTHORITY_TEXT = Object.freeze({
  owner: 'المالكُ (قرارٌ سياديٌّ)',
  'external-independent-party': 'جهةٌ خارجيّةٌ مستقلّةٌ (لا المنفِّذُ)',
  'model-council': 'مجلسُ نماذجٍ مستقلٌّ (Model Council — لا المنفِّذُ)',
  github: 'GitHub (قيدُ خطةٍ خارجيٌّ)',
});

const BLOCKER_KIND_TEXT = Object.freeze({
  'external-party': 'جهةٌ خارجيّةٌ',
  'external-plan': 'قيدُ خطةٍ خارجيٌّ',
  'sovereign-decision': 'قرارٌ سياديٌّ',
});

/**
 * @param {string[]} cells
 * @returns {string}
 */
function row(cells) {
  return `| ${cells.join(' | ')} |`;
}

/**
 * @param {import('./judgement.mjs').CoveredItem} item
 * @returns {string}
 */
function evidenceText(item) {
  if (item.coverage === 'deferred') {
    return '**مؤجَّلٌ مُصرَّحاً** — سجلُّ التأجيلاتِ `config/readiness-deferrals.yaml`';
  }
  if (item.evidence.length === 0) return '**بلا دليلٍ**';
  const attribution = item.evidence
    .filter((ref) => ref.kind === 'evidence:worklog-attribution')
    .map((ref) => `\`${ref.locator}\``);
  const mention = item.evidence
    .filter((ref) => ref.kind === 'evidence:worklog-mention')
    .map((ref) => `\`${ref.locator}\``);
  const table = item.evidence.filter((ref) => ref.kind === 'evidence:roadmap-table');
  const parts = [];
  if (attribution.length > 0) parts.push(`إسناداً مُعلَناً: ${attribution.join('، ')}`);
  if (mention.length > 0) parts.push(`ذِكراً سياقيّاً: ${mention.join('، ')}`);
  if (table.length > 0) parts.push('جدولُ «أدلّة تنفيذ» في الخارطةِ');
  return parts.join(' · ');
}

/**
 * عددُ البنودِ التي **لا إسنادَ مُعلَنَ لها** — دليلُها ذِكرٌ في المتنِ أو صفُّ
 * خارطةٍ لا حقلُ «المسار والخطوة». **وعددٌ لا يُعلَن عددٌ لا يُقاس.**
 *
 * @param {import('./judgement.mjs').CoveredItem[]} items
 * @returns {number}
 */
function countWithoutAttribution(items) {
  return items.filter(
    (item) =>
      item.coverage === 'evidenced' &&
      !item.evidence.some((ref) => ref.kind === 'evidence:worklog-attribution'),
  ).length;
}

/**
 * @param {object} facts
 * @param {import('./judgement.mjs').CoveredItem[]} facts.items
 * @param {import('./judgement.mjs').ReadinessJudgement} facts.judgement
 * @param {import('./deferrals.mjs').DeferralRecord[]} facts.deferrals
 * @param {{ version: string, percent: number, counter: string, lastEntry: string }} facts.project
 * @param {{ objective: { statement: string, limit: string }, version: string }} facts.contract
 * @returns {string}
 */
export function renderReport(facts) {
  const { items, judgement, deferrals, project, contract } = facts;
  const steps = items.filter((item) => item.kind === 'step');
  const gates = items.filter((item) => item.kind === 'gate');
  const lines = [];

  lines.push('# تقريرُ الجاهزيّةِ — الخطوة `M11.08`');
  lines.push('');
  lines.push(`> ## ${COVERAGE_BANNER_TITLE}`);
  lines.push('>');
  lines.push(
    '> **هذا التقريرُ لا يُعلِنُ جاهزيّةً ولا اعتماداً.** حكمُه ' +
      '`readiness:reported` يعني أنّ كلَّ بندٍ **مقابَلٌ بدليلٍ يُشار إلى موضعِه ' +
      'أو بتأجيلٍ مُصرَّحٍ** — **ولا يعني أنّ الضابطَ كافٍ**. وبنصِّه:',
  );
  lines.push('>');
  for (const claim of NOT_APPROVAL_CLAIMS) {
    lines.push(`> - ${claim}.`);
  }
  lines.push('>');
  lines.push(
    '> **ومن قرأَه اعتماداً قرأَ ما ليس فيه.** وهذه الترويسةُ **مقيسةٌ لا ' +
      'مُزيَّنةٌ**: القاعدةُ `R10` في `npm run guard:readiness` تُثبِتُ حضورَها في ' +
      'أوّلِ الوثيقةِ وملازمةَ لاحقتِها لقيمةِ الحكمِ وحملَ المَخرَجِ الآليِّ ' +
      '(`--json`) لها — فحَذفُها يُسقِطُ البوابةَ لا يُخضِّرُها.',
  );
  lines.push('');
  lines.push(
    '> **وثيقةٌ مُولَّدةٌ آلياً — لا تُحرَّر بيدٍ.** تُولَّد بأمرٍ واحدٍ ' +
      '(`npm run readiness:report`) من لوحةِ الخطواتِ وسجلِّ العملِ وسجلِّ ' +
      'التأجيلاتِ، ويُثبت الحاجزُ `guard:readiness` أنّها **غيرُ منزاحةٍ** عن ' +
      'الحقيقةِ الراهنةِ. وأيُّ تحريرٍ يدويٍّ يُكشَف بالمقارنةِ بايتاً ببايتٍ.',
  );
  lines.push('');
  lines.push('## 1. ما يقولُه هذا التقريرُ وما لا يقولُه');
  lines.push('');
  lines.push(`**الغرضُ:** ${contract.objective.statement}`);
  lines.push('');
  lines.push(`**الحدُّ المقيسُ:** ${contract.objective.limit}`);
  lines.push('');
  lines.push(
    '**وما لا يقولُه هذا التقريرُ — صريحاً:** مسرودٌ بنصِّه في **ترويسةِ ' +
      '«' +
      COVERAGE_BANNER_TITLE +
      '» أعلى هذه الوثيقةِ** — ولم يُكرَّرْ هنا قصداً: ' +
      'للحدِّ **مصدرٌ واحدٌ** (`NOT_APPROVAL_CLAIMS`) يُقرأ منه المتنُ والمَخرَجُ ' +
      'الآليُّ (`--json`) معاً، **ونسختانِ للحدِّ تنزاحُ إحداهما عن الأخرى بصمتٍ.**',
  );
  lines.push('');
  lines.push('## 2. الحكمُ المقيسُ');
  lines.push('');
  lines.push(row(['المقياس', 'القيمة']));
  lines.push(row(['---', '---']));
  lines.push(row(['الحكم', `\`${judgement.verdict}\` — **${VERDICT_QUALIFIER}**`]));
  lines.push(row(['عددُ البنودِ المقروءةِ', String(judgement.coverage.total)]));
  lines.push(row(['بنودٌ بدليلٍ يُشار إلى موضعِه', String(judgement.coverage.evidenced)]));
  lines.push(row(['بنودٌ مؤجَّلةٌ تأجيلاً مُصرَّحاً', String(judgement.coverage.deferred)]));
  lines.push(row(['بنودٌ بلا دليلٍ ولا تأجيلٍ', String(judgement.coverage.uncovered)]));
  lines.push(
    row([
      'منها: بنودٌ دليلُها **ذِكرٌ سياقيٌّ** لا إسنادٌ مُعلَنٌ',
      String(countWithoutAttribution(items)),
    ]),
  );
  lines.push(row(['عدّادُ الخطواتِ', `\`${project.counter}\``]));
  lines.push(row(['النسبةُ المحسوبةُ آلياً', `${String(project.percent)}%`]));
  lines.push(row(['الإصدار', `\`${project.version}\``]));
  lines.push(row(['آخرُ مُدخلةٍ', `\`${project.lastEntry}\``]));
  lines.push(row(['إصدارُ العقدِ', `\`${contract.version}\``]));
  lines.push('');
  lines.push(
    '**وقراءةُ الحكمِ:** `readiness:reported` تعني أنّ **كلَّ بندٍ مقابَلٌ بدليلٍ ' +
      'أو بتأجيلٍ مُصرَّحٍ** — لا أنّ كلَّ بندٍ منجَزٌ. وعددُ المؤجَّلاتِ أعلاه هو ' +
      'مقدارُ ما **لم يُنجَزْ** وأُعلِنَ عدمُ إنجازِه.',
  );
  lines.push('');
  lines.push(
    '**وفرقُ «الإسنادِ المُعلَنِ» من «الذِّكرِ السياقيِّ»:** الإسنادُ يُقرأ من حقلِ ' +
      '«المسار والخطوة» في مُدخلةِ سجلِّ العملِ أو من عنوانِها — أي من **موضعٍ ' +
      'يُعلِنُ صاحبُه أنّ العملَ وقعَ على هذا البندِ**. والذِّكرُ السياقيُّ ورودُ ' +
      'المعرِّفِ في المتنِ وحدَه، وقد يكون في سياقِ حَجبٍ أو تقادُمِ وثيقةٍ — ' +
      '**فهو موضعٌ يُراجَع لا إعلانُ إنجازٍ**. ومن أرادَ ذِكراً لا يُقرأ دليلاً ' +
      `أصلاً كتبَ المعرِّفَ مسبوقاً بصيغةِ الإحالةِ المحيَّدةِ \`${NEUTRAL_REFERENCE_PREFIX}\` — ` +
      'وهي مقيسةٌ بالقاعدةِ `R11` في `npm run guard:readiness`.',
  );
  lines.push('');
  lines.push('## 3. البنودُ المؤجَّلةُ — إعلانُ عدمِ إنجازٍ لا دليلُ إنجازٍ');
  lines.push('');
  lines.push(row(['البند', 'الحاجزُ', 'نوعُه', 'شرطُ فكِّه', 'صاحبُ القرارِ', 'مُعلَنٌ في']));
  lines.push(row(['---', '---', '---', '---', '---', '---']));
  for (const deferral of deferrals) {
    lines.push(
      row([
        `\`${deferral.id}\``,
        deferral.blocker,
        BLOCKER_KIND_TEXT[/** @type {keyof typeof BLOCKER_KIND_TEXT} */ (deferral.blockerKind)] ??
          deferral.blockerKind,
        deferral.unblockCondition,
        AUTHORITY_TEXT[/** @type {keyof typeof AUTHORITY_TEXT} */ (deferral.authority)] ??
          deferral.authority,
        `\`${deferral.declaredIn}\``,
      ]),
    );
  }
  lines.push('');
  lines.push('### سببُ كلِّ تأجيلٍ بنصِّه');
  lines.push('');
  for (const deferral of deferrals) {
    lines.push(`- **\`${deferral.id}\` — ${deferral.title}:** ${deferral.reason}`);
  }
  lines.push('');
  lines.push('## 4. البواباتُ');
  lines.push('');
  lines.push(row(['البوابة', 'التغطية', 'الدليلُ أو التأجيلُ']));
  lines.push(row(['---', '---', '---']));
  for (const gate of gates) {
    lines.push(
      row([
        `\`${gate.id}\``,
        gate.coverage === 'deferred' ? 'مؤجَّلةٌ مُصرَّحاً' : 'بدليلٍ',
        evidenceText(gate),
      ]),
    );
  }
  lines.push('');
  lines.push('## 5. الخطواتُ بندَاً بندَاً');
  lines.push('');
  lines.push(row(['الخطوة', 'الحالةُ في اللوحةِ', 'التغطية', 'الدليلُ أو التأجيلُ']));
  lines.push(row(['---', '---', '---', '---']));
  for (const step of steps) {
    const coverageText =
      step.coverage === 'deferred'
        ? 'مؤجَّلةٌ مُصرَّحاً'
        : step.coverage === 'evidenced'
          ? 'بدليلٍ'
          : '**بلا تغطيةٍ**';
    lines.push(row([`\`${step.id}\``, step.statusMark, coverageText, evidenceText(step)]));
  }
  lines.push('');
  lines.push('## 6. ما يُوقِفُ هذا التقريرَ');
  lines.push('');
  lines.push(
    'يُصدِرُ المولِّدُ `readiness:incomplete` (رمزُ خروجٍ غيرُ الصفرِ) إذا ظهرَ بندٌ ' +
      'بلا دليلٍ ولا تأجيلٍ، أو تأجيلٌ ناقصُ حقلٍ، أو تأجيلٌ يتيمٌ، أو تأجيلٌ لبندٍ ' +
      'مُعلَنٍ مُنجَزاً، أو مُدخلةُ إعلانٍ لا وجودَ لها؛ ويُصدِرُ `readiness:unmeasured` ' +
      'إذا خالفَ عددُ البنودِ المقروءِ العددَ المُعلَنَ في العقدِ أو غابَ مصدرٌ — ' +
      '**فالصمتُ لا يُقرأ نجاحاً**.',
  );
  lines.push('');
  if (judgement.faults.length > 0) {
    lines.push('### الإخلالاتُ المقيسةُ في هذا التشغيلِ');
    lines.push('');
    for (const fault of judgement.faults) {
      lines.push(`- \`${fault.code}\` — \`${fault.id}\`: ${fault.evidence}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}`;
}
