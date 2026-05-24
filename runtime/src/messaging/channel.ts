/**
 * LogosChannel — send and receive messages over LEZ.
 *
 * Sends are submitted as LEZ transactions using the logos-core program's
 * SendMessage instruction.  The instruction_data carries the full encoded
 * LogosMessage so recipients can reconstruct it without a separate lookup.
 *
 * No intermediary server is needed: the LEZ indexer acts as the message bus.
 */

import axios from "axios";
import { encodeMessage, type LogosMessage, type MessagePayload } from "./types.js";

export interface ChannelConfig {
  /** Sequencer REST URL. */
  sequencerUrl: string;
  /** Indexer JSON-RPC WS/HTTP URL (e.g. ws://localhost:8779). */
  indexerUrl: string;
  /** This agent's on-chain account ID. */
  accountId: string;
  /** This agent's program ID (logos-core). */
  programId: string;
  /** Signer key identifier used by the wallet/sequencer. */
  signerAccountId: string;
}

export class LogosChannel {
  private nonce = BigInt(Date.now());

  constructor(private readonly cfg: ChannelConfig) {}

  // ── Send ──────────────────────────────────────────────────────────────────

  /**
   * Send a message to `recipientId`.
   * Returns the LEZ transaction hash.
   */
  async send(
    recipientId: string,
    payload: MessagePayload
  ): Promise<string> {
    this.nonce++;

    const words = encodeMessage({
      senderId: this.cfg.accountId,
      recipientId,
      nonce: this.nonce,
      payload,
    });

    // Submit as a LEZ transaction.  The on-chain program receives it as a
    // SendMessage instruction; the instruction_data encodes the full message.
    const res = await axios.post<{ transaction_hash: string }>(
      `${this.cfg.sequencerUrl}/v1/transactions`,
      {
        program_id: this.cfg.programId,
        account_ids: [this.cfg.accountId, recipientId],
        instruction_data: Array.from(words),
        signer: this.cfg.signerAccountId,
      }
    );

    return res.data.transaction_hash;
  }

  // ── Fetch inbox ───────────────────────────────────────────────────────────

  /**
   * Fetch messages for this account from the indexer.
   * Uses getTransactionsByAccount JSON-RPC method.
   */
  async fetchMessages(
    offset = 0,
    limit = 50
  ): Promise<LogosMessage[]> {
    const res = await axios.post<{
      result: { variant: string; value: { hash: string; message: { instruction_data: number[]; program_id: unknown }; block_height?: number } }[];
    }>(
      this.cfg.indexerUrl,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "getTransactionsByAccount",
        params: [this.cfg.accountId, offset, limit],
      }
    );

    const messages: LogosMessage[] = [];

    for (const tx of res.data.result ?? []) {
      if (tx.variant !== "Public") continue;
      const { decodeMessage } = await import("./types.js");
      const msg = decodeMessage(tx.value.message.instruction_data);
      if (!msg) continue;
      // Only accept messages addressed to us.
      if (msg.recipientId !== this.cfg.accountId) continue;
      msg.txHash = tx.value.hash;
      msg.blockHeight = tx.value.block_height;
      messages.push(msg);
    }

    return messages;
  }

  // ── Reply ─────────────────────────────────────────────────────────────────

  /** Convenience: send a reply using the same correlationId. */
  async reply(
    original: LogosMessage,
    kind: MessagePayload["kind"],
    body: unknown
  ): Promise<string> {
    return this.send(original.senderId, {
      kind,
      correlationId: original.payload.correlationId,
      body,
    });
  }
}
