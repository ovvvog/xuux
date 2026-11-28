# مراجعةُ r7 لـ`WL-633` — نصٌّ خامٌ حرفيّ

- **النموذج:** Claude Opus 5.5 (‏وكيلٌ فرعيّ `wl633_reviewer` في Perplexity Computer) — **نفسُ عائلةِ المنفِّذ، ليست مراجعةً مستقلّة**.
- **التاريخ:** 2026-11-28.
- **النطاق:** `accfd416..196112c7` (‏`wl-633-r6-followups`، مدموجٌ في التكامل `fc0ed867`).
- **البيئة:** PostgreSQL 18.7 على 127.0.0.1:5433، Node v20.20.2، شجرةُ عملٍ منفصلة؛ قواعدُ مؤقّتةٌ أُسقِطت.
- **العزل:** سياقُ الوكيلِ منفصلٌ عن سياقِ المنفِّذ، لكنّ نصَّ المهمّةِ كتبَه المنفِّذُ ووصفَ النطاق؛ ليس عزلاً تامّاً.

---

(النصُّ أدناه كما وصلَ من المراجِع؛ صيغةُ markdown قد يُطبِّعُها prettier في الفراغاتِ وحدَها، والكياناتُ `&gt;`/`&lt;` في الرسالةِ أُعيدت إلى `>`/`<`)

WL-633 adversarial review — diff accfd416..196112c7 (origin/wl-633-r6-followups; merged as fc0ed867)
Reviewer: Perplexity Computer subagent (Claude Opus 5.5 — same model family as the implementer, so this is not an independent review). Date: 2026-11-28. Environment: PostgreSQL 18.7 on 127.0.0.1:5433 (the pg2 cluster), Node v20.20.2, detached worktree /tmp/wt633 at 196112c7 (removed afterwards). Scratch DBs rv633a/b/c and role rv633u were all dropped. Nothing in the repo was modified, nothing was pushed, and nothing was posted to GitHub.

## CHECKED

1. I pulled the whole M3.03 `run: |` block out of ci.yml and ran it with bash -ex against a fresh DB.
   - Result: rc=0, and all 17 node -e checks ran, D1 and D2 included. Quoting is fine: bash unescapes the `\"` sequences correctly.
   - I had to remove the two xf_reaper checks to get there. They fail locally only because the role is cluster-wide and already exists on pg2 (environmental, already noted in the work log).
2. D1 negative test: running D1 while 0038 is still applied fails as expected ("window_breach لم يَعُد…").
3. D1 against exact text: I compared md5(prosrc) of the 3 functions on a DB taken `up --to 37` with the same DB after up-all then down. All three match (425df679…, 017917df…, eed6e0d6…). So 0038.down really does restore the 0037 text exactly. D1 just doesn't prove that (see defect 2).
4. NULL / missing functions in D1: if a function is missing, the `::regprocedure` cast errors, so D1 fails loudly. A NULL `w` makes `.test(null)` test "null", which also fails. A NULL `prosrc` cannot happen for sql/plpgsql functions. No false-pass here.
5. protected_relations semantics: on a fresh DB it returns 35 rows and there are 35 xf_guard_end triggers, none cloned (tgparentid=0). Partitions are relkind 'r' and get cloned triggers, so the count stays consistent.
6. D2 mutations, run on a superuser scratch DB with xf_ddl_end and xf_ddl_drop disabled. Results are under defect 1.
7. Tests:
   - L75-C1, L75-C1-RACE and L75-C1-END together (name pattern "L75-C1"): 6 runs, 3/3 every time.
   - C1-END readings were stable every run: ROW −141.0 to −142.1 ms, AFTERROW +259.6 to +261.4 ms, XF009.
   - Full files lease-expiry.test.mjs + lease-expiry-silent-skip.test.mjs: pass 24, fail 0.
