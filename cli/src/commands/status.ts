import { Command } from "commander";
import chalk from "chalk";
import axios from "axios";
import { readFileSync } from "fs";

export function statusCommand(): Command {
  return new Command("status")
    .description("Show on-chain agent state and spending summary")
    .option("-c, --config <path>", "Agent config file", "./agent.config.json")
    .action(async (opts) => {
      const cfg = JSON.parse(readFileSync(opts.config, "utf8")) as {
        sequencerUrl: string;
        agentAccountId: string;
        agentName: string;
        spendingThreshold: number;
        deployedAt: string;
      };

      console.log(chalk.bold(`\nAgent: ${cfg.agentName}`));
      console.log(chalk.gray(`Account: ${cfg.agentAccountId}`));
      console.log(chalk.gray(`Deployed: ${cfg.deployedAt}`));
      console.log();

      try {
        const res = await axios.get<{
          data: string;
          balance: string;
        }>(`${cfg.sequencerUrl}/v1/accounts/${cfg.agentAccountId}`);

        const raw = Buffer.from(res.data.data, "base64").toString("utf8");
        let state: {
          config?: { paused?: boolean; spending_threshold?: number };
          spending?: { current_spend?: number };
          skills?: { id: string; enabled: boolean }[];
          total_executions?: number;
          pending_approvals?: unknown[];
        } = {};
        try { state = JSON.parse(raw); } catch { /* borsh — show raw */ }

        console.log(chalk.bold("On-chain state"));
        console.log(`  Paused:          ${state.config?.paused ? chalk.red("YES") : chalk.green("NO")}`);
        console.log(`  Threshold:       ${state.config?.spending_threshold ?? cfg.spendingThreshold}`);
        console.log(`  Current spend:   ${state.spending?.current_spend ?? "?"}`);
        console.log(`  Total execs:     ${state.total_executions ?? "?"}`);
        console.log(`  Pending approvals: ${state.pending_approvals?.length ?? 0}`);
        console.log(`  Balance:         ${res.data.balance} tokens`);
        console.log();

        if (state.skills?.length) {
          console.log(chalk.bold("Registered skills"));
          for (const skill of state.skills) {
            const icon = skill.enabled ? chalk.green("✓") : chalk.red("✗");
            console.log(`  ${icon} ${skill.id}`);
          }
        }
      } catch {
        console.log(chalk.yellow("Could not fetch on-chain state — sequencer may be offline."));
        console.log("Local config:", JSON.stringify(cfg, null, 2));
      }
      console.log();
    });
}
