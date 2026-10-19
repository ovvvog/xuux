#!/usr/bin/env bash
set -u
W=/home/user/workspace/council-wl413-r3/gpt_6_1_sol
R=/home/user/workspace/xuux-review-de099aa8
exe=${1:-IndependentR3.exe}
label=${2:-current}
mkdir -p "$W/$label"
modes=${3:-"primary-alias inventory-duplicate-alias baseline-transient-badclass auth-pw-nonce16 auth-pw-nonce32 auth-pw-nonce64 auth-pw-reserved3 auth-pw-audit2 auth-policy-password auth-policy-short auth-policy-continue auth-policy-reserved3 cd-missing cd-extra cd-parentalg cd-locality creationhash-flip creation-ticket-hierarchy creation-ticket-digest primary-name-flip session-policy-empty session-handle-wrongclass foreign-load-name policy-ticket-timeout policy-ticket-hierarchy policy-ticket-digest cleanup-undefine-loss"}
for mode in $modes; do
  state="$W/$label/st-$mode"
  mkdir -p "$state"
  swtpm socket --tpm2 --tpmstate "dir=$state" --server type=tcp,port=5600,bindaddr=127.0.0.1 --ctrl type=tcp,port=5601,bindaddr=127.0.0.1 --flags not-need-init,startup-clear --pid "file=$state/pid" --daemon > "$W/$label/$mode.launch" 2>&1
  rc=$?; printf 'launch %s %s\n' "$mode" "$rc" >> "$W/$label/commands.log"
  if [ "$rc" -ne 0 ]; then exit "$rc"; fi
  mono "$W/$exe" "$mode" > "$W/$label/$mode.json" 2> "$W/$label/$mode.stderr"
  rc=$?; printf 'mono %s %s %s\n' "$exe" "$mode" "$rc" >> "$W/$label/commands.log"
  printf '%s\n' "$rc" > "$W/$label/$mode.exit"
  pid=$(<"$state/pid")
  kill "$pid"
  for i in $(seq 1 100); do
    if ! ss -ltn '( sport = :5600 or sport = :5601 )' | sed 1d | rg -q .; then break; fi
    sleep .03
  done
done
