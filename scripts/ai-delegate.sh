#!/usr/bin/env bash
# Requires bash 4+ (brew install bash) or falls back to tr for lowercase.
# ai-delegate.sh — Local-vs-Copilot AI delegation helper for vital-core
#
# USAGE:
#   scripts/ai-delegate.sh bench   [FILE] [--model MODEL]
#   scripts/ai-delegate.sh review  <critic|planner|perspective> <FILE> [--model MODEL]
#   scripts/ai-delegate.sh suggest <FILE|DESCRIPTION>
#   scripts/ai-delegate.sh status
#
# REQUIREMENTS:
#   - Python 3.10+
#   - OLLAMA_HOST env var (default: http://192.168.50.171:11434)
#   - a11y-meta-skills cloned to tmp/a11y-meta-skills (done automatically on first run)
#   - pip install -r tmp/a11y-meta-skills/ollama/requirements.txt
#
# OUTPUT: tmp/ai-bench/ (gitignored)

set -euo pipefail

# ─────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────
OLLAMA_HOST="${OLLAMA_HOST:-http://192.168.50.171:11434}"
DEFAULT_MODEL="${AI_DELEGATE_MODEL:-gpt-oss:latest}"
SKILLS_REPO="https://github.com/mgifford/a11y-meta-skills.git"
SKILLS_DIR="$(pwd)/tmp/a11y-meta-skills"
BENCH_DIR="$(pwd)/tmp/ai-bench"
WRAPPER="$SKILLS_DIR/ollama/ollama_a11y.py"

# ─────────────────────────────────────────
# Colours
# ─────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

# ─────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────
info()  { echo -e "${CYAN}[ai-delegate]${RESET} $*"; }
ok()    { echo -e "${GREEN}[ok]${RESET} $*"; }
warn()  { echo -e "${YELLOW}[warn]${RESET} $*"; }
err()   { echo -e "${RED}[error]${RESET} $*" >&2; }
bold()  { echo -e "${BOLD}$*${RESET}"; }

usage() {
  grep '^# ' "$0" | sed 's/^# //' | head -20
  exit 1
}

