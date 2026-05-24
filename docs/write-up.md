# Logos Core — Architecture Write-Up

**LP-0008 submission.** This document covers the module architecture, key design decisions, the skill interface, spending controls, agent-to-agent coordination, and the security model.

---

## Module Architecture

Logos Core is split into four layers:

```
┌─────────────────────────────────────────────────────────────┐
│                     Owner (human)                           │
│            Logos App / CLI / any Logos Messaging client     │
└─────────────────────────┬───────────────────────────────────┘
                          │ Logos Messaging (P2P via LEZ txs)
┌─────────────────────────▼───────────────────────────────────┐
│              Off-chain Runtime (Node.js / TypeScript)       │
│                                                             │
│  ┌──────────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  LogosInbox      │  │  SkillEngine │  │  LezClient    │  │
│  │  (LEZ poll loop) │  │  (isolated   │  │  (Borsh txs)  │  │
│  └────────┬─────────┘  │   execution) │  └──────┬────────┘  │
│           │             └──────┬───────┘         │           │
│  ┌────────▼─────────────────────▼─────────────────▼───────┐  │
│  │            A2AMessagingTransport                       │  │
│  │  (Agent Cards · task lifecycle · owner chat)           │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  TaskStore (JSON persistence · failure recovery)       │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          │ Borsh-encoded transactions
┌─────────────────────────▼───────────────────────────────────┐
│           On-chain Program (LEZ / Risc0 / RISC-V)           │
│                                                             │
│  logos-core program                                         │
│  ├── Initialize · SetPaused · UpdateSpendingThreshold       │
│  ├── RegisterSkill · SetSkillEnabled · RemoveSkill          │
│  ├── RecordExecution                                        │
│  ├── RequestApproval · ApproveAction · RejectAction         │
│  ├── AuthorizeAgent · RevokeAgentAuthorization              │
│  └── SendMessage (Logos Messaging — replay-protected)       │
└─────────────────────────────────────────────────────────────┘
```

### On-chain program (`programs/logos-core/`)

Written in Rust, compiled to RISC-V, executed inside a Risc0 ZK guest.  The program is stateless — all state is stored in the agent's account `data` field as Borsh-encoded `AgentState`.

Key design decision: *everything the agent can do autonomously is bounded by the on-chain spending threshold*.  The on-chain program enforces this independently of the off-chain runtime, so the owner's approval flow cannot be bypassed even if the runtime is compromised.

### Off-chain runtime (`runtime/`)

TypeScript + Node.js.  Responsible for:
- Executing skills (isolated per-skill try/catch + AbortController timeout)
- Pre-checking spending limits locally before submitting on-chain
- Managing the Logos Messaging inbox (polling the LEZ indexer)
- Persisting task state to disk for failure recovery

### CLI (`cli/`)

`logos-agent` wraps the runtime for deployment, funding, configuration, status, and starting the A2A server.

### dispatch-cli (`dispatch-cli/`)

Low-level Rust CLI that sends raw LEZ transactions using the native `nssa` crate — useful for scripted testnet testing and program ID computation.

---

## Skill Interface Design

Skills are pure functions over a typed context:

```typescript
interface Skill {
  readonly meta: SkillMeta;   // id, name, estimatedCost, inputSchema (Zod)
  execute(ctx: SkillContext): Promise<SkillResult>;
}
```

Design decisions:

1. **Isolation** — each skill runs in its own try/catch block.  A skill panic or thrown exception is caught and returned as a `failed` result; it never crashes the runtime or affects other concurrent skills.

2. **Timeout** — every execution is wrapped with an AbortController.  The default timeout is 120 seconds; owners can configure this per-agent.

3. **Cost estimation** — skills declare `estimatedCost` at registration time.  The runtime checks this against the current spending period before execution.  If the estimated cost exceeds the threshold, the owner is notified (via Logos Messaging) and execution is held until approval arrives.

4. **Pluggability** — any TypeScript module can implement `Skill` and register it with `agent.registry.register(mySkill)` without modifying the core module.

---

## Spending Threshold Mechanism

### Off-chain pre-check (SpendingTracker)

The `SpendingTracker` mirrors on-chain state locally.  Before calling any skill it checks:

```
canSpend(estimatedCost) = (currentSpend + estimatedCost) <= threshold
```

If the check fails, the runtime sends an approval request to the owner via Logos Messaging and waits for a signed `ApproveAction` instruction from the owner's account.

### On-chain enforcement (logos-core program)

The `RecordExecution` instruction re-checks the spending limit on-chain:

```rust
if !state.spending.can_spend_autonomously(cost, state.config.spending_threshold) {
    return Err(LogosCoreError::SpendingLimitExceeded);
}
```

This means even if the off-chain pre-check is bypassed (e.g. by a compromised runtime), the on-chain program will reject the transaction.

### Approval retry

If the owner's Logos app is unreachable, the runtime retries the approval notification up to `approvalRetries` times (default: 3) with `approvalRetryDelayMs` delay (default: 30 seconds) between attempts.  After all retries are exhausted **the action is not executed**.

---

## Agent-to-Agent Coordination

### Transport: Logos Messaging over LEZ