8. PG behaviour check (rv633c): `INSERT … RETURNING` under a FOR ALL policy evaluates WITH CHECK first, then USING. The notices showed WITHCHECK, WITHCHECK, USING.
9. Docs: I read the WL-633 work-log entry, the LIVE-75 debt-row append, the CURRENT_STATE line, the PROJECT_STATUS/HANDOFF lines and the READINESS row.

## NOT CHECKED

- A real CI run.
- The effects.test.mjs part of the logged 42-test evidence.
- Reproducing the work log's own mutation claims (removing window_breach from 0038.down).
- Foreign-table (relkind 'f') coverage.
- C1-END under heavy CPU load (its margin is about 140 ms, the same as C1-RACE).
- The end-guard branch in L75-C1 itself. It is never hit locally: all 6 runs rejected with XF009 before any row was produced.

## CONFIRMED DEFECTS

### Defect 1 — D2 can false-pass (Low)

D2 compares the total number of xf_guard_end triggers in the whole DB with count(protected_relations()), and checks tgenabled. It doesn't join by relid and doesn't check function, timing, events or WHEN. Three mutations pass D2 while `fence.coverage_problems()` reports `[{"kind":"uncovered_relation_end","object":"public.schema_migrations"}]` each time:

- **(a) Swap.** Repro:
  ```
  DROP TRIGGER xf_guard_end ON public.schema_migrations;
  CREATE TRIGGER xf_guard_end AFTER INSERT ON fence.run_lease FOR EACH STATEMENT EXECUTE FUNCTION fence.guard_write();
  ALTER TABLE fence.run_lease ENABLE ALWAYS TRIGGER xf_guard_end;
  ```
  Counts are still 35 = 35 with d = 0, so D2 rc=0.
- **(b) Neutralised trigger.** `CREATE TRIGGER xf_guard_end AFTER … ON public.schema_migrations FOR EACH STATEMENT WHEN (false) EXECUTE FUNCTION fence.guard_write()` plus ENABLE ALWAYS. D2 rc=0.
- **(c) Wrong timing.** `CREATE TRIGGER xf_guard_end BEFORE INSERT ON public.schema_migrations FOR EACH STATEMENT …` plus ENABLE ALWAYS. D2 rc=0.

(Without ENABLE ALWAYS, D2 does fail, because CREATE [OR REPLACE] TRIGGER leaves tgenabled='O'.)

Why it's only Low:

- All three need superuser and disabled event triggers.
- CI uses a fresh DB.
- 0038.up's own `$post$` block already raises on uncovered_relation_end. So in practice D2 only guards against that post-check being removed later.
- But "xf_guard_end on every protected relation, enabled" is not what D2 actually proves.

### Defect 2 — D1 checks markers, not the 0037 text (Low)

D1 only looks for statement_timestamp / transaction_timestamp in window_breach and the absence of the string "xf_guard_end" in the other two functions. A 0038.down that left in 0038's other coverage_problems hardening would still pass D1. That hardening is the `tgqual IS NULL AND cardinality(tgattr)=0 AND tgnargs=0` clause on the xf_guard branch (WL-628 D1). Today's down is exact (CHECKED 3), so this is a missing-strength issue, not a live bug.

### Defect 3 — The L75-C1 "end-guard" branch is not exclusive to xf_guard_end, and the docs say it is (Low)

L75-C1's INSERT has RETURNING, so after WITH CHECK, PG evaluates xf_read's USING on the new row (CHECKED 8). If expiry falls between those two clock reads, USING runs `fence.window_breach`. Inside a single autocommit statement transaction_timestamp is still before upper, so it raises XF009 with the message 'الإيجارُ انقضى أثناءَ العبارة'. That outcome gives rejected.guardAt and rowAt set, rowAt < exp, XF009 — which the branch classifies as xf_guard_end.

