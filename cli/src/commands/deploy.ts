import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import axios from "axios";
import { readFileSync, writeFileSync, existsSync } from "fs";

export function deployCommand(): Command {
  return new Command("deploy")
    .description("Build and deploy the logos-core program to LEZ testnet")
    .option("-s, --sequencer <url>", "Sequencer URL", process.env.LEZ_SEQUENCER_URL ?? "http://localhost:3040")
    .option("--indexer <url>", "Indexer JSON-RPC URL", process.env.LEZ_INDEXER_URL ?? "http://localhost:8779")
    .option("-k, --key <path>", "Runtime keypair file", "./agent-key.json")
    .option("--threshold <amount>", "Spending threshold (native tokens)", "1000000")
    .option("--period <blocks>", "Spending period in blocks", "1000")
    .option("--name <name>", "Agent name", "MyLogosAgent")
    .option("--shielded", "Create a shielded (private) agent account", false)
    .action(async (opts) => {
      const spinner = ora("Connecting to sequencer…").start();

      try {
        // 1. Health check
        await axios.get(`${opts.sequencer}/health`, { timeout: 5000 });
        spinner.succeed("Sequencer reachable");

        // 2. Load or generate keypair
        spinner.start("Loading runtime keypair…");
        let keypair: { accountId: string; privateKey: string };
        if (existsSync(opts.key)) {
          keypair = JSON.parse(readFileSync(opts.key, "utf8"));
          spinner.succeed(`Loaded keypair — account: ${keypair.accountId}`);
        } else {
          // Generate a placeholder keypair (real implementation uses k256).
          keypair = {
            accountId: `agent-${Date.now()}`,
            privateKey: "generated-key-placeholder",
          };
          writeFileSync(opts.key, JSON.stringify(keypair, null, 2));
          spinner.succeed(`Generated new keypair → ${opts.key}`);
        }

        // 3. Deploy program binary
        spinner.start("Deploying logos-core program…");
        const programBinPath = "./artifacts/logos_core.bin";
        let programId: string;

        if (existsSync(programBinPath)) {
          const binary = readFileSync(programBinPath);
          const res = await axios.post<{ program_id: string }>(
            `${opts.sequencer}/v1/programs`,
            { binary: binary.toString("base64"), deployer: keypair.accountId }
          );
          programId = res.data.program_id;
          spinner.succeed(`Program deployed — id: ${programId}`);
        } else {
          programId = "logos-core-v0.1.0-testnet";
          spinner.warn(
            `Binary not found at ${programBinPath} — using testnet program ID: ${programId}`
          );
        }

        // 4. Initialize agent account
        spinner.start("Initialising agent on-chain…");
        const initIx = JSON.stringify({
          type: "Initialize",
          name: opts.name,
          spending_threshold: parseInt(opts.threshold),
          period_blocks: parseInt(opts.period),
        });

        const initRes = await axios.post<{ transaction_hash: string; account_id: string }>(
          `${opts.sequencer}/v1/transactions`,
          {
            program_id: programId,
            instruction_data: Buffer.from(initIx).toString("base64"),
            signer: keypair.accountId,
          }
        );
        spinner.succeed(`Agent initialised — tx: ${initRes.data.transaction_hash}`);

        // 5. Register default skills
        spinner.start("Registering default skills on-chain…");
        const defaultSkills = [
          "sc:analyze", "sc:build", "sc:implement", "sc:test",
          "sc:improve", "sc:troubleshoot", "sc:explain", "sc:document",
          "sc:design", "sc:cleanup", "sc:git", "sc:estimate",
          "sc:workflow", "sc:index", "sc:load", "sc:spawn", "sc:task",
        ];
        for (const skillId of defaultSkills) {
          const regIx = JSON.stringify({
            type: "RegisterSkill",
            id: skillId,
            implementation_hash: Array(32).fill(0),
            description: `Default skill: ${skillId}`,
            spending_cap: null,
          });
          await axios.post(
            `${opts.sequencer}/v1/transactions`,
            {
              program_id: programId,
              instruction_data: Buffer.from(regIx).toString("base64"),
              signer: keypair.accountId,
            }
          );
        }
        spinner.succeed(`Registered ${defaultSkills.length} default skills`);

        // 6. Shielded account note
        if (opts.shielded) {
          spinner.info(
            "Shielded mode: agent will use a PrivateOwned LEZ account. " +
            "Ensure the wallet crate is available and the agent key includes a nullifier secret key."
          );
        }

        // 7. Save deployment config
        const deployConfig = {
          agentName: opts.name,
          programId,
          agentAccountId: initRes.data?.account_id ?? keypair.accountId,
          runtimeAccountId: keypair.accountId,
          sequencerUrl: opts.sequencer,
          indexerUrl: opts.indexer,
          shielded: opts.shielded ?? false,
          spendingThreshold: parseInt(opts.threshold),
          periodBlocks: parseInt(opts.period),
          deployedAt: new Date().toISOString(),
        };
        writeFileSync("./agent.config.json", JSON.stringify(deployConfig, null, 2));

        console.log();
        console.log(chalk.green("✓ Deployment complete!"));
        console.log(chalk.gray("  Config saved to ./agent.config.json"));
        console.log();
        console.log("  Next steps:");
        console.log(chalk.cyan(`  logos-agent fund          `) + "— fund the agent account");
        console.log(chalk.cyan(`  logos-agent run           `) + "— start the runtime");

      } catch (err) {
        spinner.fail("Deployment failed");
        throw err;
      }
    });
}
