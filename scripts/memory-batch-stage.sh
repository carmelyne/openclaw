#!/usr/bin/env bash
set -euo pipefail

# Incremental memory indexing helper for large chat exports.
# It stages files from an archive directory into the live memory folder
# in batches, so each index pass is smaller and restart-safe.

LIVE_DIR="${OPENCLAW_MEMORY_LIVE_DIR:-$HOME/.openclaw/workspace/memory/chatgpt-export}"
ARCHIVE_DIR="${OPENCLAW_MEMORY_ARCHIVE_DIR:-$HOME/.openclaw/workspace/chatgpt-export-source}"
STATE_DIR="${OPENCLAW_MEMORY_BATCH_STATE_DIR:-$HOME/.openclaw/memory-batch}"
MANIFEST="${STATE_DIR}/manifest.tsv"
CURSOR="${STATE_DIR}/cursor.txt"
OPENCLAW_REPO="${OPENCLAW_REPO:-$HOME/dev/kimiclaw/openclaw}"
DEFAULT_BATCH_SIZE="${DEFAULT_BATCH_SIZE:-200}"

usage() {
  cat <<'EOF'
Usage:
  memory-batch-stage.sh init
  memory-batch-stage.sh status
  memory-batch-stage.sh next [batch_size]
  memory-batch-stage.sh run [batch_size]
  memory-batch-stage.sh rebuild-manifest

Commands:
  init
    One-time setup:
    - Moves current live export folder to archive location (if archive missing)
    - Creates empty live folder
    - Builds sorted manifest (smallest files first)
    - Resets cursor to 0

  status
    Shows staged progress and file counts.

  next [batch_size]
    Copies the next N markdown files from archive to live folder.
    Keeps already staged files in place.

  run [batch_size]
    Runs "next [batch_size]" then launches:
      node dist/index.js memory index --agent main --verbose

  rebuild-manifest
    Rebuilds manifest from archive and keeps current cursor.

Environment overrides:
  OPENCLAW_MEMORY_LIVE_DIR
  OPENCLAW_MEMORY_ARCHIVE_DIR
  OPENCLAW_MEMORY_BATCH_STATE_DIR
  OPENCLAW_REPO
  DEFAULT_BATCH_SIZE
EOF
}

ensure_dirs() {
  mkdir -p "${STATE_DIR}"
  mkdir -p "${LIVE_DIR}"
}

count_md_files() {
  local dir="$1"
  if [[ ! -d "$dir" ]]; then
    echo 0
    return
  fi
  find "$dir" -type f -name '*.md' | wc -l | tr -d '[:space:]'
}

build_manifest() {
  ensure_dirs
  if [[ ! -d "${ARCHIVE_DIR}" ]]; then
    echo "Archive directory missing: ${ARCHIVE_DIR}" >&2
    exit 1
  fi
  : > "${MANIFEST}"
  while IFS= read -r -d '' file; do
    # Fixed-width size sort key for stable numeric ordering.
    size=$(wc -c < "$file" | tr -d '[:space:]')
    rel="${file#${ARCHIVE_DIR}/}"
    printf '%012d\t%s\n' "$size" "$rel" >> "${MANIFEST}"
  done < <(find "${ARCHIVE_DIR}" -type f -name '*.md' -print0)
  sort -n -o "${MANIFEST}" "${MANIFEST}"
}

init_cmd() {
  ensure_dirs
  if [[ ! -d "${ARCHIVE_DIR}" ]]; then
    if [[ -d "${LIVE_DIR}" ]] && [[ "$(count_md_files "${LIVE_DIR}")" -gt 0 ]]; then
      mkdir -p "$(dirname "${ARCHIVE_DIR}")"
      mv "${LIVE_DIR}" "${ARCHIVE_DIR}"
      mkdir -p "${LIVE_DIR}"
      echo "Moved existing live export to archive:"
      echo "  ${ARCHIVE_DIR}"
      echo "Created fresh live dir:"
      echo "  ${LIVE_DIR}"
    else
      echo "Nothing to archive. Expected source not found:"
      echo "  ${LIVE_DIR}"
      exit 1
    fi
  fi

  build_manifest
  echo 0 > "${CURSOR}"

  total=$(wc -l < "${MANIFEST}" | tr -d '[:space:]')
  echo "Init complete."
  echo "  Archive: ${ARCHIVE_DIR}"
  echo "  Live:    ${LIVE_DIR}"
  echo "  Total files in manifest: ${total}"
}

