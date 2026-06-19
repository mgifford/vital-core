#!/usr/bin/env bash

set -euo pipefail

SOURCE_REF="${SOURCE_REF:-main}"
SOURCE_REMOTE="${SOURCE_REMOTE:-origin}"
HF_REMOTE="${HF_REMOTE:-hf}"
HF_URL="${HF_URL:-https://huggingface.co/spaces/mgifford/vital-core.git}"
PUSH="${PUSH:-1}"

load_local_env() {
  if [[ -f .env ]]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
  fi
}

log() { printf '[publish-repos] %s\n' "$*"; }
die() { printf '[publish-repos] ERROR: %s\n' "$*" >&2; exit 1; }

require_clean_worktree() {
  git diff --quiet --ignore-submodules -- && git diff --cached --quiet --ignore-submodules --
}

ensure_hf_remote() {
  if git remote get-url "$HF_REMOTE" >/dev/null 2>&1; then
    return 0
  fi
  log "Adding Hugging Face remote '$HF_REMOTE' -> '$HF_URL'"
  git remote add "$HF_REMOTE" "$HF_URL"
}

ensure_hf_auth() {
  if hf auth whoami >/dev/null 2>&1; then
    return 0
  fi

  [[ -n "${HF_TOKEN:-}" ]] || die "HF_TOKEN is not set; add it to .env or export it, then rerun."
  log "Logging into Hugging Face for git pushes"
  hf auth login --token "$HF_TOKEN" --add-to-git-credential --force >/dev/null
}

push_source_branch() {
  if [[ "$PUSH" != "1" ]]; then
    log "Skipping GitHub push (--no-push)"
    return 0
  fi

  log "Pushing '$SOURCE_REF' -> '$SOURCE_REMOTE/$SOURCE_REF'"
  git push -u "$SOURCE_REMOTE" "$SOURCE_REF:$SOURCE_REF"
}

push_hf_snapshot() {
  local remote_tip temp_dir
  remote_tip="$(git ls-remote "$HF_REMOTE" refs/heads/main | awk '{print $1}')"
  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/vital-core-hf.XXXXXX")"
  trap '[[ -n "${temp_dir:-}" ]] && rm -rf "$temp_dir"' RETURN

  git archive --format=tar "$SOURCE_REF" | tar -x -C "$temp_dir"
  rm -rf "$temp_dir/state"

  (
    cd "$temp_dir"
    git init -b main >/dev/null
    git config user.name "vital-core sync"
    git config user.email "vital-core@users.noreply.github.com"
    git add -A
    git commit -m "Deploy snapshot for Hugging Face Spaces" >/dev/null
    git remote add hf "$HF_URL"

    if [[ "$PUSH" != "1" ]]; then
      log "Skipping Hugging Face push (--no-push)"
      return 0
    fi

    log "Pushing snapshot -> '$HF_REMOTE/main'"
    if [[ -n "$remote_tip" ]]; then
      git push -u --force-with-lease=main:$remote_tip hf HEAD:main
    else
      git push -u hf HEAD:main
    fi
  )
}

show_status() {
  log "Source branch: $SOURCE_REF"
  log "GitHub remote: $SOURCE_REMOTE"
  log "HF deploy branch: main"
  log "HF remote: $HF_REMOTE"
  echo
  git remote -v
  echo
  git branch --list "$SOURCE_REF"
}

publish() {
  load_local_env
  require_clean_worktree || die "Working tree must be clean before publishing."
  ensure_hf_remote
  ensure_hf_auth
  push_source_branch
  push_hf_snapshot
}

usage() {
  cat <<'EOF'
publish-repos.sh - publish the GitHub source branch and the Hugging Face deploy snapshot

Usage:
  scripts/publish-repos.sh status
  scripts/publish-repos.sh publish
  scripts/publish-repos.sh from-main
  scripts/publish-repos.sh setup

Environment overrides:
  SOURCE_REF     Local source branch to publish (default: main)
  SOURCE_REMOTE  GitHub remote name for the source branch (default: origin)
  HF_REMOTE      Hugging Face remote name (default: hf)
  HF_URL         Hugging Face Spaces git URL used when adding hf remote
  PUSH           Set to 0 to skip pushing

Repository roles:
  - GitHub keeps the full source history on main.
  - Hugging Face gets a clean deployment snapshot on main.
  - Large state files are stripped from the Space snapshot before push.
EOF
}

main() {
  local command="${1:-status}"
  case "$command" in
    status)
      show_status
      ;;
    publish|from-main)
      publish
      ;;
    setup)
      load_local_env
      ensure_hf_remote
      ensure_hf_auth
      show_status
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      usage
      die "Unknown command: $command"
      ;;
  esac
}

main "$@"