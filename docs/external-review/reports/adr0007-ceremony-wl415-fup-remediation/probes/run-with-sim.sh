#!/usr/bin/env bash
# يشغّلُ أمرًا على swtpm معزولٍ بمنفذٍ محدّدٍ ثمّ يوقفُه ويطبعُ العمليّاتِ الباقيةَ فورًا.
# الاستخدام: run-with-sim.sh <port> <cmd...>   (المنفذُ يُمرَّرُ للأمرِ كمعاملٍ أوّلَ بعدَ اسمِه إن لزم)
set -u
port="$1"; shift
D="$(mktemp -d /tmp/wl414fix-sim.XXXXXX)"
swtpm socket --tpm2 --tpmstate "dir=$D" --server type=tcp,port=$port,bindaddr=127.0.0.1 --ctrl type=tcp,port=$((port+1)),bindaddr=127.0.0.1 --flags not-need-init,startup-clear --pid "file=$D/pid" --daemon || exit 90
pid=$(<"$D/pid"); trap 'kill "$pid" 2>/dev/null; rm -rf "$D"' EXIT
tpm2_getcap --tcti=swtpm:host=127.0.0.1,port=$port properties-fixed >/dev/null 2>&1
"$@"; rc=$?
echo "probe_exit=$rc"
kill "$pid"; for i in $(seq 1 200); do test -e "/proc/$pid" || break; sleep 0.01; done
echo "swtpm_after_stop_with_dir=$(pgrep -fc -- "dir=$D" || true)"
exit $rc
