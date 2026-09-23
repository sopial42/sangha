#!/usr/bin/env sh
# Fetch the Claude Code plugins Sangha loads, pinned to exact commits.
set -eu
DEST="${1:-vendor/plugins}"
mkdir -p "$DEST"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch() { # name repo commit subdir
  name=$1 repo=$2 commit=$3 sub=${4:-.}
  [ -f "$DEST/$name/.pinned-$commit" ] && { echo "✓ $name"; return; }
  rm -rf "$DEST/$name" "$TMP/$name"
  git init -q "$TMP/$name"
  git -C "$TMP/$name" fetch -q --depth 1 "$repo" "$commit"
  git -C "$TMP/$name" checkout -q FETCH_HEAD
  cp -R "$TMP/$name/$sub" "$DEST/$name"
  rm -rf "$DEST/$name/.git"
  touch "$DEST/$name/.pinned-$commit"
  echo "↓ $name@$(echo "$commit" | cut -c1-7)"
}

fetch superpowers     https://github.com/obra/superpowers                     5bf4e78011075bcfc0dc295f0724994cd123ee71
fetch ui-ux-pro-max   https://github.com/nextlevelbuilder/ui-ux-pro-max-skill dcc40ff5133ef78276117db0cc34e7b83cc8aeba
fetch frontend-design https://github.com/anthropics/claude-plugins-official   db467cc56673fc963ca418b4165c688dfbe77007 plugins/frontend-design
