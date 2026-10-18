#!/bin/bash
# Restart only the reviewer simulator on 5800/5801, then run one probe.
set -u
ROOT=/home/user/workspace/council-wl413-r3/grok_4_7
PIDFILE=$ROOT/pid
ST=$ROOT/st
PROBE=$1
OUT=$ROOT/raw/ceremony-$PROBE.json

restart() {
  if [[ -f $PIDFILE ]]; then
    local old
    old=$(cat "$PIDFILE" || true)
    if [[ -n ${old:-} ]]; then kill "$old" 2>/dev/null || true; fi
  fi
  sleep 0.3
  # refuse if 5800 still owned by a different pid
  if ss -ltn | awk '{print $4}' | grep -q ':5800$'; then
    echo "5800 still listening after kill" >&2
    ss -ltnp | grep -E '5800|5801' >&2 || true
    exit 3
  fi
  rm -rf "$ST"
  mkdir -p "$ST"
  swtpm socket --tpm2 --tpmstate "dir=$ST" \
    --server type=tcp,port=5800,bindaddr=127.0.0.1 \
    --ctrl type=tcp,port=5801,bindaddr=127.0.0.1 \
    --flags not-need-init,startup-clear \
    --pid "file=$PIDFILE" --daemon
  sleep 0.4
  tpm2_getcap --tcti=swtpm:host=127.0.0.1,port=5800 properties-fixed >/dev/null
}

if [[ ${2:-} != "norestart" ]]; then
  restart
fi
set +e
pwsh -NoProfile -File "$ROOT/probes/probe.ps1" -Kind ceremony -Probe "$PROBE" -SimPort 5800 > "$OUT"
ec=$?
set -e
echo "PROBE $PROBE exit=$ec" >> "$ROOT/raw/ceremony-exits.txt"
{
  echo "---- $PROBE tpm2 ----"
  tpm2_getcap --tcti=swtpm:host=127.0.0.1,port=5800 handles-nv-index
  tpm2_getcap --tcti=swtpm:host=127.0.0.1,port=5800 handles-transient
  tpm2_getcap --tcti=swtpm:host=127.0.0.1,port=5800 handles-loaded-session
  echo "---- end $PROBE ----"
} >> "$ROOT/raw/tpm2-after.txt"
echo "done $PROBE exit=$ec"
