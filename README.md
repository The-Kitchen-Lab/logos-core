# Logos Core

A modular AI agent module for the [Logos Execution Zone (LEZ)](https://github.com/logos-blockchain/logos-execution-zone). Provides on-chain agent registration, skill management, spending controls, and agent-to-agent coordination via the [A2A protocol](https://a2a-protocol.org).

## Features

- **On-chain agent program** — Rust/RISC-V, deployed to LEZ testnet
- **17 default skills** — `sc:analyze`, `sc:build`, `sc:implement`, `sc:test`, and more
- **Documented skill interface** — third parties can add skills in TypeScript
- **Spending controls** — autonomous threshold + per-period limits; above-threshold requires owner approval
- **Agent-to-Agent protocol** — A2A-compliant HTTP server and client
- **CLI** — `logos-agent deploy | fund | config | status | run | skill`
- **Reference owner chat** — interactive terminal UI for the Logos app

## Quick start

```bash
# 1. Build
cargo build --release
cd runtime && npm install && npm run build && cd ..
cd cli && npm install && npm run build && npm install -g . && cd ..

# 2. Start local testnet
# (see docs/deployment.md)

# 3. Deploy
logos-agent deploy --name "MyAgent" --threshold 5000

# 4. Fund
logos-agent fund

# 5. Run
INFERENCE_URL=https://api.openai.com INFERENCE_API_KEY=sk-... logos-agent run

# 6. Chat
cd examples/logos-app && npm run dev
```

## Repository layout

```
logos-core/
├── programs/logos-core/     # On-chain Rust program (LEZ)
│   ├── core/                # Shared types (instruction, state, error)
│   └── src/lib.rs           # Instruction processor
├── runtime/                 # Off-chain TypeScript runtime
│   └── src/
│       ├── agent.ts         # LogosAgent
│       ├── skills/          # Skill interface + 17 default skills
│       ├── a2a/             # A2A server and client
│       └── lez/             # LEZ client + spending tracker
├── cli/                     # logos-agent CLI
├── examples/logos-app/      # Reference owner chat
└── docs/
    ├── architecture.md
    ├── skill-interface.md
    ├── security-model.md
    └── deployment.md
```

## Skill interface

Implement the `Skill` interface to add custom skills:

```typescript
import type { Skill } from "@logos-core/runtime";
import { z } from "zod";

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

See [docs/skill-interface.md](docs/skill-interface.md) for the full guide.

## License

MIT
