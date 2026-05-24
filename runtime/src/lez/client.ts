/**
 * LEZ (Logos Execution Zone) client — submits transactions to the on-chain
 * logos-core program.
 *
 * In production this wraps the `wallet` CLI or the WalletCore Rust library
 * via a local socket / RPC.  For testnet development it falls back to
 * HTTP calls against the sequencer REST API.
 */

import axios from "axios";

export interface LezConfig {
  sequencerUrl: string;
  /** Bech32 or hex account ID of the deployer / runtime key. */
  runtimeAccountId: string;
  /** Agent's on-chain program account ID. */
  agentAccountId: string;
  /** Program ID of the deployed logos-core program. */
  programId: string;
}

export interface TxResult {
  hash: string;
  blockHeight?: number;
}

export class LezClient {
  constructor(private readonly cfg: LezConfig) {}

  /** Submit a raw Borsh-encoded instruction to the logos-core program. */
  async submitInstruction(instructionBytes: Uint8Array): Promise<TxResult> {
    const payload = {
      program_id: this.cfg.programId,
      account_ids: [this.cfg.agentAccountId],
      instruction_data: Buffer.from(instructionBytes).toString("base64"),
      signer: this.cfg.runtimeAccountId,
    };

    const res = await axios.post<{ transaction_hash: string; block_height?: number }>(
      `${this.cfg.sequencerUrl}/v1/transactions`,
      payload
    );

    return {
      hash: res.data.transaction_hash,
      blockHeight: res.data.block_height,
    };
  }

  /** Fetch the current on-chain agent account data. */
  async fetchAgentAccount(): Promise<Uint8Array> {
    const res = await axios.get<{ data: string }>(
      `${this.cfg.sequencerUrl}/v1/accounts/${this.cfg.agentAccountId}`
    );
    return Buffer.from(res.data.data, "base64");
  }

  /** Check if the sequencer is reachable. */
  async healthCheck(): Promise<boolean> {
    try {
      await axios.get(`${this.cfg.sequencerUrl}/health`, { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}
