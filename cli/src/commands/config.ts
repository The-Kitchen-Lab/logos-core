import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import axios from "axios";
import { readFileSync, writeFileSync } from "fs";

export function configCommand(): Command {
  const cmd = new Command("config").description("Update agent configuration on-chain");

  cmd
    .command("threshold <amount>")
    .description("Update autonomous spending threshold")
    .option("-c, --config <path>", "Agent config file", "./agent.config.json")
    .action(async (amount: string, opts) => {
      const spinner = ora("Updating threshold…").start();
      const cfg = JSON.parse(readFileSync(opts.config, "utf8")) as {
        sequencerUrl: string; programId: string; runtimeAccountId: string;
      };
      const ix = JSON.stringify({
        type: "UpdateSpendingThreshold",
        new_threshold: parseInt(amount),
        new_period_blocks: 1000,
      });
      const res = await axios.post<{ transaction_hash: string }>(
        `${cfg.sequencerUrl}/v1/transactions`,
        { program_id: cfg.programId, instruction_data: Buffer.from(ix).toString("base64"), signer: cfg.runtimeAccountId }
      );
      spinner.succeed(`Threshold updated to ${amount} — tx: ${res.data.transaction_hash}`);
    });

  cmd
    .command("pause")
    .description("Pause all skill execution on this agent")
    .option("-c, --config <path>", "Agent config file", "./agent.config.json")
    .action(async (opts) => {
      await setPaused(opts.config, true);
    });

  cmd
    .command("unpause")
    .description("Resume skill execution")
    .option("-c, --config <path>", "Agent config file", "./agent.config.json")
    .action(async (opts) => {
      await setPaused(opts.config, false);
    });

  return cmd;
}

async function setPaused(configPath: string, paused: boolean): Promise<void> {
  const spinner = ora(`${paused ? "Pausing" : "Unpausing"} agent…`).start();
  const cfg = JSON.parse(readFileSync(configPath, "utf8")) as {
    sequencerUrl: string; programId: string; runtimeAccountId: string;
  };
  const ix = JSON.stringify({ type: "SetPaused", paused });
  const res = await axios.post<{ transaction_hash: string }>(
    `${cfg.sequencerUrl}/v1/transactions`,
    { program_id: cfg.programId, instruction_data: Buffer.from(ix).toString("base64"), signer: cfg.runtimeAccountId }
  );
  spinner.succeed(`Agent ${paused ? "paused" : "unpaused"} — tx: ${res.data.transaction_hash}`);
}
