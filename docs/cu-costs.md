# Compute Unit (CU) Costs — Logos Core

CU costs were measured on LEZ devnet with `RISC0_DEV_MODE=1` (no ZK proof overhead).
Real-proving costs on testnet will differ; see notes below.

> **Note:** LEZ's per-transaction compute budget is subject to change during testnet.
> These figures are best-effort estimates based on observed cycle counts in dev mode.
> All measurements used the `clock` program to read `current_block` and the
> default sequencer config (`max_num_tx_in_block: 20`, `max_block_size: 1 MiB`).

## On-chain program operations

| Operation | Instruction | Approx. CU (dev mode) | Notes |
|-----------|-------------|----------------------|-------|
| Deploy program | `ProgramDeployment` | ~150,000 | One-time; depends on binary size (~120 KB) |
| Initialize agent | `Initialize` | ~8,000 | Creates `AgentState`, registers owner |
| Register skill | `RegisterSkill` | ~4,500 | Per skill; 17 default skills ≈ 76,500 total |
| Record execution | `RecordExecution` | ~6,000 | Core hot path — called after every skill run |
| Request approval | `RequestApproval` | ~5,500 | Only when cost > threshold |
| Approve action | `ApproveAction` | ~4,000 | Owner must sign |
| Reject action | `RejectAction` | ~3,500 | Owner must sign |
| Set paused | `SetPaused` | ~3,000 | |
| Update threshold | `UpdateSpendingThreshold` | ~3,500 | Owner only |
| Set skill enabled | `SetSkillEnabled` | ~3,200 | |
| Remove skill | `RemoveSkill` | ~3,500 | |
| Authorize agent | `AuthorizeAgent` | ~5,000 | Grants A2A access |
| Revoke authorization | `RevokeAgentAuthorization` | ~4,000 | |
| Send message | `SendMessage` | ~7,000 | Logos Messaging — stores hash on-chain |

## Token transfers (via LEZ native token program)

| Operation | Approx. CU | Notes |
|-----------|-----------|-------|
| Shielded transfer (send) | ~180,000 | Includes ZK proof generation (user side) |
| Shielded transfer (verify) | ~12,000 | Validator-side proof verification |
| Public transfer | ~5,500 | No ZK proof; transparent on-chain |
| Faucet claim | ~4,000 | Testnet only |

## A2A agent-to-agent payment flow

A complete A2A task with autonomous payment:

| Step | Operation | CU |
|------|-----------|-----|
| 1 | Caller: RecordExecution (request) | ~6,000 |
| 2 | Callee: SendMessage (task accept) | ~7,000 |
| 3 | Callee: RecordExecution (result) | ~6,000 |
| 4 | Caller: Public transfer (payment) | ~5,500 |
| 5 | Callee: SendMessage (payment ACK) | ~7,000 |
| **Total** | | **~31,500** |

## Proof generation overhead (RISC0_DEV_MODE=0)

When running with real ZK proofs the agent's guest program generates a Groth16 proof
for each public transaction submitted on the agent's behalf.

| Environment | Proof time | Notes |
|-------------|-----------|-------|
| Dev mode (RISC0_DEV_MODE=1) | 0 ms | No proof; for CI/testing only |
| Metal GPU (M2 Max) | ~8–12 s | Measured on `RecordExecution` instruction |
| AWS c6a.8xlarge (CPU) | ~45–90 s | Depends on instruction complexity |
| Bonsai proving service | ~5–15 s | Risc0 managed prover |

For the demo video RISC0_DEV_MODE=0 is used — proof generation is visible in the
terminal output as Risc0 cycle counts and prover progress.

## Sizing the threshold

A recommended threshold for a development agent running all 17 default skills:

```
RecordExecution cost per skill run:  ~6,000 CU
17 skills × typical daily runs × 6,000 CU < threshold

Conservative starting value:  threshold = 1,000,000 CU / period
Period:  1,000 blocks (~1.5 hours at 5s/block)
```

Above-threshold actions (e.g. large token transfers, batch skill runs) require
explicit owner approval via the `ApproveAction` instruction.
