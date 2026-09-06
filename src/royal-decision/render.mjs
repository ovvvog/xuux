/**
 * توليدُ وثيقةِ حزمةِ القرارِ الملكيِّ من العقدِ — تجهيزُ الخطوةِ `M11.09`.
 *
 * الوثيقةُ **مولَّدةٌ** كي لا يُدَسَّ فيها سطرٌ لا أصلَ له في العقدِ: كلُّ ما
 * يُقرأُ فيها له مصدرٌ في `config/royal-decision.yaml`، والحاجزُ يُقارِنُ المولَّدَ
 * بالمكتوبِ بايتاً ببايتٍ فيمنعُ الانزياحَ.
 *
 * @module royal-decision/render
 */

/**
 * @param {string[]} items
 * @returns {string}
 */
function bullets(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

/**
 * @param {import('./contract.mjs').RoyalDecisionPacketConfig} packet
 * @returns {string}
 */
export function renderRoyalDecisionPacket(packet) {
  const signature = /** @type {Record<string, unknown>} */ (packet.signatureRequirement);
  const audit = /** @type {Record<string, unknown>} */ (packet.auditRecord);
  const envelope = /** @type {string[]} */ (signature.envelopeFields);
  const eventTypes = /** @type {string[]} */ (audit.requiredEventTypes);
  const auditRequirements = /** @type {string[]} */ (audit.requirements);

  const lines = [];
  lines.push('# حزمةُ القرارِ الملكيِّ — `M11.09`');
  lines.push('');
  lines.push('> **وثيقةٌ مولَّدةٌ** من `config/royal-decision.yaml` بأمرِ `npm run royal:packet`.');
  lines.push('> لا تُحرَّرْ يدوياً؛ الحاجزُ `guard:royal-decision` يردُّ أيَّ انزياحٍ.');
  lines.push('');
  lines.push('## ما لا تقولُه هذه الوثيقةُ');
  lines.push('');
  lines.push(
    'لا تقولُ إنَّ قراراً صدرَ، ولا إنَّ الشروطَ السابقةَ مستوفاةٌ، ولا إنَّ النظامَ جاهزٌ للإطلاقِ، ولا إنَّ `G11` قابلةٌ للفتحِ. هي **مُدخلٌ لقرارٍ لم يصدرْ**: تُجهِّزُ ما يحتاجُه المالكُ ليقرِّرَ، ولا تقرِّرُ عنه. والخطوةُ `M11.09` تبقى `⬜`.',
  );
  lines.push('');
  lines.push('## الحدودُ المعلَنةُ');
  lines.push('');
  lines.push(`| الحقل | القيمة |`);
  lines.push(`| --- | --- |`);
  lines.push(`| مُعرِّفُ الحزمةِ | \`${packet.decisionId}\` |`);
  lines.push(`| الخطوةُ | \`${packet.step}\` |`);
  lines.push(`| الموضوعُ | ${packet.subject} |`);
  lines.push(`| صاحبُ القرارِ | \`${packet.authority}\` |`);
  lines.push(`| مَن جهّزَ الحزمةَ | \`executor\` — لا يُقرِّرُ ولا يُوقِّعُ |`);
  lines.push(`| القرارُ | *فارغٌ* |`);
  lines.push(`| التوقيعُ | *فارغٌ* |`);
  lines.push(`| قيدُ سجلِّ الأحداثِ | *فارغٌ* |`);
  lines.push(`| مُدخلةُ الإعلانِ | \`${packet.declaredIn}\` |`);
  lines.push('');
  lines.push('## نطاقُ القرارِ');
  lines.push('');
  lines.push('**ما يُقرَّرُ:**');
  lines.push('');
  lines.push(bullets(packet.scope.decides));
  lines.push('');
  lines.push('**ما لا يُقرَّرُ ولا يُقرأُ من القرارِ:**');
  lines.push('');
  lines.push(bullets(packet.scope.doesNotDecide));
  lines.push('');
  lines.push('## الشروطُ السابقةُ — حالتُها تُقرأُ من سجلِّ التأجيلاتِ');
  lines.push('');
  lines.push('| الشرط | المطلوب | مصدرُ الحالةِ |');
  lines.push('| --- | --- | --- |');
  for (const precondition of packet.preconditions) {
    lines.push(
      `| \`${precondition.id}\` | ${precondition.requirement} | \`${precondition.statusSource}\` |`,
    );
  }
  lines.push('');
  lines.push('## الخياراتُ الثلاثةُ وعواقبُها');
  lines.push('');
  for (const option of packet.options) {
    lines.push(`### \`${option.id}\``);
    lines.push('');
    lines.push(option.meaning);
    lines.push('');
    lines.push('**العواقبُ:**');
    lines.push('');
    lines.push(bullets(option.consequences));
    lines.push('');
    lines.push('**المُخرَجاتُ اللازمةُ:**');
    lines.push('');
    lines.push(bullets(option.requiredArtifacts));
    lines.push('');
  }
  lines.push('## صيغةُ التوقيعِ المطلوبةُ');
  lines.push('');
  lines.push(
    `التوقيعُ ليس صيغةً مخترعةً في هذه الوثيقةِ: هو صيغةُ بوابةِ التاجِ القائمةِ، يتحقّقُ منها \`${String(signature.verifierEntry)}\` في \`${String(signature.verifiedBy)}\`.`,
  );
  lines.push('');
  lines.push(`- الخوارزميّةُ: \`${String(signature.algorithm)}\``);
  lines.push(`- الترميزُ: \`${String(signature.encoding)}\``);
  lines.push(`- المُوقَّعُ عليه: \`${String(signature.signedPayload)}\``);
  lines.push(`- حقولُ المِغلافِ: ${envelope.map((field) => `\`${field}\``).join('، ')}`);
  lines.push(
    `- الفعلُ: \`${String(signature.action)}\` على الهدفِ \`${String(signature.target)}\``,
  );
  lines.push(`- أقصى عمرٍ للأمرِ: \`${String(signature.maxCommandAgeMs)}\` ميلي ثانية`);
  lines.push(`- انزياحُ الساعةِ المقبولُ: \`${String(signature.clockSkewMs)}\` ميلي ثانية`);
  lines.push(`- منعُ الإعادةِ: ${String(signature.replayProtection)}`);
  lines.push('');
  lines.push(`**ملاحظةُ الربطِ:** ${String(signature.bindingNote)}`);
  lines.push('');
  lines.push('## قيدُ التدقيقِ المطلوبُ');
  lines.push('');
  lines.push(
    `- نوعُ الواقعةِ: ${eventTypes.map((type) => `\`${type}\``).join('، ')} (مصدرُها \`${String(audit.eventSource)}\`)`,
  );
  lines.push(`- دفترُ الأوامرِ: \`${String(audit.ledger)}\``);
  lines.push('');
  lines.push(bullets(auditRequirements));
  lines.push('');
  lines.push('## خطةُ التوسّعِ المقترحةُ ومعاييرُ التراجعِ');
  lines.push('');
  lines.push('**مقترحةٌ لا مُقرَّرةٌ** — إقرارُها جزءٌ من القرارِ نفسِه.');
  lines.push('');
  for (const phase of packet.rolloutPlan.phases) {
    const entry = /** @type {string[]} */ (phase.entryCriteria);
    const exit = /** @type {string[]} */ (phase.exitCriteria);
    const rollback = /** @type {string[]} */ (phase.rollbackCriteria);
    lines.push(`### \`${String(phase.id)}\` — ${String(phase.title)}`);
    lines.push('');
    lines.push('**معاييرُ الدخولِ:**');
    lines.push('');
    lines.push(bullets(entry));
    lines.push('');
    lines.push('**معاييرُ الخروجِ:**');
    lines.push('');
    lines.push(bullets(exit));
    lines.push('');
    lines.push('**معاييرُ التراجعِ:**');
    lines.push('');
    lines.push(bullets(rollback));
    lines.push('');
    lines.push(`**المقياسُ:** ${String(phase.measure)}`);
    lines.push('');
  }
  lines.push('## الأحكامُ ورموزُ الخروجِ');
  lines.push('');
  lines.push('| الحكم | رمزُ الخروجِ | المعنى |');
  lines.push('| --- | --- | --- |');
  for (const verdict of packet.verdicts) {
    lines.push(`| \`${verdict.id}\` | \`${String(verdict.exitCode)}\` | ${verdict.meaning} |`);
  }
  lines.push('');
  lines.push('## رموزُ الرفضِ');
  lines.push('');
  for (const code of packet.refusalCodes) {
    lines.push(`- \`${code}\``);
  }
  lines.push('');
  lines.push('## الضماناتُ المُنفَّذةُ');
  lines.push('');
  for (const guarantee of packet.guarantees) {
    lines.push(`- \`${guarantee.id}\`: ${guarantee.statement}`);
  }
  lines.push('');
  lines.push('## ما يُنفَّذُ بعدَ صدورِ القرارِ (وليس قبلَه)');
  lines.push('');
  lines.push(
    '- ربطُ الفعلِ بالعتبةِ السياديّةِ في `config/royal-authority.yaml` — تعديلُ عقدٍ لا يسبقُ قراراً.',
  );
  lines.push(
    '- نسخُ مُعرِّفِ قيدِ سجلِّ الأحداثِ إلى `recordedEventId` بعدَ قبولِ الأمرِ في البوابةِ.',
  );
  lines.push('- مُدخلةُ سجلِّ عملٍ تُوثِّقُ الإصدارَ والنطاقَ والزمنَ، ثم تحديثُ صفِّ `M11.09`.');
  lines.push('');
  return `${lines.join('\n')}`;
}
