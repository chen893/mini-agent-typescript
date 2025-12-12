#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${HOME}/.mini-agent/config"

echo "Mini Agent TypeScript - setup config"
echo "Target: ${TARGET_DIR}"

mkdir -p "${TARGET_DIR}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${ROOT_DIR}/config"

copy_if_missing () {
  local src="$1"
  local dst="$2"
  if [[ -f "${TARGET_DIR}/${dst}" ]]; then
    echo "Skip (already exists): ${TARGET_DIR}/${dst}"
  else
    cp "${SRC_DIR}/${src}" "${TARGET_DIR}/${dst}"
    echo "Created: ${TARGET_DIR}/${dst}"
  fi
}

copy_if_missing "config-example.yaml" "config.yaml"
copy_if_missing "mcp.json" "mcp.json"
copy_if_missing "system_prompt.md" "system_prompt.md"

echo "Done."
echo "Next: edit ${TARGET_DIR}/config.yaml and fill api_key/api_base."

