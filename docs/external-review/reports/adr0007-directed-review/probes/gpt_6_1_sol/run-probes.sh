#!/usr/bin/env bash
set -eu
base=/home/user/workspace/council-adr0007/gpt_6_1_sol
state="${base}/runtime/probe-tpm"
mkdir -p "${state}"
trap 'if test -f "${state}/pid"; then kill "$(cat "${state}/pid")" 2>/dev/null || true; fi' EXIT
swtpm socket --tpm2 --tpmstate dir="${state}" --server type=tcp,port=29321,bindaddr=127.0.0.1 --ctrl type=tcp,port=29322,bindaddr=127.0.0.1 --flags not-need-init,startup-clear --pid file="${state}/pid" --daemon
export TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=29321
export XUUX_TPM_SIM=1
export TMPDIR="${base}/runtime"
tpm2_getcap properties-fixed > "${base}/logs/probe-properties-fixed.txt"
node "${base}/probes.mjs"
