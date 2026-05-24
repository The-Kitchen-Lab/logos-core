/**
 * A2A protocol HTTP server for Logos Core agents.
 *
 * Exposes:
 *   GET  /.well-known/agent.json  — Agent Card
 *   POST /                         — JSON-RPC 2.0 endpoint
 */

import express, { type Request, type Response } from "express";
import type { AgentCard, A2ARequest, A2AResponse, Task, TaskStatus } from "./types.js";
import type { Agent } from "../agent.js";

export class A2AServer {
  private readonly app = express();
  private readonly tasks = new Map<string, Task>();

  constructor(private readonly agent: Agent) {
    this.app.use(express.json());
    this.app.get("/.well-known/agent.json", this.handleAgentCard.bind(this));
    this.app.post("/", this.handleRpc.bind(this));
  }

  listen(port: number): import("node:http").Server {
    return this.app.listen(port, () => {
      console.log(`[A2A] Agent "${this.agent.config.name}" listening on :${port}`);
    });
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  private handleAgentCard(_req: Request, res: Response): void {
    const card: AgentCard = {
      name: this.agent.config.name,
      description: `Logos Core AI agent — ${this.agent.config.name}`,
      url: this.agent.config.a2aUrl,
      version: "0.1.0",
      defaultInputModes: ["text/plain", "application/json"],
      defaultOutputModes: ["text/plain", "application/json"],
      capabilities: { streaming: false, pushNotifications: false },
      skills: this.agent.registry.list().map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      })),
      onChainId: this.agent.config.onChainId,
    };
    res.json(card);
  }

  private async handleRpc(req: Request, res: Response): Promise<void> {
    const body = req.body as A2ARequest;

    try {
      switch (body.method) {
        case "tasks/send": {
          const task = await this.sendTask(body.params);
          const response: A2AResponse<Task> = { id: body.id, result: task };
          res.json(response);
          break;
        }
        case "tasks/get": {
          const task = this.tasks.get(body.params.id);
          if (!task) {
            res.json({
              id: body.id,
              error: { code: -32001, message: "Task not found" },
            } satisfies A2AResponse);
          } else {
            res.json({ id: body.id, result: task } satisfies A2AResponse<Task>);
          }
          break;
        }
        case "tasks/cancel": {
          const task = this.tasks.get(body.params.id);
          if (task) {
            task.status = {
              state: "cancelled",
              timestamp: new Date().toISOString(),
            };
          }
          res.json({ id: body.id, result: { id: body.params.id } } satisfies A2AResponse);
          break;
        }
        default:
          res.json({
            id: (body as { id: string }).id,
            error: { code: -32601, message: "Method not found" },
          } satisfies A2AResponse);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        id: body.id,
        error: { code: -32000, message: msg },
      } satisfies A2AResponse);
    }
  }

  // ── Task execution ────────────────────────────────────────────────────────

  private async sendTask(params: {
    id: string;
    sessionId?: string;
    message: { role: string; parts: { type: string; text?: string; data?: Record<string, unknown> }[] };
    metadata?: Record<string, unknown>;
  }): Promise<Task> {
    const taskId = params.id;
    const now = new Date().toISOString();

    const task: Task = {
      id: taskId,
      sessionId: params.sessionId,
      status: { state: "submitted", timestamp: now },
      history: [params.message as Task["history"] extends Array<infer T> ? T : never],
    };
    this.tasks.set(taskId, task);

    // Extract skill ID and input from message.
    const text =
      params.message.parts.find((p) => p.type === "text")?.text ?? "";
    const data = params.message.parts.find((p) => p.type === "data")?.data;

    // Message format: "sc:build\n<task text>" or data.skillId + data.input.
    let skillId: string;
    let input: unknown;

    if (data?.skillId) {
      skillId = data.skillId as string;
      input = data.input ?? { task: text };
    } else {
      // Try JSON text format: {"skillId": "sc:build", "task": "..."}
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (typeof parsed["skillId"] === "string") {
          skillId = parsed["skillId"];
          input = { task: parsed["task"] ?? text, context: parsed["context"] };
        } else {
          throw new Error("no skillId");
        }
      } catch {
        // Fallback: "sc:build\n<task text>" newline format
        const [first, ...rest] = text.split("\n");
        skillId = first.trim();
        input = { task: rest.join("\n").trim() || text };
      }
    }

    task.status = { state: "working", timestamp: new Date().toISOString() };

    try {
      const result = await this.agent.executeSkill(skillId, input);
      task.status = {
        state: result.success ? "completed" : "failed",
        message: {
          role: "agent",
          parts: [
            { type: "text", text: result.summary },
            { type: "data", data: { output: result.output, cost: result.actualCost.toString() } },
          ],
        },
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      task.status = {
        state: "failed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        },
        timestamp: new Date().toISOString(),
      };
    }

    return task;
  }
}