# ─────────────────────────────────────────
# Ollama connectivity check
# ─────────────────────────────────────────
check_ollama() {
  local timeout="${1:-4}"
  if curl -sf --max-time "$timeout" "${OLLAMA_HOST}/api/tags" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

# Fire a macOS notification (works in iTerm2, Terminal.app, background cron).
# Silent no-op if osascript is not available.
native_alert() {
  local title="$1" body="$2" sound="${3:-Basso}"
  if command -v osascript &>/dev/null; then
    osascript -e \
      "display notification \"${body}\" with title \"${title}\" sound name \"${sound}\"" \
      2>/dev/null || true
  fi
  # Also send iTerm2 proprietary notification escape (no-op in other terminals)
  printf "\e]9;%s\a" "${title}: ${body}" 2>/dev/null || true
}

require_ollama() {
  # Always emit a status line; exit with useful message if unavailable.
  if check_ollama; then
    ok "Ollama reachable at ${OLLAMA_HOST}"
    return 0
  fi

  # Fire OS-level notification so iTerm2/macOS catches it even in background.
  native_alert \
    "ai-delegate: Ollama Offline" \
    "Cannot reach ${OLLAMA_HOST}. Mac Studio may need a restart. Use Copilot until it's back." \
    "Basso"

  echo
  echo -e "${RED}╔══════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${RED}║  ⚠  LOCAL OLLAMA NOT REACHABLE                          ║${RESET}"
  echo -e "${RED}║                                                          ║${RESET}"
  echo -e "${RED}║  Host : ${OLLAMA_HOST}${RESET}"
  echo -e "${RED}║                                                          ║${RESET}"
  echo -e "${RED}║  Possible causes:                                        ║${RESET}"
  echo -e "${RED}║    • Mac Studio is off or sleeping                       ║${RESET}"
  echo -e "${RED}║    • You are on a different network (travelling)         ║${RESET}"
  echo -e "${RED}║    • Ollama service needs restart: ssh mac-studio        ║${RESET}"
  echo -e "${RED}║        then run: ollama serve                            ║${RESET}"
  echo -e "${RED}║                                                          ║${RESET}"
  echo -e "${RED}║  To use a different host:                                ║${RESET}"
  echo -e "${RED}║    export OLLAMA_HOST=http://HOST:PORT                   ║${RESET}"
  echo -e "${RED}║                                                          ║${RESET}"
  echo -e "${RED}║  Delegation advice: use GitHub Copilot for all tasks     ║${RESET}"
  echo -e "${RED}║  until local Ollama is back online.                      ║${RESET}"
  echo -e "${RED}╚══════════════════════════════════════════════════════════╝${RESET}"
  echo
  exit 1
}

# ─────────────────────────────────────────
# Auto-bootstrap skills repo if missing
# ─────────────────────────────────────────
ensure_skills() {
  if [[ ! -f "$WRAPPER" ]]; then
    warn "a11y-meta-skills not found at $SKILLS_DIR"
    info "Cloning from ${SKILLS_REPO} ..."
    git clone --depth 1 "$SKILLS_REPO" "$SKILLS_DIR"
    ok "Cloned."
    if ! python3 -c "import yaml" 2>/dev/null; then
      info "Installing Python requirements ..."
      pip3 install -q -r "$SKILLS_DIR/ollama/requirements.txt"
    fi
  fi
}

# ─────────────────────────────────────────
# List available models on the Ollama host
# ─────────────────────────────────────────
list_models() {
  curl -sf "${OLLAMA_HOST}/api/tags" \
    | python3 -c "
import sys, json
data = json.load(sys.stdin)
for m in data.get('models', []):
    size_gb = m['size'] / 1e9
    ctx = m['details'].get('context_length', '?')
    print(f\"  {m['name']:<30} {size_gb:.1f} GB   ctx {ctx}\")
"
}

# ─────────────────────────────────────────
# Run a single skill task and measure time
# ─────────────────────────────────────────
run_skill() {
  local skill="$1" input_file="$2" model="$3"
  local slug
  slug="$(basename "$input_file" | sed 's/[^a-zA-Z0-9_-]/_/g')"
  local out_file="${BENCH_DIR}/${model//[:]/_}_${skill}_${slug}.md"
  local err_file="${BENCH_DIR}/${model//[:]/_}_${skill}_${slug}.err"

  mkdir -p "$BENCH_DIR"
  info "Running ${skill} on $(basename "$input_file") with model ${model} ..."

  local start_ts
  start_ts=$(date +%s)
  export OLLAMA_HOST
  python3 "$WRAPPER" "$skill" "$input_file" --model "$model" \
    > "$out_file" 2> "$err_file" || {
    err "Skill run failed. See $err_file"
    cat "$err_file" >&2
    return 1
  }
  local elapsed=$(( $(date +%s) - start_ts ))
  local tokens chars
  tokens=$(grep 'tokens,' "$err_file" | grep -oE '[0-9]+ tokens' | head -1 || echo "? tokens")
  chars=$(wc -c < "$out_file")

  ok "Done in ${elapsed}s  |  ${tokens}  |  ${chars} chars output"
  echo "  → $out_file"

  # Extract verdict/key finding lines for quick summary
  local summary
  summary=$(grep -E 'VERDICT|CRITICAL|MAJOR|Perspective|WCAG' "$out_file" | head -10 || true)
  if [[ -n "$summary" ]]; then
    echo
    bold "Quick summary:"
    echo "$summary"
  fi
  echo
}

# ─────────────────────────────────────────
# COMMAND: status
# ─────────────────────────────────────────
cmd_status() {
  bold "═══ ai-delegate status ═══"
  echo
  echo "OLLAMA_HOST : ${OLLAMA_HOST}"
  echo "Model       : ${DEFAULT_MODEL}"
  echo "Skills dir  : ${SKILLS_DIR}"
  echo "Bench output: ${BENCH_DIR}"
  echo

  if check_ollama 3; then
    ok "Ollama is ONLINE"
    echo
    bold "Available models:"
    list_models || warn "Could not list models (jq/curl issue)"
  else
    # Fire OS-level notification from status check too — useful when run as a
    # cron / LaunchAgent health-check or when the terminal is minimised.
    native_alert \
      "ai-delegate: Ollama Offline" \
      "Cannot reach ${OLLAMA_HOST}. Mac Studio may need a restart."
    warn "Ollama is OFFLINE or unreachable"
    echo "  → A macOS notification has been sent."
    echo "  → Use Copilot for all tasks until it is back online."
  fi

  echo
  if [[ -d "$BENCH_DIR" ]]; then
    bold "Recent benchmark outputs (last 5):"
    ls -1t "$BENCH_DIR"/*.md 2>/dev/null | head -5 | while read -r f; do
      local size chars
      chars=$(wc -c < "$f")
      echo "  $(basename "$f")  (${chars} chars)"
    done
  fi
  echo
}

# ─────────────────────────────────────────
# COMMAND: bench
# ─────────────────────────────────────────
cmd_bench() {
  local file="${1:-src/lib/urls.js}"
  local model="${2:-$DEFAULT_MODEL}"

  require_ollama
  ensure_skills

  bold "═══ Benchmark: ${model} on $(basename "$file") ═══"
  echo

  for skill in critic planner perspective; do
    run_skill "$skill" "$file" "$model"
  done

  bold "═══ Benchmark complete. Output in ${BENCH_DIR}/ ═══"
}

# ─────────────────────────────────────────
# COMMAND: review
# ─────────────────────────────────────────
cmd_review() {
  local skill="${1:-critic}"
  local file="${2:?Usage: ai-delegate.sh review <critic|planner|perspective> <FILE>}"
  local model="${3:-$DEFAULT_MODEL}"

  # Accept --model as named arg anywhere
  for arg in "$@"; do
    if [[ "$arg" == --model=* ]]; then model="${arg#--model=}"; fi
    if [[ "$prev" == "--model" ]]; then model="$arg"; fi
    prev="$arg"
  done

  require_ollama
  ensure_skills

  if [[ ! -f "$file" ]]; then
    err "File not found: $file"
    exit 1
  fi

  run_skill "$skill" "$file" "$model"
}

# ─────────────────────────────────────────
# COMMAND: suggest  (no Ollama needed)
# ─────────────────────────────────────────
cmd_suggest() {
  local input="${1:-}"
  local ollama_up=false

  check_ollama 3 && ollama_up=true

  bold "═══ Delegation Suggestion ═══"
  echo
  echo "Input: ${input:-<not specified>}"
  echo

  if ! $ollama_up; then
    echo -e "${RED}  ✗  Ollama OFFLINE (${OLLAMA_HOST})${RESET}"
    echo "     → Use Copilot for ALL tasks right now."
    echo
    return 0
  fi

  ok "Ollama ONLINE (${OLLAMA_HOST})"
  echo

  # Pattern-match against common vital-core task types
  local lane="LOCAL"
  local reason=""
  local input_lower
  input_lower=$(echo "$input" | tr '[:upper:]' '[:lower:]')

  case "$input_lower" in
    *"bug report"*|*"accessibility report"*|*"a11y review"*|*"critic"*|*"critique"*)
      lane="LOCAL"
      reason="a11y critic/review — local model handles well in < 2 min" ;;
    *"plan"*|*"disclosure"*|*"navigation"*|*"modal"*|*"form"*|*"widget"*)
      lane="LOCAL"
      reason="a11y planner — local model produces adequate plans for concrete features" ;;
    *"perspective"*|*"audit"*)
      lane="LOCAL"
      reason="perspective audit — local model handles with 60-80s" ;;
    *"edit"*|*"fix"*|*"refactor"*|*"rename"*|*"migrate"*)
      lane="COPILOT"
      reason="code edits — Copilot is safer for multi-file changes with LSP and error checking" ;;
    *"test"*|*"e2e"*|*"unit"*)
      lane="COPILOT"
      reason="test validation — Copilot has access to run tests and inspect errors" ;;
    *"urls.js"*|*"findings.js"*|*"state.js"*|*"config"*|*"schema"*|*"contract"*)
      lane="COPILOT"
      reason="stable contract files — Copilot understands repo context and avoids breaking changes" ;;
    *"aggregate"*|*"summary.json"*|*"weekly"*)
      lane="COPILOT"
      reason="aggregation/data pipeline — historical compatibility requires careful edits" ;;
    *"scan"*|*"engine"*|*"axe"*|*"alfa"*|*"lighthouse"*)
      lane="COPILOT"
      reason="scan engine code — Copilot has full repo context for testing impacts" ;;
    *"report"*|*"draft"*|*"summarise"*|*"summarize"*)
      lane="LOCAL"
      reason="report drafting — local model produces useful first-pass drafts" ;;
    *)
      lane="COPILOT"
      reason="unrecognized task type — default to Copilot for safety" ;;
  esac

  if [[ "$lane" == "LOCAL" ]]; then
    echo -e "  ${GREEN}→ Delegate to LOCAL Ollama (${DEFAULT_MODEL})${RESET}"
  else
    echo -e "  ${YELLOW}→ Delegate to COPILOT (GitHub Copilot)${RESET}"
  fi
  echo "  Reason: $reason"
  echo

  if [[ "$lane" == "LOCAL" ]]; then
    echo "  Suggested command:"
    local skill="critic"
    [[ "$input_lower" == *"plan"* ]] && skill="planner"
    [[ "$input_lower" == *"perspective"* || "$input_lower" == *"audit"* ]] && skill="perspective"
    echo "    scripts/ai-delegate.sh review $skill <FILE>"
  fi

  echo
}

# ─────────────────────────────────────────
# Main dispatcher
# ─────────────────────────────────────────
CMD="${1:-status}"
shift || true

case "$CMD" in
  status)                  cmd_status ;;
  bench)                   cmd_bench "$@" ;;
  review)                  cmd_review "$@" ;;
  suggest)                 cmd_suggest "$@" ;;
  help|--help|-h)          usage ;;
  *)
    err "Unknown command: $CMD"
    usage
    ;;
esac
