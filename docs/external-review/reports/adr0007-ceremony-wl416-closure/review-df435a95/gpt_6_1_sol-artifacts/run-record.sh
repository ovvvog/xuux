#!/usr/bin/env bash
set -u
out=/tmp/council-wl420-gpt_6_1_sol
id=$1
shift
{
  printf 'cwd=%q\n' "$PWD"
  printf 'command='
  printf '%q ' "$@"
  printf '\nstart='
  date -u +'%Y-%m-%dT%H:%M:%SZ'
} > "$out/$id.command.txt"
"$@" > "$out/$id.stdout.txt" 2> "$out/$id.stderr.txt"
rc=$?
printf '%s\n' "$rc" > "$out/$id.exit.txt"
{
  printf 'end='
  date -u +'%Y-%m-%dT%H:%M:%SZ'
  printf 'exit=%s\n' "$rc"
} >> "$out/$id.command.txt"
printf '%s exit=%s stdout=%s/%s.stdout.txt stderr=%s/%s.stderr.txt\n' "$id" "$rc" "$out" "$id" "$out" "$id"
exit "$rc"
