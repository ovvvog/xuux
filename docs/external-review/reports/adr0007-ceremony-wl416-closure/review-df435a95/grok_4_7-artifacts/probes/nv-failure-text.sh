#!/usr/bin/env bash
# قياس نص فشل الحاجز على منافذ 7782–7790. لا يلمس شجرة المراجعة ولا /dev/tpm*.
set -u
OUT=/tmp/council-wl420-grok_4_7/logs/nv-failure-text.log
HARNESS=/tmp/wt-df435a95-grok/tests/helpers/tpm-ceremony-harness.ps1
: > "$OUT"
port=7782
for mode in nv-preseed-unattributable nv-appear-midrun nv-appear-late nv-appear-after-define nv-appear-after-primary inventory-more0-hide; do
  D=$(mktemp -d /tmp/council-wl420-grok_4_7/sim.XXXXXX)
  swtpm socket --tpm2 --tpmstate "dir=$D" --server "type=tcp,port=$port,bindaddr=127.0.0.1" --ctrl "type=tcp,port=$((port+1)),bindaddr=127.0.0.1" --flags not-need-init,startup-clear --pid "file=$D/pid" --daemon
  rc_sw=$?
  pid=$(cat "$D/pid" 2>/dev/null || echo none)
  echo "MODE=$mode port=$port swtpm_start=$rc_sw pid=$pid dir=$D" | tee -a "$OUT"
  raw=/tmp/council-wl420-grok_4_7/logs/nvtext-$mode.json
  pwsh -NoProfile -NonInteractive -File "$HARNESS" -SimPort "$port" -Mode fault -Fault "$mode" > "$raw" 2>/tmp/council-wl420-grok_4_7/logs/nvtext-$mode.err
  hrc=$?
  node --input-type=module -e "
    import { readFileSync } from 'node:fs';
    const raw = readFileSync('$raw','utf8');
    const hrc = $hrc;
    if (hrc !== 0) { console.log('HARNESS_EXIT=' + hrc); console.log(readFileSync('/tmp/council-wl420-grok_4_7/logs/nvtext-$mode.err','utf8').slice(0,800)); process.exit(0); }
    const o = JSON.parse(raw);
    const changing = new Set(['0x0000012a','0x00000134','0x00000122','0x00000131','0x00000153','0x00000157','0x00000176','0x00000160','0x0000016c','0x00000165']);
    const steps = (o.report && o.report.steps) || [];
    const sc = steps.filter(x => changing.has(String(x.commandCode).toLowerCase())).map(x => x.stage+':'+x.name+':'+x.commandCode);
    console.log('status=' + (o.report && o.report.status));
    console.log('FAILURE=' + (o.report && o.report.failure));
    console.log('STATE_CHANGING=' + JSON.stringify(sc));
    console.log('nvAfter=' + JSON.stringify(o.nvAfter));
    console.log('changes=' + (o.fault && o.fault.changes));
    console.log('facts=' + JSON.stringify(o.report && o.report.facts));
  " | tee -a "$OUT"
  echo "---" | tee -a "$OUT"
  if [ -f "$D/pid" ]; then
    kill "$(cat "$D/pid")" 2>/dev/null || true
    for i in $(seq 1 100); do [ -e "/proc/$(cat "$D/pid")" ] || break; sleep 0.02; done
  fi
  # لا حذف إن بقي المالك
  left=$(pgrep -fc -- "dir=$D" || true)
  echo "swtpm_left=$left" | tee -a "$OUT"
  if [ "$left" = "0" ]; then rm -rf "$D"; else echo "KEPT $D" | tee -a "$OUT"; fi
  port=$((port+2))
done
echo DONE | tee -a "$OUT"
