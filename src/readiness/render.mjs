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
 * @module readiness/render
 */

const AUTHORITY_TEXT = Object.freeze({
  owner: 'المالكُ (قرارٌ سياديٌّ)',
  'external-independent-party': 'جهةٌ خارجيّةٌ مستقلّةٌ (لا المنفِّذُ)',
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
  const worklog = item.evidence
    .filter((ref) => ref.kind === 'evidence:worklog-entry')
    .map((ref) => `\`${ref.locator}\``);
  const table = item.evidence.filter((ref) => ref.kind === 'evidence:roadmap-table');
  const parts = [];
  if (worklog.length > 0) parts.push(`سجلُّ العملِ: ${worklog.join('، ')}`);
  if (table.length > 0) parts.push('جدولُ «أدلّة تنفيذ» في الخارطةِ');
  return parts.join(' · ');
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
    '**وما لا يقولُه هذا التقريرُ — صريحاً:** لا يُعلِنُ اعتماداً أمنياً ولا ' +
      'قانونياً ولا أخلاقياً، ولا يُقرأ مراجعةً مستقلّةً، ولا يفتحُ البوابةَ ' +
      'النهائيّةَ، ولا يُعلِنُ جاهزيّةَ إطلاقٍ، ولا يرفعُ نسبةَ الإنجازِ إلى تمامٍ. ' +
      'ومن قرأ فيه غيرَ ذلك قرأ ما ليس فيه.',
  );
  lines.push('');
  lines.push('## 2. الحكمُ المقيسُ');
  lines.push('');
  lines.push(row(['المقياس', 'القيمة']));
  lines.push(row(['---', '---']));
  lines.push(row(['الحكم', `\`${judgement.verdict}\``]));
  lines.push(row(['عددُ البنودِ المقروءةِ', String(judgement.coverage.total)]));
  lines.push(row(['بنودٌ بدليلٍ يُشار إلى موضعِه', String(judgement.coverage.evidenced)]));
  lines.push(row(['بنودٌ مؤجَّلةٌ تأجيلاً مُصرَّحاً', String(judgement.coverage.deferred)]));
  lines.push(row(['بنودٌ بلا دليلٍ ولا تأجيلٍ', String(judgement.coverage.uncovered)]));
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
