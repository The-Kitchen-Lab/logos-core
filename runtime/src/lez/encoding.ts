/**
 * Borsh encoding for Logos Core instructions.
 *
 * Mirrors the Instruction enum in programs/logos-core/core/src/instruction.rs.
 * Variant tag is a u8 index matching the declaration order (Borsh default).
 */

// ─── Low-level Borsh writer ────────────────────────────────────────────────────

class BorshWriter {
  private buf: number[] = [];

  u8(v: number): this {
    this.buf.push(v & 0xff);
    return this;
  }

  u32(v: number): this {
    this.buf.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }

  u64(v: bigint): this {
    const lo = v & 0xffffffffn;
    const hi = (v >> 32n) & 0xffffffffn;
    this.u32(Number(lo));
    this.u32(Number(hi));
    return this;
  }

  u128(v: bigint): this {
    const lo = v & 0xffffffffffffffffn;
    const hi = (v >> 64n) & 0xffffffffffffffffn;
    this.u64(lo);
    this.u64(hi);
    return this;
  }

  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }

  str(s: string): this {
    const bytes = new TextEncoder().encode(s);
    this.u32(bytes.length);
    for (const b of bytes) this.buf.push(b);
    return this;
  }

  bytes32(b: Uint8Array | number[]): this {
    for (let i = 0; i < 32; i++) this.buf.push((b as number[])[i] ?? 0);
    return this;
  }

  option<T>(v: T | null | undefined, write: (w: this, val: T) => void): this {
    if (v == null) {
      this.u8(0);
    } else {
      this.u8(1);
      write(this, v);
    }
    return this;
  }

  vec<T>(arr: T[], write: (w: this, item: T) => void): this {
    this.u32(arr.length);
    for (const item of arr) write(this, item);
    return this;
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.buf);
  }
}

// ─── Instruction variant tags (must match Rust enum declaration order) ─────────

const TAG = {
  Initialize: 0,
  SetPaused: 1,
  UpdateSpendingThreshold: 2,
  RegisterSkill: 3,
  SetSkillEnabled: 4,
  RemoveSkill: 5,
  RecordExecution: 6,
  RequestApproval: 7,
  ApproveAction: 8,
  RejectAction: 9,
  AuthorizeAgent: 10,
  RevokeAgentAuthorization: 11,
} as const;

// ─── Instruction types ────────────────────────────────────────────────────────

export type Instruction =
  | { tag: "Initialize"; name: string; spending_threshold: bigint; period_blocks: bigint }
  | { tag: "SetPaused"; paused: boolean }
  | { tag: "UpdateSpendingThreshold"; new_threshold: bigint; new_period_blocks: bigint }
  | { tag: "RegisterSkill"; id: string; implementation_hash: Uint8Array; description: string; spending_cap: bigint | null }
  | { tag: "SetSkillEnabled"; skill_id: string; enabled: boolean }
  | { tag: "RemoveSkill"; skill_id: string }
  | { tag: "RecordExecution"; skill_id: string; cost: bigint; result_summary: string }
  | { tag: "RequestApproval"; skill_id: string; action_description: string; estimated_cost: bigint }
  | { tag: "ApproveAction"; approval_id: bigint }
  | { tag: "RejectAction"; approval_id: bigint }
  | { tag: "AuthorizeAgent"; agent_account_id: bigint; allowed_skills: string[] }
  | { tag: "RevokeAgentAuthorization"; agent_account_id: bigint };

// ─── Encoder ──────────────────────────────────────────────────────────────────

export function encodeInstruction(ix: Instruction): Uint8Array {
  const w = new BorshWriter();
  w.u8(TAG[ix.tag]);

  switch (ix.tag) {
    case "Initialize":
      w.str(ix.name).u128(ix.spending_threshold).u64(ix.period_blocks);
      break;
    case "SetPaused":
      w.bool(ix.paused);
      break;
    case "UpdateSpendingThreshold":
      w.u128(ix.new_threshold).u64(ix.new_period_blocks);
      break;
    case "RegisterSkill":
      w.str(ix.id).bytes32(ix.implementation_hash).str(ix.description);
      w.option(ix.spending_cap, (wr, v) => wr.u128(v));
      break;
    case "SetSkillEnabled":
      w.str(ix.skill_id).bool(ix.enabled);
      break;
    case "RemoveSkill":
      w.str(ix.skill_id);
      break;
    case "RecordExecution":
      w.str(ix.skill_id).u128(ix.cost).str(ix.result_summary);
      break;
    case "RequestApproval":
      w.str(ix.skill_id).str(ix.action_description).u128(ix.estimated_cost);
      break;
    case "ApproveAction":
      w.u64(ix.approval_id);
      break;
    case "RejectAction":
      w.u64(ix.approval_id);
      break;
    case "AuthorizeAgent":
      w.u64(ix.agent_account_id).vec(ix.allowed_skills, (wr, s) => wr.str(s));
      break;
    case "RevokeAgentAuthorization":
      w.u64(ix.agent_account_id);
      break;
  }

  return w.toBytes();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function hashSkillId(id: string): Uint8Array {
  const enc = new TextEncoder().encode(id);
  // Simple deterministic 32-byte hash for skill implementation_hash.
  // In production, use the actual bundle hash.
  const out = new Uint8Array(32);
  for (let i = 0; i < enc.length; i++) out[i % 32] ^= enc[i];
  return out;
}
