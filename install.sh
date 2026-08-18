#!/bin/bash

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <path-to-obsidian-vault>"
  exit 1
fi

VAULT="$1"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ID="$(node -p "require('./manifest.json').id" 2>/dev/null)"
PLUGIN_DIR="$VAULT/.obsidian/plugins/$PLUGIN_ID"

if [ ! -d "$VAULT" ]; then
  echo "Vault not found: $VAULT"
  exit 1
fi

(
  cd "$SCRIPT_DIR"
  corepack pnpm build
)

mkdir -p "$PLUGIN_DIR"
cp "$SCRIPT_DIR/manifest.json" "$PLUGIN_DIR/manifest.json"
cp "$SCRIPT_DIR/main.js" "$PLUGIN_DIR/main.js"
cp "$SCRIPT_DIR/styles.css" "$PLUGIN_DIR/styles.css"

echo "Installed $PLUGIN_ID into $PLUGIN_DIR"
