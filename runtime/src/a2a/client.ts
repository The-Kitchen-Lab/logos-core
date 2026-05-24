/**
 * Minimal A2A client for agent-to-agent calls.
 */

import axios from "axios";
import type { AgentCard, Task, A2AResponse } from "./types.js";

export class A2AClient {
  constructor(private readonly baseUrl: string) {}

  async fetchAgentCard(): Promise<AgentCard> {
    const res = await axios.get<AgentCard>(
      `${this.baseUrl}/.well-known/agent.json`
    );
    return res.data;
  }

  async sendTask(params: {
    skillId: string;
    task: string;
    context?: string;
    sessionId?: string;
  }): Promise<Task> {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const response = await axios.post<A2AResponse<Task>>(this.baseUrl, {
      id: taskId,
      method: "tasks/send",
      params: {
        id: taskId,
        sessionId: params.sessionId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                skillId: params.skillId,
                input: { task: params.task, context: params.context },
              },
            },
          ],
        },
      },
    });

    if (response.data.error) {
      throw new Error(
        `A2A error ${response.data.error.code}: ${response.data.error.message}`
      );
    }
    return response.data.result!;
  }

  async getTask(taskId: string): Promise<Task> {
    const response = await axios.post<A2AResponse<Task>>(this.baseUrl, {
      id: `get-${taskId}`,
      method: "tasks/get",
      params: { id: taskId },
    });
    if (response.data.error) {
      throw new Error(response.data.error.message);
    }
    return response.data.result!;
  }
}
