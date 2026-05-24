# Agent-to-Agent (A2A) Protocol

## Overview

Logos Core implements the [Google A2A Protocol v0.2](https://a2a-protocol.org/latest/specification/) for agent-to-agent communication. Any A2A-compatible client can call skills on a Logos Core agent.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/agent.json` | GET | Agent Card |
| `/` | POST | JSON-RPC 2.0 task endpoint |

## Agent Card

```json
{
  "name": "MyLogosAgent",
  "description": "Logos Core AI agent",
  "url": "http://localhost:8080",
  "version": "0.1.0",
  "defaultInputModes": ["text/plain", "application/json"],
  "defaultOutputModes": ["text/plain", "application/json"],
  "capabilities": { "streaming": false },
  "skills": [
    { "id": "sc:analyze", "name": "Analyze", "description": "..." },
    ...
  ],
  "onChainId": "agent-1234567890"
}
```

## Calling a skill

### Request

```json
{
  "id": "task-abc123",
  "method": "tasks/send",
  "params": {
    "id": "task-abc123",
    "message": {
      "role": "user",
      "parts": [
        {
          "type": "data",
          "data": {
            "skillId": "sc:build",
            "input": {
              "task": "Build the TypeScript project in /workspace",
              "context": "package.json content here"
            }
          }
        }
      ]
    }
  }
}
```

### Response

```json
{
  "id": "task-abc123",
  "result": {
    "id": "task-abc123",
    "status": {
      "state": "completed",
      "message": {
        "role": "agent",
        "parts": [
          { "type": "text", "text": "Build succeeded — 0 errors" },
          { "type": "data", "data": { "output": "...", "cost": "80" } }
        ]
      },
      "timestamp": "2026-05-24T12:00:00Z"
    }
  }
}
```

## Text shorthand

For quick testing, you can pass `"<skillId>\n<task>"` as plain text:

```json
{
  "parts": [{ "type": "text", "text": "sc:analyze\nCheck this auth module for SQL injection" }]
}
```

## Task states

| State | Meaning |
|-------|---------|
| `submitted` | Received, not yet started |
| `working` | Skill executing |
| `completed` | Success |
| `failed` | Error (see message) |
| `cancelled` | Cancelled by client |
| `input-required` | Agent needs clarification (future) |

## Agent-to-agent delegation

One Logos Core agent can call another using `A2AClient`:

```typescript
import { A2AClient } from "@logos-core/runtime";

const client = new A2AClient("http://other-agent:8080");
const card = await client.fetchAgentCard();

const task = await client.sendTask({
  skillId: "sc:test",
  task: "Write tests for the auth module",
  context: "existing code here",
});
```

On-chain, authorisation is recorded via `AuthorizeAgent` instruction (owner-gated).

## Security

- No authentication required for MVP testnet.
- Production: add OAuth 2.0 or API key header validation in the A2A server middleware.
- A2A authorisation is tracked on-chain via `AuthorizeAgent` / `RevokeAgentAuthorization`.
