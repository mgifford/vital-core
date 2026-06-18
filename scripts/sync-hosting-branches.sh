#!/usr/bin/env bash

set -euo pipefail

BASE_BRANCH="${BASE_BRANCH:-main}"
GITHUB_REMOTE="${GITHUB_REMOTE:-origin}"
GITHUB_BRANCH="${GITHUB_BRANCH:-github-hosting}"
HF_REMOTE="${HF_REMOTE:-hf}"
HF_BRANCH="${HF_BRANCH:-hf-spaces}"
HF_URL="${HF_URL:-https://huggingface.co/spaces/mgifford/vital-core.git}"
PUSH="${PUSH:-1}"

usage() {
  cat <<'EOF'
sync-hosting-branches.sh - keep GitHub and Hugging Face hosting branches in sync

Usage:
  scripts/sync-hosting-branches.sh status
  scripts/sync-hosting-branches.sh setup
  scripts/sync-hosting-branches.sh from-main
  scripts/sync-hosting-branches.sh from-github
  scripts/sync-hosting-branches.sh from-hf

Environment overrides:
  BASE_BRANCH     Shared source branch (default: main)
  GITHUB_REMOTE   GitHub remote name (default: origin)
  GITHUB_BRANCH   GitHub hosting branch (default: github-hosting)
  HF_REMOTE       Hugging Face remote name (default: hf)
  HF_BRANCH       Hugging Face hosting branch (default: hf-spaces)
  HF_URL          Hugging Face Spaces git URL used when adding hf remote
  PUSH            Set to 0 to skip pushing

Commands:
  status       Show branch and remote configuration.
  setup        Add the HF remote and create local hosting branches.
  from-main    Merge the shared base branch into both hosting branches.
  from-github  Merge GitHub hosting into HF Spaces, then push both.
  from-hf      Merge HF Spaces into GitHub hosting, then push both.

The worktree must be clean before syncing.
EOF
}

log() { printf '[sync-hosting] %s\n' "$*"; }
die() { printf '[sync-hosting] ERROR: %s\n' "$*" >&2; exit 1; }

require_clean_worktree() {
  git diff --quiet --ignore-submodules -- && git diff --cached --quiet --ignore-submodules --
}

current_branch() {
  local branch
  branch="$(git branch --show-current)"
  [[ -n "$branch" ]] || die "Run this from a named branch, not detached HEAD."
  printf '%s\n' "$branch"
}

ensure_hf_remote() {
  if git remote get-url "$HF_REMOTE" >/dev/null 2>&1; then
    return 0
  fi
  log "Adding Hugging Face remote '$HF_REMOTE' -> '$HF_URL'"
  git remote add "$HF_REMOTE" "$HF_URL"
}

fetch_remotes() {
  git fetch --prune "$GITHUB_REMOTE"
  git fetch --prune "$HF_REMOTE" >/dev/null 2>&1 || true
}

ensure_branch() {
  local branch="$1"
  local start_ref="$2"
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    return 0
  fi
  log "Creating local branch '$branch' from '$start_ref'"
  git switch -c "$branch" "$start_ref" >/dev/null
}

push_branch() {
  local branch="$1"
  local remote="$2"
  local remote_ref="${3:-$branch}"
  if [[ "$PUSH" != "1" ]]; then
    log "Skipping push for '$branch' (--no-push)"
    return 0
  fi
  log "Pushing '$branch' -> '$remote/$remote_ref'"
  git push -u "$remote" "$branch:$remote_ref"
}

switch_merge() {
  local target="$1"
  local source="$2"
  git switch "$target" >/dev/null
  git merge --no-edit "$source"
}

show_status() {
  log "Current branch: $(current_branch)"
  echo
  git remote -v
  echo
  git branch --list "$BASE_BRANCH" "$GITHUB_BRANCH" "$HF_BRANCH"
  echo
  log "Base:        $BASE_BRANCH"
  log "GitHub:      $GITHUB_REMOTE / $GITHUB_BRANCH"
  log "Hugging Face: $HF_REMOTE / $HF_BRANCH"
}

sync_from_main() {
  local original_branch
  original_branch="$(current_branch)"

  require_clean_worktree || die "Working tree must be clean before syncing."
  ensure_hf_remote
  fetch_remotes

  ensure_branch "$BASE_BRANCH" "$GITHUB_REMOTE/$BASE_BRANCH"
  ensure_branch "$GITHUB_BRANCH" "$BASE_BRANCH"
  ensure_branch "$HF_BRANCH" "$BASE_BRANCH"

  switch_merge "$GITHUB_BRANCH" "$BASE_BRANCH"
  push_branch "$GITHUB_BRANCH" "$GITHUB_REMOTE"

  switch_merge "$HF_BRANCH" "$BASE_BRANCH"
  push_branch "$HF_BRANCH" "$HF_REMOTE" main

  git switch "$original_branch" >/dev/null
}

sync_from_github() {
  local original_branch
  original_branch="$(current_branch)"

  require_clean_worktree || die "Working tree must be clean before syncing."
  ensure_hf_remote
  fetch_remotes

  ensure_branch "$GITHUB_BRANCH" "$GITHUB_REMOTE/$BASE_BRANCH"
  ensure_branch "$HF_BRANCH" "$HF_REMOTE/main"

  switch_merge "$HF_BRANCH" "$GITHUB_BRANCH"
  push_branch "$HF_BRANCH" "$HF_REMOTE" main

  push_branch "$GITHUB_BRANCH" "$GITHUB_REMOTE"
  git switch "$original_branch" >/dev/null
}

sync_from_hf() {
  local original_branch
  original_branch="$(current_branch)"

  require_clean_worktree || die "Working tree must be clean before syncing."
  ensure_hf_remote
  fetch_remotes

  ensure_branch "$HF_BRANCH" "$HF_REMOTE/main"
  ensure_branch "$GITHUB_BRANCH" "$GITHUB_REMOTE/$BASE_BRANCH"

  switch_merge "$GITHUB_BRANCH" "$HF_BRANCH"
  push_branch "$GITHUB_BRANCH" "$GITHUB_REMOTE"

  push_branch "$HF_BRANCH" "$HF_REMOTE" main
  git switch "$original_branch" >/dev/null
}

main() {
  local command="${1:-status}"
  shift || true

  case "$command" in
    status)
      show_status
      ;;
    setup)
      require_clean_worktree || die "Working tree must be clean before setup."
      ensure_hf_remote
      fetch_remotes
      ensure_branch "$BASE_BRANCH" "$GITHUB_REMOTE/$BASE_BRANCH"
      ensure_branch "$GITHUB_BRANCH" "$BASE_BRANCH"
      ensure_branch "$HF_BRANCH" "$BASE_BRANCH"
      log "Setup complete. Use 'from-main' to publish both hosting branches."
      ;;
    from-main)
      sync_from_main
      ;;
    from-github)
      sync_from_github
      ;;
    from-hf)
      sync_from_hf
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