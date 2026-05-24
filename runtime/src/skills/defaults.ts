/**
 * Default skill implementations for Logos Core.
 *
 * Each skill wraps a real capability (build, test, analyze, etc.) via the
 * pluggable inference backend configured at runtime.  The `InferenceBackend`
 * interface keeps the skill layer decoupled from any specific AI provider.
 */

import { z } from "zod";
import type { Skill, SkillContext, SkillResult } from "./interface.js";

// ─── Inference backend interface (pluggable) ──────────────────────────────────

export interface InferenceBackend {
  complete(prompt: string, signal?: AbortSignal): Promise<string>;
}

// ─── Helper: build a skill around an inference prompt ─────────────────────────

function promptSkill(
  id: string,
  name: string,
  description: string,
  systemPrompt: string,
  estimatedCost: bigint,
  inputSchema: z.ZodTypeAny,
  backend: InferenceBackend
): Skill {
  return {
    meta: { id, name, description, version: "0.1.0", inputSchema, estimatedCost },
    async execute(ctx: SkillContext): Promise<SkillResult> {
      const input = ctx.input as { task: string; context?: string };
      const prompt = `${systemPrompt}\n\nTask: ${input.task}${
        input.context ? `\n\nContext:\n${input.context}` : ""
      }`;

      ctx.log(`[${id}] starting…`);
      let output: string;
      try {
        output = await backend.complete(prompt, ctx.signal);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, summary: `${id} failed: ${msg}`, output: null, actualCost: 0n };
      }

      const summary = output.slice(0, 240);
      ctx.log(`[${id}] done`);
      return { success: true, summary, output, actualCost: estimatedCost };
    },
  };
}

const baseInput = z.object({
  task: z.string().min(1).max(4096),
  context: z.string().max(16384).optional(),
});

// ─── Default skill factory ────────────────────────────────────────────────────

export function createDefaultSkills(backend: InferenceBackend): Skill[] {
  return [
    promptSkill(
      "sc:analyze",
      "Analyze",
      "Multi-dimensional code and system analysis",
      "You are a senior software engineer. Analyze the given code or system thoroughly. " +
        "Identify quality issues, security risks, performance bottlenecks, and architectural concerns. " +
        "Return structured findings.",
      50n,
      baseInput,
      backend
    ),

    promptSkill(
      "sc:build",
      "Build",
      "Project builder with framework detection and error handling",
      "You are a build engineer. Generate or fix build configuration and scripts for the given project. " +
        "Detect the framework, resolve errors, and return the corrected build output.",
      80n,
      baseInput,
      backend
    ),

    promptSkill(
      "sc:implement",
      "Implement",
      "Feature and code implementation",
      "You are a senior developer. Implement the requested feature with clean, idiomatic code. " +
        "Follow existing project patterns and return the complete implementation.",
      120n,
      baseInput,
      backend
    ),

    promptSkill(
      "sc:test",
      "Test",
      "Test generation, execution and coverage reporting",
      "You are a QA engineer. Write comprehensive tests for the given code. " +
        "Cover happy paths, edge cases, and error conditions. Return runnable test code.",
      80n,
      baseInput,
      backend
    ),

    promptSkill(
      "sc:improve",
      "Improve",
      "Evidence-based code quality improvements",
      "You are a refactoring specialist. Improve the given code for quality, performance, and maintainability. " +
        "Keep changes minimal and evidence-based.",
      80n,
      baseInput,
      backend
    ),

    promptSkill(
      "sc:troubleshoot",
      "Troubleshoot",
      "Diagnose and resolve issues in code or systems",
      "You are a debugging specialist. Systematically diagnose the described issue. " +
        "Identify root cause and provide a concrete fix.",
      80n,
      baseInput,
      backend
    ),

    promptSkill(
      "sc:explain",
      "Explain",
      "Clear explanations of code, concepts, or system behaviour",
      "You are a senior engineer and teacher. Explain the given code or concept clearly. " +
        "Adapt depth to the question.",
      30n,
      baseInput,
      backend
    ),

    promptSkill(
      "sc:document",
      "Document",
      "Generate focused documentation for components or features",
      "You are a technical writer. Write clear, accurate documentation for the given code or feature. " +
        "Include usage examples.",
      50n,
      baseInput,
      backend
    ),

    promptSkill(
      "sc:design",
      "Design",
      "System architecture and API design",
      "You are a systems architect. Design a clean, scalable architecture for the given requirement. " +
        "Include component diagram (ASCII), API contracts, and key trade-offs.",
      100n,
      baseInput,
      backend
    ),

    promptSkill(
      "sc:cleanup",
      "Cleanup",
      "Remove dead code and reduce technical debt",
      "You are a refactoring specialist. Clean up the given code: remove dead code, simplify logic, " +
        "and fix inconsistencies. Return the cleaned version with a brief change list.",
      60n,
      baseInput,
      backend
    ),

    promptSkill(
      "sc:git",
      "Git",
      "Git workflow — commit messages, branch management, PR descriptions",
      "You are a DevOps engineer. Generate or review git artifacts (commit messages, PR descriptions, " +
        "branch names) following conventional commits and project conventions.",
      20n,
      baseInput,
      backend
    ),

    promptSkill(
      "sc:estimate",
      "Estimate",
      "Development effort estimation for tasks and features",
      "You are a senior engineer with strong estimation skills. Provide a realistic effort estimate " +
        "for the given task. Break it down by sub-task and justify each estimate.",
      40n,
      baseInput,
      backend
    ),

    promptSkill(
      "sc:workflow",
      "Workflow",
      "Generate structured implementation workflows from requirements",
      "You are a project architect. Generate a step-by-step implementation workflow for the given " +
        "feature or PRD. Include phases, dependencies, and success criteria.",
      60n,
      baseInput,
      backend
    ),

    promptSkill(
      "sc:index",
      "Index",
      "Generate project documentation and knowledge base",
      "You are a technical writer. Analyse the project structure and produce a comprehensive index: " +
        "module map, key concepts, dependency graph, and entry points.",
      80n,
      baseInput,
      backend
    ),

    promptSkill(
      "sc:load",
      "Load",
      "Load and analyse project context and dependencies",
      "You are a senior engineer. Analyse the given project configuration and dependencies. " +
        "Summarise tech stack, key configs, and potential issues.",
      40n,
      baseInput,
      backend
    ),

    promptSkill(
      "sc:spawn",
      "Spawn",
      "Break complex tasks into coordinated subtasks",
      "You are an orchestrator. Decompose the given complex task into independent subtasks. " +
        "For each subtask specify: id, skill to use, input, dependencies.",
      60n,
      baseInput,
      backend
    ),

    promptSkill(
      "sc:task",
      "Task",
      "Long-running project task management with cross-session persistence",
      "You are a project manager and engineer. Plan and track the given long-running task. " +
        "Break it into milestones, identify blockers, and update the plan.",
      80n,
      baseInput,
      backend
    ),
  ];
}
