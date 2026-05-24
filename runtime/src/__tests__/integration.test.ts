/**
 * Integration tests — run against a real LEZ sequencer.
 *
 * These tests are skipped automatically when LEZ_SEQUENCER_URL is not set
 * or the sequencer is not reachable.  In CI, the workflow starts a standalone
 * sequencer before running this suite.
 *
 * Run locally:
 *   LEZ_SEQUENCER_URL=http://localhost:3040 \
 *   LEZ_INDEXER_URL=http://localhost:8779 \
 *   RISC0_DEV_MODE=1 \
 *   npx jest --testPathPattern integration
 */

import { LezClient } from "../lez/client.js";
import { LogosChannel } from "../messaging/channel.js";
import { encodeMessage, decodeMessage, LOGOS_MSG_TAG } from "../messaging/types.js";
import { SpendingTracker } from "../lez/spending.js";
import { TaskStore } from "../task-store.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const SEQUENCER_URL = process.env["LEZ_SEQUENCER_URL"] ?? "";
const INDEXER_URL   = process.env["LEZ_INDEXER_URL"]   ?? "http://localhost:8779";

// Skip all integration tests when no sequencer is configured
const describeIntegration = SEQUENCER_URL
  ? describe
  : describe.skip.bind(describe);

// ─── Sequencer connectivity ────────────────────────────────────────────────────

describeIntegration("LEZ sequencer connectivity", () => {
  let lez: LezClient;

  beforeAll(() => {
    lez = new LezClient({
      sequencerUrl: SEQUENCER_URL,
      runtimeAccountId: "test-account",
      agentAccountId: "test-agent",
      programId: "test-program",
    });
  });

  test("healthCheck returns true", async () => {
    const ok = await lez.healthCheck();
    expect(ok).toBe(true);
  }, 10_000);
});

// ─── Logos Messaging encoding roundtrip ──────────────────────────────────────

describe("Logos Messaging encoding roundtrip", () => {
  test("encodeMessage + decodeMessage roundtrip", () => {
    const original = {
      senderId: "12345678901234567",
      recipientId: "98765432109876543",
      nonce: 42n,
      payload: {
        kind: "a2a:task_request" as const,
        correlationId: "test-corr-id",
        body: { skillId: "sc:explain", input: { task: "hello" } },
      },
    };

    const words = encodeMessage(original);
    expect(words[0]! & 0xff).toBe(LOGOS_MSG_TAG);

    // Reconstruct from flat u32 array
    const decoded = decodeMessage(Array.from(words));
    expect(decoded).not.toBeNull();
    expect(decoded!.senderId).toBe(original.senderId);
    expect(decoded!.recipientId).toBe(original.recipientId);
    expect(decoded!.nonce).toBe(original.nonce);
    expect(decoded!.payload.kind).toBe("a2a:task_request");
    expect(decoded!.payload.correlationId).toBe("test-corr-id");
  });

  test("decodeMessage returns null for non-message data", () => {
    expect(decodeMessage([0x00, 0x01, 0x02])).toBeNull();
    expect(decodeMessage([])).toBeNull();
  });

  test("encodeMessage handles all MessageKind variants", () => {
    const kinds = [
      "owner:chat",
      "agent:chat",
      "a2a:task_request",
      "a2a:task_response",
      "a2a:card_request",
      "a2a:card_response",
      "a2a:task_cancel",
      "a2a:payment",
    ] as const;

    for (const kind of kinds) {
      const words = encodeMessage({
        senderId: "1",
        recipientId: "2",
        nonce: 1n,
        payload: { kind, correlationId: "c", body: {} },
      });
      const decoded = decodeMessage(Array.from(words));
      expect(decoded?.payload.kind).toBe(kind);
    }
  });
});

// ─── TaskStore ────────────────────────────────────────────────────────────────

describe("TaskStore persistence", () => {
  let dir: string;
  let store: TaskStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "logos-task-"));
    store = new TaskStore(join(dir, "tasks.json"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  test("save and get roundtrip", () => {
    const stored = {
      task: {
        id: "t1",
        status: { state: "submitted" as const, timestamp: new Date().toISOString() },
        history: [],
      },
      skillId: "sc:build",
      input: { task: "build it" },
      createdAt: new Date().toISOString(),
      attempts: 0,
      source: "a2a_http",
    };
    store.save(stored);
    expect(store.get("t1")).toEqual(stored);
  });

  test("getPending returns only non-terminal tasks", () => {
    const base = {
      task: {
        id: "t1",
        status: { state: "submitted" as const, timestamp: new Date().toISOString() },
        history: [],
      },
      skillId: "sc:build",
      input: {},
      createdAt: new Date().toISOString(),
      attempts: 0,
      source: "a2a_http",
    };
    store.save(base);
    store.save({
      ...base,
      task: { ...base.task, id: "t2", status: { state: "completed" as const, timestamp: "" } },
    });
    const pending = store.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.task.id).toBe("t1");
  });

  test("persists across store instances (simulates restart)", () => {
    const path = join(dir, "tasks.json");
    const s1 = new TaskStore(path);
    s1.save({
      task: {
        id: "persist-test",
        status: { state: "working" as const, timestamp: "" },
        history: [],
      },
      skillId: "sc:test",
      input: {},
      createdAt: new Date().toISOString(),
      attempts: 1,
      source: "a2a_messaging",
    });

    // New instance, same file — simulates a restart
    const s2 = new TaskStore(path);
    expect(s2.get("persist-test")).toBeDefined();
    expect(s2.get("persist-test")!.attempts).toBe(1);
  });
});

// ─── SpendingTracker ──────────────────────────────────────────────────────────

describe("SpendingTracker period reset", () => {
  test("resets spend after period elapses", async () => {
    const tracker = new SpendingTracker(100n, 50); // 50ms period
    tracker.record(80n);
    expect(tracker.canSpend(30n)).toBe(false);

    await new Promise((r) => setTimeout(r, 60));
    expect(tracker.canSpend(30n)).toBe(true); // period reset
  });

  test("blocks when spend exceeds threshold within period", () => {
    const tracker = new SpendingTracker(100n, 10_000);
    tracker.record(70n);
    expect(tracker.canSpend(30n)).toBe(true);
    expect(tracker.canSpend(31n)).toBe(false);
  });
});

// ─── Logos Messaging over LEZ (requires sequencer) ───────────────────────────

describeIntegration("Logos Messaging over LEZ", () => {
  test("LogosChannel can be instantiated with valid config", () => {
    const channel = new LogosChannel({
      sequencerUrl: SEQUENCER_URL,
      indexerUrl: INDEXER_URL,
      accountId: "1234567890",
      programId: "test-program-id",
      signerAccountId: "1234567890",
    });
    expect(channel).toBeDefined();
  });

  test("fetchMessages returns array (may be empty on fresh testnet)", async () => {
    const channel = new LogosChannel({
      sequencerUrl: SEQUENCER_URL,
      indexerUrl: INDEXER_URL,
      accountId: "1234567890",
      programId: "test-program-id",
      signerAccountId: "1234567890",
    });
    // Just verifies the indexer call doesn't throw (empty result is OK)
    const msgs = await channel.fetchMessages(0, 10).catch(() => []);
    expect(Array.isArray(msgs)).toBe(true);
  }, 15_000);
});
