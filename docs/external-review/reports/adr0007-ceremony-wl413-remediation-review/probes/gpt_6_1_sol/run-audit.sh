#!/usr/bin/env bash
set -u
OUT=/home/user/workspace/council-wl413/gpt_6_1_sol
TREE=/home/user/workspace/xuux-review-dbaf6104
reset_sim() {
  if [ -f "$OUT/pid" ]; then
    p=$(<"$OUT/pid"); kill "$p"; sleep 0.15
  fi
  # Each private state is retained for inspection.
  state=$(mktemp -d "$OUT/st-audit-XXXXXX")
  setsid swtpm socket --tpm2 --tpmstate "dir=$state" \
    --server type=tcp,port=2101,bindaddr=127.0.0.1 \
    --ctrl type=tcp,port=2102,bindaddr=127.0.0.1 \
    --flags not-need-init,startup-clear --pid "file=$OUT/pid" \
    >> "$OUT/swtpm-audit.log" 2>&1 < /dev/null &
  for i in $(seq 1 20); do
    [ -f "$OUT/pid" ] && break
    sleep 0.1
  done
}
mcs -langversion:5 -main:AuditProgram -out:"$OUT/AuditProbe.exe" \
  "$TREE/sim/tpm-ceremony/TpmCeremonyCore.cs" "$TREE/tests/helpers/TpmCeremonyFaultTransport.cs" \
  "$OUT/WL412Probe.cs" "$OUT/R2Probe.cs" "$OUT/AuditProbe.cs" "$OUT/GeminiProbe.cs" "$OUT/G47Probe.cs" > "$OUT/audit-build.log" 2>&1
rc=$?; echo "build exit=$rc"; [ "$rc" -eq 0 ] || exit "$rc"
for mode in \
  old:invalid-tag old:missing-response-auth old:define-response-loss old:flush-refusal old:unexpected-negative \
  r2:written-before-reconcile r2:neg-increment-loss r2:trailing-params \
  helper:flush-refusal helper:blocked-forever-undefine helper:identity-string34 helper:identity-spacefold helper:identity-missing-prop \
  auth-nonce auth-hmac auth-reserved primary-empty-public primary-invalid-creationdata primary-wrong-name \
  create-invalid-creationdata policy-invalid-ticket start-trial-empty-nonce start-policy-empty-nonce \
  handle-baseline-alias inventory-empty-more inventory-wrong-range negative-policy-loss create-loss malformed-absence \
  trailing-122 trailing-12a trailing-131 trailing-134 trailing-14e trailing-153 trailing-157 trailing-15d \
  trailing-160 trailing-165 trailing-169 trailing-16c trailing-176 trailing-17a trailing-189
do
  reset_sim
  slug=${mode/:/-}
  mono "$OUT/AuditProbe.exe" "$mode" 2101 > "$OUT/probe-$slug.jsonl" 2> "$OUT/probe-$slug.stderr"
  rc=$?
  printf '%s exit=%s\n' "$mode" "$rc"
  printf '%s\n' "$rc" > "$OUT/probe-$slug.exit"
done
