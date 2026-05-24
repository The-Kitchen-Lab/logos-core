/**
 * Logos Core Runtime — public entry point.
 *
 * Usage:
 *   import { LogosAgent, createDefaultSkills, A2AServer } from "@logos-core/runtime";
 */

export { LogosAgent } from "./agent.js";
export type { AgentRuntimeConfig, ApprovalRequest, Agent } from "./agent.js";

export { SkillRegistry } from "./skills/interface.js";
export type { Skill, SkillMeta, SkillContext, SkillResult } from "./skills/interface.js";

export { createDefaultSkills } from "./skills/defaults.js";
export type { InferenceBackend } from "./skills/defaults.js";

export { A2AServer } from "./a2a/server.js";
export { A2AClient } from "./a2a/client.js";
export type { AgentCard, Task, TaskState } from "./a2a/types.js";

export { LezClient } from "./lez/client.js";
export type { LezConfig } from "./lez/client.js";
