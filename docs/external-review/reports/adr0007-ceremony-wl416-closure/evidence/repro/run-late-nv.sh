#!/usr/bin/env bash
set -eu
base=/tmp/wl418-repro
tree=/home/user/workspace/xuux
for scenario in after-define after-primary; do
  port=7870; stages=S1
  if [[ "$scenario" == after-primary ]]; then port=7872; stages=S2; fi
  dir=$(/usr/bin/mktemp -d "$base/tmp/late-nv.XXXXXX")
  swtpm socket --tpm2 --tpmstate "dir=$dir" \
    --server "type=tcp,port=$port,bindaddr=127.0.0.1" \
    --ctrl "type=tcp,port=$((port+1)),bindaddr=127.0.0.1" \
    --flags not-need-init,startup-clear --pid "file=$dir/pid" --daemon
  pid=$(<"$dir/pid")
  set +e
  pwsh -NoProfile -NonInteractive -Command "\$ErrorActionPreference='Stop'; Add-Type -Path @('$tree/sim/tpm-ceremony/TpmCeremonyCore.cs','$base/LateNvProbe.cs') -IgnoreWarnings; [LateNvProbe]::Run($port, '$stages', '$scenario')" > "$base/late-nv-$scenario.log" 2>&1
  rc=$?
  set -e
  # This helper also enforces pidfd-only signalling and proof of disappearance.
  env TMPDIR="$base/tmp" node --input-type=module -e "
    import {stopSim} from '$tree/tests/helpers/ceremony-swtpm.mjs';
    if (!stopSim({pid:$pid,dir:'$dir'})) process.exit(91);
  "
  echo "$scenario exit=$rc"
  head -n 5 "$base/late-nv-$scenario.log"
  [[ $rc == 0 ]] || exit "$rc"
done