- The window is microseconds wide. I didn't reproduce it, so it's an argument from code plus the measured evaluation order.
- Both sources are correct fence behaviour, and the row count / `written === 0` checks are unchanged. So it is not a safety weakening.
- But the code comment, the work log ("فهو مخرجُ xf_guard_end") and the debt append claim one source.
- Neither the branch nor C1-END checks the error message. guard_write raises 'fence: الإيجارُ منقضٍ أو غائب' and window_breach raises 'الإيجارُ انقضى أثناءَ العبارة', so the message would tell the two apart.

## RISKS

- **R-a: no weakening in the L75-C1 branch.** I don't think it hides a real fence defect.
  - It still requires preAt < exp and rowAt < exp, so the row was produced while the lease was valid.
  - It still requires 0 rows for the rejected id, and n == accepted.length.
  - A broken BEFORE guard with clocks after exp would hit the 42501 path. There, the existing PRE < exp check fails.
  - `rejected.at >= exp` is almost vacuous: dbNow() is taken after the error round-trip. It's harmless, but it isn't evidence of anything.
- **R-b: the new AFTER ROW trigger doesn't change other tests.**
  - It only sleeps when v = 'after-sleep'. L75-C1 inserts '' and C1-RACE inserts `pg_sleep()::text = ''`, so neither sleeps.
  - Otherwise it returns NULL and adds a negligible after-trigger queue entry.
  - coverage_problems has no "extra trigger" kind, and the full files pass.
- **R-c: C1-END is deterministic in my runs.** Its only timing dependency is the ~140 ms pre-expiry margin, the same as C1-RACE. The 'ends === 1' check plus requiring XF009 means it would fail if xf_guard_end were missing or BEFORE-timed.
- **R-d: C1-END attribution is sound but not asserted.** With no RETURNING and AFTER ROW events firing before AFTER STATEMENT, XF009 after AFTERROW > exp can only come from xf_guard_end. The message isn't asserted, though.

## DOCS ACCURACY

- The work log's description of D1/D2 matches the code. Its claim of three mutations killed is plausible, but it doesn't mention the false-pass cases in defect 1.
- CURRENT_STATE ("xf_guard_end على كلِّ علاقةٍ من fence.protected_relations() ومفعَّل") and the HANDOFF/PROJECT_STATUS wording ("تغطيةَ xf_guard_end كاملةً مفعَّلة") overclaim. D2 compares counts only; it doesn't check coverage per relation.
- The LIVE-75 append and the work log attribute the L75-C1 XF009-after-row exit solely to xf_guard_end (defect 3).
- The disclosures are fine: "the end-guard path in random L75-C1 was not seen locally", "not an independent review", and RISK-0054 = NO-GO with no class change. These are accurate.

## SEVERITY

No High or Medium findings. Defects 1, 2 and 3 are all Low, and so is the docs overclaim.

## RECOMMENDATION

Mergeable as is, with small follow-ups:

1. **Replace D2** with `SELECT jsonb_array_length(coalesce(jsonb_agg(p),'[]')) FROM jsonb_array_elements(fence.coverage_problems()) p WHERE p->>'kind' IN ('uncovered_relation','uncovered_relation_end')` = 0. Optionally keep the count/enabled check alongside it. This kills mutations (a), (b) and (c).
2. **Make D1 exact.** Compare md5(prosrc) of the three functions against literal 0037 digests: window_breach 425df679648415d1594d954ac05cb8c0, coverage_problems 017917dfc48bdcc5fd03989a870196bb, cover_relation eed6e0d6f14f3615dd80085a4b29ddc9. These are listed in pg_proc oid order on my DB; re-derive the mapping with `up --to 37` before hard-coding.
3. **Assert the message.**
   - In C1-END, assert the guard_write message ('منقضٍ أو غائب').
   - In the L75-C1 end branch, accept either message, record which one in the L75-C1-ENDPATH note, and fix the comment and docs to say "xf_guard_end or RETURNING-USING window_breach".
4. **Fix the overclaim wording** in CURRENT_STATE and HANDOFF/PROJECT_STATUS: say "count equals and all enabled", or adopt item 1 and keep the wording.
