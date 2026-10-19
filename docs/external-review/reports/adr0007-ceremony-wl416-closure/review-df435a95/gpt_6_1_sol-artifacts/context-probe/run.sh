#!/usr/bin/env bash
# الاستخدام: run.sh <core.cs> <port> — يشغّلُ المسبارَ على swtpm معزولٍ ثمّ يوقفُه ويطبعُ العمليّاتِ الباقية.
set -u
core="$1"; port="$2"; here="$(cd "$(dirname "$0")" && pwd)"
D="$(mktemp -d /tmp/council-wl420-gpt_6_1_sol/context-probe/wl416-ctxreg-sim.XXXXXX)"
swtpm socket --tpm2 --tpmstate "dir=$D" --server type=tcp,port=$port,bindaddr=127.0.0.1 --ctrl type=tcp,port=$((port+1)),bindaddr=127.0.0.1 --flags not-need-init,startup-clear --pid "file=$D/pid" --daemon || exit 90
pid=$(<"$D/pid")
echo "core_file=$core core_sha256=$(sha256sum "$core" | cut -c1-64)"
echo "probe_sha256=$(sha256sum "$here/CtxRegressionProbe.cs" | cut -c1-64)"
pwsh -NoProfile -NonInteractive -Command "Add-Type -Path @('$core','$here/CtxRegressionProbe.cs') -IgnoreWarnings; [CtxRegressionProbe]::Run('127.0.0.1', $port) | ForEach-Object { \$_ }"
rc=$?
echo "probe_exit=$rc"
kill "$pid"; for i in $(seq 1 200); do test -e "/proc/$pid" || break; sleep 0.01; done
echo "swtpm_after_stop_with_dir=$(pgrep -fc -- "dir=$D" || true)"
rm -rf "$D"
exit $rc
