#!/usr/bin/env bash
# Packs a finished `next build` into the cPanel deploy archive, with app.js and
# server.js at the top level.
#
# Usage: bash scripts/cpanel/package.sh <output.tar.gz>
set -euo pipefail

out="$(realpath -m "$1")"
cd "$(dirname "$0")/../.."

test -f .next/standalone/server.js || { echo "No standalone build. Run 'npm run build' first." >&2; exit 1; }

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

cp -a .next/standalone/. "$stage/"
mkdir -p "$stage/.next/static" "$stage/public"
cp -a .next/static/. "$stage/.next/static/"
cp -a public/. "$stage/public/"
cp scripts/cpanel/app.js "$stage/app.js"

if [ -n "$(find "$stage" -name '.env*')" ]; then
  echo "Refusing to pack: a .env file is in the output." >&2
  exit 1
fi
# The image optimiser is off. sharp must not ship (see next.config.mjs).
if [ -n "$(find "$stage" \( -path '*/node_modules/sharp' -o -path '*/node_modules/@img' \))" ]; then
  echo "Refusing to pack: sharp is in the output." >&2
  exit 1
fi

tar -czf "$out" --owner=0 --group=0 --numeric-owner -C "$stage" \
  .next app.js messages node_modules package.json public server.js
echo "Packed $out"
