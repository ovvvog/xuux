#!/usr/bin/env bash
set -u
W=/home/user/workspace/council-wl413-r3/gpt_6_1_sol
R=/home/user/workspace/xuux-review-de099aa8
mkdir -p "$W/shipped"
for mode in session-alias inventory-no-progress inventory-wrong-class auth-nonce-byte auth-hmac-byte auth-attrs-ff auth-attrs-clear paramsize-huge readpublic-malformed-18b readcounter-malformed-14a create-response-loss policysigned-neg-loss define-response-loss schema-public-empty schema-creationdata-short schema-creationhash-short schema-ticket-tag-flip schema-nonce-empty schema-nvread-short schema-sign-short schema-policysigned-digest missing-response-auth define-params-extra define-not-executed written-before-reconcile blocked-forever-undefine flush-refusal transport-dead-after-define unexpected-negative; do
  st="$W/shipped/st-$mode"
  mkdir -p "$st"
  swtpm socket --tpm2 --tpmstate "dir=$st" --server type=tcp,port=5600,bindaddr=127.0.0.1 --ctrl type=tcp,port=5601,bindaddr=127.0.0.1 --flags not-need-init,startup-clear --pid "file=$st/pid" --daemon > "$W/shipped/$mode.launch" 2>&1
  rc=$?; printf 'launch %s exit=%s\n' "$mode" "$rc" >> "$W/shipped/commands.log"
  if [ "$rc" -ne 0 ]; then exit "$rc"; fi
  pwsh -NoProfile -NonInteractive -File "$R/tests/helpers/tpm-ceremony-harness.ps1" -Mode fault -SimPort 5600 -Fault "$mode" > "$W/shipped/$mode.json" 2> "$W/shipped/$mode.stderr"
  rc=$?; printf 'pwsh harness -Mode fault -SimPort 5600 -Fault %s exit=%s\n' "$mode" "$rc" >> "$W/shipped/commands.log"
  printf '%s\n' "$rc" > "$W/shipped/$mode.exit"
  kill "$(<"$st/pid")"
  sleep .04
done
