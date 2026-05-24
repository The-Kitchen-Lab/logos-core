/**
 * LogosAgent — the central runtime class.
 *
 * Responsibilities:
 *   1. Maintain the skill registry.
 *   2. Enforce spending controls (pre-check off-chain, record on-chain).
 *   3. Request owner approval for above-threshold actions.
 *   4. Submit RecordExecution / RequestApproval transactions to LEZ.
 *   5. Expose the A2A server for agent-to-agent calls.
 */

import { SkillRegistry, type SkillResult } from "./skills/interface.js";
import { SpendingTracker } from "./lez/spending.js";
import type { LezClient } from "./lez/client.js";
import { encodeInstruction } from "./lez/encoding.js";

// ─── Config ───────────────────────────────────────────────────────────────────

export interface AgentRuntimeConfig {
  /** Human-readable agent name. */
  name: string;
  /** Owner account ID on-chain. */
  ownerId: string;
  /** This agent's on-chain account ID. */
  onChainId: string;
  /** Publicly reachable URL for the A2A endpoint. */
  a2aUrl: string;
  /** Per-period autonomous spending limit (native tokens). */
  spendingThreshold: bigint;
  /** Period duration in milliseconds (0 = no reset). */
  periodMs: number;
  /** Callback invoked when owner approval is required. */
  onApprovalRequired: (request: ApprovalRequest) => Promise<boolean>;
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
  private readonly spending: SpendingTracker;
  private readonly logs: string[] = [];

  constructor(
    readonly config: AgentRuntimeConfig,
    private readonly lez?: LezClient
  ) {
    this.spending = new SpendingTracker(
      config.spendingThreshold,
      config.periodMs
    );
  }

  // ── Skill execution ───────────────────────────────────────────────────────

  async executeSkill(skillId: string, input: unknown): Promise<SkillResult> {
    const skill = this.registry.get(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    const estimatedCost = skill.meta.estimatedCost;
    const logLines: string[] = [];

    const ctx = {
      input,
      agentId: this.config.onChainId,
      ownerId: this.config.ownerId,
      blockHeight: 0,
      signal: new AbortController().signal,
      log: (msg: string) => {
        logLines.push(msg);
        this.logs.push(`[${skillId}] ${msg}`);
      },
    };

    // Check if spend requires approval.
    if (!this.spending.canSpend(estimatedCost)) {
      const approvalId = Date.now(); // Simple monotonic ID for off-chain.
      const approved = await this.config.onApprovalRequired({
        approvalId,
        skillId,
        actionDescription: `Execute skill ${skillId}`,
        estimatedCost,
      });

      if (!approved) {
        return {
          success: false,
          summary: `Skill ${skillId} blocked — owner approval denied`,
          output: null,
          actualCost: 0n,
        };
      }

      // Submit RequestApproval + ApproveAction on-chain.
      await this.submitApprovalFlow(skillId, estimatedCost);
    }

    // Execute the skill.
    const result = await skill.execute(ctx);

    // Record on-chain.
    if (this.lez) {
      await this.recordExecution(skillId, result.actualCost, result.summary);
    }
    this.spending.record(result.actualCost);

    return result;
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

  private async submitApprovalFlow(
    skillId: string,
    estimatedCost: bigint
  ): Promise<void> {
    if (!this.lez) return;
    const reqBytes = encodeInstruction({
      tag: "RequestApproval",
      skill_id: skillId,
      action_description: `Execute ${skillId}`,
      estimated_cost: estimatedCost,
    });
    const result = await this.lez.submitInstruction(reqBytes);

    // Derive a deterministic approval_id from the tx hash.
    const approvalId = BigInt("0x" + result.hash.replace(/[^0-9a-f]/gi, "").slice(-8) || "0");
    const approveBytes = encodeInstruction({
      tag: "ApproveAction",
      approval_id: approvalId,
    });
    await this.lez.submitInstruction(approveBytes);
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

// Re-export for convenience.
export type { SkillResult };
export { SkillRegistry };
export type Agent = LogosAgent;
