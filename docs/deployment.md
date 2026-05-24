# Deployment Instructions

## Prerequisites

- Rust 1.94.0 (`rustup toolchain install 1.94.0`)
- Risc0 toolchain (`cargo install cargo-risczero && cargo risczero install`)
- Node.js 22+ and npm
- Docker (for local LEZ testnet)
- `git`

## 1. Clone and build

```bash
git clone https://github.com/YOUR_ORG/logos-core.git
cd logos-core

# Build Rust on-chain program
cargo build --release

# Build TypeScript packages
cd runtime && npm install && npm run build && cd ..
cd cli    && npm install && npm run build && cd ..
npm install -g ./cli   # installs logos-agent globally
```

## 2. Start the local LEZ testnet

```bash
# Clone LEZ repo
git clone https://github.com/logos-blockchain/logos-execution-zone.git
cd logos-execution-zone

# Start all services
docker compose up -d

# Wait for sequencer to be ready (~30s)
curl http://localhost:3000/health
```

## 3. Deploy the agent

```bash
cd /path/to/logos-core

logos-agent deploy \
  --sequencer http://localhost:3000 \
  --name "MyAgent" \
  --threshold 5000 \
  --period 1000
```

This will:
- Upload the compiled `logos_core.bin` to the sequencer
- Create the agent account on-chain
- Register all 17 default skills
- Save deployment config to `./agent.config.json`

## 4. Fund the agent

```bash
logos-agent fund --amount 50000
```

Requests tokens from the testnet faucet.

## 5. Configure the inference backend

```bash
export INFERENCE_URL=https://api.openai.com
export INFERENCE_API_KEY=sk-...
export INFERENCE_MODEL=gpt-4o-mini
```

Or use a local model (Ollama, llama.cpp) by pointing `INFERENCE_URL` at its OpenAI-compatible endpoint.

## 6. Start the runtime

```bash
logos-agent run --port 8080
```

The agent is now:
- Listening for A2A requests at `http://localhost:8080`
- Serving the agent card at `http://localhost:8080/.well-known/agent.json`
- Recording all skill executions on-chain

## 7. Open the owner chat

```bash
cd examples/logos-app
AGENT_URL=http://localhost:8080 npm run dev
```

## 8. Test skill execution

```bash
# Via A2A client
curl -X POST http://localhost:8080 \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test-1",
    "method": "tasks/send",
    "params": {
      "id": "test-1",
      "message": {
        "role": "user",
        "parts": [{"type":"data","data":{"skillId":"sc:analyze","input":{"task":"Analyze this code for bugs: function add(a,b){return a+b}"}}}]
      }
    }
  }'
```

## 9. Deploying to public LEZ testnet

Replace the sequencer URL with the public testnet endpoint (check LEZ docs for current URL).

For ZK proof generation (required on public testnet), set:
```bash
# Remove dev mode — generates real ZK proofs (much slower)
unset RISC0_DEV_MODE
```

## Verification

After deployment, verify the agent is live:

```bash
logos-agent status
```

You should see the agent's on-chain state, registered skills, and spending summary.
