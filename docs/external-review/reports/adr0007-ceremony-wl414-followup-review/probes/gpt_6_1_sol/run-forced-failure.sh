#!/usr/bin/env bash
set -u
W=/tmp/wl414-followup/reviewers/gpt_6_1_sol
O="$W/forced-failure"
node "$W/prepare-forced-failure.mjs"
exec > >(tee "$O/commands.log") 2>&1
set -x
export TMPDIR="$O/tmp"
export XUUX_TPM_SIM=1
export TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=7100
ps -C swtpm -o pid,ppid,stat,args >"$O/processes-before.txt"
node --test --test-name-pattern=R3-18 "$O/forced-r3.test.mjs" >"$O/forced.tap" 2>"$O/forced.stderr"
rc=$?;echo "$rc" >"$O/forced.exit"
ps -C swtpm -o pid,ppid,stat,args >"$O/processes-immediately-after.txt"
echo "forced_test_exit=$rc"
git -C "$W/repo" diff --no-index tests/sim/tpm-ceremony-wl413-r3.test.mjs "$O/forced-r3.test.mjs" >"$O/copy.diff"
echo "expected_diff_exit=$?"
