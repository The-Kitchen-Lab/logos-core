# Logos Core

**AI agent module for the [Logos Execution Zone (LEZ)](https://github.com/logos-blockchain/logos-execution-zone) — λPrize submission.**

On-chain trust enforcement for autonomous AI agents: cryptographic spending controls, skill registry, and agent-to-agent coordination — all anchored in a RISC-V program running inside ZK proofs.

[![Demo](https://img.shields.io/badge/demo-asciinema-orange)](https://asciinema.org/a/lohSSQFNCCftqtph)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

---

## Demo

https://github.com/The-Kitchen-Lab/logos-core/raw/main/docs/logos-demo.mp4

[![asciicast](https://asciinema.org/a/lohSSQFNCCftqtph.svg)](https://asciinema.org/a/lohSSQFNCCftqtph)

---

## What it does

Logos Core separates **on-chain trust** from **off-chain inference**:

```
Owner (human / Logos App)
        │
        ▼
Off-chain Runtime (Node.js)
  ├── A2A Server (JSON-RPC 2.0 over HTTP)
  ├── Skill Engine (17 default skills)
  └── LEZ Client (Borsh-encoded transactions)
        │
        ▼
On-chain Program (LEZ / RISC-V)
  ├── Agent registration & identity
  ├── Skill registry with per-skill spending caps
  ├── Autonomous threshold + approval flow
  └── Spending period enforcement
```

The on-chain program is written in Rust, compiles to RISC-V, and runs inside a Risc0 ZK guest. All state transitions are Borsh-encoded.

---

## Architecture

### On-chain (`programs/logos-core/`)

| Component | Description |
|-----------|-------------|
| `core/` | Shared types: `Instruction`, `AgentState`, `LogosCoreError` |
| `src/lib.rs` | Instruction processor — Initialize, RegisterSkill, RecordExecution, SetPaused, ApprovePending |
| `guest/` | RISC-V entry point — reads `nssa_core` program inputs, applies processor, writes outputs |

**Instructions:**
- `Initialize` — create agent with owner key, spending threshold, and period length
- `RegisterSkill` — whitelist a skill with optional per-skill cap
- `SetSkillEnabled` — enable/disable skill without deregistering
- `RecordExecution` — record a skill run; blocked if over threshold (queues for approval)
- `ApprovePending` — owner approves a queued execution
- `SetPaused` — owner pause/resume
- `UpdateConfig` — adjust threshold or period

### Off-chain runtime (`runtime/`)

TypeScript runtime with full LEZ integration:

- **`LogosAgent`** — orchestrates skill execution, spending checks, LEZ submission
- **`SpendingTracker`** — mirrors on-chain state locally for fast pre-checks
- **`A2AServer`** — JSON-RPC 2.0 server, serves `/.well-known/agent.json` agent card
- **`A2AClient`** — calls remote agents by URL
- **`LezClient`** — submits Borsh-encoded transactions to the sequencer

### CLI (`cli/`)

```
logos-agent deploy    # build + deploy program, initialize agent account
logos-agent fund      # faucet top-up
logos-agent config    # update threshold / period on-chain
logos-agent status    # show on-chain state + spending summary
logos-agent run       # start A2A server
logos-agent skill     # list / enable / disable skills
```

### dispatch-cli (`dispatch-cli/`)

Low-level Rust CLI that sends raw LEZ transactions using the native `nssa` crate — bypasses the TypeScript runtime for direct on-chain interaction and program ID computation.

---

## 17 Default Skills

| Skill ID | Description |
|----------|-------------|
| `sc:analyze` | Code quality, security, performance analysis |
| `sc:build` | Build, compile, and package |
| `sc:implement` | Feature implementation |
| `sc:test` | Test execution and coverage |
| `sc:improve` | Systematic code improvements |
| `sc:troubleshoot` | Diagnose and resolve issues |
| `sc:explain` | Explain code or concepts |
| `sc:document` | Generate documentation |
| `sc:design` | System architecture and API design |
| `sc:cleanup` | Remove dead code, reduce debt |
| `sc:git` | Git operations with smart commit messages |
| `sc:estimate` | Development estimates |
| `sc:workflow` | Structured implementation workflows |
| `sc:index` | Project documentation and knowledge base |
| `sc:load` | Load and analyze project context |
| `sc:spawn` | Break complex tasks into subtasks |
| `sc:task` | Cross-session task management |

Custom skills implement the `Skill` interface — see [docs/skill-interface.md](docs/skill-interface.md).

---

## Quick start

### Prerequisites

- Rust (via [rustup](https://rustup.rs))
- Risc0: `curl -L https://risczero.com/install | bash && rzup install`
- Node.js 20+

### Build

```bash
# On-chain program
cargo build --release

# TypeScript runtime + CLI
cd runtime && npm install && npm run build && cd ..
cd cli && npm install && npm run build && cd ..
```

### Test

```bash
# Rust (11 tests)
cargo test

# TypeScript (37 tests)
cd runtime && npm test
```

### Run

```bash
# Deploy to local LEZ testnet
logos-agent deploy --name "MyAgent" --threshold 5000 --period 1000

# Fund from faucet
logos-agent fund

# Start A2A server
INFERENCE_URL=https://api.openai.com/v1 \
INFERENCE_API_KEY=sk-... \
logos-agent run --port 8080

# Verify agent card
curl http://localhost:8080/.well-known/agent.json | jq .
```

### End-to-end demo

```bash
bash scripts/demo.sh
```

The demo script builds everything, starts the testnet (if Docker is available), deploys, funds, and validates the A2A endpoint. Without Docker it runs all build and test steps and exits cleanly.

---

## Borsh encoding

LEZ expects Borsh-encoded instructions. The TypeScript runtime provides `encodeInstruction` / `decodeInstruction` utilities in `runtime/src/lez/encoding.ts` that mirror the on-chain `Instruction` enum exactly:

```typescript
import { encodeInstruction } from "@logos-core/runtime/lez/encoding";

const bytes = encodeInstruction({
  tag: "RecordExecution",
  skill_id: "sc:build",
  cost: 80n,
  result_summary: "compiled successfully",
});
```

---

## Custom skills

```typescript
import type { Skill } from "@logos-core/runtime";

const mySkill: Skill = {
  meta: {
    id: "myorg:my-skill",
    name: "My Skill",
    description: "Does something useful",
    version: "1.0.0",
    inputSchema: z.object({ task: z.string() }),
    estimatedCost: 10n,
  },
  async execute(ctx) {
    ctx.log("running…");
    return { success: true, summary: "done", output: {}, actualCost: 10n };
  },
};
```

Full guide: [docs/skill-interface.md](docs/skill-interface.md)

---

## Repository layout

```
logos-core/
├── programs/logos-core/
│   ├── core/                # Shared types (Instruction, AgentState, errors)
│   ├── src/lib.rs           # On-chain processor (11 tests)
│   └── guest/               # RISC-V guest entry point
├── runtime/                 # TypeScript off-chain runtime
│   └── src/
│       ├── agent.ts
│       ├── skills/          # Skill interface + 17 defaults
│       ├── a2a/             # A2A server + client
│       └── lez/             # LEZ client, Borsh encoding, spending tracker
├── cli/                     # logos-agent CLI
├── dispatch-cli/            # Low-level Rust LEZ transaction CLI
├── examples/logos-app/      # Reference owner chat UI
├── scripts/
│   └── demo.sh              # Zero-dependency end-to-end demo
└── docs/
    ├── architecture.md
    ├── skill-interface.md
    ├── security-model.md
    ├── deployment.md
    └── a2a-protocol.md
```

---

## Test results

```
Rust  — 11/11 passed  (programs/logos-core)
TS    — 37/37 passed  (runtime: encoding, spending, skills, a2a)
```

---

## License

MIT — see [LICENSE](LICENSE)
