/**
 * Logos Messaging — P2P message types.
 *
 * Messages are sent as LEZ transactions with Borsh-encoded payloads in the
 * instruction_data field.  The recipient polls the indexer's
 * getTransactionsByAccount to receive messages — no intermediary server.
 *
 * Wire format (Borsh):
 *   [0] tag byte: 0xA2 = LogosMessage
 *   [1..9]  sender_id: u64 LE
 *   [9..17] recipient_id: u64 LE
 *   [17..25] nonce: u64 LE (monotonic, per-sender)
 *   [25..29] payload_len: u32 LE
 *   [29..]  payload bytes (JSON-encoded MessagePayload)
 */

// ─── Message tag ──────────────────────────────────────────────────────────────

/** Magic tag byte that identifies a Logos Messaging transaction. */
export const LOGOS_MSG_TAG = 0xa2;

// ─── Payload types ────────────────────────────────────────────────────────────

export type MessageKind =
  | "owner:chat"       // Owner → agent plain-text chat
  | "agent:chat"       // Agent → owner plain-text chat
  | "a2a:task_request" // A2A task send (agent → agent)
  | "a2a:task_response"// A2A task response
  | "a2a:card_request" // Request agent card
  | "a2a:card_response"// Agent card response
  | "a2a:task_cancel"  // Cancel a running task
  | "a2a:payment";     // Token payment acknowledgement

export interface MessagePayload {
  kind: MessageKind;
  /** Correlation ID — links requests to responses. */
  correlationId: string;
  /** Message body, structure depends on kind. */
  body: unknown;
}

// ─── Core message struct ──────────────────────────────────────────────────────

export interface LogosMessage {
  /** Sender's LEZ account ID (u64 as decimal string). */
  senderId: string;
  /** Recipient's LEZ account ID (u64 as decimal string). */
  recipientId: string;
  /** Monotonically increasing nonce (per sender). */
  nonce: bigint;
  /** Decoded payload. */
  payload: MessagePayload;
  /** LEZ transaction hash (set on receive). */
  txHash?: string;
  /** Block height (set on receive). */
  blockHeight?: number;
}

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * Encode a LogosMessage to bytes for instruction_data.
 * The LEZ `instruction_data` field is Vec<u32> (little-endian u32 words).
 * We pad to a u32 boundary and convert.
 */
export function encodeMessage(msg: Omit<LogosMessage, "txHash" | "blockHeight">): Uint32Array {
  const payloadJson = JSON.stringify(msg.payload);
  const payloadBytes = new TextEncoder().encode(payloadJson);

  // Header: tag(1) + sender_id(8) + recipient_id(8) + nonce(8) + payload_len(4) = 29 bytes
  const totalBytes = 29 + payloadBytes.length;
  const paddedLen = Math.ceil(totalBytes / 4) * 4;
  const buf = new ArrayBuffer(paddedLen);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // tag
  view.setUint8(0, LOGOS_MSG_TAG);

  // sender_id as u64 LE
  const senderBig = BigInt(msg.senderId);
  view.setBigUint64(1, senderBig, true);

  // recipient_id as u64 LE
  const recipBig = BigInt(msg.recipientId);
  view.setBigUint64(9, recipBig, true);

  // nonce as u64 LE
  view.setBigUint64(17, msg.nonce, true);

  // payload_len as u32 LE
  view.setUint32(25, payloadBytes.length, true);

  // payload bytes
  u8.set(payloadBytes, 29);

  return new Uint32Array(buf);
}

/**
 * Decode instruction_data words to a LogosMessage.
 * Returns null if the data is not a LogosMessage.
 */
export function decodeMessage(words: number[]): LogosMessage | null {
  if (words.length < 8) return null;

  const buf = new ArrayBuffer(words.length * 4);
  const u32 = new Uint32Array(buf);
  for (let i = 0; i < words.length; i++) u32[i] = words[i]!;
  const view = new DataView(buf);

  // Check tag
  if (view.getUint8(0) !== LOGOS_MSG_TAG) return null;

  const senderId = view.getBigUint64(1, true).toString();
  const recipientId = view.getBigUint64(9, true).toString();
  const nonce = view.getBigUint64(17, true);
  const payloadLen = view.getUint32(25, true);

  if (29 + payloadLen > words.length * 4) return null;

  const payloadBytes = new Uint8Array(buf, 29, payloadLen);
  let payload: MessagePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as MessagePayload;
  } catch {
    return null;
  }

  return { senderId, recipientId, nonce, payload };
}
