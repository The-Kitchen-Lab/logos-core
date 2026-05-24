/**
 * LogosAgent — the central runtime class.
 *
 * Responsibilities:
 *   1. Maintain the skill registry.
 *   2. Enforce spending controls (pre-check off-chain, record on-chain).
 *   3. Request owner approval for above-threshold actions — with retry + timeout.
 *   4. Submit RecordExecution / RequestApproval transactions to LEZ.
 *   5. Expose the A2A server for agent-to-agent calls.
 *   6. Persist task state for failure recovery across restarts.
 *   7. Isolate skill failures so they cannot crash the runtime.
 */

import { SkillRegistry, type SkillResult } from "./skills/interface.js";
import { SpendingTracker } from "./lez/spending.js";
import type { LezClient } from "./lez/client.js";
import { encodeInstruction } from "./lez/encoding.js";
import { TaskStore } from "./task-store.js";
import type { Task } from "./a2a/types.js";

// ─── Config ───────────────────────────────────────────────────────────────────

export interface AgentRuntimeConfig {
  name: string;
  ownerId: string;
  onChainId: string;
  a2aUrl: string;
  spendingThreshold: bigint;
  periodMs: number;
  /**
   * Callback invoked when owner approval is required.
   * The runtime retries this up to `approvalRetries` times (default: 3)
   * with `approvalRetryDelayMs` between attempts (default: 30s).
   * If all retries fail, the action is NOT executed.
   */
  onApprovalRequired: (request: ApprovalRequest) => Promise<boolean>;
  /** How many times to retry a failed approval notification (default: 3). */
  approvalRetries?: number;
  /** Delay between approval retries in ms (default: 30_000). */
  approvalRetryDelayMs?: number;
  /** Max ms to wait for a single skill execution (default: 120_000 = 2 min). */
  skillTimeoutMs?: number;
  /** Path for persisting task state (default: ./task-store.json). */
  taskStorePath?: string;
}

