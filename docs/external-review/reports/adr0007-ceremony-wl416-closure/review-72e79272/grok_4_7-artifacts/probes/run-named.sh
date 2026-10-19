#!/bin/bash
set -u
cd /tmp/wt-72e79272-grok
export XUUX_TPM_SIM=1
export TPM2TOOLS_TCTI='swtpm:host=127.0.0.1,port=2321'
pattern="$1"
exec node --test --test-concurrency=1 --test-name-pattern "$pattern" \
  tests/sim/tpm-ceremony-wl416.test.mjs
