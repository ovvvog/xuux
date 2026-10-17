#!/usr/bin/env bash
set -u
W=/home/user/workspace/council-wl413/gpt_6_1_sol
O="$W/fresh"
R=/home/user/workspace/xuux-review-dbaf6104
mkdir -p "$O"
exec > >(tee -a "$O/commands.log") 2>&1
date -u +%FT%TZ
stop_own() {
  if [ -f "$W/pid" ]; then
    p=$(<"$W/pid")
    if [ -r "/proc/$p/cmdline" ] && tr '\0' ' ' < "/proc/$p/cmdline" | rg -q -- "swtpm socket.*--tpmstate dir=$W/"; then
      kill "$p"; echo "stopped own swtpm pid=$p"
      for i in $(seq 1 40); do
        ss -ltnH '( sport = :2101 or sport = :2102 )' | rg -q . || break
        sleep 0.05
      done
    fi
  fi
}
start_own() {
  stop_own
  state=$(mktemp -d "$O/state-XXXXXX")
  swtpm socket --tpm2 --tpmstate "dir=$state" --server type=tcp,port=2101,bindaddr=127.0.0.1 --ctrl type=tcp,port=2102,bindaddr=127.0.0.1 --flags not-need-init,startup-clear --pid "file=$W/pid" --daemon || exit 97
  echo "swtpm state=$state rc=0"
}
trap stop_own EXIT
cd "$R" || exit 99
if [ "${1:-}" != probes ]; then
start_own
XUUX_TPM_SIM=1 TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=2101 node --test --test-concurrency=1 tests/sim/tpm-ceremony-rehearsal.test.mjs tests/sim/tpm-ceremony-guard.test.mjs tests/sim/tpm-ceremony-remediation.test.mjs tests/sim/tpm-ceremony-wl413-r2.test.mjs > "$O/tests.tap" 2>&1
echo "common tests exit=$?"; tail -n 10 "$O/tests.tap"
pwsh -NoProfile -File sim/tpm-ceremony/rehearse.ps1 -SimHost 127.0.0.1 -SimPort 2101 -Stages ALL -SimPidFile "$W/pid" > "$O/rehearsal.json" 2> "$O/rehearsal.stderr"
echo "direct ALL exit=$?"
pwsh -NoProfile -File tests/helpers/tpm-ceremony-harness.ps1 -Mode host-guard > "$O/host-guard.json" 2> "$O/host-guard.stderr"
echo "host-guard exit=$?"
fi
mcs -langversion:5 -main:AuditProgram -out:"$O/AuditProbe.exe" sim/tpm-ceremony/TpmCeremonyCore.cs tests/helpers/TpmCeremonyFaultTransport.cs "$W/WL412Probe.cs" "$W/R2Probe.cs" "$W/AuditProbe.cs" "$W/GeminiProbe.cs" "$W/G47Probe.cs" > "$O/build.log" 2>&1
rc=$?; echo "current build exit=$rc"; [ "$rc" = 0 ] || exit "$rc"
for mode in old:invalid-tag old:missing-response-auth old:define-response-loss old:flush-refusal old:unexpected-negative \
  r2:written-before-reconcile r2:neg-increment-loss r2:trailing-params \
  helper:flush-refusal helper:blocked-forever-undefine helper:identity-string34 helper:identity-spacefold helper:identity-missing-prop \
  gemini:truncate gemini:size gemini:blocked \
  g47:truncate-header g47:size-mismatch g47:unexpected-rc g47:windows-family g47:blocked-forever-undefine g47:blocked-on-expected-failure g47:negative-unexpected-success g47:drop-after-identity g47:io-throw g47:identity-ignores-string34 g47:vendor-space-fold \
  auth-nonce auth-hmac auth-reserved auth-continue-cleared \
  primary-empty-public primary-invalid-creationdata primary-wrong-name primary-ticket-invalid \
  create-invalid-creationdata create-empty-private policy-invalid-ticket signature-empty-r \
  start-trial-empty-nonce start-policy-empty-nonce handle-baseline-alias \
  inventory-empty-more inventory-wrong-range negative-policy-loss create-loss malformed-absence negative-valid-success \
  trailing-122 trailing-12a trailing-131 trailing-134 trailing-14e trailing-153 trailing-157 trailing-15d \
  trailing-160 trailing-165 trailing-169 trailing-16c trailing-176 trailing-17a trailing-189
do
  start_own
  slug=${mode/:/-}
  mono "$O/AuditProbe.exe" "$mode" 2101 > "$O/$slug.jsonl" 2> "$O/$slug.stderr"
  rc=$?; echo "$mode exit=$rc"; printf '%s\n' "$rc" > "$O/$slug.exit"
done
git show 42c0050a:sim/tpm-ceremony/TpmCeremonyCore.cs > "$O/Core-42c0050a.cs"
echo "git show baseline exit=$?"
mcs -langversion:5 -main:AuditProgram -out:"$O/BaselineProbe.exe" "$O/Core-42c0050a.cs" tests/helpers/TpmCeremonyFaultTransport.cs "$W/WL412Probe.cs" "$W/R2Probe.cs" "$W/AuditProbe.cs" "$W/GeminiProbe.cs" "$W/G47Probe.cs" > "$O/baseline-build.log" 2>&1
rc=$?; echo "baseline build exit=$rc"; [ "$rc" = 0 ] || exit "$rc"
for mode in r2:written-before-reconcile r2:neg-increment-loss r2:trailing-params auth-reserved primary-empty-public policy-invalid-ticket start-policy-empty-nonce handle-baseline-alias malformed-absence negative-policy-loss
do
  start_own
  slug=${mode/:/-}
  mono "$O/BaselineProbe.exe" "$mode" 2101 > "$O/baseline-$slug.jsonl" 2> "$O/baseline-$slug.stderr"
  rc=$?; echo "baseline $mode exit=$rc"; printf '%s\n' "$rc" > "$O/baseline-$slug.exit"
done
mcs -langversion:5 -main:ParserChecks -out:"$O/ParserChecks.exe" sim/tpm-ceremony/TpmCeremonyCore.cs "$W/ParserChecks.cs" > "$O/parser-build.log" 2>&1
echo "parser build exit=$?"
mono "$O/ParserChecks.exe" > "$O/parser-checks.jsonl"; echo "parser checks exit=$?"
date -u +%FT%TZ
