#!/usr/bin/env bash
set -eu
out=/tmp/council-wl420-gpt_6_1_sol
src=/tmp/wt-df435a95-gpt/tests/helpers/tpm-ceremony-harness.ps1
cp "$src" "$out/old-harness.ps1"
sed -i \
  -e "s|^\\\$root = .*|\\\$root = '/tmp/wt-a3f1505d'|" \
  -e "s|^\\\$helper = .*|\\\$helper = '/tmp/wt-df435a95-gpt/tests/helpers/TpmCeremonyFaultTransport.cs'|" \
  "$out/old-harness.ps1"
diff -u "$src" "$out/old-harness.ps1" || test "$?" -eq 1
git -C /tmp/wt-a3f1505d rev-parse HEAD
sha256sum /tmp/wt-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs /tmp/wt-a3f1505d/tests/helpers/ceremony-swtpm.mjs /tmp/wt-df435a95-gpt/tests/sim/tpm-ceremony-wl416.test.mjs /tmp/wt-df435a95-gpt/tests/helpers/TpmCeremonyFaultTransport.cs
