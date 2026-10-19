#!/bin/bash
set -u
cd /tmp/wt-72e79272-grok
export XUUX_TPM_SIM=1
export TPM2TOOLS_TCTI='swtpm:host=127.0.0.1,port=2321'
if [[ "${XUUX_OLD_HELPER:-}" != "" ]]; then
  exec node --experimental-loader /tmp/council-wl422-grok_4_7/probes/old-helper-loader.mjs \
    --test --test-concurrency=1 --test-name-pattern '^(L7|L8)' \
    tests/sim/tpm-ceremony-wl416.test.mjs
fi
exec node --test --test-concurrency=1 --test-name-pattern '^(L7|L8)' \
  tests/sim/tpm-ceremony-wl416.test.mjs
