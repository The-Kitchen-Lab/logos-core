import { A2AServer } from "../a2a/server.js";
import { LogosAgent } from "../agent.js";
import { createDefaultSkills } from "../skills/defaults.js";
import type { InferenceBackend } from "../skills/defaults.js";
import http from "node:http";

const stubBackend: InferenceBackend = {
  async complete() {
    return "stub output";
  },
};

function makeAgent(): LogosAgent {
  const agent = new LogosAgent({
    name: "TestAgent",
    ownerId: "owner-1",
    onChainId: "agent-1",
    a2aUrl: "http://localhost:9999",
    spendingThreshold: 99999n,
    periodMs: 0,
    onApprovalRequired: async () => true,
  });
  createDefaultSkills(stubBackend).forEach((s) => agent.registry.register(s));
  return agent;
}

function jsonRpc(port: number, method: string, params: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: "1", method, params });
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve(JSON.parse(data) as Record<string, unknown>); }
          catch { reject(new Error(data)); }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function getAgentCard(port: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: "/.well-known/agent.json", method: "GET" },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve(JSON.parse(data) as Record<string, unknown>); }
          catch { reject(new Error(data)); }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("A2AServer", () => {
  let httpServer: http.Server;
  let port: number;

  beforeAll(async () => {
    const agent = makeAgent();
    const srv = new A2AServer(agent);
    httpServer = srv.listen(0);
    await new Promise<void>((resolve) => httpServer.once("listening", resolve));
    port = (httpServer.address() as { port: number }).port;
  });

  afterAll(() => {
    httpServer?.close();
  });

  test("GET /.well-known/agent.json returns agent card", async () => {
    const card = await getAgentCard(port);
    expect(card["name"]).toBe("TestAgent");
    expect(Array.isArray(card["skills"])).toBe(true);
    expect((card["skills"] as unknown[]).length).toBe(17);
  });

  test("tasks/send executes a known skill", async () => {
    const resp = await jsonRpc(port, "tasks/send", {
      id: "task-1",
      message: {
        role: "user",
        parts: [{ type: "text", text: JSON.stringify({ skillId: "sc:explain", task: "hello" }) }],
      },
    });
    const result = resp["result"] as { status: { state: string } };
    expect(result.status.state).toBe("completed");
  });

  test("tasks/send returns failed for unknown skill", async () => {
    const resp = await jsonRpc(port, "tasks/send", {
      id: "task-2",
      message: {
        role: "user",
        parts: [{ type: "text", text: "sc:nonexistent\nhello" }],
      },
    });
    const result = resp["result"] as { status: { state: string } };
    expect(result.status.state).toBe("failed");
  });

  test("tasks/get returns stored task", async () => {
    const sendResp = await jsonRpc(port, "tasks/send", {
      id: "task-3",
      message: {
        role: "user",
        parts: [{ type: "text", text: "sc:explain\ntest query" }],
      },
    });
    const taskId = (sendResp["result"] as { id: string }).id;
    expect(taskId).toBe("task-3");

    const getResp = await jsonRpc(port, "tasks/get", { id: taskId });
    const got = getResp["result"] as { id: string };
    expect(got.id).toBe("task-3");
  });

  test("tasks/cancel marks task as cancelled", async () => {
    await jsonRpc(port, "tasks/send", {
      id: "task-cancel",
      message: {
        role: "user",
        parts: [{ type: "text", text: "sc:explain\nsome task" }],
      },
    });
    const cancelResp = await jsonRpc(port, "tasks/cancel", { id: "task-cancel" });
    expect(cancelResp["result"]).toBeDefined();
  });

  test("unknown method returns error -32601", async () => {
    const resp = await jsonRpc(port, "tasks/unknown", {});
    expect((resp["error"] as { code: number }).code).toBe(-32601);
  });
});
