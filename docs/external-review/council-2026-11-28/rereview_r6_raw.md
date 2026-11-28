# إعادةُ مراجعة r6 — نصٌّ خامٌ حرفيّ

- **المراجِع:** وكيلٌ معزولُ السياقِ (‏Claude Opus 5.5، العائلةُ نفسُها للمنفِّذ — **لا تُحسَبُ مستقلّةً عائليّاً**؛ النماذجُ الأخرى رفضتها المنصّة).
- **التاريخ:** 2026-11-28. **النطاق:** `21f163d4`، `1a97f8e7`، `9ac83a05`، واستعادتا `WL-140`/`WL-148` على `origin/wl-532-533-integration@accfd416`.
- **البيئة:** نسخةُ عملٍ `/tmp/r6`، PostgreSQL 18.7 على المنفذ 5433، Node v20. لم يُعطَ إلا الكوميتاتُ والأسئلة.
- النصُّ أدناه كما وصلَ بلا تحرير.

```text
REVIEW REPORT — r6 (origin/wl-532-533-integration @ accfd416), worktree /tmp/r6

SETUP
git -C /home/user/workspace/xuux fetch origin; git worktree add /tmp/r6 origin/wl-532-533-integration -> HEAD accfd416 (Merge #642). node_modules hard-linked; npm run -s build OK. DB used: only postgresql://state:state@127.0.0.1:5433/state (PG 18.7). It initially had no fence schema; I left it at migration version 38 (DB state changed by me; no files under /home/user/workspace modified; worktree edits were reverted, git status clean).

=== CHECKED ===

1) 21f163d4 + 1a97f8e7 (CI M3.03, 0038 rollback assertion)
- Read ci.yml diff, 0038 up/down, CURRENT_STATE diff.
- Extracted the M3.03 run block verbatim from ci.yml into /tmp/m303.sh (awk) and ran: DATABASE_URL=...5433/state bash -e -o pipefail /tmp/m303.sh
  Key output: "طُبِّقت: 1..38 ⇒ النسخة 38", "تُراجع عن: 38 ⇒ النسخة 37" -> new 0038 assertion passed; "تُراجع عن: 37 ⇒ 36" -> 0037 assertion passed; 0036..0031 assertions passed; then failed at the 0030 check "xf_reaper باقٍ بعد down". That failure is environmental (xf_reaper is a cluster-wide role that already exists on this shared server — other DBs ci_sim/state_test_* present); not in scope, not caused by these commits.
- Non-vacuity: after `npm run migrate -- up` to 38: `select count(*) from pg_trigger where tgname='xf_guard_end'` = 35 (= count of fence.protected_relations() = 35); running the new assertion line (line 5 of the block) at v38 -> exit 1, stderr "xf_guard_end من 0038 باقٍ بعد down". So the assertion is not vacuous; commit message claim confirmed.
- Shell quoting: the new node -e line is byte-pattern-identical to the neighbouring lines (\"...\" outer, \\\"...\\\" inner SQL, single-quoted literal); it executed correctly under bash both pass and fail cases. Confirmed OK.
- What 0038 down claims to undo (header + body): restore window_breach, coverage_problems, cover_relation to 0037 text, drop xf_guard_end from every relation, re-register manifest. Real down verified manually:
  at v38: window_breach tx_ts=t st_ts=f; coverage_problems mentions xf_guard_end=t; cover_relation mentions xf_guard_end=t; coverage_problems()=[]
  after down: window_breach tx_ts=f st_ts=t; coverage_problems xf_guard_end=f; cover_relation xf_guard_end=f; coverage_problems()=[]; xf_guard_end count 0. So the real down is correct.
- Sufficiency (mutation): I removed the `CREATE OR REPLACE FUNCTION fence.window_breach ... $f$;` block from 0038 down (worktree only; applied with checksum recorded via down->mutate->up), then down: new 0038 assertion exit 0 (PASS), window_breach still contains transaction_timestamp (0038 text) = t; next down (0037) and 0037 assertion exit 0 (PASS). File reverted afterwards. => The CI step does not detect a 0038 down that fails to restore window_breach (and by the same argument coverage_problems/cover_relation — not separately run, inferred). Masked because 0037 down drops window_breach anyway and manifest is re-registered by 0038 down.
- Asymmetry: the M3.03 post-re-up checks cover 0030..0037 (e.g. "دالّةُ 0037 غائبةٌ بعد up") but there is no post-up check that xf_guard_end is present again after the final `migrate up`. WL-621/WL-622 added both directions; WL-628 added only the down direction.
- CURRENT_STATE dated line (WL-628, 2026-11-28) accurately describes the change (rollback 0038 first, check no xf_guard_end, then 0037 as before). It says "on a request branch (#640, not main)"; #640 is now merged into integration (a7e59f50) — wording dated, acceptable. guard:project-state with PROJECT_STATE_HISTORY_BASE=origin/wl-532-533-integration and =c1534749: both "✅ ... ستّتُها ناجحةٌ".

2) 9ac83a05 (WL-632, L75-C1)
- Trigger order: experiment on a TEMP table, triggers created in order xf_guard_zz_l75, xf_guard, l75_pre (BEFORE INSERT FOR EACH STATEMENT, NOTICE TG_NAME): output "l75_pre / xf_guard / xf_guard_zz_l75". Confirms PG fires same-timing triggers in name order regardless of creation order; 'l75_pre' < 'xf_guard' < 'xf_guard_zz_l75'. Reasoning correct.
- guard_write reads `l.expires_at > clock_timestamp()` (XF009) — read from pg_proc prosrc at v38. So the guard read is a clock_timestamp() call between PRE and STATEMENT probes; bracketing is sound.
- Ran: DATABASE_URL=...5433 node --test --test-name-pattern="L75-C1" tests/fence/lease-expiry.test.mjs -> pass 2 fail 0. Notes: L75-C1 {"rejectedCode":"XF009","rejectedPreMinusExpiryMs":9.82,"rejectedGuardMinusExpiryMs":null,...}; L75-C1-RACE {"inFlight":"42501","guardMinusExpiryMs":-141.5,"rowMinusExpiryMs":259.28,"afterExpiry":"XF009"}. The new 42501 branch was NOT exercised (same as author).
- Mutation: renamed trigger l75_pre -> xf_guard_zzz_pre (worktree, reverted): L75-C1 fails "مِسبارُ PRE يُطلَقُ قبلَ xf_guard" (pass 0 fail 1). Author's mutation claim confirmed.
- Other parsers of 'l75-clock': rg shows lines 287 and 519 (`/^l75-clock STATEMENT ([0-9.]+)$/`, on l75_initplan_probe, which has no l75_pre) and L75-C1-RACE line ~930 (`(STATEMENT|ROW)`, on l75_c1_probe). PRE notices fire in L75-C1-RACE but the anchored regex ignores them; RACE's `at('STATEMENT') === undefined` after-expiry assertion is unaffected. No other test affected. Confirmed.
- Legitimacy: old check STATEMENT < exp was a sufficient-but-flaky proof (STATEMENT is an upper bound of the guard read). New check PRE < exp is a necessary condition; STATEMENT >= exp case is now only t_note'd. This is a legitimate measurement correction, but it is a real (small) weakening: a guard that is lenient at the boundary by up to the PRE→STATEMENT gap (sub-ms) would now pass L75-C1 with only a note. No upper bound on (STATEMENT − PRE) is asserted.
- "Deterministic split stays in L75-C1-RACE": partially true. RACE deterministically shows the two layers (guard passes ~141 ms before expiry, RLS rejects row ~259 ms after; after expiry XF009 with no STATEMENT/ROW). It does not test guard precision at the boundary (margin 141 ms), so it does not replace what the STATEMENT<exp check used to give in the bracket case.

3) WL-631 restorations (WL-140, WL-148)
- Using the repo's own historyEntries()+historyFingerprint() (the PS10/RESTORE-ALTERED comparison) via /tmp/fp2.mjs:
  WL-140 counts from/head/pre 1 1 1, from==head TRUE, pre(c2ddf7d5^)==head false, bytes 4010/4010
  WL-148 counts from/head/pre 1 1 1, from==head TRUE, pre==head false, bytes 4185/4185
- Raw diff of extracted entries differs only by trailing "---"/blank lines (tail ignored by design of historyFingerprint).
- Both from commits are ancestors of HEAD (git merge-base --is-ancestor: yes).
- History claim check (/tmp/fp3.mjs over ancestry-path to origin/main): WL-148 first changed at b6b43019 (#46) — matches config reason. WL-140 disappeared at 828bff5e ("Merge origin/main into PR 40 ...") and reappeared at 16fa2660 (#73) — consistent with the reason ("dropped by #40 merge, restored by WL-178/16fa2660"); config names e9cdd7ba as the #40 merge, I saw 828bff5e on the ancestry path (not reconciled; cosmetic).
- 16fa2660 diff contains "(يُملأ بعد الدفعِ)" (count 1) — consistent. guard:work-log-ids: "✅ الترقيمُ متّصلٌ مُفرَدٌ".

=== NOT CHECKED ===
- GitHub CI runs 46106810269 / 46105237618 / 46113382523 (not fetched).
- 42501 branch of L75-C1 at runtime (racy; not hit). Full test suite / npm run validate not run. lease-expiry-silent-skip.test.mjs not run.
- Mutation of coverage_problems/cover_relation restore in 0038 down (inferred same as window_breach, not run).
- e9cdd7ba vs 828bff5e reconciliation for WL-140 reason text.

=== CONFIRMED DEFECTS ===
D1 (low/medium, CI coverage gap): M3.03 0038 rollback assertion is insufficient for what 0038 down claims. Repro: in a worktree delete the window_breach CREATE OR REPLACE block from migrations/0038_fence_end_guard.down.sql, run migrate down(to 37)->up(38)->down; the new assertion exits 0 and `select prosrc ~ 'transaction_timestamp' from pg_proc where oid='fence.window_breach(tstzrange)'::regprocedure` = t; the 0037 down + assertion then also pass. Fix suggestion: also assert window_breach prosrc contains statement_timestamp and not transaction_timestamp, and coverage_problems prosrc has no 'xf_guard_end' (or no uncovered_relation_end kind) after the 0038 down.
D2 (low, CI coverage gap): no post-re-up assertion that xf_guard_end is present again (e.g. count = number of protected relations, tgenabled='A'), unlike 0030–0037. Repro: read ci.yml lines ~245–257; no xf_guard_end check after the final `npm run migrate -- up`.

=== RISKS ===
R1 (medium, reasoned, NOT reproduced): Under 0038, l75_c1_probe (state schema) gets xf_guard_end AFTER STATEMENT (verified on a fresh state.zz_review_probe table: triggers xf_guard tgtype 62, xf_guard_end tgtype 60), and guard_write raises XF009 for expiry. Hence a third outcome exists in L75-C1: statement passes BEFORE guard and WITH CHECK before expiry but the AFTER statement guard runs after expiry -> XF009 with STATEMENT and ROW notices present. The XF009 branch asserts guardAt===undefined and rowAt===undefined, so this would be reported as a failure ("XF009 والمِسبارُ بعدَ الزنادِ أُطلِق"). Window is sub-ms (comparable to the 0.072 ms that caused the original flake). WL-632's "two layers only" dichotomy does not account for xf_guard_end from WL-628. Not introduced by 9ac83a05, but the same flake class it was fixing.
R2 (low): L75-C1 bracket case now passes without proof; boundary leniency of up to PRE→STATEMENT gap would not be caught by any test (RACE margin ~141 ms).
R3 (env): M3.03 block fails locally at 0030 check due to pre-existing cluster role xf_reaper on the shared 5433 server; irrelevant in CI (fresh container).

=== RECOMMENDATION ===
Item 1: accept as a correct, non-vacuous fix for the immediate CI failure; follow up with D1/D2 (strengthen 0038 down assertion to cover the restored function texts, add post-up xf_guard_end presence check).
Item 2: accept — reasoning (alphabetical trigger order, clock_timestamp bracket) is correct and the change is a legitimate measurement correction with a small, declared weakening; regex change affects no other test. Follow up R1: allow/handle XF009-from-xf_guard_end (STATEMENT+ROW present, ROW < exp, end after exp) in the L75-C1 XF009 branch, or explicitly classify it, and consider asserting an upper bound on STATEMENT−PRE in the bracket note.
Item 3: accept — restored WL-140 and WL-148 text equals text at declared from commits under the guard's own fingerprint (and byte-identical apart from trailing separator); from commits are ancestors; guards green.
```
