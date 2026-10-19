#!/usr/bin/env bash
# مشغّلُ مسابرِ جولةِ المتابعةِ WL-414 — منافذُ معزولةٌ (6100/6101)، قتلٌ بـPID مملوكٍ لا بنمطٍ عامٍّ.
# الاستعمالُ: run-probes.sh <mode> <outfile.json>
set -u
MODE="$1"; OUT="$2"
PORT=6100
STATE=/tmp/wl414-followup/probes/swtpm-state-$MODE
mkdir -p "$(dirname "$OUT")"; rm -rf "$STATE"; mkdir -p "$STATE"
OLD=$(pgrep -x swtpm | wc -l)
swtpm socket --tpm2 --tpmstate dir=$STATE \
  --server type=tcp,port=$PORT,bindaddr=127.0.0.1 --ctrl type=tcp,port=$((PORT+1)),bindaddr=127.0.0.1 \
  --flags not-need-init,startup-clear --daemon > /dev/null 2>&1
SIM_PID=$(pgrep -n -x swtpm)
pwsh -NoProfile -File /tmp/wl414-followup/probes/probe-harness.ps1 -Fault "$MODE" -SimPort $PORT > "$OUT" 2> "${OUT%.json}.stderr.log"
PW_EXIT=$?
# العدُّ فورَ خروجِ pwsh وقبلَ أيِّ تنظيفٍ احتياطيٍّ — هذا هو القياسُ المعتمدُ للعملياتِ اليتيمةِ
COUNT_AFTER_EXIT=$(pgrep -x swtpm | wc -l)
kill $SIM_PID 2>/dev/null; wait $SIM_PID 2>/dev/null
sleep 0.5
COUNT_AFTER_CLEANUP=$(pgrep -x swtpm | wc -l)
echo "mode=$MODE pwsh_exit=$PW_EXIT swtpm_baseline=$OLD swtpm_after_exit=$COUNT_AFTER_EXIT swtpm_after_cleanup=$COUNT_AFTER_CLEANUP"
exit $PW_EXIT