All agent-to-agent communication uses Logos Messaging — not HTTP.  This means:
- No ports exposed between agents
- No custodian or relay server
- All messages are on-chain transactions, auditable and tamper-evident

**Message encoding:**

```
[0]     tag byte: 0xA2 (LOGOS_MSG_TAG)
[1..9]  sender_id: u64 LE
[9..17] recipient_id: u64 LE
[17..25] nonce: u64 LE
[25..29] payload_len: u32 LE
[29..]  JSON-encoded MessagePayload
```

The full message is placed in the `instruction_data` field of a LEZ `SendMessage` transaction.  The on-chain program records the nonce for replay protection.

### A2A Protocol Binding

The A2A task lifecycle is mapped to Logos Messaging message kinds:

| A2A operation | Message kind |
|---------------|-------------|
| Get agent card | `a2a:card_request` / `a2a:card_response` |
| Send task | `a2a:task_request` / `a2a:task_response` |
| Cancel task | `a2a:task_cancel` |
| Payment ACK | `a2a:payment` |
| Owner chat | `owner:chat` / `agent:chat` |

Agent Cards follow the A2A specification (name, url, version, skills, capabilities).  The `onChainId` extension field links the agent card to its on-chain account.

### Agent discovery

Agents discover each other by account ID.  A caller sends a `a2a:card_request` message to the target account ID and waits for a `a2a:card_response`.  No central registry is required.

### Autonomous payment

After a task completes, the caller can send a token transfer (via the LEZ token program) followed by an `a2a:payment` acknowledgement message.  Both are autonomous if within the spending threshold.

---

## Security Model

### What the agent can do without owner approval

- Execute any registered and enabled skill whose cost ≤ remaining threshold
- Send Logos Messages to other agents or the owner
- Read its own on-chain state via the indexer
- Register the output of a skill execution on-chain (`RecordExecution`)

### What always requires explicit owner approval

- Any skill execution whose cost would exceed the current-period threshold
- Registering or deregistering skills (`RegisterSkill`, `RemoveSkill`)
- Pausing or unpausing the agent (`SetPaused`)
- Changing the spending threshold or period (`UpdateSpendingThreshold`)
- Granting or revoking A2A authorization to other agents

### Trust boundaries

| Component | Trusted? | Notes |
|-----------|---------|-------|
| On-chain program | ✅ | Verified by Risc0 proof; deterministic |
| Off-chain runtime | ⚠️ | Trusted for liveness; not for correctness — on-chain program re-checks all limits |
| Inference backend | ⚠️ | Untrusted output — skill results are summarised before going on-chain |
| Remote agents (A2A) | ⚠️ | Only authorized agents can invoke skills; authorization is revocable on-chain |
| LEZ sequencer | ✅ | Provides ordering and finality |

### Replay protection

`SendMessage` requires a strictly increasing nonce per sender.  The on-chain program rejects any `SendMessage` with a nonce ≤ `state.last_message_nonce`.

---

## Known Limitations

1. **Logos Messaging encryption** — message payloads are currently transmitted as plaintext JSON in instruction_data.  Production deployments should encrypt the payload using the recipient's viewing public key (X25519/ChaCha20-Poly1305) before submitting.  The nssa_core crate provides the necessary key types (`ViewingPublicKey`, `EphemeralPublicKey`).

2. **Shielded agent account** — the current runtime uses a public LEZ account for the agent.  A privacy-preserving deployment should use `PrivateOwned` or `PrivatePdaOwned` account types from the wallet crate, so the agent's token balance is not visible on-chain.

3. **Proof generation latency** — with `RISC0_DEV_MODE=0` each on-chain transaction requires a Groth16 proof.  On commodity hardware this takes ~45–90 seconds.  For high-frequency skill execution, batching multiple `RecordExecution` instructions into a single transaction would reduce overhead.

4. **Inbox polling** — the inbox currently polls the indexer on a fixed interval.  A WebSocket subscription to `subscribeToFinalizedBlocks` would reduce message latency from ~5s to ~1s.

5. **Task state persistence** — the `TaskStore` uses a plain JSON file.  For production deployments a SQLite or RocksDB backend would be more robust under concurrent writes.

---

## Integration Instructions

See [deployment.md](deployment.md) for the full step-by-step guide.  Quick start:

```bash
# 1. Build everything
cargo build --release
cd runtime && npm install && npm run build && cd ..
cd cli && npm install && npm run build && cd ..

# 2. Start local LEZ testnet (requires Docker or manual setup)
#    See: https://github.com/logos-blockchain/logos-execution-zone

# 3. Deploy agent
logos-agent deploy \
  --name "MyAgent" \
  --threshold 1000000 \
  --period 1000 \
  --sequencer http://localhost:3040

# 4. Fund agent
logos-agent fund --sequencer http://localhost:3040

# 5. Start runtime (A2A + Logos Messaging)
INFERENCE_URL=https://api.openai.com/v1 \
INFERENCE_API_KEY=sk-... \
logos-agent run --port 8080

# 6. Send a task via Logos Messaging (no HTTP required between agents)
node examples/a2a-send.js \
  --target-account <agent-account-id> \
  --skill sc:explain \
  --input "What is Borsh encoding?"
```
