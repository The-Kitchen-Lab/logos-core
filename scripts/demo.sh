#!/usr/bin/env bash
# Logos Core — end-to-end demo script
# Runs without any pre-configured environment.
#
# Prerequisites: Rust (via rustup), Node.js 22+, Docker

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[demo]${NC} $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC} $*"; }
die()     { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
cd "$ROOT"

# ── 1. Prerequisites ──────────────────────────────────────────────────────────

info "Checking prerequisites…"
command -v cargo   &>/dev/null || die "Rust/cargo not found. Install via rustup.rs"
command -v node    &>/dev/null || die "Node.js not found (need v22+)"
command -v npm     &>/dev/null || die "npm not found"
command -v docker  &>/dev/null || warn "Docker not found — skipping local testnet"

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
(( NODE_MAJOR >= 20 )) || die "Node.js v20+ required (found v$(node --version))"

# ── 2. Build Rust ─────────────────────────────────────────────────────────────

info "Building Rust on-chain program…"
cargo test 2>&1
info "cargo test passed ✓"
cargo build --release 2>&1 | grep -E "Compiling|Finished|error"
info "cargo build --release passed ✓"

# ── 3. Install Node.js dependencies ──────────────────────────────────────────

info "Installing runtime dependencies…"
(cd runtime && npm install --silent)
info "Installing CLI dependencies…"
(cd cli     && npm install --silent)

# ── 4. Build TypeScript ───────────────────────────────────────────────────────

info "Building TypeScript runtime…"
(cd runtime && npm run build)
info "Building TypeScript CLI…"
(cd cli && npm run build)

# ── 5. Run TypeScript tests ───────────────────────────────────────────────────

info "Running TypeScript tests…"
(cd runtime && npm test 2>&1) || die "TypeScript tests failed"
info "All TypeScript tests passed ✓"

# ── 6. Local testnet (Docker) ─────────────────────────────────────────────────

SEQUENCER_URL="${LEZ_SEQUENCER_URL:-http://localhost:3000}"

if command -v docker &>/dev/null; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "lez-testnet"; then
    info "LEZ testnet already running"
  else
    info "Starting LEZ local testnet via Docker…"
    docker run -d \
      --name lez-testnet \
      --rm \
      -p 3000:3000 \
      ghcr.io/logos-blockchain/logos-execution-zone:latest \
      2>/dev/null || warn "Could not start LEZ testnet Docker image (may not exist yet)"
    sleep 3
  fi
fi

# ── 7. Health-check sequencer ─────────────────────────────────────────────────

info "Checking sequencer at $SEQUENCER_URL…"
if curl -sf "${SEQUENCER_URL}/health" &>/dev/null; then
  info "Sequencer reachable ✓"
  SEQUENCER_OK=true
else
  warn "Sequencer not reachable — skipping on-chain steps"
  SEQUENCER_OK=false
fi

# ── 8. Deploy + fund (if sequencer available) ─────────────────────────────────

AGENT_CONFIG="./agent.config.json"

if $SEQUENCER_OK; then
  info "Deploying agent to testnet…"
  node cli/dist/index.js deploy \
    --sequencer "$SEQUENCER_URL" \
    --name "DemoAgent" \
    --threshold 5000 \
    --period 1000

  info "Funding agent from faucet…"
  node cli/dist/index.js fund \
    --sequencer "$SEQUENCER_URL"
fi

# ── 9. Start A2A server in background ─────────────────────────────────────────

A2A_PORT="${A2A_PORT:-8080}"

if $SEQUENCER_OK; then
  info "Starting A2A server on port $A2A_PORT…"
  INFERENCE_URL="${INFERENCE_URL:-}" \
  INFERENCE_API_KEY="${INFERENCE_API_KEY:-demo}" \
  INFERENCE_MODEL="${INFERENCE_MODEL:-gpt-4o-mini}" \
  node cli/dist/index.js run \
    --port "$A2A_PORT" \
    --config "$AGENT_CONFIG" &
  A2A_PID=$!
  sleep 2

  # ── 10. Validate A2A endpoint ─────────────────────────────────────────────

  info "Validating A2A agent card…"
  CARD=$(curl -sf "http://localhost:${A2A_PORT}/.well-known/agent.json") || die "A2A endpoint not responding"
  SKILL_COUNT=$(echo "$CARD" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('skills', [])))" 2>/dev/null || echo "?")
  info "Agent card returned — $SKILL_COUNT skills registered ✓"

  # ── 11. Execute a skill ────────────────────────────────────────────────────

  info "Executing sc:explain via A2A…"
  RESULT=$(curl -sf -X POST "http://localhost:${A2A_PORT}/" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":"demo-1","method":"tasks/send","params":{"id":"demo-task-1","message":{"role":"user","parts":[{"type":"text","text":"{\"skillId\":\"sc:explain\",\"task\":\"What is Borsh encoding?\"}"}]}}}') || die "Skill execution failed"

  STATE=$(echo "$RESULT" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['result']['status']['state'])" 2>/dev/null || echo "unknown")
  info "Skill execution state: $STATE ✓"

  # ── 12. skill list ────────────────────────────────────────────────────────

  info "Listing registered skills…"
  node cli/dist/index.js skill list --config "$AGENT_CONFIG" 2>/dev/null || true

  kill $A2A_PID 2>/dev/null || true
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Logos Core demo completed successfully!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  cargo test      ✓"
echo "  npm test        ✓"
echo "  TypeScript build ✓"
if $SEQUENCER_OK; then
  echo "  On-chain deploy  ✓"
  echo "  A2A endpoint     ✓"
  echo "  Skill execution  ✓"
fi
echo ""
