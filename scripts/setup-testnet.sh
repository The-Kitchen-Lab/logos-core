#!/usr/bin/env bash
# Setup and start the LEZ standalone sequencer for local development/demo.
# Run this in a dedicated terminal before running demo.sh or record-demo.sh.
#
# Usage:
#   bash scripts/setup-testnet.sh [--dev]  # --dev = RISC0_DEV_MODE=1 (fast)
#   bash scripts/setup-testnet.sh          # RISC0_DEV_MODE=0 (real proofs, slow)

set -euo pipefail
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info() { echo -e "${GREEN}[testnet]${NC} $*"; }
warn() { echo -e "${YELLOW}[testnet]${NC} $*"; }
die()  { echo -e "${RED}[testnet]${NC} $*" >&2; exit 1; }

# ── Config ────────────────────────────────────────────────────────────────────

DEV_MODE=0
for arg in "$@"; do [[ "$arg" == "--dev" ]] && DEV_MODE=1; done
export RISC0_DEV_MODE=$DEV_MODE

LEZ_DIR="${LEZ_DIR:-/tmp/logos-execution-zone}"
SEQ_HOME="${SEQ_HOME:-/tmp/lez-data}"
SEQ_PORT=3040

if [[ "$DEV_MODE" == "1" ]]; then
  info "Mode: RISC0_DEV_MODE=1 (proof generation skipped — fast)"
else
  warn "Mode: RISC0_DEV_MODE=0 (real ZK proofs — each tx takes 45-90s on CPU)"
  warn "This is what LP-0008 requires for the submission video."
fi

# ── Clone LEZ repo if missing ─────────────────────────────────────────────────

if [[ ! -d "$LEZ_DIR" ]]; then
  info "Cloning logos-execution-zone → $LEZ_DIR …"
  git clone https://github.com/logos-blockchain/logos-execution-zone "$LEZ_DIR" --depth 1
fi

# ── Build standalone sequencer if missing ─────────────────────────────────────

SEQ_BIN="$LEZ_DIR/target/release/sequencer_service"
if [[ ! -f "$SEQ_BIN" ]]; then
  info "Building standalone sequencer (this takes ~3 minutes)…"
  cd "$LEZ_DIR"
  cargo build --release --features standalone -p sequencer_service
fi

# ── Prepare data dir ──────────────────────────────────────────────────────────

mkdir -p "$SEQ_HOME"

# Write a self-contained sequencer config (no bedrock node required)
cat > "$SEQ_HOME/sequencer_config.json" << SEQCFG
{
  "home": "$SEQ_HOME",
  "max_num_tx_in_block": 20,
  "max_block_size": "1 MiB",
  "mempool_max_size": 1000,
  "block_create_timeout": "5s",
  "retry_pending_blocks_timeout": "5s",
  "bedrock_config": {
    "backoff": { "start_delay": "100ms", "max_retries": 3 },
    "channel_id": "0101010101010101010101010101010101010101010101010101010101010101",
    "node_url": "http://localhost:8080"
  },
  "indexer_rpc_url": "ws://localhost:8779",
  "genesis": [
    { "supply_account": { "account_id": "CbgR6tj5kWx5oziiFptM7jMvrQeYY3Mzaao6ciuhSr2r", "balance": 1000000000 } },
    { "supply_account": { "account_id": "7wHg9sbJwc6h3NP1S9bekfAzB8CHifEcxKswCKUt3YQo", "balance": 1000000000 } }
  ],
  "signing_key": [37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37]
}
SEQCFG

# ── Kill any existing sequencer ───────────────────────────────────────────────

pkill -f "sequencer_service" 2>/dev/null || true
sleep 1

# ── Start sequencer ───────────────────────────────────────────────────────────

info "Starting LEZ standalone sequencer on :$SEQ_PORT …"
info "  RISC0_DEV_MODE=$RISC0_DEV_MODE"
info "  Data dir: $SEQ_HOME"
info ""
info "Press Ctrl+C to stop."
info ""

exec env RISC0_DEV_MODE=$DEV_MODE RUST_LOG=info \
  "$SEQ_BIN" "$SEQ_HOME/sequencer_config.json"
