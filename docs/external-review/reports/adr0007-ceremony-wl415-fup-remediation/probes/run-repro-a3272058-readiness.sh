#!/usr/bin/env bash
set -u
W=/tmp/wl414-followup/reviewers/gpt_6_1_sol
O="$W/repro-a3272058-readiness"
node "$W/prepare-repro-a3272058-readiness.mjs"
chmod +x "$O/bin/tpm2_getcap"
exec > >(tee "$O/commands.log") 2>&1
set -x
export TMPDIR="$O/tmp"
export XUUX_TPM_SIM=1
export TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=7100
ps -C swtpm -o pid,ppid,stat,args >"$O/processes-before.txt"
PATH="$O/bin:$PATH" node --test --test-name-pattern=R3-18 "$O/readiness-r3.test.mjs" >"$O/readiness.tap" 2>"$O/readiness.stderr"
rc=$?;echo "$rc" >"$O/readiness.exit"
ps -C swtpm -o pid,ppid,stat,args >"$O/processes-immediately-after.txt"
echo "readiness_test_exit=$rc"
# Only now, after recording the orphan, stop the one simulator created by this probe.
while read -r pid args; do
    case "$args" in *"dir=$O/tmp/"*) echo "measured_orphan_cleanup_pid=$pid"; kill "$pid";; esac
done < <(ps -C swtpm -o pid=,args=)
ps -C swtpm -o pid,ppid,stat,args >"$O/processes-after-explicit-cleanup.txt"
git -C "$W/repo" diff --no-index tests/sim/tpm-ceremony-wl413-r3.test.mjs "$O/readiness-r3.test.mjs" >"$O/copy.diff"
echo "expected_diff_exit=$?"
