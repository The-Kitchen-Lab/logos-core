# LP-0008 Demo Recording Guide

This guide tells you exactly what to do in each terminal to record the submission video
for **Logos Core — LP-0008: Autonomous AI Module with Wallet, Storage, and Messaging**.

---

## Before you start

**Prerequisites on your PC:**
- Rust toolchain (stable) with the `sequencer_service` already built
- Node.js 20+
- LEZ repo already cloned and built: `RISC0_DEV_MODE=0` binary at `target/release/sequencer_service`

> If the binary isn't built yet, run **once** (takes ~3 min):
> ```
> bash scripts/setup-testnet.sh   # (without --dev) — builds binary only, Ctrl-C after "Starting"
> ```

**Clone and build logos-core:**
```bash
git clone https://github.com/The-Kitchen-Lab/logos-core
cd logos-core
cd runtime && npm install && npm run build && cd ..
cd cli    && npm install && npm run build && cd ..
cd dispatch-cli && cargo build --release 2>/dev/null
```

---

## Terminal layout

Open **3 terminals** side-by-side:

| Terminal | Purpose |
|----------|---------|
| **A** — Sequencer | LEZ standalone sequencer (always visible, shows proof generation) |
| **B** — Dispatch  | dispatch-cli on-chain transactions |
| **C** — Runtime   | TypeScript agent runtime + tests |

---

## Scene 1 — Start the sequencer (Terminal A) — ~30 s

```bash
# Real ZK proofs — this is what the submission requires
bash scripts/setup-testnet.sh
```

**Say:**
> "We're starting the LEZ standalone sequencer with RISC0_DEV_MODE=0 — real Groth16 proofs.
> You can see it initialising from genesis and opening the RPC port on 3040."

**Wait for:** `Starting LEZ standalone sequencer on :3040`

---

## Scene 2 — Health check (Terminal B) — ~10 s

```bash
curl -s -X POST http://localhost:3040 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"checkHealth","params":[]}'
```

Expected: `{"jsonrpc":"2.0","id":1,"result":null}`

**Say:**
> "Sequencer is live and accepting JSON-RPC calls."

---

## Scene 3 — Deploy agent on-chain (Terminal B) — ~90 s with real proofs

```bash
cargo run --manifest-path dispatch-cli/Cargo.toml \
  --bin dispatch -- deploy \
  --name "logos-demo-agent" \
  --threshold 1000000
```

**While waiting for the tx hash, say:**
> "dispatch-cli generates an ed25519 keypair, builds a Borsh-serialised Initialize instruction,
> signs it, and submits it to the sequencer.
> With RISC0_DEV_MODE=0 the sequencer generates a Groth16 proof for each block —
> you can see the proof generation output in Terminal A."

**When you see the hash, say:**
> "Transaction confirmed on-chain. The account ID and private key printed here
> are used for all subsequent operations."

**Copy the `account` and `key` values** — you'll need them in Scene 4.

---

## Scene 4 — Record a skill execution on-chain (Terminal B) — ~90 s

```bash
# Replace ACCOUNT and KEY with values from Scene 3
cargo run --manifest-path dispatch-cli/Cargo.toml \
  --bin dispatch -- exec \
  --account ACCOUNT \
  --key KEY \
  --skill sc:explain \
  --cost 5 \
  --summary "Explained Borsh encoding in Logos Messaging context"
```

**Say:**
> "RecordExecution creates an auditable on-chain record of every skill the agent runs.
> Cost is deducted from the agent's spending budget.
> Again, a real ZK proof is generated for this block."

---

## Scene 5 — TypeScript tests (Terminal C) — ~20 s

```bash
cd runtime && npx jest --no-coverage 2>&1 | tail -20
```

**Say:**
> "The off-chain runtime has a full test suite:
> Logos Messaging encoding roundtrip, TaskStore persistence across restarts,
> and SpendingTracker period reset.
> These run without a sequencer and pass in CI too."

Show the green pass summary.

---

## Scene 6 — Start the agent runtime (Terminal C) — ~15 s

```bash
# Create a minimal agent.config.json first
cat > /tmp/demo-agent.config.json << 'EOF'
{
  "agentName": "logos-demo-agent",
  "programId": "logos-core-v0.1.0-testnet",
  "agentAccountId": "ACCOUNT",
  "runtimeAccountId": "ACCOUNT",
  "sequencerUrl": "http://localhost:3040",
  "indexerUrl": "http://localhost:8779",
  "spendingThreshold": 1000000,
  "periodBlocks": 1000
}
EOF

node cli/dist/index.js run --config /tmp/demo-agent.config.json --port 8080
```

**Say:**
> "The runtime boots with the on-chain config:
> an HTTP A2A server on port 8080 for local tooling,
> and a Logos Messaging inbox polling the LEZ indexer for P2P messages —
> no relay server, no WebSocket bridge."

Show the green startup banner listing all 17 skills.

---

## Scene 7 — A2A agent card (Terminal B, new tab) — ~10 s

```bash
curl -s http://localhost:8080/.well-known/agent.json | jq .
```

**Say:**
> "The agent card follows the A2A specification.
> The `onChainId` extension field links the card directly to the on-chain account.
> Any A2A-compatible client can discover this agent by account ID over Logos Messaging."

---

## Scene 8 — Send a task via A2A (Terminal B) — ~30 s

```bash
curl -s -X POST http://localhost:8080 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":1,
    "method":"tasks/send",
    "params": {
      "id": "demo-task-1",
      "message": {
        "role": "user",
        "parts": [{ "text": "What is Borsh encoding?" }]
      }
    }
  }' | jq .
```

**Say:**
> "A task sent over HTTP A2A — same protocol used between agents over Logos Messaging.
> The skill executes, cost is pre-checked against the SpendingTracker,
> and the result comes back as a completed A2A task."

---

## Wrapping up — ~30 s

Point at the repo structure on screen:

```
logos-core/
├── programs/logos-core/   ← Rust on-chain program (RISC-V / Risc0)
├── runtime/               ← TypeScript agent runtime
├── cli/                   ← logos-agent CLI
├── dispatch-cli/          ← Low-level Rust tx sender
├── docs/write-up.md       ← Architecture document
└── .github/workflows/ci.yml
```

**Say:**
> "Logos Core implements the full LP-0008 spec:
> on-chain spending controls with dual enforcement,
> Logos Messaging P2P transport over LEZ,
> A2A protocol binding with task lifecycle and agent cards,
> task persistence for failure recovery,
> skill isolation and timeout,
> and a CI pipeline that starts a standalone sequencer and runs integration tests.
> Everything is open source at github.com/The-Kitchen-Lab/logos-core."

---

## Troubleshooting

**Sequencer won't start:**
```bash
pkill -f sequencer_service
rm -rf /tmp/lez-data/rocksdb   # wipe state — fresh genesis
bash scripts/setup-testnet.sh
```

**Port 3040 already in use:**
```bash
lsof -ti :3040 | xargs kill -9
```

**dispatch-cli compile error:**
```bash
cd dispatch-cli && cargo build --release
```

**`jq: command not found`:**
```bash
brew install jq   # macOS
```
