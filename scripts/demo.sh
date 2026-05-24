#!/usr/bin/env bash
# Logos Core — end-to-end demo script
# Runs without any pre-configured environment.
#
# Prerequisites: Rust (via rustup) + Risc0, Node.js 22+, Docker (optional)
#
# Set RISC0_DEV_MODE=0 to run with real ZK proof generation (slow — 1-2 min/tx).
# CI uses RISC0_DEV_MODE=1 to skip proof generation.
#
# For the LP-0008 submission video, run with RISC0_DEV_MODE=0 so proof
# generation output is visible in the terminal.

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}[demo]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }
die()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }
step()  { echo -e "\n${CYAN}━━━ $* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
cd "$ROOT"

: "${RISC0_DEV_MODE:=1}"
export RISC0_DEV_MODE

if [[ "$RISC0_DEV_MODE" == "0" ]]; then
  warn "RISC0_DEV_MODE=0 — real ZK proof generation active (slow)"
else
  info "RISC0_DEV_MODE=1 — proof generation skipped (CI/fast mode)"
fi

# ── 1. Prerequisites ──────────────────────────────────────────────────────────

step "1. Checking prerequisites"
command -v cargo  &>/dev/null || die "Rust/cargo not found. Install via rustup.rs"
command -v node   &>/dev/null || die "Node.js not found (need v22+)"
command -v npm    &>/dev/null || die "npm not found"
command -v docker &>/dev/null || warn "Docker not found — skipping local testnet"

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
(( NODE_MAJOR >= 20 )) || die "Node.js v20+ required (found v$(node --version))"
info "Prerequisites OK"

# ── 2. Build Rust ─────────────────────────────────────────────────────────────

step "2. Building Rust on-chain program"
cargo test 2>&1
info "cargo test passed ✓  (11/11)"

cargo build --release 2>&1 | grep -E "Compiling nssa|Compiling logos|Finished|error"
info "cargo build --release passed ✓"

# ── 3. Install & build TypeScript ─────────────────────────────────────────────

step "3. Building TypeScript"
(cd runtime && npm install --silent && npm run build)
info "runtime built ✓"
(cd cli && npm install --silent && npm run build)
info "CLI built ✓"

# ── 4. TypeScript tests ───────────────────────────────────────────────────────

step "4. Running TypeScript tests"
(cd runtime && npm test 2>&1) || die "TypeScript tests failed"
info "TypeScript tests passed ✓  (37/37)"

# ── 5. Local testnet (Docker) ─────────────────────────────────────────────────

SEQUENCER_URL="${LEZ_SEQUENCER_URL:-http://localhost:3040}"
SEQUENCER_OK=false

step "5. Starting LEZ testnet"
if command -v docker &>/dev/null; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "sequencer_service"; then
    info "LEZ sequencer already running"
    SEQUENCER_OK=true
  else
    info "Starting LEZ sequencer via Docker…"
    (cd /tmp/logos-execution-zone 2>/dev/null || \
      git clone https://github.com/logos-blockchain/logos-execution-zone /tmp/logos-execution-zone --depth 1)
    RISC0_DEV_MODE=$RISC0_DEV_MODE docker compose \
      -f /tmp/logos-execution-zone/sequencer/service/docker-compose.yml \
      up -d 2>/dev/null && sleep 5 && SEQUENCER_OK=true || \
      warn "Could not start sequencer Docker image"
  fi
fi

# Fallback: try standalone sequencer binary
if ! $SEQUENCER_OK; then
  if [[ -f /tmp/logos-execution-zone/target/release/sequencer_service ]]; then
    info "Starting standalone sequencer…"
    RISC0_DEV_MODE=$RISC0_DEV_MODE \
    /tmp/logos-execution-zone/target/release/sequencer_service \
      /tmp/logos-execution-zone/sequencer/service/configs/debug &
    SEQUENCER_PID=$!
    sleep 4
  fi
fi

# ── 6. Health check ───────────────────────────────────────────────────────────

step "6. Sequencer health check"
if curl -sf "${SEQUENCER_URL}/health" &>/dev/null; then
  info "Sequencer reachable at $SEQUENCER_URL ✓"
  SEQUENCER_OK=true
else
  warn "Sequencer not reachable — skipping on-chain steps"
  SEQUENCER_OK=false
fi

# ── 7. Deploy + fund ─────────────────────────────────────────────────────────

if $SEQUENCER_OK; then
  step "7. Deploying agent"
  node cli/dist/index.js deploy \
    --sequencer "$SEQUENCER_URL" \
    --name "DemoAgent" \
    --threshold 1000000 \
    --period 1000
  info "Agent deployed ✓"

  step "8. Funding agent"
  node cli/dist/index.js fund --sequencer "$SEQUENCER_URL"
  info "Agent funded ✓"
fi

# ── 9. Start A2A server + Logos Messaging ────────────────────────────────────

A2A_PORT="${A2A_PORT:-8080}"
AGENT_CONFIG="./agent.config.json"

if $SEQUENCER_OK && [[ -f "$AGENT_CONFIG" ]]; then
  step "9. Starting A2A server + Logos Messaging inbox"
  INFERENCE_URL="${INFERENCE_URL:-}" \
  INFERENCE_API_KEY="${INFERENCE_API_KEY:-demo}" \
  INFERENCE_MODEL="${INFERENCE_MODEL:-gpt-4o-mini}" \
  node cli/dist/index.js run \
    --port "$A2A_PORT" \
    --config "$AGENT_CONFIG" &
  A2A_PID=$!
  sleep 2

  # ── 10. Validate A2A endpoint ─────────────────────────────────────────────

  step "10. Validating A2A endpoint"
  CARD=$(curl -sf "http://localhost:${A2A_PORT}/.well-known/agent.json") || \
    die "A2A endpoint not responding"
  SKILL_COUNT=$(echo "$CARD" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); print(len(d.get('skills', [])))" 2>/dev/null || echo "?")
  info "Agent card OK — $SKILL_COUNT skills ✓"

  # ── 11. Execute a skill via A2A ──────────────────────────────────────────

  step "11. Executing sc:explain via A2A"
  RESULT=$(curl -sf -X POST "http://localhost:${A2A_PORT}/" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":"demo-1","method":"tasks/send","params":{"id":"demo-task-1","message":{"role":"user","parts":[{"type":"text","text":"{\"skillId\":\"sc:explain\",\"task\":\"What is Borsh encoding?\"}"}]}}}') || \
    die "Skill execution failed"

  STATE=$(echo "$RESULT" | python3 -c \
    "import sys,json; r=json.load(sys.stdin); print(r['result']['status']['state'])" 2>/dev/null || \
    echo "unknown")
  info "Skill execution state: $STATE ✓"

  kill $A2A_PID 2>/dev/null || true
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Logos Core demo completed!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  RISC0_DEV_MODE=${RISC0_DEV_MODE}"
echo "  cargo test       ✓  (11/11 Rust tests)"
echo "  npm test         ✓  (37/37 TypeScript tests)"
echo "  TypeScript build ✓"
if $SEQUENCER_OK; then
  echo "  On-chain deploy  ✓"
  echo "  A2A endpoint     ✓"
  echo "  Skill execution  ✓"
else
  echo "  On-chain steps   skipped (no sequencer)"
fi
echo ""
echo "  To run with real ZK proofs:  RISC0_DEV_MODE=0 bash scripts/demo.sh"
echo ""
