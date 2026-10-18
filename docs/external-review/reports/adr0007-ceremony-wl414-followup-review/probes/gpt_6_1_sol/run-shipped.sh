#!/usr/bin/env bash
set -u
W=/tmp/wl414-followup/reviewers/gpt_6_1_sol
R="$W/repo"
O="$W/shipped"
mkdir -p "$O/tmp" "$O/state"
exec > >(tee "$O/commands.log") 2>&1
set -x
export TMPDIR="$O/tmp"
export XUUX_TPM_SIM=1
export TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=7100
cd "$R" || exit 1
swtpm socket --tpm2 --tpmstate "dir=$O/state" --server type=tcp,port=7100,bindaddr=127.0.0.1 --ctrl type=tcp,port=7101,bindaddr=127.0.0.1 --flags not-need-init,startup-clear --pid "file=$O/pid" --daemon
rc=$?;echo "fixture_start_exit=$rc";test "$rc" = 0 || exit "$rc"
simpid=$(<"$O/pid")
trap 'kill "$simpid" 2>/dev/null || true' EXIT
tpm2_getcap --tcti="$TPM2TOOLS_TCTI" properties-fixed >"$O/properties-fixed.txt" 2>"$O/properties.stderr"
ps -C swtpm -o pid,ppid,stat,args >"$O/processes-before-suite.txt"
node --test --test-concurrency=1 tests/sim/tpm-ceremony-rehearsal.test.mjs tests/sim/tpm-ceremony-guard.test.mjs tests/sim/tpm-ceremony-remediation.test.mjs tests/sim/tpm-ceremony-wl413-r2.test.mjs tests/sim/tpm-ceremony-wl413-r3.test.mjs >"$O/suite.tap" 2>"$O/suite.stderr"
rc=$?;echo "$rc" >"$O/suite.exit"
# This is the first command after recording the exit: no kill/sleep or external cleanup.
ps -C swtpm -o pid,ppid,stat,args >"$O/processes-immediately-after-suite.txt"
echo "suite_exit=$rc"
pwsh -NoProfile -NonInteractive -File sim/tpm-ceremony/rehearse.ps1 -SimHost 127.0.0.1 -SimPort 7100 -Stages ALL -SimPidFile "$O/pid" >"$O/rehearsal.json" 2>"$O/rehearsal.stderr"
rc=$?;echo "$rc" >"$O/rehearsal.exit"
ps -C swtpm -o pid,ppid,stat,args >"$O/processes-immediately-after-rehearsal.txt"
echo "rehearsal_exit=$rc"
tpm2_getcap --tcti="$TPM2TOOLS_TCTI" handles-nv-index >"$O/nv-after-rehearsal.txt" 2>"$O/nv-after.stderr"
kill "$simpid"
for i in $(seq 1 100); do test -e "/proc/$simpid/exe" || break;sleep 0.01;done
ps -C swtpm -o pid,ppid,stat,args >"$O/processes-after-fixture-stop.txt"
trap - EXIT
