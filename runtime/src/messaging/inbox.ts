/**
 * LogosInbox — polls the LEZ indexer for incoming messages and dispatches them.
 *
 * Tracks the highest seen nonce per sender to avoid reprocessing.
 * Survives agent restarts via a simple cursor file.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import type { LogosChannel } from "./channel.js";
import type { LogosMessage } from "./types.js";

export type MessageHandler = (msg: LogosMessage) => Promise<void>;

interface CursorState {
  /** Last processed offset into getTransactionsByAccount results. */
  offset: number;
  /** Seen tx hashes to deduplicate across poll intervals. */
  seen: string[];
}

export class LogosInbox {
  private handlers: MessageHandler[] = [];
  private cursor: CursorState = { offset: 0, seen: [] };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private readonly channel: LogosChannel,
    private readonly cursorFile: string,
    private readonly pollIntervalMs = 5_000
  ) {
    this.loadCursor();
  }

  // ── Handler registration ──────────────────────────────────────────────────

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  // ── Polling ───────────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      const messages = await this.channel.fetchMessages(this.cursor.offset, 50);

      for (const msg of messages) {
        const hash = msg.txHash ?? `${msg.senderId}-${msg.nonce}`;
        if (this.cursor.seen.includes(hash)) continue;

        this.cursor.seen.push(hash);
        // Keep seen list bounded
        if (this.cursor.seen.length > 1000) {
          this.cursor.seen = this.cursor.seen.slice(-500);
        }

        for (const handler of this.handlers) {
          try {
            await handler(msg);
          } catch (err) {
            // Handler errors are isolated — do not crash the inbox
            console.error("[inbox] handler error:", err);
          }
        }
      }

      if (messages.length === 50) {
        // There may be more — advance offset and poll immediately
        this.cursor.offset += 50;
        this.saveCursor();
        void this.poll();
        return;
      }

      this.saveCursor();
    } catch {
      // Network error — will retry on next interval
    }

    if (this.running) {
      this.timer = setTimeout(() => void this.poll(), this.pollIntervalMs);
    }
  }

  // ── Cursor persistence ────────────────────────────────────────────────────

  private loadCursor(): void {
    if (!existsSync(this.cursorFile)) return;
    try {
      this.cursor = JSON.parse(readFileSync(this.cursorFile, "utf8")) as CursorState;
    } catch {
      // Corrupt cursor — start from beginning
    }
  }

  private saveCursor(): void {
    writeFileSync(this.cursorFile, JSON.stringify(this.cursor, null, 2));
  }
}
