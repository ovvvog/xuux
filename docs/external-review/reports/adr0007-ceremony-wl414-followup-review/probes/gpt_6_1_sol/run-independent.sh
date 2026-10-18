#!/usr/bin/env bash
set -u
W=/tmp/wl414-followup/reviewers/gpt_6_1_sol
R="$W/repo"
O="${OUTPUT:-$W/independent}"
mkdir -p "$O"
exec > >(tee "$O/commands.log") 2>&1
set -x
git -C "$R" rev-parse HEAD
EXE="${EXE:-$W/IndependentFollowup.exe}"
CORE="${CORE:-$R/sim/tpm-ceremony/TpmCeremonyCore.cs}"
mcs -langversion:5 -out:"$EXE" "$CORE" "$W/IndependentFollowup.cs"
compile=$?; echo "compile_exit=$compile"
test "$compile" = 0 || exit "$compile"
modes="${*:-normal normal-foreign duplicate-alias duplicate-many descending cross-page below-start partial-transient partial-session auth-policy-on-password auth-password-on-policy auth-policy-nonce16 auth-policy-attrs08 creation-hierarchy-40000001 creation-hierarchy-40000007 creation-hierarchy-4000000b creation-hierarchy-4000000c creation-hierarchy-40000002 creation-hierarchy-40000009 creation-digest-0 creation-digest-1 creation-digest-32 creation-digest-63 creation-digest-64 creation-digest-65 creation-digest-100 creation-null-empty creation-hash-flip creation-data-missing creation-data-extra creation-parentalg-invalid creation-outsideinfo creation-parentname creation-pcr-empty policy-hierarchy-40000001 policy-hierarchy-40000007 policy-hierarchy-4000000b policy-hierarchy-4000000c policy-hierarchy-40000002 policy-hierarchy-40000009 policy-digest-0 policy-digest-1 policy-digest-32 policy-digest-64 policy-digest-65 policy-timeout load-name-flip loss-define loss-create}"
for mode in $modes; do
    D="$O/state-$mode"
    mkdir -p "$D"
    swtpm socket --tpm2 --tpmstate "dir=$D" --server type=tcp,port=7100,bindaddr=127.0.0.1 --ctrl type=tcp,port=7101,bindaddr=127.0.0.1 --flags not-need-init,startup-clear --pid "file=$D/pid" --daemon
    rc=$?;echo "$mode sim_start_exit=$rc"
    test "$rc" = 0 || exit "$rc"
    simpid=$(<"$D/pid")
    trap 'kill "$simpid" 2>/dev/null || true' EXIT
    tpm2_getcap --tcti=swtpm:host=127.0.0.1,port=7100 properties-fixed >"$D/ready.txt" 2>"$D/ready.stderr"
    mono "$EXE" "$mode" "$O" >"$O/$mode.json" 2>"$O/$mode.stderr"
    rc=$?;echo "$rc" >"$O/$mode.exit"; echo "$mode probe_exit=$rc"
    # Immediately after the probe process exits, before any external simulator cleanup.
    ps -C swtpm -o pid,ppid,stat,args >"$O/$mode.processes-after-probe.txt"
    kill "$simpid"
    for i in $(seq 1 100); do test -e "/proc/$simpid/exe" || break;sleep 0.01;done
    ps -C swtpm -o pid,ppid,stat,args >"$O/$mode.processes-after-fixture-stop.txt"
    trap - EXIT
done
