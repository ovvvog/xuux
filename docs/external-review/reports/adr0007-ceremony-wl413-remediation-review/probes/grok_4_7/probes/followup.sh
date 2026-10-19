#!/bin/bash
set -u
ROOT=/home/user/workspace/xuux-review-dbaf6104
OUT=/home/user/workspace/council-wl413/grok_4_7
LOG=$OUT/logs/followup
mkdir -p "$LOG" "$OUT/probes/sims"
HARNESS=$ROOT/tests/helpers/tpm-ceremony-harness.ps1
RUNNER=$ROOT/sim/tpm-ceremony/rehearse.ps1

start_sim() {
  local port=$1
  local ctrl_bind=${2:-127.0.0.1}
  local dir=$OUT/probes/sims/f$port
  rm -rf "$dir"; mkdir -p "$dir/st"
  swtpm socket --tpm2 --tpmstate dir="$dir/st" \
    --server type=tcp,port=${port},bindaddr=127.0.0.1 \
    --ctrl type=tcp,port=$((port+1)),bindaddr=${ctrl_bind} \
    --flags not-need-init,startup-clear \
    --pid file="$dir/pid" --daemon
  sleep 0.25
  echo "$port pid=$(cat "$dir/pid") ctrl_bind=$ctrl_bind"
}
stop_sim() {
  local port=$1
  local dir=$OUT/probes/sims/f$port
  if [ -f "$dir/pid" ]; then kill "$(cat "$dir/pid")" 2>/dev/null || true; fi
}

echo "=== harness original modes $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
port=2181
for mode in invalid-tag missing-response-auth define-response-loss define-not-executed flush-refusal unexpected-negative blocked-forever-undefine identity-string34 identity-spacefold identity-missing-prop; do
  start_sim $port
  pwsh -NoProfile -NonInteractive -File "$HARNESS" -Mode fault -SimPort $port -Fault "$mode" > "$LOG/${mode}.json" 2> "$LOG/${mode}.err"
  echo "HARNESS $mode exit:$? port:$port" | tee -a "$LOG/harness-exits.txt"
  python3 - << PY
import json
p="$LOG/${mode}.json"
try:
    o=json.load(open(p))
except Exception as e:
    print("PARSE_FAIL", "$mode", e); raise SystemExit
r=o["report"]
print("$mode", "status="+str(r.get("status")), "failure="+str(r.get("failure"))[:180])
print("  leftovers", r.get("cleanupLeftovers"))
print("  recon", r.get("reconciliation"))
print("  post", r.get("postRunInventory"))
print("  nvAfter", o.get("nvAfter"), "sessionsAfter", o.get("sessionsAfter"))
print("  steps", len(r.get("steps") or []), "first", (r.get("steps") or [{}])[0].get("name"), "outcome", (r.get("steps") or [{}])[0].get("outcome"))
PY
  stop_sim $port
  port=$((port+2))
done

echo "=== control port wide bind ==="
start_sim 2211 0.0.0.0
pwsh -NoProfile -File "$RUNNER" -SimHost 127.0.0.1 -SimPort 2211 -Stages S1 -SimPidFile "$OUT/probes/sims/f2211/pid" > "$LOG/ctrl-wide.json" 2> "$LOG/ctrl-wide.err"
echo "ctrl-wide exit:$?" | tee -a "$LOG/ctrl-wide.json"
python3 - << 'PY'
import json
t=open("/home/user/workspace/council-wl413/grok_4_7/logs/followup/ctrl-wide.json").read().strip().splitlines()
# last json line
raw=[ln for ln in t if ln.startswith("{")][-1]
r=json.loads(raw)
print("status", r.get("status"), "failure", r.get("failure"))
print("listener", r.get("facts",{}).get("transport.listener.before"), r.get("facts",{}).get("transport.listener.after"))
PY
ss -ltn | awk '$4 ~ /2212$/ {print}'
stop_sim 2211

echo "=== fake swtpm comm/cmdline ==="
rm -f "$OUT/probes/fake-swtpm.log"
"$OUT/probes/bin/swtpm" socket --tpm2 --server type=tcp,port=2215,bindaddr=127.0.0.1 &
FPID=$!
sleep 0.3
echo "fake pid $FPID comm=$(cat /proc/$FPID/comm 2>/dev/null) exe=$(readlink /proc/$FPID/exe)"
pwsh -NoProfile -File "$RUNNER" -SimHost 127.0.0.1 -SimPort 2215 -Stages S1 > "$LOG/fake-swtpm.json" 2> "$LOG/fake-swtpm.err"
echo "fake exit:$?" | tee -a "$LOG/fake-swtpm.json"
echo "--- fake log ---"
cat "$OUT/probes/fake-swtpm.log" || true
echo "--- fake json head ---"
python3 - << 'PY'
import json
t=open("/home/user/workspace/council-wl413/grok_4_7/logs/followup/fake-swtpm.json").read()
print(t[:800])
PY
kill $FPID 2>/dev/null || true
wait $FPID 2>/dev/null || true

echo "=== pwsh parameterSize 0xFFFFFFFF ==="
pwsh -NoProfile -File "$OUT/probes/paramsize.ps1" > "$LOG/paramsize-pwsh.txt" 2>&1
echo "paramsize pwsh exit:$?"
cat "$LOG/paramsize-pwsh.txt"

echo "DONE $(date -u +%Y-%m-%dT%H:%M:%SZ)"
