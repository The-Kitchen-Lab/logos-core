/**
 * Logos Core — Skill Interface
 *
 * Third-party skills must implement this interface.  A skill is a pure
 * function that receives a typed context and returns a result.  The runtime
 * handles all on-chain bookkeeping (RecordExecution / RequestApproval).
 */

import { z } from "zod";

// ─── Skill metadata ────────────────────────────────────────────────────────────

export interface SkillMeta {
  /** Unique identifier, e.g. "sc:build" or "myorg:deploy". */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Short description (shown in agent card & on-chain description). */
  description: string;
  /** Semver of this skill implementation. */
  version: string;
  /** Input schema (Zod) — validated before execution. */
  inputSchema: z.ZodTypeAny;
  /** Estimated token cost for on-chain spending check. */
  estimatedCost: bigint;
}

// ─── Execution context ────────────────────────────────────────────────────────

export interface SkillContext {
  /** Parsed and validated input matching `meta.inputSchema`. */
  input: unknown;
  /** Agent account ID on-chain (for logging / A2A calls). */
  agentId: string;
  /** Owner account ID (for approval callbacks). */
  ownerId: string;
  /** Current block height at execution time. */
  blockHeight: number;
  /** Abort signal — honour this for long-running operations. */
  signal: AbortSignal;
  /** Log a message that will be included in the on-chain result_summary. */
  log: (msg: string) => void;
}

// ─── Execution result ─────────────────────────────────────────────────────────

export interface SkillResult {
  /** true = success, false = soft failure (still recorded on-chain). */
  success: boolean;
  /** One-liner written to chain as `result_summary`. Max 256 chars. */
  summary: string;
  /** Full structured output returned to the caller / A2A client. */
  output: unknown;
  /** Actual cost incurred (may be lower than estimatedCost). */
  actualCost: bigint;
}

// ─── The interface itself ─────────────────────────────────────────────────────

export interface Skill {
  readonly meta: SkillMeta;
  execute(ctx: SkillContext): Promise<SkillResult>;
}

// ─── Skill registry ───────────────────────────────────────────────────────────

export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  register(skill: Skill): void {
    if (this.skills.has(skill.meta.id)) {
      throw new Error(`Skill already registered: ${skill.meta.id}`);
    }
    this.skills.set(skill.meta.id, skill);
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  list(): SkillMeta[] {
    return [...this.skills.values()].map((s) => s.meta);
  }

  has(id: string): boolean {
    return this.skills.has(id);
  }
}
