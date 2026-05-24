# Skill Interface — Third-Party Development Guide

## Overview

A Logos Core skill is a TypeScript object implementing the `Skill` interface. Skills are registered in the `SkillRegistry` at runtime startup and declared on-chain via `RegisterSkill` instructions.

## Interface

```typescript
interface Skill {
  readonly meta: SkillMeta;
  execute(ctx: SkillContext): Promise<SkillResult>;
}

interface SkillMeta {
  id: string;           // Unique: "myorg:my-skill" (namespace:name)
  name: string;         // Human-readable: "My Skill"
  description: string;  // Short description (on-chain + agent card)
  version: string;      // Semver: "1.0.0"
  inputSchema: z.ZodTypeAny;  // Zod schema for input validation
  estimatedCost: bigint;      // Expected token cost (for spending checks)
}

interface SkillContext {
  input: unknown;       // Validated against meta.inputSchema
  agentId: string;      // On-chain agent account ID
  ownerId: string;      // Owner account ID
  blockHeight: number;  // Current block (for time-sensitive logic)
  signal: AbortSignal;  // Honour for long-running ops
  log: (msg: string) => void;  // Append to on-chain result_summary
}

interface SkillResult {
  success: boolean;
  summary: string;      // Max 240 chars — written to chain
  output: unknown;      // Full result returned to caller
  actualCost: bigint;   // Actual cost (≤ estimatedCost recommended)
}
```

## Minimal example

```typescript
import { z } from "zod";
import type { Skill, SkillContext, SkillResult } from "@logos-core/runtime";

export const greetSkill: Skill = {
  meta: {
    id: "myorg:greet",
    name: "Greet",
    description: "Returns a greeting message",
    version: "1.0.0",
    inputSchema: z.object({ name: z.string() }),
    estimatedCost: 1n,
  },
  async execute(ctx: SkillContext): Promise<SkillResult> {
    const { name } = ctx.input as { name: string };
    ctx.log(`Greeting ${name}`);
    return {
      success: true,
      summary: `Greeted ${name}`,
      output: { message: `Hello, ${name}!` },
      actualCost: 1n,
    };
  },
};
```

## Registering a custom skill

```typescript
import { LogosAgent, createDefaultSkills } from "@logos-core/runtime";
import { greetSkill } from "./my-skills.js";

const agent = new LogosAgent(config, lezClient);

// Register defaults
for (const skill of createDefaultSkills(backend)) {
  agent.registry.register(skill);
}

// Register custom skill
agent.registry.register(greetSkill);
```

## On-chain registration

After registering in the runtime, declare the skill on-chain so the spending tracker and approval flow can reference it:

```bash
logos-agent skill add myorg:greet "Returns a greeting message"
```

Or programmatically via `RegisterSkill` instruction.

## Skill ID conventions

- Format: `namespace:name` (e.g. `sc:build`, `myorg:deploy`)
- All lowercase, hyphens allowed
- Default skills use the `sc:` namespace (reserved)
- Third-party skills should use a unique organisation prefix

## Default skills

| ID | Description |
|----|-------------|
| `sc:analyze` | Multi-dimensional code and system analysis |
| `sc:build` | Project builder with framework detection |
| `sc:implement` | Feature and code implementation |
| `sc:test` | Test generation and coverage reporting |
| `sc:improve` | Evidence-based code quality improvements |
| `sc:troubleshoot` | Diagnose and resolve issues |
| `sc:explain` | Clear explanations of code and concepts |
| `sc:document` | Generate focused documentation |
| `sc:design` | System architecture and API design |
| `sc:cleanup` | Remove dead code, reduce technical debt |
| `sc:git` | Git workflow assistance |
| `sc:estimate` | Development effort estimation |
| `sc:workflow` | Generate implementation workflows |
| `sc:index` | Project documentation and knowledge base |
| `sc:load` | Load and analyse project context |
| `sc:spawn` | Break tasks into coordinated subtasks |
| `sc:task` | Long-running task management |
