#!/usr/bin/env bash
set -u
W=/home/user/workspace/council-wl413/gpt_6_1_sol
R=/home/user/workspace/xuux-review-dbaf6104
exec > >(tee "$W/fresh/final-audit.log") 2>&1
date -u +%FT%TZ
git -C "$R" rev-parse HEAD; echo "git rev-parse rc=$?"
git -C "$R" status --porcelain > "$W/fresh/git-status.txt"
echo "git status --porcelain rc=$? bytes=$(wc -c < "$W/fresh/git-status.txt")"
git -C "$R" diff 1ca1668e -- sim/tpm-host/ > "$W/fresh/host-diff.txt"
echo "git diff 1ca1668e -- sim/tpm-host/ rc=$? bytes=$(wc -c < "$W/fresh/host-diff.txt")"
ss -ltnp '( sport = :2101 or sport = :2102 or sport = :2103 )'
echo "ss rc=$?"
ps -eo pid,ppid,args | rg "swtpm socket.*$W|node $W/transport-probes.mjs" | rg -v 'rg |bash -c' || true
echo "active own simulator/proxy listing ends"
node "$W/fresh-summary.mjs" > "$W/fresh/summary.log"; echo "summary rc=$?"
sha256sum "$W/fresh/tcg-part1-r138.pdf" "$W/fresh/tcg-part2-r138.pdf" "$W/fresh/tcg-part3-r138.pdf"
diff -u "$R/docs/external-review/reports/adr0007-ceremony-rehearsal-review/probes/gpt_6_1_sol/IndependentProbe.cs" "$W/WL412Probe.cs" > "$W/fresh/historical-adaptation.diff"
echo "historical diff exit=$? (1 denotes adaptation)"
node --version; pwsh --version; swtpm --version; tpm2_getcap --version; mcs --version
date -u +%FT%TZ
