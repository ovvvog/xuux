#!/usr/bin/env bash
set -u
W=/home/user/workspace/council-wl413/gpt_6_1_sol
O="$W/fresh"
R=/home/user/workspace/xuux-review-dbaf6104
exec > >(tee "$O/additional-commands.log") 2>&1
start() {
  state=$(mktemp -d "$O/extra-state-XXXXXX")
  swtpm socket --tpm2 --tpmstate "dir=$state" --server type=tcp,port=2101,bindaddr=127.0.0.1 --ctrl type=tcp,port=2102,bindaddr=127.0.0.1 --flags not-need-init,startup-clear --pid "file=$O/extra.pid" --daemon || exit 95
  p=$(<"$O/extra.pid")
  echo "sim pid=$p state=$state rc=0"
}
stop() { kill "$p"; sleep 0.1; }
trap 'test -z "${p:-}" || kill "$p" 2>/dev/null || true' EXIT
cd "$R" || exit 99
for mode in helper:define-not-executed helper:transport-dead-after-define helper:getcap-wrong-cap helper:load-name-short helper:define-params-extra
do
  start
  slug=${mode/:/-}
  mono "$O/AuditProbe.exe" "$mode" 2101 > "$O/$slug.jsonl" 2> "$O/$slug.stderr"
  rc=$?; echo "$mode exit=$rc"; printf '%s\n' "$rc" > "$O/$slug.exit"
  stop
done
start
mono "$O/BaselineProbe.exe" old:missing-response-auth 2101 > "$O/baseline-old-missing-response-auth.jsonl" 2> "$O/baseline-old-missing-response-auth.stderr"
rc=$?; echo "baseline old:missing-response-auth exit=$rc"; printf '%s\n' "$rc" > "$O/baseline-old-missing-response-auth.exit"
stop
start
for stage in S1 S2
do
 pwsh -NoProfile -File sim/tpm-ceremony/rehearse.ps1 -SimHost 127.0.0.1 -SimPort 2101 -Stages "$stage" -SimPidFile "$O/extra.pid" > "$O/rehearsal-$stage.json" 2> "$O/rehearsal-$stage.stderr"
 echo "direct $stage exit=$?"
done
mcs -langversion:5 -main:PolicyRefMain -out:"$O/PolicyRef.exe" sim/tpm-ceremony/TpmCeremonyCore.cs "$W/PolicyRefProbe.cs" "$W/PolicyRefMain.cs" > "$O/policyref-build.log" 2>&1
echo "policyRef build exit=$?"
mono "$O/PolicyRef.exe" > "$O/policyref.json" 2> "$O/policyref.stderr"
echo "policyRef run exit=$?"
TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=2101 tpm2_getcap properties-fixed > "$O/properties-fixed.txt"; echo "properties-fixed exit=$?"
for cap in handles-nv-index handles-loaded-session handles-transient
do
 TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=2101 tpm2_getcap "$cap" > "$O/final-$cap.txt"
 echo "final $cap exit=$? bytes=$(wc -c < "$O/final-$cap.txt")"
done
stop
date -u +%FT%TZ
ss -ltnp '( sport = :2101 or sport = :2102 or sport = :2103 )'
