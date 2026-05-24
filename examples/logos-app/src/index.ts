/**
 * Logos App — Reference owner chat interface for a Logos Core agent.
 *
 * Demonstrates:
 *   1. Connecting to a running agent via the A2A protocol.
 *   2. Sending skill requests and displaying results.
 *   3. Approving pending on-chain actions.
 *   4. Monitoring spending status.
 *
 * Run:
 *   AGENT_URL=http://localhost:8080 tsx src/index.ts
 */

import "dotenv/config";
import readline from "readline";
import chalk from "chalk";
import { A2AClient } from "@logos-core/runtime";
import axios from "axios";

const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:8080";
const CONFIG_PATH = process.env.AGENT_CONFIG ?? "../../agent.config.json";

async function main() {
  const client = new A2AClient(AGENT_URL);

  // Fetch agent card.
  let agentCard;
  try {
    agentCard = await client.fetchAgentCard();
  } catch {
    console.error(chalk.red(`Cannot connect to agent at ${AGENT_URL}`));
    console.error("Make sure the agent runtime is running: " + chalk.cyan("logos-agent run"));
    process.exit(1);
  }

  console.clear();
  console.log(chalk.bold.blue("╔══════════════════════════════════════╗"));
  console.log(chalk.bold.blue("║      Logos Core — Owner Chat         ║"));
  console.log(chalk.bold.blue("╚══════════════════════════════════════╝"));
  console.log();
  console.log(chalk.bold(`Agent: ${agentCard.name}`));
  console.log(chalk.gray(`On-chain ID: ${agentCard.onChainId ?? "unknown"}`));
  console.log(chalk.gray(`Available skills: ${agentCard.skills.length}`));
  console.log();
  console.log(chalk.gray("Commands:"));
  console.log(chalk.gray("  /skills          — list available skills"));
  console.log(chalk.gray("  /status          — show spending status"));
  console.log(chalk.gray("  /approvals       — show pending approvals"));
  console.log(chalk.gray("  /approve <id>    — approve a pending action"));
  console.log(chalk.gray("  /reject <id>     — reject a pending action"));
  console.log(chalk.gray("  /quit            — exit"));
  console.log(chalk.gray("  <skill-id> <task> — run a skill directly"));
  console.log();
  console.log(chalk.gray("Example: sc:analyze Analyze the auth module for security issues"));
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan("owner> "),
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    try {
      if (input === "/quit" || input === "/exit") {
        console.log(chalk.gray("Goodbye."));
        process.exit(0);
      }

      if (input === "/skills") {
        console.log(chalk.bold("\nAvailable skills:"));
        for (const skill of agentCard.skills) {
          console.log(`  ${chalk.cyan(skill.id.padEnd(20))} ${skill.description}`);
        }
        console.log();

      } else if (input === "/status") {
        await showStatus();

      } else if (input === "/approvals") {
        await showApprovals();

      } else if (input.startsWith("/approve ")) {
        const id = parseInt(input.slice(9).trim());
        await approveAction(id);

      } else if (input.startsWith("/reject ")) {
        const id = parseInt(input.slice(8).trim());
        await rejectAction(id);

      } else {
        // Parse as "<skill-id> <task text>".
        const [skillId, ...rest] = input.split(/\s+/);
        const task = rest.join(" ");

        if (!task) {
          console.log(chalk.yellow("Usage: <skill-id> <task description>"));
          console.log(chalk.yellow("Example: sc:analyze Review this function for bugs"));
        } else {
          await executeSkill(client, skillId, task);
        }
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : String(err));
    }

    rl.prompt();
  });
}

