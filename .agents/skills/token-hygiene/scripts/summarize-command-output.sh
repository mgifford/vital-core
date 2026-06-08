#!/usr/bin/env sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "usage: summarize-command-output.sh <log-file> [pattern]" >&2
  exit 2
fi

log_file="$1"
pattern="${2:-error|fail|panic|exception|traceback}"

if [ ! -f "$log_file" ]; then
  echo "missing log file: $log_file" >&2
  exit 2
fi

echo "== first matching lines =="
rg -n -i "$pattern" "$log_file" | head -40 || true
echo
echo "== tail =="
tail -80 "$log_file"
