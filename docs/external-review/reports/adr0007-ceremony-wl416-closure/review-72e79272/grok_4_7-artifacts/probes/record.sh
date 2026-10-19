#!/bin/bash
# Usage: record.sh <id> <command...>
set -u
EVID=/tmp/council-wl422-grok_4_7
id="$1"
shift
{
  printf '%q ' "$@"
  printf '\n'
} > "$EVID/${id}.command.txt"
set +e
"$@" > "$EVID/${id}.stdout.txt" 2> "$EVID/${id}.stderr.txt"
ec=$?
set -e
printf '%s\n' "$ec" > "$EVID/${id}.exit.txt"
# drop empty artifacts
if [[ ! -s "$EVID/${id}.stdout.txt" ]]; then rm -f "$EVID/${id}.stdout.txt"; fi
if [[ ! -s "$EVID/${id}.stderr.txt" ]]; then rm -f "$EVID/${id}.stderr.txt"; fi
echo "RECORDED $id exit=$ec"
exit 0
