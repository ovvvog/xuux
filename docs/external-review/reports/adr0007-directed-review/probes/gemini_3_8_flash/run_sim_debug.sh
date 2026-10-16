#!/usr/bin/env bash
set -uo pipefail

PORT=2331
CTRL=2332
state_dir="$(mktemp -d /tmp/xuux-debug-swtpm.XXXXXX)"
pid_file="${state_dir}/swtpm.pid"

cleanup() {
  if [ -f "${pid_file}" ]; then kill "$(cat "${pid_file}")" 2>/dev/null || true; fi
  rm -rf "${state_dir}"
}
trap cleanup EXIT

swtpm socket --tpm2 \
  --tpmstate dir="${state_dir}" \
  --server type=tcp,port=${PORT},bindaddr=127.0.0.1 \
  --ctrl type=tcp,port=${CTRL},bindaddr=127.0.0.1 \
  --flags not-need-init,startup-clear \
  --pid file="${pid_file}" \
  --daemon

export TPM2TOOLS_TCTI="swtpm:host=127.0.0.1,port=${PORT}"
export XUUX_TPM_SIM=1

ready=0
for _ in $(seq 1 30); do
  if tpm2_getcap properties-fixed >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done

if [ "${ready}" != 1 ]; then
  echo "swtpm not responding" >&2
  exit 1
fi

cd /home/user/workspace/xuux-review-a76c8478
node --test --test-concurrency=1 tests/sim/
rc=$?
echo "Exit code: $rc"
exit $rc
