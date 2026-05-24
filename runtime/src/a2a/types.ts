/**
 * A2A (Agent-to-Agent) Protocol types.
 * Aligned with the Google A2A specification v0.2.
 * https://a2a-protocol.org/latest/specification/
 */

// ─── Agent Card ───────────────────────────────────────────────────────────────

export interface AgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
}

export interface AgentSkillDescriptor {
  id: string;
  name: string;
  description: string;
  inputModes?: string[];
  outputModes?: string[];
  examples?: string[];
  tags?: string[];
}

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  capabilities: AgentCapabilities;
  skills: AgentSkillDescriptor[];
  /** On-chain account ID of this agent. */
  onChainId?: string;
}

// ─── Task lifecycle ───────────────────────────────────────────────────────────

export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "cancelled";

export interface TextPart {
  type: "text";
  text: string;
}

export interface DataPart {
  type: "data";
  data: Record<string, unknown>;
  mimeType?: string;
}

export type Part = TextPart | DataPart;

export interface Message {
  role: "user" | "agent";
  parts: Part[];
  metadata?: Record<string, unknown>;
}

export interface TaskStatus {
  state: TaskState;
  message?: Message;
  timestamp: string;
}

export interface Task {
  id: string;
  sessionId?: string;
  status: TaskStatus;
  history?: Message[];
  artifacts?: Artifact[];
  metadata?: Record<string, unknown>;
}

export interface Artifact {
  name?: string;
  description?: string;
  parts: Part[];
  index: number;
}

// ─── JSON-RPC request / response ─────────────────────────────────────────────

export interface SendTaskRequest {
  id: string;
  method: "tasks/send";
  params: {
    id: string;
    sessionId?: string;
    message: Message;
    metadata?: Record<string, unknown>;
  };
}

export interface GetTaskRequest {
  id: string;
  method: "tasks/get";
  params: { id: string };
}

export interface CancelTaskRequest {
  id: string;
  method: "tasks/cancel";
  params: { id: string };
}

export type A2ARequest = SendTaskRequest | GetTaskRequest | CancelTaskRequest;

export interface A2AResponse<T = unknown> {
  id: string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}
