#!/bin/bash
# One-command release: bump patch version, build, reinstall locally, commit, push, publish a GitHub release.
# Usage: ./ship.sh "one-line description of what changed"
set -e
cd "$(dirname "$0")"

MSG="${1:?Usage: ./ship.sh \"description of what changed\"}"

VERSION=$(node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('package.json'));
const parts = p.version.split('.').map(Number);
parts[2]++;
p.version = parts.join('.');
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
console.log(p.version);
")
echo "==> Building v$VERSION"

# The dictation helper is frozen separately and bundled in via extraResources.
# Rebuild it only when it's missing or older than its source, since PyInstaller
# takes minutes and most releases don't touch dictation.
if [ ! -x dictate-dist/dictate/dictate.exe ] || [ dictate.py -nt dictate-dist/dictate/dictate.exe ] || [ dictate.spec -nt dictate-dist/dictate/dictate.exe ]; then
  echo "==> Rebuilding the dictation helper"
  ./build-dictate.sh
fi

npm run dist

EXE="dist/Write Notes Setup $VERSION.exe"

echo "==> Reinstalling locally"
taskkill //IM "Write Notes.exe" //F 2>/dev/null || true
"$EXE" /S

echo "==> Committing and pushing"
# .gitignore already covers dist/ and node_modules/; naming them as exclude pathspecs
# made git treat them as explicitly-added ignored paths, exit 1, and kill the script here
git add -A
git commit -m "v$VERSION: $MSG"
git push origin master

echo "==> Publishing GitHub release"
gh release create "v$VERSION" "$EXE" --title "v$VERSION" --notes "$MSG"

echo "==> Done: v$VERSION shipped and installed locally"
