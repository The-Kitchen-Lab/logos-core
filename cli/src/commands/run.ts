import { Command } from "commander";
import chalk from "chalk";
import { readFileSync, existsSync } from "fs";
import {
  LogosAgent,
  createDefaultSkills,
  A2AServer,
  LezClient,
  LogosChannel,
  LogosInbox,
  A2AMessagingTransport,
  type AgentRuntimeConfig,
  type InferenceBackend,
} from "@logos-core/runtime";

export function runCommand(): Command {
  return new Command("run")
    .description("Start the agent runtime and A2A server")
    .option("-c, --config <path>", "Agent config file", "./agent.config.json")
    .option("-p, --port <number>", "A2A server port", "8080")
    .option("--inference <url>", "Inference backend URL (OpenAI-compatible)", process.env.INFERENCE_URL ?? "")
    .option("--api-key <key>", "API key for inference backend", process.env.INFERENCE_API_KEY ?? "")
    .action(async (opts) => {
      if (!existsSync(opts.config)) {
        console.error(chalk.red(`Config not found: ${opts.config}`));
        console.error("Run " + chalk.cyan("logos-agent deploy") + " first.");
        process.exit(1);
      }

      const cfg = JSON.parse(readFileSync(opts.config, "utf8")) as {
        agentName: string;
        programId: string;
        agentAccountId: string;
        runtimeAccountId: string;
        sequencerUrl: string;
        indexerUrl?: string;
        spendingThreshold: number;
        periodBlocks: number;
      };

      const port = parseInt(opts.port);
      const a2aUrl = `http://localhost:${port}`;

      // Build inference backend (OpenAI-compatible).
      const backend: InferenceBackend = opts.inference
        ? {
            async complete(prompt: string, signal?: AbortSignal): Promise<string> {
              const { default: axios } = await import("axios");
              const res = await axios.post<{
                choices: { message: { content: string } }[];
              }>(
                `${opts.inference}/v1/chat/completions`,
                {
                  model: process.env.INFERENCE_MODEL ?? "gpt-4o-mini",
                  messages: [{ role: "user", content: prompt }],
                  max_tokens: 4096,
                },
                {
                  headers: { Authorization: `Bearer ${opts.apiKey}` },
                  signal,
                }
              );
              return res.data.choices[0].message.content;
            },
          }
        : {
            // Stub backend for testing (no actual inference).
            async complete(prompt: string): Promise<string> {
              return `[stub] Would process: ${prompt.slice(0, 80)}…`;
            },
          };

      const lez = new LezClient({
        sequencerUrl: cfg.sequencerUrl,
        runtimeAccountId: cfg.runtimeAccountId,
        agentAccountId: cfg.agentAccountId,
        programId: cfg.programId,
      });

      // ── Logos Messaging channel (created before agent so approval callback can use it) ──
      const indexerUrl = cfg.indexerUrl ?? "http://localhost:8779";
      const channel = new LogosChannel({
        sequencerUrl: cfg.sequencerUrl,
        indexerUrl,
        accountId: cfg.agentAccountId,
        programId: cfg.programId,
        signerAccountId: cfg.runtimeAccountId,
      });

      // Pending approval promises: correlationId → { resolve, reject }
      const pendingApprovals = new Map<string, { resolve: (v: boolean) => void }>();

      const agentConfig: AgentRuntimeConfig = {
        name: cfg.agentName,
        ownerId: cfg.runtimeAccountId,
        onChainId: cfg.agentAccountId,
        a2aUrl,
        spendingThreshold: BigInt(cfg.spendingThreshold),
        periodMs: cfg.periodBlocks * 5000, // ~5s per block on testnet
        approvalRetries: 3,
        approvalRetryDelayMs: 30_000,
        skillTimeoutMs: 120_000,
        onApprovalRequired: async (req) => {
          console.log(chalk.yellow(`\n⚠  Approval required: ${req.skillId} (${req.estimatedCost} tokens)`));

          // Send approval request to owner via Logos Messaging (P2P, no server needed).
          const correlationId = `approval-${req.approvalId}`;
          try {
            await channel.send(cfg.runtimeAccountId, {
              kind: "owner:chat",
              correlationId,
              body: {
                type: "approval_request",
                approvalId: req.approvalId,
                skillId: req.skillId,
                actionDescription: req.actionDescription,
                estimatedCost: req.estimatedCost.toString(),
              },
            });
            console.log(chalk.gray(`  → Approval request sent to owner via Logos Messaging (corr: ${correlationId})`));
          } catch (err) {
            console.error(chalk.red(`  Messaging failed: ${String(err)}`));
            return false;
          }

          // Wait up to 5 minutes for the owner to respond via Logos Messaging.
          return new Promise<boolean>((resolve) => {
            pendingApprovals.set(correlationId, { resolve });
            setTimeout(() => {
              if (pendingApprovals.delete(correlationId)) {
                console.log(chalk.red(`  Approval timed out for ${req.skillId}`));
                resolve(false);
              }
            }, 5 * 60 * 1000);
          });
        },
      };

      const agent = new LogosAgent(agentConfig, lez);

      // Register all default skills.
      for (const skill of createDefaultSkills(backend)) {
        agent.registry.register(skill);
      }

      // ── HTTP A2A server (for local tooling / testing) ─────────────────────
      const server = new A2AServer(agent);
      server.listen(port);

      // ── Logos Messaging inbox + A2A transport (reuse the channel above) ────
      const inbox = new LogosInbox(channel, "./inbox-cursor.json");

      // Route incoming approval responses to the pending approval map.
      inbox.onMessage(async (msg) => {
        if (msg.payload.kind === "agent:chat") {
          const body = msg.payload.body as { type?: string; approved?: boolean };
          if (body.type === "approval_response") {
            const pending = pendingApprovals.get(msg.payload.correlationId);
            if (pending) {
              pendingApprovals.delete(msg.payload.correlationId);
              pending.resolve(body.approved === true);
            }
          }
        }
      });

      new A2AMessagingTransport(agent, channel, inbox);
      inbox.start();

      console.log();
      console.log(chalk.green("✓ Agent runtime started"));
      console.log(chalk.gray(`  A2A (HTTP):    ${a2aUrl}`));
      console.log(chalk.gray(`  A2A (Logos):   account ${cfg.agentAccountId} (P2P via LEZ)`));
      console.log(chalk.gray(`  Agent card:    ${a2aUrl}/.well-known/agent.json`));
      console.log(chalk.gray(`  On-chain ID:   ${cfg.agentAccountId}`));
      console.log(chalk.gray(`  Indexer:       ${indexerUrl}`));
      console.log(chalk.gray(`  Skills loaded: ${agent.registry.list().length}`));
      console.log();
      console.log(chalk.gray("Press Ctrl+C to stop."));
    });
}
