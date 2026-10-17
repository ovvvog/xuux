#!/bin/bash
# Independent probes. Sims use ports 2141+ (outside test ranges 2299, 2321, 2400-3000, 3100-3500).
set -u
ROOT=/home/user/workspace/xuux-review-dbaf6104
OUT=/home/user/workspace/council-wl413/grok_4_7
PROBES=$OUT/probes
LOG=$OUT/logs/probes
mkdir -p "$LOG" "$PROBES/bin" "$PROBES/sims"
CORE=$ROOT/sim/tpm-ceremony/TpmCeremonyCore.cs

echo "compile $(date -u +%Y-%m-%dT%H:%M:%SZ)"
mcs -langversion:5 -out:"$PROBES/ProbeRunner.exe" "$CORE" "$PROBES/ProbeRunner.cs"
echo "mcs_exit:$?"

start_sim() {
  local port=$1
  local dir=$PROBES/sims/$port
  rm -rf "$dir"
  mkdir -p "$dir/st"
  swtpm socket --tpm2 --tpmstate dir="$dir/st" \
    --server type=tcp,port=${port},bindaddr=127.0.0.1 \
    --ctrl type=tcp,port=$((port+1)),bindaddr=127.0.0.1 \
    --flags not-need-init,startup-clear \
    --pid file="$dir/pid" --daemon
  sleep 0.2
  echo "$port $(cat "$dir/pid")"
}

stop_sim() {
  local port=$1
  local dir=$PROBES/sims/$port
  if [ -f "$dir/pid" ]; then
    kill "$(cat "$dir/pid")" 2>/dev/null || true
  fi
}

run_fault() {
  local port=$1
  local mode=$2
  local stages=${3:-ALL}
  echo "RUN fault $mode port=$port stages=$stages"
  mono "$PROBES/ProbeRunner.exe" fault "$port" "$mode" "$stages" > "$LOG/${mode}.jsonl" 2> "$LOG/${mode}.err"
  echo "exit:$?" | tee -a "$LOG/${mode}.jsonl"
  cat "$LOG/${mode}.jsonl"
}

# schema lab
P=2141
start_sim $P
mono "$PROBES/ProbeRunner.exe" schema $P > "$LOG/schema.txt" 2> "$LOG/schema.err"
echo "schema_exit:$?" | tee -a "$LOG/schema.txt"
stop_sim $P

# fault modes, fresh sim each
modes="invalid-tag-success truncated-header size-mismatch error-with-body error-bad-tag paramsize-huge hmac-nonzero short-nonce plant-same-public redefine-after-exec drop-create drop-refused-policysigned cleanup-undefine-no-retry drop-undefine-after-exec io-before-increment"
port=2143
for mode in $modes; do
  start_sim $port
  run_fault $port "$mode" ALL
  # also record nv handles after, via tpm2 if sim still up
  tpm2_getcap --tcti=swtpm:host=127.0.0.1,port=$port handles-nv-index > "$LOG/${mode}.nv" 2> "$LOG/${mode}.nv.err" || true
  tpm2_getcap --tcti=swtpm:host=127.0.0.1,port=$port handles-transient > "$LOG/${mode}.tr" 2>> "$LOG/${mode}.nv.err" || true
  stop_sim $port
  port=$((port+2))
done

echo "DONE $(date -u +%Y-%m-%dT%H:%M:%SZ)"
