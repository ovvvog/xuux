# مراجعةُ r8 لـ`WL-634` — النصُّ كما وصلَ (‏منقولٌ بأمانة)

- **النموذج:** Claude Opus 5.5 (‏وكيلٌ فرعيّ `wl634_reviewer` في Perplexity Computer) — **نفسُ عائلةِ المنفِّذ، ليست مراجعةً مستقلّة**.
- **التاريخ:** 2026-11-28.
- **النطاق:** `fc0ed867..cc46ddea` (‏`wl-634-r7-followups`، `#644`). الشيفرةُ لم تتغيّر بعدَ المراجعة؛ هذا الملفُّ وسطرُ المُدخلةِ وحدَهما أُضيفا بعدَها.
- **البيئة:** PostgreSQL 18.7 على 127.0.0.1:5433، Node v20، شجرةُ عملٍ منفصلةٌ أُزيلت؛ قواعدُ مؤقّتةٌ أُسقِطت.
- **العزل:** سياقُ الوكيلِ منفصل، لكنّ نصَّ المهمّةِ كتبَه المنفِّذ؛ ليس عزلاً تامّاً.
- **ملاحظةُ المنفِّذ على «NOT CHECKED» (‏guard:debt):** لا سكربتَ `guard:debt` في `package.json`؛ `npm run -s` لسكربتٍ غائبٍ يعيدُ 1 بلا خرج — لا حاجزَ راسب. عددُ الصفوفِ (‏76) يقيسُه `guard:project-state` و`guard:doc-counts` الناجحان.
- **صيغةٌ:** قد يُطبِّعُ prettier الفراغات؛ والكياناتُ `&gt;`/`&lt;`/`&amp;` في الرسالةِ أُعيدت إلى `>`/`<`/`&`.

---

