# Reviewer working notes — gpt_6_1_sol (OPENAI)

The requested review head is `7a799cecf23b80538487a01560144ecb39f99abd`; `git rev-parse HEAD` returned exactly that value, and initial short status was empty. ([Identity log](./00-identity.log))

Only this member's three prior reports were read from the external-review report tree; the current annex was read in full, including its claims in §13, rather than treating those claims as dispositions. ([Current annex copy](./01-annex-numbered.log))

No workspace `write` tool is exposed; manually authored artifacts therefore use `apply_patch`.

The test loader redirects generated module imports to an isolated build and retains test roots; test-requested single-file removal is represented by a rename to a retained sibling, so the missing-file assertions keep their meaning without discarding those inputs. ([Loader](./loader.mjs), [Retention adapter](./retain-removal.mjs))

Public TCG retrieval:
- Part 1 architecture: https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part1_Architecture_pub.pdf — read with native URL tool.
- Part 2 structures: https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part2_Structures_pub.pdf — read with native URL tool.
- EK profile: https://trustedcomputinggroup.org/wp-content/uploads/TCG-EK-Credential-Profile-V-2.5-R2_published.pdf — read with native URL tool.
- Part 3 commands: https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part3_Commands_pub_00016d87e3.pdf — native URL tool returned `bad_robots_code`; HTTPS download and `pdftotext -layout` returned 0.
- Part 4 supplementary routines: https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part4_Supp_Routines_code_pub_b5951a79b4.pdf — native URL tool returned `bad_robots_code`; HTTPS download and `pdftotext -layout` returned 0.

Candidate issue, still under examination: the closed `NV_ReadPublic` row allows a salted audit session only, while the new bootstrap text and success profile explicitly require/permit its no-session use before EK salting. ([Annex lines 63, 148, 162, 186](./01-annex-numbered.log))

R2-06 must be disposed explicitly: the revision now states that restoring the provisioning consumption ledger permits replay, and that neither fsync nor a signature supplies monotonicity; the owner has a new E11 choice, not a new technical anti-replay mechanism. ([Annex lines 381–388, 523, 551](./01-annex-numbered.log))

## Final artifact map

The raw Arabic report has six item verdicts (`open`, `holds`, `holds`, `holds`, `holds`, `open`), 17 prior-finding dispositions including R2-06, and two new findings: R4-01 (`medium`, EK bootstrap descriptor contradiction) and R4-02 (`high`, owner-password command integrity under a transport-changing adversary). ([Report](./report.md))

R2-06 is `partially`: disclosure and an explicit model exception are present, but resistance to restoration of the provisioning ledger and the owner's E11 decision are not established; the item-2 verdict is explicitly limited to the declared non-restoring ceremony-file trust model. ([Report](./report.md), [Signed-file model result](./10-protocol-models.log))

The isolated build exited 0; the final unmodified WL-434 unit file, with external import redirection and retention-only cleanup adaptation, reports 17 tests, 0 failures, and 0 skipped tests. ([Build](./05-build-unit-tests.log), [Unit result](./06-unit-tests.log))

Final source HEAD/status and report structure/evidence checks are recorded at `2026-10-22T02:42:28Z`; the review worktree has no tracked changes. ([Final validation](./20-final-validation.log))

The source PDFs/text, initial failed invocation logs, model inputs, generated build, and retained test roots all remain in this directory; the report itself links the 24 evidence paths it uses. ([Final validation](./20-final-validation.log), [Report](./report.md))
