#!/usr/bin/env bash
set -u
OUT=/home/user/workspace/council-wl413/gpt_6_1_sol
TREE=/home/user/workspace/xuux-review-dbaf6104
reset_sim() {
  if [ -f "$OUT/pid" ]; then p=$(<"$OUT/pid"); kill "$p"; sleep 0.15; fi
  state=$(mktemp -d "$OUT/st-extra-XXXXXX")
  setsid swtpm socket --tpm2 --tpmstate "dir=$state" \
    --server type=tcp,port=2101,bindaddr=127.0.0.1 \
    --ctrl type=tcp,port=2102,bindaddr=127.0.0.1 \
    --flags not-need-init,startup-clear --pid "file=$OUT/pid" \
    >> "$OUT/swtpm-audit.log" 2>&1 < /dev/null &
  for i in $(seq 1 20); do [ -f "$OUT/pid" ] && break; sleep 0.1; done
}
for pair in current:sim/tpm-ceremony/TpmCeremonyCore.cs baseline:Core-42c0050a.cs; do
  kind=${pair%%:*}; file=${pair#*:}
  if [ "$kind" = current ]; then core="$TREE/$file"; else core="$OUT/$file"; fi
  mcs -langversion:5 -main:AuditProgram -out:"$OUT/Extra-$kind.exe" "$core" \
    "$TREE/tests/helpers/TpmCeremonyFaultTransport.cs" "$OUT/WL412Probe.cs" "$OUT/R2Probe.cs" \
    "$OUT/AuditProbe.cs" "$OUT/GeminiProbe.cs" "$OUT/G47Probe.cs" > "$OUT/extra-$kind-build.log" 2>&1
  rc=$?; echo "$kind build exit=$rc"; [ "$rc" -eq 0 ] || exit "$rc"
  if [ "$kind" = current ]; then
    modes='gemini:truncate gemini:size gemini:blocked g47:truncate-header g47:size-mismatch g47:unexpected-rc g47:windows-family g47:blocked-forever-undefine g47:blocked-on-expected-failure g47:negative-unexpected-success g47:drop-after-identity g47:io-throw g47:identity-ignores-string34 g47:vendor-space-fold'
  else
    modes='auth-reserved primary-empty-public policy-invalid-ticket start-policy-empty-nonce handle-baseline-alias malformed-absence negative-policy-loss'
  fi
  for mode in $modes; do
    reset_sim
    slug=${mode/:/-}
    if [ "$kind" = current ]; then name="probe-$slug"; else name="baseline-$slug"; fi
    mono "$OUT/Extra-$kind.exe" "$mode" 2101 > "$OUT/$name.jsonl" 2> "$OUT/$name.stderr"
    rc=$?; echo "$kind $mode exit=$rc"; printf '%s\n' "$rc" > "$OUT/$name.exit"
  done
done
reset_sim
node "$OUT/AdditionalChecks.mjs" > "$OUT/additional-checks.log" 2>&1
echo "additional checks exit=$?"
