#!/usr/bin/env bash
set -eu
base=/home/user/workspace/council-adr0007/gpt_6_1_sol
state="${base}/runtime/nvcertify-tpm"
out="${base}/probe-artifacts/P08-real-command-on-simulator"
mkdir -p "${state}" "${out}"
trap 'if test -f "${state}/pid"; then kill "$(cat "${state}/pid")" 2>/dev/null || true; fi' EXIT
swtpm socket --tpm2 --tpmstate dir="${state}" --server type=tcp,port=29341,bindaddr=127.0.0.1 --ctrl type=tcp,port=29342,bindaddr=127.0.0.1 --flags not-need-init,startup-clear --pid file="${state}/pid" --daemon
export TPM2TOOLS_TCTI=swtpm:host=127.0.0.1,port=29341
cd "${out}"
step() {
  printf 'COMMAND'
  printf ' %q' "$@"
  printf '\n'
  set +e
  "$@"
  rc=$?
  set -e
  printf 'EXIT %s\n' "$rc"
  test "$rc" = 0 || exit "$rc"
}
step tpm2 getcap properties-fixed
step tpm2 nvdefine -C o -s 8 -a 'ownerread|ownerwrite|nt=counter' 0x1500067
step tpm2 nvincrement -C o 0x1500067
step tpm2 createprimary -C o -G ecc:ecdsa-sha256 -g sha256 -a 'fixedtpm|fixedparent|sensitivedataorigin|userwithauth|restricted|sign' -c ak.ctx
step tpm2 flushcontext -t
step tpm2 readpublic -c ak.ctx -f pem -o ak.pem
step tpm2 flushcontext -t
step tpm2 nvcertify -C ak.ctx -c o -g sha256 -s ecdsa -f plain -q aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --size 8 --offset 0 --attestation attest-a.bin -o sig-a.bin 0x1500067
step tpm2 flushcontext -t
step tpm2 nvcertify -C ak.ctx -c o -g sha256 -s ecdsa -f plain -q bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb --size 8 --offset 0 --attestation attest-b.bin -o sig-b.bin 0x1500067
step openssl dgst -sha256 -verify ak.pem -signature sig-a.bin attest-a.bin
step openssl dgst -sha256 -verify ak.pem -signature sig-b.bin attest-b.bin
step node "${base}/parse-attest.mjs" "${out}"
