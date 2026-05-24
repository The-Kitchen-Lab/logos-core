import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import axios from "axios";
import { readFileSync } from "fs";

export function skillCommand(): Command {
  const cmd = new Command("skill").description("Manage skills on the agent");

  cmd
    .command("list")
    .description("List all registered skills")
    .option("-c, --config <path>", "Agent config file", "./agent.config.json")
    .action(async (opts) => {
      const cfg = JSON.parse(readFileSync(opts.config, "utf8")) as { sequencerUrl: string; agentAccountId: string };
      try {
        const res = await axios.get<{ data: string }>(
          `${cfg.sequencerUrl}/v1/accounts/${cfg.agentAccountId}`
        );
        const state = JSON.parse(Buffer.from(res.data.data, "base64").toString()) as {
          skills: { id: string; enabled: boolean; description: string; lifetime_spend: number }[];
        };
        console.log(chalk.bold("\nSkills:"));
        for (const s of state.skills) {
          const icon = s.enabled ? chalk.green("●") : chalk.red("○");
          console.log(`  ${icon} ${chalk.bold(s.id.padEnd(20))}  ${s.description}`);
          console.log(`       lifetime spend: ${s.lifetime_spend}`);
        }
      } catch {
        console.log(chalk.yellow("Could not fetch skills from chain."));
      }
    });

  cmd
    .command("enable <skillId>")
    .description("Enable a skill")
    .option("-c, --config <path>", "Agent config file", "./agent.config.json")
    .action(async (skillId: string, opts) => {
      await setEnabled(opts.config, skillId, true);
    });

  cmd
    .command("disable <skillId>")
    .description("Disable a skill")
    .option("-c, --config <path>", "Agent config file", "./agent.config.json")
    .action(async (skillId: string, opts) => {
      await setEnabled(opts.config, skillId, false);
    });

  cmd
    .command("add <skillId> <description>")
    .description("Register a new skill")
    .option("-c, --config <path>", "Agent config file", "./agent.config.json")
    .option("--cap <amount>", "Optional per-skill spending cap")
    .action(async (skillId: string, description: string, opts) => {
      const spinner = ora(`Registering skill ${skillId}…`).start();
      const cfg = JSON.parse(readFileSync(opts.config, "utf8")) as {
        sequencerUrl: string; programId: string; runtimeAccountId: string;
      };
      const ix = JSON.stringify({
        type: "RegisterSkill",
        id: skillId,
        implementation_hash: Array(32).fill(0),
        description,
        spending_cap: opts.cap ? parseInt(opts.cap) : null,
      });
      const res = await axios.post<{ transaction_hash: string }>(
        `${cfg.sequencerUrl}/v1/transactions`,
        { program_id: cfg.programId, instruction_data: Buffer.from(ix).toString("base64"), signer: cfg.runtimeAccountId }
      );
      spinner.succeed(`Skill ${skillId} registered — tx: ${res.data.transaction_hash}`);
    });

  return cmd;
}

async function setEnabled(configPath: string, skillId: string, enabled: boolean): Promise<void> {
  const spinner = ora(`${enabled ? "Enabling" : "Disabling"} ${skillId}…`).start();
  const cfg = JSON.parse(readFileSync(configPath, "utf8")) as {
    sequencerUrl: string; programId: string; runtimeAccountId: string;
  };
  const ix = JSON.stringify({ type: "SetSkillEnabled", skill_id: skillId, enabled });
  const res = await axios.post<{ transaction_hash: string }>(
    `${cfg.sequencerUrl}/v1/transactions`,
    { program_id: cfg.programId, instruction_data: Buffer.from(ix).toString("base64"), signer: cfg.runtimeAccountId }
  );
  spinner.succeed(`${skillId} ${enabled ? "enabled" : "disabled"} — tx: ${res.data.transaction_hash}`);
}
