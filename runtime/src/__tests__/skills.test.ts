import { SkillRegistry } from "../skills/interface.js";
import { createDefaultSkills } from "../skills/defaults.js";
import type { InferenceBackend } from "../skills/defaults.js";

const stubBackend: InferenceBackend = {
  async complete(prompt: string) {
    return `stub response for: ${prompt.slice(0, 50)}`;
  },
};

describe("SkillRegistry", () => {
  test("registers and retrieves skills", () => {
    const reg = new SkillRegistry();
    const skills = createDefaultSkills(stubBackend);
    skills.forEach((s) => reg.register(s));

    expect(reg.has("sc:build")).toBe(true);
    expect(reg.has("sc:analyze")).toBe(true);
    expect(reg.get("sc:build")).toBeDefined();
  });

  test("returns undefined for unknown skill", () => {
    const reg = new SkillRegistry();
    expect(reg.get("nonexistent:skill")).toBeUndefined();
    expect(reg.has("nonexistent:skill")).toBe(false);
  });

  test("list returns all registered skill metas", () => {
    const reg = new SkillRegistry();
    const skills = createDefaultSkills(stubBackend);
    skills.forEach((s) => reg.register(s));

    const list = reg.list();
    expect(list.length).toBe(17);
    const ids = list.map((m) => m.id);
    expect(ids).toContain("sc:build");
    expect(ids).toContain("sc:test");
    expect(ids).toContain("sc:analyze");
    expect(ids).toContain("sc:implement");
  });

  test("registering duplicate skill id throws", () => {
    const reg = new SkillRegistry();
    const skills = createDefaultSkills(stubBackend);
    reg.register(skills[0]);
    expect(() => reg.register(skills[0])).toThrow(/already registered/i);
  });
});

describe("createDefaultSkills", () => {
  test("creates exactly 17 skills", () => {
    const skills = createDefaultSkills(stubBackend);
    expect(skills.length).toBe(17);
  });

  test("all skills have valid metadata", () => {
    const skills = createDefaultSkills(stubBackend);
    for (const skill of skills) {
      expect(typeof skill.meta.id).toBe("string");
      expect(skill.meta.id.length).toBeGreaterThan(0);
      expect(typeof skill.meta.name).toBe("string");
      expect(typeof skill.meta.description).toBe("string");
      expect(typeof skill.meta.estimatedCost).toBe("bigint");
      expect(skill.meta.estimatedCost).toBeGreaterThanOrEqual(0n);
    }
  });

  test("all skill ids start with sc:", () => {
    const skills = createDefaultSkills(stubBackend);
    for (const skill of skills) {
      expect(skill.meta.id).toMatch(/^sc:/);
    }
  });

  test("skill executes and returns SkillResult", async () => {
    const skills = createDefaultSkills(stubBackend);
    const explain = skills.find((s) => s.meta.id === "sc:explain")!;
    expect(explain).toBeDefined();

    const ctx = {
      input: { task: "What is Borsh encoding?" },
      agentId: "agent-123",
      ownerId: "owner-456",
      blockHeight: 100,
      signal: new AbortController().signal,
      log: () => {},
    };

    const result = await explain.execute(ctx);
    expect(result.success).toBe(true);
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeLessThanOrEqual(240);
    expect(result.actualCost).toBeGreaterThanOrEqual(0n);
  });

  test("skill handles backend error gracefully", async () => {
    const errBackend: InferenceBackend = {
      complete: async () => { throw new Error("backend offline"); },
    };
    const skills = createDefaultSkills(errBackend);
    const skill = skills[0];

    const ctx = {
      input: { task: "anything" },
      agentId: "a",
      ownerId: "o",
      blockHeight: 0,
      signal: new AbortController().signal,
      log: () => {},
    };

    const result = await skill.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.output).toBeNull();
    expect(result.actualCost).toBe(0n);
  });
});
