# Logos Core — Module Architecture

## Overview

Logos Core is a modular AI agent system for the Logos Execution Zone (LEZ). It separates on-chain trust enforcement from off-chain AI inference, giving owners cryptographic guarantees about what an agent can do autonomously versus what requires explicit approval.

```
┌─────────────────────────────────────────────────────────┐
│                    Owner (human)                        │
│              Logos App / CLI / any client               │
└───────────────────────┬─────────────────────────────────┘
                        │ A2A / direct calls
┌───────────────────────▼─────────────────────────────────┐
│              Off-chain Runtime (Node.js)                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ A2A Server   │  │ Skill Engine │  │  LEZ Client   │  │
│  │ (HTTP/JSON-  │  │ (execution + │  │  (tx submit)  │  │
│  │  RPC 2.0)    │  │  registry)   │  │               │  │
│  └──────────────┘  └──────────────┘  └───────┬───────┘  │
│                                              │           │
│  ┌──────────────────────────────────────┐   │           │
│  │  Inference Backend (pluggable)       │   │           │
│  │  OpenAI / Anthropic / local LLM     │   │           │
│  └──────────────────────────────────────┘   │           │
└──────────────────────────────────────────────┼──────────┘
                                               │ transactions
┌──────────────────────────────────────────────▼──────────┐
│            On-chain (Logos Execution Zone)              │
│  ┌──────────────────────────────────────────────────┐   │
│  │  logos-core program (RISC-V / Borsh)             │   │
│  │                                                  │   │
│  │  AgentState {                                    │   │
│  │    config: AgentConfig           (owner, limit)  │   │
│  │    spending: SpendingPeriod      (tracker)       │   │
│  │    skills: Vec<SkillEntry>       (registry)      │   │
│  │    pending_approvals: Vec<…>     (queue)         │   │
│  │  }                                               │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Components

### 1. On-chain program (`programs/logos-core/`)

Written in Rust, compiled to RISC-V bytecode for the LEZ zkVM.

| Module | Purpose |
|--------|---------|
| `core/src/state.rs` | `AgentState`, `AgentConfig`, `SpendingPeriod`, `SkillEntry`, `PendingApproval` |
| `core/src/instruction.rs` | All `Instruction` variants (Borsh-serialised) |
| `core/src/error.rs` | `LogosCoreError` enum |
| `src/lib.rs` | `process()` — main instruction dispatcher |

The program is **stateless**: all persistent data is passed in as the account's data bytes and returned as updated bytes. No heap allocation beyond what Borsh needs.

### 2. Off-chain runtime (`runtime/`)

TypeScript (ESM) package that runs on the deployer's infrastructure.

| Module | Purpose |
|--------|---------|
| `src/agent.ts` | `LogosAgent` — orchestrates skill execution and on-chain recording |
| `src/skills/interface.ts` | `Skill` interface, `SkillRegistry`, `SkillContext`, `SkillResult` |
| `src/skills/defaults.ts` | 17 default skills (`sc:*`) built on a pluggable `InferenceBackend` |
| `src/a2a/server.ts` | A2A-compliant HTTP server (JSON-RPC 2.0) |
| `src/a2a/client.ts` | A2A client for agent-to-agent calls |
| `src/lez/client.ts` | `LezClient` — submits Borsh-encoded instructions to the LEZ sequencer |
| `src/lez/spending.ts` | Off-chain `SpendingTracker` (mirrors on-chain state) |

### 3. CLI (`cli/`)

`logos-agent` — Node.js CLI built with Commander.js.

Commands: `deploy`, `fund`, `config`, `status`, `run`, `skill`

### 4. Reference app (`examples/logos-app/`)

Interactive terminal owner chat that connects to a running agent via A2A. Demonstrates skill invocation, approval management, and spending monitoring.

## Data flow — skill execution

```
1. Client (A2A) → POST /  {"method":"tasks/send","params":{"skillId":"sc:build",...}}
2. A2AServer    → agent.executeSkill("sc:build", input)
3. LogosAgent   → SpendingTracker.canSpend(estimatedCost)
   a. YES       → execute skill, RecordExecution tx
   b. NO        → RequestApproval tx, await owner approval, then execute
4. Skill        → InferenceBackend.complete(prompt) → SkillResult
5. LezClient    → POST /v1/transactions  {RecordExecution}
6. A2AServer    → return Task {state:"completed", output}
```
