# Security Model

## Threat model

Logos Core assumes an adversarial off-chain environment: the agent runtime may be compromised, the inference backend may hallucinate, and external callers may be malicious. The on-chain program is the last line of defence.

## What the agent CAN do without owner approval

- Execute any registered, enabled skill whose estimated cost fits within the current-period spending threshold.
- Submit `RecordExecution` transactions (cost accounting only — no fund movement).
- Submit `RequestApproval` transactions (queues a request; does not execute).
- Read its own on-chain state (public account).

## What the agent CANNOT do without owner approval

- Move native tokens beyond the spending threshold.
- Register, enable, or disable skills.
- Change the spending threshold or period.
- Pause or unpause itself.
- Approve its own pending approval requests.
- Authorise other agents (A2A delegation).
- Any action requiring the `owner_id` signer.

## On-chain enforcement

The `process()` function enforces all rules deterministically. Key checks:

```
require_owner(state, caller_id)   → Err(Unauthorized) if caller ≠ owner
can_spend_autonomously(cost, threshold) → blocks RecordExecution if over limit
skill.enabled check               → blocks disabled skills
MAX_PENDING_APPROVALS             → prevents unbounded queue growth
```

Because the program runs inside the RISC-V zkVM, these checks cannot be bypassed by the runtime — a forged transaction would fail proof verification.

## Off-chain runtime security

- The runtime keypair (stored in `agent-key.json`) should be treated as a hot wallet. Restrict file permissions (`chmod 600`).
- The inference backend API key should be in environment variables, never committed to source control.
- The A2A server should be placed behind a reverse proxy with rate limiting in production.
- The `onApprovalRequired` callback is the hook for integrating with the owner's notification channel (Telegram, email, Logos app push).

## Spending controls

```
Per-period limit:  config.spending_threshold  (native tokens)
Per-skill cap:     skill.spending_cap         (optional, additional guard)
Period reset:      every period_blocks blocks (rolling window)
```

When `RecordExecution` would exceed the threshold, it returns `SpendingLimitExceeded`. The runtime should then:
1. Call `RequestApproval` on-chain (queues the request for the owner).
2. Notify the owner via the configured channel.
3. Wait for `ApproveAction` from the owner.
4. Re-execute the skill.

## Known limitations

- The runtime keypair is a single point of failure. Future work: M-of-N multisig using LP-0002.
- The inference backend is fully trusted by the runtime; output is not verified on-chain.
- `RecordExecution` records cost but does not actually debit the agent account — native token debit is handled by the LEZ faucet/vault interaction layer (separate program).
- The off-chain spending tracker is a best-effort cache; the on-chain state is authoritative.
