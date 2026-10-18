#!/usr/bin/env bash
set -u
W=/tmp/wl414-followup/reviewers/gpt_6_1_sol
cd "$W/repo" || exit 1
mkdir -p "$W/static"
{
set -x
git rev-parse HEAD
git status --porcelain
node --version
pwsh --version
swtpm --version
tpm2_getcap --version
mcs --version
npm ci
echo "npm_ci_exit=$?"
npm run build
echo "build_exit=$?"
git diff d9e1dc3b^..HEAD --stat | tail -12
git diff 8b48a568 -- scripts/production-entry.mjs config/external-review.yaml version.json sim/tpm/tcti_guard.mjs
echo "protected_diff_exit=$?"
} >"$W/static/preflight.txt" 2>&1
git diff d9e1dc3b^..HEAD -- sim/tpm-ceremony/TpmCeremonyCore.cs >"$W/static/core.diff"
git diff d9e1dc3b^..HEAD -- tests/helpers/TpmCeremonyFaultTransport.cs tests/helpers/tpm-ceremony-harness.ps1 tests/sim/tpm-ceremony-wl413-r3.test.mjs tests/sim/tpm-ceremony-rehearsal.test.mjs >"$W/static/tests.diff"
git diff d9e1dc3b^..HEAD -- docs/THREAT_MODEL.md sim/tpm-ceremony/README.md docs/adr/0007-tpm-nv-counter-freshness-anchor-design.md >"$W/static/docs.diff"
git log --oneline d9e1dc3b^..HEAD >"$W/static/commits.txt"
git diff d9e1dc3b..HEAD -- docs/audit/template-allowlist.txt scripts/guard-templates.mjs >"$W/static/allowlist.diff"
{
set -x
npm run guard:templates
echo "guard_templates_exit=$?"
git status --porcelain
} >"$W/static/template-guard.txt" 2>&1
