import { Command } from "commander";
import chalk from "chalk";
import { readFileSync, existsSync } from "fs";
import {
  LogosAgent,
  createDefaultSkills,
  A2AServer,
  LezClient,
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

      const agentConfig: AgentRuntimeConfig = {
        name: cfg.agentName,
        ownerId: cfg.runtimeAccountId,
        onChainId: cfg.agentAccountId,
        a2aUrl,
        spendingThreshold: BigInt(cfg.spendingThreshold),
        periodMs: cfg.periodBlocks * 5000, // ~5s per block on testnet
        onApprovalRequired: async (req) => {
          console.log();
          console.log(chalk.yellow("⚠ Owner approval required"));
          console.log(`  Skill:   ${req.skillId}`);
          console.log(`  Action:  ${req.actionDescription}`);
          console.log(`  Cost:    ${req.estimatedCost} tokens`);
          console.log();
          // In production, send a notification to the owner's Logos app.
          // For CLI testing, auto-deny above-threshold actions.
          console.log(chalk.red("  Auto-denied (no owner UI connected)."));
          return false;
        },
      };

      const agent = new LogosAgent(agentConfig, lez);

      // Register all default skills.
      for (const skill of createDefaultSkills(backend)) {
        agent.registry.register(skill);
      }

      const server = new A2AServer(agent);
      server.listen(port);

      console.log();
      console.log(chalk.green("✓ Agent runtime started"));
      console.log(chalk.gray(`  A2A endpoint:  ${a2aUrl}`));
      console.log(chalk.gray(`  Agent card:    ${a2aUrl}/.well-known/agent.json`));
      console.log(chalk.gray(`  On-chain ID:   ${cfg.agentAccountId}`));
      console.log(chalk.gray(`  Skills loaded: ${agent.registry.list().length}`));
      console.log();
      console.log(chalk.gray("Press Ctrl+C to stop."));
    });
}