export interface ApprovalRequest {
  approvalId: number;
  skillId: string;
  actionDescription: string;
  estimatedCost: bigint;
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export class LogosAgent {
  readonly registry = new SkillRegistry();
  readonly taskStore: TaskStore;
  private readonly spending: SpendingTracker;
  private readonly logs: string[] = [];

  private readonly approvalRetries: number;
  private readonly approvalRetryDelayMs: number;
  private readonly skillTimeoutMs: number;

  constructor(
    readonly config: AgentRuntimeConfig,
    private readonly lez?: LezClient
  ) {
    this.spending = new SpendingTracker(config.spendingThreshold, config.periodMs);
    this.taskStore = new TaskStore(config.taskStorePath ?? "./task-store.json");
    this.approvalRetries = config.approvalRetries ?? 3;
    this.approvalRetryDelayMs = config.approvalRetryDelayMs ?? 30_000;
    this.skillTimeoutMs = config.skillTimeoutMs ?? 120_000;
  }

  // ── Skill execution ───────────────────────────────────────────────────────

  async executeSkill(skillId: string, input: unknown): Promise<SkillResult> {
    const skill = this.registry.get(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    const estimatedCost = skill.meta.estimatedCost;
    const logLines: string[] = [];

    const abortCtrl = new AbortController();
    const timeoutId = setTimeout(() => abortCtrl.abort(), this.skillTimeoutMs);

    const ctx = {
      input,
      agentId: this.config.onChainId,
      ownerId: this.config.ownerId,
      blockHeight: 0,
      signal: abortCtrl.signal,
      log: (msg: string) => {
        logLines.push(msg);
        this.logs.push(`[${skillId}] ${msg}`);
      },
    };

    try {
      // ── Spending check ───────────────────────────────────────────────────
      if (!this.spending.canSpend(estimatedCost)) {
        const approved = await this.requestApprovalWithRetry({
          approvalId: Date.now(),
          skillId,
          actionDescription: `Execute skill ${skillId}`,
          estimatedCost,
        });

        if (!approved) {
          return {
            success: false,
            summary: `${skillId} blocked — owner approval not received after ${this.approvalRetries} attempts`,
            output: null,
            actualCost: 0n,
          };
        }

        await this.submitApprovalFlow(skillId, estimatedCost);
      }

      // ── Isolated execution ────────────────────────────────────────────────
      // Each skill runs in an isolated try/catch so a crash here never
      // propagates to the A2A server or other concurrent skills.
      let result: SkillResult;
      try {
        result = await Promise.race([
          skill.execute(ctx),
          new Promise<never>((_, reject) =>
            abortCtrl.signal.addEventListener("abort", () =>
              reject(new Error(`Skill ${skillId} timed out after ${this.skillTimeoutMs}ms`))
            )
          ),
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result = {
          success: false,
          summary: `${skillId} threw: ${msg.slice(0, 200)}`,
          output: null,
          actualCost: 0n,
        };
      }

      // ── On-chain recording ────────────────────────────────────────────────
      if (this.lez && result.actualCost > 0n) {
        await this.recordExecution(skillId, result.actualCost, result.summary).catch(
          (e) => this.logs.push(`[warn] recordExecution failed: ${String(e)}`)
        );
      }
      if (result.actualCost > 0n) {
        this.spending.record(result.actualCost);
      }

      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ── Approval with retry ───────────────────────────────────────────────────

  private async requestApprovalWithRetry(req: ApprovalRequest): Promise<boolean> {
    for (let attempt = 1; attempt <= this.approvalRetries; attempt++) {
      try {
        const approved = await this.config.onApprovalRequired(req);
        if (approved) return true;
        // Owner explicitly denied — do not retry
        return false;
      } catch (err) {
        this.logs.push(
          `[approval] attempt ${attempt}/${this.approvalRetries} failed: ${String(err)}`
        );
        if (attempt < this.approvalRetries) {
          await sleep(this.approvalRetryDelayMs);
        }
      }
    }
    // All retries exhausted without reaching the owner — do NOT execute.
    this.logs.push(
      `[approval] ${req.skillId}: owner unreachable after ${this.approvalRetries} retries — action blocked`
    );
    return false;
  }

  // ── On-chain helpers ──────────────────────────────────────────────────────

  private async recordExecution(
    skillId: string,
    cost: bigint,
    summary: string
  ): Promise<void> {
    if (!this.lez) return;
    const bytes = encodeInstruction({
      tag: "RecordExecution",
      skill_id: skillId,
      cost,
      result_summary: summary.slice(0, 240),
    });
    await this.lez.submitInstruction(bytes);
  }

  private async submitApprovalFlow(skillId: string, estimatedCost: bigint): Promise<void> {
    if (!this.lez) return;
    const reqBytes = encodeInstruction({
      tag: "RequestApproval",
      skill_id: skillId,
      action_description: `Execute ${skillId}`,
      estimated_cost: estimatedCost,
    });
    const result = await this.lez.submitInstruction(reqBytes);

    const approvalId = BigInt(
      "0x" + result.hash.replace(/[^0-9a-f]/gi, "").slice(-8) || "0"
    );
    const approveBytes = encodeInstruction({
      tag: "ApproveAction",
      approval_id: approvalId,
    });
    await this.lez.submitInstruction(approveBytes);
  }

  // ── Task lifecycle helpers (used by A2A server) ───────────────────────────

  createTask(id: string, sessionId?: string): Task {
    return {
      id,
      sessionId,
      status: { state: "submitted", timestamp: new Date().toISOString() },
      history: [],
    };
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  getSpendingStatus() {
    return {
      spent: this.spending.spent,
      remaining: this.spending.remaining,
      threshold: this.config.spendingThreshold,
    };
  }

  getRecentLogs(n = 50): string[] {
    return this.logs.slice(-n);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type { SkillResult };
export { SkillRegistry };
export type Agent = LogosAgent;
