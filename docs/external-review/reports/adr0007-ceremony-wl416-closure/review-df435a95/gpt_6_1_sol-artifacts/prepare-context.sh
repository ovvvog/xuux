#!/usr/bin/env bash
set -eu
out=/tmp/council-wl420-gpt_6_1_sol
src=/tmp/wt-df435a95-gpt/docs/external-review/reports/adr0007-ceremony-wl416-closure/probes
mkdir -p "$out/context-probe"
cp "$src/run.sh" "$src/CtxRegressionProbe.cs" "$out/context-probe/"
sed -i 's|/tmp/wl416-ctxreg-sim.XXXXXX|/tmp/council-wl420-gpt_6_1_sol/context-probe/wl416-ctxreg-sim.XXXXXX|' "$out/context-probe/run.sh"
diff -u "$src/run.sh" "$out/context-probe/run.sh" || test "$?" -eq 1
sha256sum "$src/CtxRegressionProbe.cs" "$out/context-probe/CtxRegressionProbe.cs"
