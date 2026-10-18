#!/usr/bin/env bash
set -u
W=/tmp/wl414-followup/reviewers/gpt_6_1_sol
O="$W/positive-expiration"
mkdir -p "$O"
exec > >(tee "$O/commands.log") 2>&1
set -x
mcs -langversion:5 -main:PositiveExpiration -out:"$O/current.exe" "$W/repo/sim/tpm-ceremony/TpmCeremonyCore.cs" "$W/IndependentFollowup.cs" "$W/PositiveExpiration.cs"
echo "current_compile_exit=$?"
mcs -langversion:5 -main:PositiveExpiration -out:"$O/before-fix.exe" "$W/Core-before-d9e1dc3b.cs" "$W/IndependentFollowup.cs" "$W/PositiveExpiration.cs"
echo "before_fix_compile_exit=$?"
for v in current before-fix; do
for expiration in 0 3600; do
    D="$O/state-$v-$expiration";mkdir -p "$D"
    swtpm socket --tpm2 --tpmstate "dir=$D" --server type=tcp,port=7100,bindaddr=127.0.0.1 --ctrl type=tcp,port=7101,bindaddr=127.0.0.1 --flags not-need-init,startup-clear --pid "file=$D/pid" --daemon
    rc=$?;echo "sim_start_exit=$rc";test "$rc" = 0 || exit "$rc"
    simpid=$(<"$D/pid");trap 'kill "$simpid" 2>/dev/null || true' EXIT
    tpm2_getcap --tcti=swtpm:host=127.0.0.1,port=7100 properties-fixed >"$D/ready.txt" 2>"$D/ready.stderr"
    mono "$O/$v.exe" "$expiration" >"$O/$v-$expiration.txt" 2>"$O/$v-$expiration.stderr"
    rc=$?;echo "$rc" >"$O/$v-$expiration.exit"
    ps -C swtpm -o pid,ppid,stat,args >"$O/$v-$expiration.processes-after-probe.txt"
    kill "$simpid"
    for i in $(seq 1 100);do test -e "/proc/$simpid/exe" || break;sleep 0.01;done
    trap - EXIT
done
done
