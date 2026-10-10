#!/usr/bin/env bash
# Download the CMU Keystroke Dynamics Benchmark data (Killourhy & Maxion, DSN 2009).
# The CSV is not committed to this repo; please cite the paper if you use it.
set -euo pipefail
cd "$(dirname "$0")/.."
URL="https://www.cs.cmu.edu/~keystroke/DSL-StrongPasswordData.csv"
OUT="DSL-StrongPasswordData.csv"
MD5="470235f96568f28f9ea0da62234ec857"   # as published on cs.cmu.edu/~keystroke

if [ ! -f "$OUT" ]; then
  echo "Downloading $URL"
  curl -fSL --retry 3 -o "$OUT.part" "$URL"
  mv "$OUT.part" "$OUT"
fi

if command -v md5sum >/dev/null; then GOT=$(md5sum "$OUT" | cut -d' ' -f1)
else GOT=$(md5 -q "$OUT"); fi
if [ "$GOT" != "$MD5" ]; then
  echo "Checksum mismatch: got $GOT, expected $MD5" >&2; exit 1
fi
echo "OK: $OUT ($(($(wc -l < "$OUT") - 1)) rows). Now run: node bench.js $OUT"