async function executeSkill(client: A2AClient, skillId: string, task: string): Promise<void> {
  const spinner = process.stdout;
  spinner.write(chalk.gray(`  Executing ${skillId}…\n`));

  const taskResult = await client.sendTask({ skillId, task });

  if (taskResult.status.state === "completed") {
    console.log(chalk.green("✓ Completed"));
    if (taskResult.status.message?.parts) {
      for (const part of taskResult.status.message.parts) {
        if (part.type === "text") {
          console.log();
          console.log(chalk.white(part.text));
        }
      }
    }
  } else if (taskResult.status.state === "failed") {
    console.log(chalk.red("✗ Failed"));
    const msg = taskResult.status.message?.parts.find((p) => p.type === "text");
    if (msg?.type === "text") console.log(chalk.red(msg.text));
  }
  console.log();
}

async function showStatus(): Promise<void> {
  try {
    const { default: fs } = await import("fs");
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as {
      sequencerUrl: string;
      agentAccountId: string;
      spendingThreshold: number;
    };
    const res = await axios.get<{ balance: string }>(
      `${cfg.sequencerUrl}/v1/accounts/${cfg.agentAccountId}`
    );
    console.log(chalk.bold("\nSpending status:"));
    console.log(`  Balance:    ${res.data.balance} tokens`);
    console.log(`  Threshold:  ${cfg.spendingThreshold} tokens`);
  } catch {
    console.log(chalk.yellow("\nCould not fetch status from chain."));
  }
  console.log();
}

async function showApprovals(): Promise<void> {
  try {
    const { default: fs } = await import("fs");
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as {
      sequencerUrl: string;
      agentAccountId: string;
    };
    const res = await axios.get<{ data: string }>(
      `${cfg.sequencerUrl}/v1/accounts/${cfg.agentAccountId}`
    );
    const state = JSON.parse(Buffer.from(res.data.data, "base64").toString()) as {
      pending_approvals: { id: number; skill_id: string; action_description: string; estimated_cost: number; approved: boolean }[];
    };

    if (!state.pending_approvals?.length) {
      console.log(chalk.gray("\nNo pending approvals.\n"));
      return;
    }

    console.log(chalk.bold("\nPending approvals:"));
    for (const a of state.pending_approvals) {
      const status = a.approved ? chalk.green("approved") : chalk.yellow("pending");
      console.log(`  [${a.id}] ${a.skill_id} — ${a.action_description}`);
      console.log(`       Cost: ${a.estimated_cost}  Status: ${status}`);
    }
    console.log();
  } catch {
    console.log(chalk.yellow("\nCould not fetch approvals from chain.\n"));
  }
}

async function approveAction(approvalId: number): Promise<void> {
  try {
    const { default: fs } = await import("fs");
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as {
      sequencerUrl: string;
      programId: string;
      runtimeAccountId: string;
    };
    const ix = JSON.stringify({ type: "ApproveAction", approval_id: approvalId });
    const res = await axios.post<{ transaction_hash: string }>(
      `${cfg.sequencerUrl}/v1/transactions`,
      { program_id: cfg.programId, instruction_data: Buffer.from(ix).toString("base64"), signer: cfg.runtimeAccountId }
    );
    console.log(chalk.green(`✓ Approved action ${approvalId} — tx: ${res.data.transaction_hash}`));
  } catch {
    console.log(chalk.red(`Failed to approve action ${approvalId}.`));
  }
}

async function rejectAction(approvalId: number): Promise<void> {
  try {
    const { default: fs } = await import("fs");
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as {
      sequencerUrl: string;
      programId: string;
      runtimeAccountId: string;
    };
    const ix = JSON.stringify({ type: "RejectAction", approval_id: approvalId });
    const res = await axios.post<{ transaction_hash: string }>(
      `${cfg.sequencerUrl}/v1/transactions`,
      { program_id: cfg.programId, instruction_data: Buffer.from(ix).toString("base64"), signer: cfg.runtimeAccountId }
    );
    console.log(chalk.yellow(`✗ Rejected action ${approvalId} — tx: ${res.data.transaction_hash}`));
  } catch {
    console.log(chalk.red(`Failed to reject action ${approvalId}.`));
  }
}

main().catch(console.error);
