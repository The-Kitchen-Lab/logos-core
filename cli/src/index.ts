#!/usr/bin/env node
/**
 * logos-agent CLI
 *
 * Commands:
 *   deploy    — build and deploy the logos-core program to LEZ testnet
 *   fund      — fund the agent account with native tokens from the faucet
 *   config    — update agent settings (threshold, skills, pause)
 *   status    — print on-chain agent state and spending
 *   run       — start the off-chain runtime + A2A server
 *   skill     — manage skills (list, add, enable, disable)
 */

import "dotenv/config";
import { Command } from "commander";
import chalk from "chalk";
import { deployCommand } from "./commands/deploy.js";
import { fundCommand } from "./commands/fund.js";
import { configCommand } from "./commands/config.js";
import { statusCommand } from "./commands/status.js";
import { runCommand } from "./commands/run.js";
import { skillCommand } from "./commands/skill.js";

const program = new Command();

program
  .name("logos-agent")
  .description(
    chalk.bold("Logos Core") +
      " — deploy and manage AI agents on the Logos Execution Zone"
  )
  .version("0.1.0");

program.addCommand(deployCommand());
program.addCommand(fundCommand());
program.addCommand(configCommand());
program.addCommand(statusCommand());
program.addCommand(runCommand());
program.addCommand(skillCommand());

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red("Error:"), err.message);
  process.exit(1);
});