WL-634 adversarial review — diff fc0ed867..cc46ddea (origin/wl-634-r7-followups, PR #644 → wl-532-533-integration)

Reviewer: Perplexity Computer subagent, Claude Opus 5.5. This is the same model family as the implementer, so it is not an independent review.
Date: 2026-11-28.
Environment: PostgreSQL 18.7 (Ubuntu 18.7-1) on 127.0.0.1:5433, Node v20, detached worktree /tmp/wt634r at cc46ddea with node_modules symlinked and `npm run -s build` run. The worktree has been removed. The scratch DBs rv634a and rv634b have been dropped. I modified nothing in the repo, pushed nothing and posted nothing.

## CHECKED

1. **Full M3.03 block.** I extracted the `run:` block from ci.yml with a YAML parser and ran it with `set -e` on a fresh DB.
   - rc=0 for the whole down/up sequence, including the new D1 and D2.
   - I had to remove the two pg_roles checks (xf_reaper and the other cluster-wide role check). They fail only because roles are cluster-wide on pg2 and already exist (environmental, as in WL-633).
2. **D1 digest mapping.** The w/p/k digests are correct and match CI:
   - Fresh DB, `up --to 37`: w=eed6e0d6…, p=425df679…, k=017917df…
   - After `up` to 38, all three differ: 21dba21a…, 171529da…, d3e43aa7…
   - After `down` back to 37, the 0037 values return exactly.
   - The same values appeared on two independent DBs (rv634a went through the full CI sequence, rv634b used up --to 37).
   - The r7 reviewer's raw recommendation had the digests rotated (window_breach=425d…). The implementer re-derived them correctly, and the work log says so honestly.
3. **md5 stability across PG versions and CI.** I took the md5 of the literal dollar-quoted body of each function in migrations/0037_fence_rls_no_silent_skip.up.sql, computed with Python from the file. All three equal the hard-coded digests. Two reasons this holds outside my machine:
   - prosrc is the verbatim body text. No PG version normalizes it, and it is not built through EXECUTE/format, so nothing DB-specific (oids, names) is interpolated.
   - .gitattributes has `* text=auto eol=lf`, so CRLF checkouts can't shift the digest.
   - The only fragility is that 0037 must never be edited. The work log discloses this.
4. **D2 mutations.** Each was run inside a rolled-back transaction with xf_ddl_end/xf_ddl_drop disabled:
   - (a) the trigger moved to fence.run_lease
   - (b) CREATE OR REPLACE … WHEN (false) plus ENABLE ALWAYS
   - (c) BEFORE timing plus ENABLE ALWAYS
   - All three give n=35, d=0, m=35, so the old count/enable condition would pass. The new u=1 makes each fail.
   - Also checked: DROP on one relation gives n=34/u=1, and DISABLE gives d=1/u=1. Unmutated: 35|0|35|0.
   - The kind names 'uncovered_relation' and 'uncovered_relation_end' match 0038.up coverage_problems exactly, and 0038's own `$post$` check uses the same kinds.
   - The 0038 uncovered_relation_end branch checks tgfoid, AFTER/STATEMENT/non-instead timing, the I/U/D/T events, WHEN, UPDATE OF and args, so D2 now inherits all of that.
5. **Message regexes.** I compared code points and ran the test regexes against every XF009 MESSAGE in 0024, 0037 and 0038:
   - /منقضٍ أو غائب/u matches only guard_write's 'fence: الإيجارُ منقضٍ أو غائب' (0024:636). guard_write is never redefined after 0024.
   - /انقضى أثناءَ العبارة/u matches only window_breach (0037 and 0038, both up and down texts). The U+200F that follows the match doesn't matter.
   - 0025's 'منقضٍ — الانقضاءُ نهائيّ' (the renew path) and 'لا إيجار' match neither. They cannot arise from an INSERT, and if they somehow did, they would land in the explicit "unknown message" assert failure, which is a correct loud fail rather than a false pass.
   - node-pg `err.message` is the primary message, so there is no prefix or context problem.
6. **C1-END logic.** The policy is FOR ALL (0038:162), and the INSERT has no RETURNING, so only WITH CHECK runs and USING is not applied. That makes guard_write via xf_guard_end the only possible source, and the new assert is sound.
7. **Tests.**
   - `--test-name-pattern=L75-C1` over both files: 4 runs, 3/3 pass every time.
   - C1-END readings: ROW −141 ms, AFTERROW +260 ms, XF009.
   - lease-expiry + lease-expiry-silent-skip + effects: tests 42, pass 41, fail 0, skipped 1. This matches the work log's claim exactly.
8. **Style and guards.** prettier --check is clean on all changed files I checked, eslint is clean on the suite, and guard:project-state passes.
9. **Docs.**
   - The WL-634 work log matches the code: the three mutations and the D1 digest prefixes are right, and "commit-line in coverage_problems/cover_relation of 0038.down ⇒ fail" follows from the md5 check.
   - The CURRENT_STATE dated line is accurate. It corrects the WL-633 count-vs-coverage overclaim without editing the merged text.
   - The LIVE-75 append is accurate: two sources, split by message, D2 now reads coverage_problems, D1 uses md5, no class change.
   - PROJECT_STATUS, HANDOFF and READINESS are consistent with that. The HANDOFF table drops the WL-626 row, which looks like the normal rolling window.
10. **Raw review file header.**
    - Scope accfd416..196112c7 is correct: 196112c7 is the WL-633 commit, accfd416 is the #642 merge, and fc0ed867 merges 196112c7.
    - Model and date are correct, and it discloses same-family, non-independent review and incomplete isolation.
    - PG 18.7 matches the cluster.
    - The body faithfully carries the r7 findings, including the rotated digests, which the implementer did not silently "fix".

## NOT CHECKED

- A real GitHub CI run.
- The `window_breach` branch of L75-C1 under natural timing. It was never hit: all my runs rejected XF009 before any row was produced. It is classified by code reasoning, not reproduced, and the work log discloses this. The "microseconds window" wording is plausible but not measured.
- Whether the raw file is truly verbatim compared with the message the reviewer originally sent. I don't have the original, and the body reads like it may have been reformatted. The header discloses whitespace/prettier and &gt;/&lt; normalisation only.
- The "76 rows" debt count. guard:debt returned rc=1 locally; I didn't investigate, and it's likely environmental or unrelated, but worth confirming in CI.
- Foreign-table coverage, and behaviour under CPU load.

## CONFIRMED DEFECTS

None.

## RISKS (all Low)

- **R1: md5 constants are a maintenance trap.** Any future legitimate change to these three functions in a new migration 0039 does not affect D1, because D1 runs after 0038 down. But a deliberate rewrite of 0037 would require updating the constants. This is disclosed.
- **R2: false-fail edge in D2.** An extra xf_guard_end on a non-protected relation makes n > m and fails D2 even when coverage is fine. That is acceptable strictness, not a false pass.
- **R3: the L75-C1 message classification depends on literal Arabic strings.** A future rewording of the guard_write or window_breach message would turn this into an "unknown message" failure (loud, not silent), so the risk is acceptable.
- **R4: the raw-review "verbatim" claim can't be proven from the repo.** It is a provenance issue, not a code issue.

## SEVERITY

No High, Medium or Low defects; the four Low risks above are informational.

## RECOMMENDATION

Mergeable as is. Optional follow-ups:

1. Add the one-line derivation (`up --to 37`, then md5(prosrc)) as a comment next to the constants. The ci.yml comment already says roughly this.
2. To make "verbatim" provable, either store the reviewer's original message unmodified alongside the file, or soften the header to "transcribed faithfully".
3. Confirm guard:debt is green in CI.
