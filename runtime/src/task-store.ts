/**
 * TaskStore — persistent task state for failure recovery.
 *
 * Writes pending tasks to a JSON file on disk so the agent can recover
 * in-progress work after a crash or node restart.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import type { Task } from "./a2a/types.js";

export interface StoredTask {
  task: Task;
  skillId: string;
  input: unknown;
  /** ISO timestamp when the task was created. */
  createdAt: string;
  /** How many times execution has been attempted. */
  attempts: number;
  /** ISO timestamp of last attempt (undefined = not yet attempted). */
  lastAttemptAt?: string;
  /** Source of the task: "a2a_http" | "a2a_messaging" | "owner_chat" */
  source: string;
  /** Correlation ID for messaging-based tasks (reply routing). */
  correlationId?: string;
  /** Sender account ID for messaging-based tasks. */
  senderId?: string;
}

export class TaskStore {
  private readonly tasks = new Map<string, StoredTask>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  save(stored: StoredTask): void {
    this.tasks.set(stored.task.id, stored);
    this.persist();
  }

  get(taskId: string): StoredTask | undefined {
    return this.tasks.get(taskId);
  }

  update(taskId: string, patch: Partial<StoredTask>): void {
    const existing = this.tasks.get(taskId);
    if (!existing) return;
    this.tasks.set(taskId, { ...existing, ...patch });
    this.persist();
  }

  delete(taskId: string): void {
    this.tasks.delete(taskId);
    this.persist();
  }

  /** Return all tasks in non-terminal states. */
  getPending(): StoredTask[] {
    return [...this.tasks.values()].filter(
      (s) => s.task.status.state === "submitted" || s.task.status.state === "working"
    );
  }

  /** Return all tasks (for status reporting). */
  getAll(): StoredTask[] {
    return [...this.tasks.values()];
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const arr = JSON.parse(raw) as StoredTask[];
      for (const s of arr) this.tasks.set(s.task.id, s);
    } catch {
      // Corrupt file — start fresh
    }
  }

  private persist(): void {
    const arr = [...this.tasks.values()];
    writeFileSync(this.filePath, JSON.stringify(arr, null, 2));
  }

  /** Prune completed/failed/cancelled tasks older than `maxAgeMs`. */
  prune(maxAgeMs = 7 * 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, s] of this.tasks) {
      const terminal = ["completed", "failed", "cancelled"].includes(s.task.status.state);
      if (terminal && new Date(s.createdAt).getTime() < cutoff) {
        this.tasks.delete(id);
      }
    }
    this.persist();
  }
}
