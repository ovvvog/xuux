#!/usr/bin/env bash
set -u

OUTDIR="/home/user/workspace/council-adr0007/gemini_3_8_flash"
TREE="/home/user/workspace/xuux-review-a76c8478"
LOG="${OUTDIR}/evidence_probes.log"

exec > "${LOG}" 2>&1

echo "=== START PROBES: $(date -u +"%Y-%m-%d %H:%M:%S UTC") ==="

echo "--- PROBE 1: git rev-parse HEAD in review tree ---"
cd "${TREE}"
git rev-parse HEAD
echo "EXIT: $?"

echo "--- PROBE 2: Environment versions ---"
echo "node: $(node -v)"
echo "npm: $(npm -v)"
echo "swtpm: $(swtpm --version | head -n 1)"
echo "tpm2_getcap: $(tpm2_getcap --version | head -n 1)"
echo "openssl: $(openssl version)"
echo "psql: $(psql --version)"
echo "EXIT: 0"

echo "--- PROBE 3: scripts/tpm-sim-ci.sh from repo directory ---"
cd "${TREE}"
./scripts/tpm-sim-ci.sh
echo "EXIT: $?"

echo "--- PROBE 3b: scripts/tpm-sim-ci.sh from external directory (/home/user/workspace) ---"
cd /home/user/workspace
bash "${TREE}/scripts/tpm-sim-ci.sh"
echo "EXIT: $?"

echo "--- PROBE 4: tests/sim/channel-poc.test.mjs with XUUX_CHANNEL_POC=1 ---"
cd "${TREE}"
export XUUX_CHANNEL_POC=1
node --test tests/sim/channel-poc.test.mjs
echo "EXIT: $?"

echo "--- PROBE 5: tests/root-of-trust/replay-limit.test.mjs ---"
cd "${TREE}"
node --test tests/root-of-trust/replay-limit.test.mjs
echo "EXIT: $?"

echo "--- PROBE 6: tests/root-of-trust/freshness-socket.test.mjs ---"
cd "${TREE}"
node --test tests/root-of-trust/freshness-socket.test.mjs
echo "EXIT: $?"

echo "--- PROBE 7: scripts/production-entry.mjs fail-closed behavior ---"
cd "${TREE}"
NODE_ENV=production STATE_ENV=production node scripts/production-entry.mjs
echo "EXIT: $?"

echo "--- PROBE 7b: scripts/production-entry.mjs with unsupported backend ---"
cd "${TREE}"
NODE_ENV=production STATE_ENV=production XUUX_FRESHNESS_BACKEND=tpm_nv node scripts/production-entry.mjs
echo "EXIT: $?"

echo "--- PROBE 8: Direct TPM2 NV counter redefinition test on swtpm ---"
PORT=2341
CTRL=2342
TMPSTATE="$(mktemp -d /tmp/xuux-probe-swtpm.XXXXXX)"
PIDF="${TMPSTATE}/swtpm.pid"

swtpm socket --tpm2 \
  --tpmstate dir="${TMPSTATE}" \
  --server type=tcp,port=${PORT},bindaddr=127.0.0.1 \
  --ctrl type=tcp,port=${CTRL},bindaddr=127.0.0.1 \
  --flags not-need-init,startup-clear \
  --pid file="${PIDF}" \
  --daemon

export TPM2TOOLS_TCTI="swtpm:host=127.0.0.1,port=${PORT}"
sleep 1

NV_HANDLE=0x01800001
echo "Defining counter at ${NV_HANDLE}..."
tpm2_nvdefine -C o "${NV_HANDLE}" -s 8 -a "ownerread|ownerwrite|nt=counter"
echo "Incrementing counter..."
tpm2_nvincrement -C o "${NV_HANDLE}"
tpm2_nvincrement -C o "${NV_HANDLE}"
VAL1="$(tpm2_nvread -C o "${NV_HANDLE}" | xxd -p)"
echo "Counter hex after 2 increments: ${VAL1}"
echo "Undefining counter..."
tpm2_nvundefine -C o "${NV_HANDLE}"
echo "Redefining counter at ${NV_HANDLE}..."
tpm2_nvdefine -C o "${NV_HANDLE}" -s 8 -a "ownerread|ownerwrite|nt=counter"
VAL2="$(tpm2_nvread -C o "${NV_HANDLE}" | xxd -p)"
echo "Counter hex after redefinition (before increment): ${VAL2}"
echo "Incrementing redefined counter..."
tpm2_nvincrement -C o "${NV_HANDLE}"
VAL3="$(tpm2_nvread -C o "${NV_HANDLE}" | xxd -p)"
echo "Counter hex after increment: ${VAL3}"

kill "$(cat "${PIDF}")" 2>/dev/null || true
rm -rf "${TMPSTATE}"
echo "EXIT: $?"

echo "=== END PROBES: $(date -u +"%Y-%m-%d %H:%M:%S UTC") ==="
