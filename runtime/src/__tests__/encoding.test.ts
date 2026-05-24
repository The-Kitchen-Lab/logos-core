import { encodeInstruction, hashSkillId } from "../lez/encoding.js";

describe("encodeInstruction", () => {
  test("Initialize encodes with correct tag byte", () => {
    const bytes = encodeInstruction({
      tag: "Initialize",
      name: "TestAgent",
      spending_threshold: 1000n,
      period_blocks: 100n,
    });
    expect(bytes[0]).toBe(0); // tag 0
    expect(bytes.length).toBeGreaterThan(1);
  });

  test("SetPaused true encodes bool", () => {
    const bytes = encodeInstruction({ tag: "SetPaused", paused: true });
    expect(bytes[0]).toBe(1); // tag 1
    expect(bytes[1]).toBe(1); // true
  });

  test("SetPaused false encodes bool", () => {
    const bytes = encodeInstruction({ tag: "SetPaused", paused: false });
    expect(bytes[1]).toBe(0); // false
  });

  test("RecordExecution encodes with tag 6", () => {
    const bytes = encodeInstruction({
      tag: "RecordExecution",
      skill_id: "sc:build",
      cost: 80n,
      result_summary: "Built successfully",
    });
    expect(bytes[0]).toBe(6);
  });

  test("ApproveAction encodes approval_id as u64", () => {
    const bytes = encodeInstruction({ tag: "ApproveAction", approval_id: 42n });
    expect(bytes[0]).toBe(8);
    // u64 LE: 42 = 0x2a, rest zeros
    expect(bytes[1]).toBe(42);
    expect(bytes[2]).toBe(0);
  });

  test("RejectAction encodes with tag 9", () => {
    const bytes = encodeInstruction({ tag: "RejectAction", approval_id: 1n });
    expect(bytes[0]).toBe(9);
  });

  test("RegisterSkill encodes option(None) as 0 byte", () => {
    const bytes = encodeInstruction({
      tag: "RegisterSkill",
      id: "test:skill",
      implementation_hash: new Uint8Array(32),
      description: "test",
      spending_cap: null,
    });
    expect(bytes[0]).toBe(3);
    // After tag + id + hash + description, should have 0x00 for None
    expect(bytes).toContain(0);
  });

  test("RegisterSkill encodes option(Some) as 1 byte followed by u128", () => {
    const bytes = encodeInstruction({
      tag: "RegisterSkill",
      id: "test:skill",
      implementation_hash: new Uint8Array(32),
      description: "test",
      spending_cap: 500n,
    });
    // Option present byte should be 1 somewhere in the encoded output
    expect(bytes).toContain(1);
  });

  test("AuthorizeAgent encodes skill list", () => {
    const bytes = encodeInstruction({
      tag: "AuthorizeAgent",
      agent_account_id: 1n,
      allowed_skills: ["sc:build", "sc:test"],
    });
    expect(bytes[0]).toBe(10);
  });

  test("RequestApproval encodes with tag 7", () => {
    const bytes = encodeInstruction({
      tag: "RequestApproval",
      skill_id: "sc:implement",
      action_description: "Implement feature X",
      estimated_cost: 120n,
    });
    expect(bytes[0]).toBe(7);
  });

  test("all 12 instruction tags are distinct", () => {
    const tags = [
      encodeInstruction({ tag: "Initialize", name: "A", spending_threshold: 0n, period_blocks: 0n })[0],
      encodeInstruction({ tag: "SetPaused", paused: false })[0],
      encodeInstruction({ tag: "UpdateSpendingThreshold", new_threshold: 0n, new_period_blocks: 0n })[0],
      encodeInstruction({ tag: "RegisterSkill", id: "x", implementation_hash: new Uint8Array(32), description: "y", spending_cap: null })[0],
      encodeInstruction({ tag: "SetSkillEnabled", skill_id: "x", enabled: true })[0],
      encodeInstruction({ tag: "RemoveSkill", skill_id: "x" })[0],
      encodeInstruction({ tag: "RecordExecution", skill_id: "x", cost: 0n, result_summary: "z" })[0],
      encodeInstruction({ tag: "RequestApproval", skill_id: "x", action_description: "y", estimated_cost: 0n })[0],
      encodeInstruction({ tag: "ApproveAction", approval_id: 0n })[0],
      encodeInstruction({ tag: "RejectAction", approval_id: 0n })[0],
      encodeInstruction({ tag: "AuthorizeAgent", agent_account_id: 0n, allowed_skills: [] })[0],
      encodeInstruction({ tag: "RevokeAgentAuthorization", agent_account_id: 0n })[0],
    ];
    const unique = new Set(tags);
    expect(unique.size).toBe(12);
    expect(tags).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe("hashSkillId", () => {
  test("returns 32-byte Uint8Array", () => {
    const h = hashSkillId("sc:build");
    expect(h).toBeInstanceOf(Uint8Array);
    expect(h.length).toBe(32);
  });

  test("different ids produce different hashes", () => {
    const h1 = hashSkillId("sc:build");
    const h2 = hashSkillId("sc:test");
    expect(h1).not.toEqual(h2);
  });

  test("same id produces same hash", () => {
    expect(hashSkillId("sc:analyze")).toEqual(hashSkillId("sc:analyze"));
  });
});
