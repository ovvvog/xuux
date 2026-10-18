#!/usr/bin/env bash
set -u
W=/home/user/workspace/council-wl413/gpt_6_1_sol
R=/home/user/workspace/xuux-review-dbaf6104
mkdir -p "$W/st"
exec > >(tee "$W/common-commands.log") 2>&1
date -u +%FT%TZ
cd "$R" || exit 99
git rev-parse HEAD
test "$(git rev-parse HEAD)" = dbaf61049bbdb9b2b93cab6c7605d439c1c465b3 || exit 98
git status --porcelain
git diff 1ca1668e -- sim/tpm-host/
node --version; pwsh --version; swtpm --version; tpm2_getcap --version; mcs --version
setsid -f swtpm socket --tpm2 --tpmstate dir="$W/st" --server type=tcp,port=2101,bindaddr=127.0.0.1 --ctrl type=tcp,port=2102,bindaddr=127.0.0.1 --flags not-need-init,startup-clear --pid file="$W/pid" --daemon
echo "simulator launch rc=$?"
sleep 1
TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=2101 tpm2_getcap properties-fixed > "$W/properties-fixed.txt" 2>&1
echo "getcap rc=$?"
XUUX_TPM_SIM=1 TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=2101 node --test --test-concurrency=1 tests/sim/tpm-ceremony-rehearsal.test.mjs tests/sim/tpm-ceremony-guard.test.mjs tests/sim/tpm-ceremony-remediation.test.mjs tests/sim/tpm-ceremony-wl413-r2.test.mjs > "$W/tests.tap" 2>&1
echo "node tests rc=$?"
tail -n 14 "$W/tests.tap"
pwsh -NoProfile -File sim/tpm-ceremony/rehearse.ps1 -SimHost 127.0.0.1 -SimPort 2101 -Stages ALL -SimPidFile "$W/pid" > "$W/rehearsal.json" 2> "$W/rehearsal.stderr"
echo "direct rehearsal rc=$?"
date -u +%FT%TZ