status_cmd() {
  ensure_dirs
  if [[ ! -f "${MANIFEST}" ]]; then
    echo "Manifest not found: ${MANIFEST}"
    echo "Run: $0 init"
    exit 1
  fi
  total=$(wc -l < "${MANIFEST}" | tr -d '[:space:]')
  cursor=0
  if [[ -f "${CURSOR}" ]]; then
    cursor=$(cat "${CURSOR}" | tr -d '[:space:]')
  fi
  live_count=$(count_md_files "${LIVE_DIR}")
  archive_count=$(count_md_files "${ARCHIVE_DIR}")
  pct=0
  if [[ "${total}" -gt 0 ]]; then
    pct=$(( cursor * 100 / total ))
  fi
  echo "Batch status"
  echo "  Manifest total: ${total}"
  echo "  Cursor:         ${cursor} (${pct}%)"
  echo "  Live files:     ${live_count}"
  echo "  Archive files:  ${archive_count}"
  echo "  Remaining:      $(( total - cursor ))"
}

next_cmd() {
  ensure_dirs
  if [[ ! -f "${MANIFEST}" ]]; then
    echo "Manifest not found. Run: $0 init"
    exit 1
  fi
  batch_size="${1:-${DEFAULT_BATCH_SIZE}}"
  if ! [[ "${batch_size}" =~ ^[0-9]+$ ]] || [[ "${batch_size}" -le 0 ]]; then
    echo "Batch size must be a positive integer." >&2
    exit 1
  fi

  total=$(wc -l < "${MANIFEST}" | tr -d '[:space:]')
  cursor=0
  if [[ -f "${CURSOR}" ]]; then
    cursor=$(cat "${CURSOR}" | tr -d '[:space:]')
  fi
  if [[ "${cursor}" -ge "${total}" ]]; then
    echo "All files already staged."
    return
  fi

  start=$(( cursor + 1 ))
  end=$(( cursor + batch_size ))
  if [[ "${end}" -gt "${total}" ]]; then
    end="${total}"
  fi

  copied=0
  while IFS=$'\t' read -r _size rel; do
    src="${ARCHIVE_DIR}/${rel}"
    dst="${LIVE_DIR}/${rel}"
    mkdir -p "$(dirname "${dst}")"
    cp -n "${src}" "${dst}"
    copied=$(( copied + 1 ))
  done < <(sed -n "${start},${end}p" "${MANIFEST}")

  echo "${end}" > "${CURSOR}"
  echo "Staged ${copied} file(s): ${start}-${end} of ${total}"
}

run_cmd() {
  batch_size="${1:-${DEFAULT_BATCH_SIZE}}"
  next_cmd "${batch_size}"
  echo "Starting memory index..."
  cd "${OPENCLAW_REPO}"
  set +e
  node dist/index.js memory index --agent main --verbose
  code=$?
  set -e
  if [[ "${code}" -eq 132 ]]; then
    cat <<'EOF'
Memory index crashed with: Illegal instruction (exit 132).

Most common cause on Apple Silicon:
- Running x64/Rosetta Node with native vector extension loading.

Quick fix:
  node dist/index.js config set agents.defaults.memorySearch.store.vector.enabled false
  node dist/index.js gateway restart
Then run this batch command again.
EOF
  fi
  return "${code}"
}

rebuild_manifest_cmd() {
  keep_cursor=0
  if [[ -f "${CURSOR}" ]]; then
    keep_cursor=$(cat "${CURSOR}" | tr -d '[:space:]')
  fi
  build_manifest
  echo "${keep_cursor}" > "${CURSOR}"
  total=$(wc -l < "${MANIFEST}" | tr -d '[:space:]')
  echo "Manifest rebuilt. Cursor kept at ${keep_cursor}/${total}."
}

main() {
  cmd="${1:-}"
  case "${cmd}" in
    init)
      init_cmd
      ;;
    status)
      status_cmd
      ;;
    next)
      shift || true
      next_cmd "${1:-${DEFAULT_BATCH_SIZE}}"
      ;;
    run)
      shift || true
      run_cmd "${1:-${DEFAULT_BATCH_SIZE}}"
      ;;
    rebuild-manifest)
      rebuild_manifest_cmd
      ;;
    -h|--help|help|"")
      usage
      ;;
    *)
      echo "Unknown command: ${cmd}" >&2
      usage
      exit 1
      ;;
  esac
}

main "$@"
