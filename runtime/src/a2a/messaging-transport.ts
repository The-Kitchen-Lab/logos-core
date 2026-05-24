/**
 * A2A transport binding over Logos Messaging.
 *
 * This module implements the A2A task lifecycle (tasks/send, tasks/get,
 * tasks/cancel) using Logos Messaging as the transport layer instead of HTTP.
 *
 * Protocol binding:
 *   - Agent Cards are fetched by sending a `a2a:card_request` message and
 *     waiting for a `a2a:card_response` reply.
 *   - Tasks are initiated via `a2a:task_request`, responses arrive as
 *     `a2a:task_response`.
 *   - Cancellations are sent as `a2a:task_cancel`.
 *   - Payment acknowledgements use `a2a:payment`.
 *
 * All messages use the LogosChannel for delivery and the LogosInbox for
 * reception.  No HTTP server is exposed between agents.
 *
 * @see https://a2a-protocol.org/latest/specification/
 */

import { randomUUID } from "crypto";
import type { LogosChannel } from "../messaging/channel.js";
import type { LogosInbox } from "../messaging/inbox.js";
import type { LogosMessage } from "../messaging/types.js";
import type { AgentCard, Task, TaskStatus } from "./types.js";
import type { Agent } from "../agent.js";

// ─── Pending RPC futures ──────────────────────────────────────────────────────

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

// ─── Messaging transport ──────────────────────────────────────────────────────

export class A2AMessagingTransport {
  private readonly pending = new Map<string, PendingRpc>();
  private readonly tasks = new Map<string, Task>();

  constructor(
    private readonly agent: Agent,
    private readonly channel: LogosChannel,
    inbox: LogosInbox
  ) {
    inbox.onMessage((msg) => this.handleIncoming(msg));
  }

  // ── Outgoing (caller side) ────────────────────────────────────────────────

  /** Fetch an agent card from a remote agent via Logos Messaging. */
  async getAgentCard(remoteAccountId: string, timeoutMs = 15_000): Promise<AgentCard> {
    const correlationId = randomUUID();
    const card = await this.rpcCall(
      remoteAccountId,
      "a2a:card_request",
      {},
      correlationId,
      timeoutMs
    );
    return card as AgentCard;
  }

  /**
   * Send a task to a remote agent via Logos Messaging.
   * Returns when the task reaches a terminal state or times out.
   */
  async sendTask(
    remoteAccountId: string,
    params: {
      id?: string;
      sessionId?: string;
      skillId: string;
      input: unknown;
    },
    timeoutMs = 120_000
  ): Promise<Task> {
    const taskId = params.id ?? randomUUID();
    const correlationId = randomUUID();

    const task = await this.rpcCall(
      remoteAccountId,
      "a2a:task_request",
      {
        taskId,
        sessionId: params.sessionId,
        skillId: params.skillId,
        input: params.input,
      },
      correlationId,
      timeoutMs
    );
    return task as Task;
  }

  /** Cancel a running task on a remote agent. */
  async cancelTask(remoteAccountId: string, taskId: string): Promise<void> {
    const correlationId = randomUUID();
    await this.channel.send(remoteAccountId, {
      kind: "a2a:task_cancel",
      correlationId,
      body: { taskId },
    });
  }

  // ── Incoming (callee side) ────────────────────────────────────────────────

  private async handleIncoming(msg: LogosMessage): Promise<void> {
    const { kind, correlationId, body } = msg.payload;

    switch (kind) {
      case "a2a:card_request":
        await this.handleCardRequest(msg, correlationId);
        break;

      case "a2a:card_response":
      case "a2a:task_response":
        this.resolveRpc(correlationId, body);
        break;

      case "a2a:task_request":
        await this.handleTaskRequest(msg, correlationId, body as {
          taskId: string;
          sessionId?: string;
          skillId: string;
          input: unknown;
        });
        break;

      case "a2a:task_cancel":
        this.handleTaskCancel((body as { taskId: string }).taskId);
        break;

      case "owner:chat":
        await this.handleOwnerChat(msg, correlationId, body as { text: string });
        break;

      default:
        break;
    }
  }

  private async handleCardRequest(
    msg: LogosMessage,
    correlationId: string
  ): Promise<void> {
    const card: AgentCard = {
      name: this.agent.config.name,
      description: `Logos Core AI agent — ${this.agent.config.name}`,
      url: this.agent.config.a2aUrl,
      version: "0.1.0",
      defaultInputModes: ["application/json"],
      defaultOutputModes: ["application/json"],
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

    await this.channel.reply(msg, "a2a:card_response", card);
    void correlationId; // used via reply correlation in channel
  }

  private async handleTaskRequest(
    msg: LogosMessage,
    correlationId: string,
    params: { taskId: string; sessionId?: string; skillId: string; input: unknown }
  ): Promise<void> {
    const now = new Date().toISOString();
    const task: Task = {
      id: params.taskId,
      sessionId: params.sessionId,
      status: { state: "working", timestamp: now },
      history: [],
    };
    this.tasks.set(task.id, task);

    let finalStatus: TaskStatus;
    try {
      const result = await this.agent.executeSkill(params.skillId, params.input);
      finalStatus = {
        state: result.success ? "completed" : "failed",
        message: {
          role: "agent",
          parts: [
            { type: "text", text: result.summary },
            {
              type: "data",
              data: { output: result.output, cost: result.actualCost.toString() },
            },
          ],
        },
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      finalStatus = {
        state: "failed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        },
        timestamp: new Date().toISOString(),
      };
    }

    task.status = finalStatus;

    await this.channel.send(msg.senderId, {
      kind: "a2a:task_response",
      correlationId,
      body: task,
    });
  }

  private handleTaskCancel(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = { state: "cancelled", timestamp: new Date().toISOString() };
    }
  }

  private async handleOwnerChat(
    msg: LogosMessage,
    correlationId: string,
    body: { text: string }
  ): Promise<void> {
    // Route owner chat to sc:explain or similar skill for a response.
    let responseText: string;
    try {
      const result = await this.agent.executeSkill("sc:explain", {
        task: body.text,
      });
      responseText = result.summary;
    } catch (err) {
      responseText = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    await this.channel.send(msg.senderId, {
      kind: "agent:chat",
      correlationId,
      body: { text: responseText },
    });
  }

  // ── RPC helpers ───────────────────────────────────────────────────────────

  private rpcCall(
    remoteId: string,
    kind: LogosMessage["payload"]["kind"],
    body: unknown,
    correlationId: string,
    timeoutMs: number
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(correlationId);
        reject(new Error(`A2A RPC timed out after ${timeoutMs}ms (${kind})`));
      }, timeoutMs);

      this.pending.set(correlationId, { resolve, reject, timeoutId });

      this.channel
        .send(remoteId, { kind, correlationId, body })
        .catch((err: unknown) => {
          clearTimeout(timeoutId);
          this.pending.delete(correlationId);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  private resolveRpc(correlationId: string, value: unknown): void {
    const pending = this.pending.get(correlationId);
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    this.pending.delete(correlationId);
    pending.resolve(value);
  }
}
