/**
 * حذفُ فرعِ العملِ بعدَ دمجِه — وحدةُ القرارِ النقيّةُ والتنفيذُ بعميلٍ مُمرَّرٍ (‏`WL-329`).
 *
 * **العيبُ:** فروعٌ مدموجةٌ تبقى فتُضلِّلُ الوكيلَ التالي («هل هذا عملٌ جارٍ؟»). وإعدادُ
 * المستودعِ `delete_branch_on_merge` يُطفأُ بلا أثرٍ في الشفرةِ ولا يُتحقَّقُ من نتيجتِه.
 * فهذه الوحدةُ تُقرِّرُ **ولا تحذفُ إلّا ما ثبتَ دمجُه**، ثمّ **تتحقّقُ أنّ الفرعَ زالَ**،
 * وتُعلِنُ الفشلَ ولا تدّعي الإتمام.
 *
 * @module lib/merged-branch
 */

/**
 * @typedef {{
 *   merged: boolean,
 *   sameRepo: boolean,
 *   headRef: string,
 *   prHeadSha: string,
 *   defaultBranch: string,
 *   currentRefSha: string | null,
 *   isProtected: boolean,
 *   otherOpenPrs: number,
 * }} BranchFacts
 * @typedef {{ action: 'delete' | 'keep' | 'already-gone', reason: string }} BranchDecision
 */

/**
 * القرارُ: يُحذَفُ الفرعُ إن — وفقط إن — دُمِجَ طلبُه، ومن المستودعِ نفسِه، وليس الافتراضيَّ
 * ولا `main` ولا محميّاً، ورأسُه الآنَ هو رأسُ الطلبِ عندَ الدمجِ (‏لا عملَ بعدَه)، ولا طلبَ
 * مفتوحاً آخرَ يستعملُه.
 *
 * @param {BranchFacts} f
 * @returns {BranchDecision}
 */
export function decideBranchDeletion(f) {
  if (!f.merged)
    return {
      action: 'keep',
      reason: 'NOT-MERGED: الطلبُ أُغلِقَ بلا دمجٍ — الفرعُ عملٌ لم يَنتهِ.',
    };
  if (!f.sameRepo)
    return { action: 'keep', reason: 'FORK: فرعٌ في مستودعٍ آخرَ لا يملكُه هذا المستودع.' };
  if (f.headRef === '' || f.headRef === f.defaultBranch || f.headRef === 'main') {
    return {
      action: 'keep',
      reason: `DEFAULT: \`${f.headRef}\` هو الفرعُ الافتراضيُّ — لا يُحذَفُ أبداً.`,
    };
  }
  if (f.currentRefSha === null)
    return { action: 'already-gone', reason: 'GONE: الفرعُ غيرُ موجودٍ أصلاً.' };
  if (f.isProtected)
    return { action: 'keep', reason: `PROTECTED: \`${f.headRef}\` محميٌّ — لا يُحذَف.` };
  if (f.currentRefSha !== f.prHeadSha) {
    return {
      action: 'keep',
      reason: `MOVED: رأسُ \`${f.headRef}\` (${f.currentRefSha.slice(0, 12)}) ليس رأسَ الطلبِ المدموجِ (${f.prHeadSha.slice(0, 12)}) — فيه عملٌ لم يُدمَج.`,
    };
  }
  if (f.otherOpenPrs > 0) {
    return {
      action: 'keep',
      reason: `IN-USE: ${f.otherOpenPrs} طلبٌ مفتوحٌ آخرُ رأسُه \`${f.headRef}\`.`,
    };
  }
  return {
    action: 'delete',
    reason: `MERGED: \`${f.headRef}\` مدموجٌ ورأسُه رأسُ الطلبِ — يُحذَف.`,
  };
}

/**
 * @typedef {{
 *   isMerged: (pr: number) => Promise<boolean>,
 *   getRefSha: (ref: string) => Promise<string | null>,
 *   isProtected: (ref: string) => Promise<boolean>,
 *   countOpenPrsWithHead: (ref: string, exceptPr: number) => Promise<number>,
 *   deleteRef: (ref: string) => Promise<void>,
 * }} BranchApi
 */

/**
 * يُنفِّذُ القرارَ ثمّ يتحقّقُ: بعدَ الحذفِ يُقرأُ المرجعُ ثانيةً، فإن بقيَ فالنتيجةُ فشلٌ.
 *
 * @param {{ pr: number, headRef: string, prHeadSha: string, sameRepo: boolean, defaultBranch: string }} event
 * @param {BranchApi} api
 * @returns {Promise<{ ok: boolean, decision: BranchDecision, verified: string }>}
 */
export async function cleanupMergedBranch(event, api) {
  // الدمجُ يُقرأُ من الواجهةِ لا من حمولةِ الحدثِ وحدَها.
  const merged = await api.isMerged(event.pr);
  const currentRefSha = await api.getRefSha(event.headRef);
  const facts = {
    merged,
    sameRepo: event.sameRepo,
    headRef: event.headRef,
    prHeadSha: event.prHeadSha,
    defaultBranch: event.defaultBranch,
    currentRefSha,
    isProtected: currentRefSha === null ? false : await api.isProtected(event.headRef),
    otherOpenPrs:
      currentRefSha === null ? 0 : await api.countOpenPrsWithHead(event.headRef, event.pr),
  };
  const decision = decideBranchDeletion(facts);
  if (decision.action === 'keep') return { ok: true, decision, verified: 'kept' };
  if (decision.action === 'already-gone') return { ok: true, decision, verified: 'absent' };
  try {
    await api.deleteRef(event.headRef);
  } catch (error) {
    return {
      ok: false,
      decision,
      verified: `DELETE-FAILED: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const after = await api.getRefSha(event.headRef);
  if (after !== null)
    return { ok: false, decision, verified: `STILL-PRESENT: ${after.slice(0, 12)}` };
  return { ok: true, decision, verified: 'absent' };
}
