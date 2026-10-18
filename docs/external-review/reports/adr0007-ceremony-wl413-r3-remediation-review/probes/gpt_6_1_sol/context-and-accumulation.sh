#!/usr/bin/env bash
set -u
W=/home/user/workspace/council-wl413-r3/gpt_6_1_sol
R=/home/user/workspace/xuux-review-de099aa8
mkdir -p "$W/context/bin" "$W/accumulation/st"
gcc -Wall -Wextra -O2 "$W/fake-swtpm.c" -o "$W/context/bin/swtpm" > "$W/context/fake-build.log" 2>&1
printf 'fake build exit=%s\n' "$?" >> "$W/context/commands.log"
"$W/context/bin/swtpm" socket --tpm2 --server type=tcp,port=5600,bindaddr=127.0.0.1 > "$W/context/fake-listener.log" 2>&1 &
pid=$!
sleep .15
pwsh -NoProfile -File "$R/sim/tpm-ceremony/rehearse.ps1" -SimHost 127.0.0.1 -SimPort 5600 -Stages ALL > "$W/context/fake-exe.json" 2> "$W/context/fake-exe.stderr"
printf 'fake context exit=%s\n' "$?" >> "$W/context/commands.log"
kill "$pid"
wait "$pid"
printf 'fake listener wait exit=%s\n' "$?" >> "$W/context/commands.log"
mkdir -p "$W/context/broad-st"
swtpm socket --tpm2 --tpmstate "dir=$W/context/broad-st" --server type=tcp,port=5600,bindaddr=127.0.0.1 --ctrl type=tcp,port=5601,bindaddr=0.0.0.0 --flags not-need-init,startup-clear --pid "file=$W/context/broad-st/pid" --daemon > "$W/context/broad.launch" 2>&1
printf 'broad launch exit=%s\n' "$?" >> "$W/context/commands.log"
ss -ltnp '( sport = :5600 or sport = :5601 )' > "$W/context/broad-listeners.txt"
pwsh -NoProfile -File "$R/sim/tpm-ceremony/rehearse.ps1" -SimHost 127.0.0.1 -SimPort 5600 -Stages ALL -SimPidFile "$W/context/broad-st/pid" > "$W/context/broad-control.json" 2> "$W/context/broad-control.stderr"
printf 'broad control context exit=%s\n' "$?" >> "$W/context/commands.log"
kill "$(<"$W/context/broad-st/pid")"
sleep .1
swtpm socket --tpm2 --tpmstate "dir=$W/accumulation/st" --server type=tcp,port=5600,bindaddr=127.0.0.1 --ctrl type=tcp,port=5601,bindaddr=127.0.0.1 --flags not-need-init,startup-clear --pid "file=$W/accumulation/st/pid" --daemon > "$W/accumulation/launch.txt" 2>&1
printf 'accumulation launch exit=%s\n' "$?" >> "$W/accumulation/commands.log"
tpm2_getcap --tcti=swtpm:host=127.0.0.1,port=5600 handles-nv-index > "$W/accumulation/nv-initial.txt" 2>&1
for n in 1 2 3; do
  pwsh -NoProfile -NonInteractive -File "$R/tests/helpers/tpm-ceremony-harness.ps1" -Mode fault -SimPort 5600 -Fault define-response-loss > "$W/accumulation/lost-$n.json" 2> "$W/accumulation/lost-$n.stderr"
  printf 'fault define-response-loss %s exit=%s\n' "$n" "$?" >> "$W/accumulation/commands.log"
  tpm2_getcap --tcti=swtpm:host=127.0.0.1,port=5600 handles-nv-index > "$W/accumulation/nv-$n.txt" 2>&1
done
pwsh -NoProfile -File "$R/sim/tpm-ceremony/rehearse.ps1" -SimHost 127.0.0.1 -SimPort 5600 -Stages ALL -SimPidFile "$W/accumulation/st/pid" > "$W/accumulation/subsequent-normal.json" 2> "$W/accumulation/subsequent-normal.stderr"
printf 'subsequent normal exit=%s\n' "$?" >> "$W/accumulation/commands.log"
tpm2_getcap --tcti=swtpm:host=127.0.0.1,port=5600 handles-nv-index > "$W/accumulation/nv-after-normal.txt" 2>&1
kill "$(<"$W/accumulation/st/pid")"
sleep .1
ss -ltnp '( sport = :5600 or sport = :5601 )' > "$W/context/final-listeners.txt"
