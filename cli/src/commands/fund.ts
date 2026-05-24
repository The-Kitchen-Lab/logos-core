import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import axios from "axios";
import { readFileSync } from "fs";

export function fundCommand(): Command {
  return new Command("fund")
    .description("Fund the agent account from the testnet faucet")
    .option("-c, --config <path>", "Agent config file", "./agent.config.json")
    .option("--amount <tokens>", "Amount of native tokens to request", "10000")
    .action(async (opts) => {
      const spinner = ora("Reading config…").start();

      const cfg = JSON.parse(readFileSync(opts.config, "utf8")) as {
        sequencerUrl: string;
        agentAccountId: string;
      };

      spinner.text = "Requesting tokens from faucet…";

      try {
        const res = await axios.post<{ tx_hash: string }>(
          `${cfg.sequencerUrl}/v1/faucet`,
          {
            recipient: cfg.agentAccountId,
            amount: parseInt(opts.amount),
          }
        );
        spinner.succeed(
          `Funded ${opts.amount} tokens → ${cfg.agentAccountId}  (tx: ${res.data.tx_hash})`
        );
      } catch (err) {
        spinner.fail("Faucet request failed");
        if (axios.isAxiosError(err)) {
          console.error(chalk.red(err.response?.data ?? err.message));
        }
        throw err;
      }
    });
}
