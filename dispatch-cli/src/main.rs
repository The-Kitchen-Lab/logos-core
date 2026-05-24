//! dispatch CLI — sends Initialize + RecordExecution transactions to the
//! deployed logos-core program on the LEZ testnet.

use std::str::FromStr;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use nssa::{
    AccountId, PublicTransaction,
    public_transaction::{Message, WitnessSet},
    PrivateKey, PublicKey,
};
use common::transaction::NSSATransaction;
use sequencer_service_rpc::{RpcClient as _, SequencerClientBuilder};
use logos_core_types::Instruction;
use borsh::BorshDeserialize;
use serde::{Serialize, Deserialize};

/// Program ID of the deployed logos-core program on LEZ testnet.
/// Image ID bytes (LE): 8a6f416ddf18de92ac3f1ae033b8fa98b4ccca23570c593fff823e45268590da
/// Computed via: risc0_binfmt::ProgramBinary::decode(elf).compute_image_id()
const LOGOS_CORE_PROGRAM_ID: [u32; 8] = [
    1833004938, 2464028895, 3759816620, 2566567987,
    600493236, 1062800471, 1161724671, 3666904358,
];

const SEQUENCER_URL: &str = "http://127.0.0.1:3040";

/// Instruction envelope sent to the logos-core program guest.
#[derive(Serialize, Deserialize)]
struct EnvelopedInstruction {
    block: u64,
    caller_id: u64,
    inner: Instruction,
}

#[derive(Parser)]
#[command(name = "dispatch", about = "Logos Core on-chain CLI for LEZ testnet")]
struct Cli {
    #[arg(long, default_value = SEQUENCER_URL)]
    sequencer: String,

    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Generate a new agent keypair and Initialize the agent account on-chain.
    /// Prints the account ID and private key for subsequent commands.
    Deploy {
        #[arg(long, default_value = "dispatch-agent")]
        name: String,
        #[arg(long, default_value_t = 10)]
        threshold: u64,
    },

    /// Record a skill execution on-chain
    Exec {
        #[arg(long)]
        account: String,
        #[arg(long)]
        key: String,
        #[arg(long, default_value = "web-search")]
        skill: String,
        #[arg(long, default_value_t = 1)]
        cost: u64,
        #[arg(long, default_value = "completed")]
        summary: String,
    },

    /// Fetch the on-chain agent account state
    Status {
        #[arg(long)]
        account: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    let client = SequencerClientBuilder::default()
        .build(&cli.sequencer)
        .context("Failed to build sequencer client")?;

    match cli.cmd {
        Cmd::Deploy { name, threshold } => {
            // Generate a fresh keypair — account starts with DEFAULT owner ([0;8])
            // so logos-core can claim it on Initialize.
            let private_key = PrivateKey::new_os_random();
            let public_key = PublicKey::new_from_private_key(&private_key);
            let account_id = AccountId::from(&public_key);
            let account_b58 = bs58::encode(account_id.as_ref()).into_string();

            println!("Agent keypair:");
            println!("  account: {account_b58}");
            println!("  key:     {private_key}");
            println!();

            // New account has nonce 0 (default)
            let block = client.get_last_block_id().await
                .context("Failed to get last block")?;

            // nonce 0 for fresh account
            let nonces = vec![nssa_core::account::Nonce(0)];

            let instruction = EnvelopedInstruction {
                block,
                caller_id: account_id_to_u64(account_id),
                inner: Instruction::Initialize {
                    name: name.clone(),
                    spending_threshold: threshold as u128,
                    period_blocks: 100,
                },
            };

            let message = Message::try_new(
                LOGOS_CORE_PROGRAM_ID,
                vec![account_id],
                nonces,
                &instruction,
            )
            .context("Failed to build transaction message")?;

            let sig = nssa::Signature::new(&private_key, &message.hash());
            let witness = WitnessSet::from_raw_parts(vec![(sig, public_key)]);
            let tx = PublicTransaction::new(message, witness);

            let hash = client.send_transaction(NSSATransaction::Public(tx)).await
                .context("Failed to send Initialize transaction")?;

            println!("✅ Initialize submitted");
            println!("   agent:   {account_b58}");
            println!("   name:    {name}");
            println!("   tx hash: {hash}");
            println!();
            println!("Save these values to use with 'exec' and 'status' commands.");
        }

        Cmd::Exec { account, key, skill, cost, summary } => {
            let account_id = parse_account_id(&account)?;
            let private_key = PrivateKey::from_str(&key)
                .map_err(|_| anyhow::anyhow!("Invalid private key hex"))?;
            let public_key = PublicKey::new_from_private_key(&private_key);

            let block = client.get_last_block_id().await
                .context("Failed to get last block")?;
            let nonces = client.get_accounts_nonces(vec![account_id]).await
                .context("Failed to get nonces")?;

            let instruction = EnvelopedInstruction {
                block,
                caller_id: account_id_to_u64(account_id),
                inner: Instruction::RecordExecution {
                    skill_id: skill.clone(),
                    cost: cost as u128,
                    result_summary: summary.clone(),
                },
            };

            let message = Message::try_new(
                LOGOS_CORE_PROGRAM_ID,
                vec![account_id],
                nonces,
                &instruction,
            )
            .context("Failed to build transaction message")?;

            let sig = nssa::Signature::new(&private_key, &message.hash());
            let witness = WitnessSet::from_raw_parts(vec![(sig, public_key)]);
            let tx = PublicTransaction::new(message, witness);

            let hash = client.send_transaction(NSSATransaction::Public(tx)).await
                .context("Failed to send RecordExecution transaction")?;

            println!("✅ RecordExecution submitted");
            println!("   skill:   {skill}");
            println!("   cost:    {cost}");
            println!("   summary: {summary}");
            println!("   tx hash: {hash}");
        }

        Cmd::Status { account } => {
            let account_id = parse_account_id(&account)?;
            let acc = client.get_account(account_id).await
                .context("Failed to fetch account")?;

            println!("Account: {account}");
            println!("  balance: {}", acc.balance);
            println!("  nonce:   {:?}", acc.nonce);

            if acc.data.is_empty() {
                println!("  state:   (uninitialized / fresh)");
            } else {
                use logos_core_types::AgentState;
                match borsh::from_slice::<AgentState>(&acc.data) {
                    Ok(state) => {
                        println!("  state:   ✅ logos-core agent");
                        println!("  name:    {}", state.config.name);
                        println!("  owner:   {}", state.config.owner_id);
                        println!("  paused:  {}", state.config.paused);
                        println!("  skills:  {}", state.skills.len());
                        println!("  spent:   {}", state.spending.current_spend);
                        println!("  execs:   {}", state.total_executions);
                    }
                    Err(_) => println!("  state:   (raw, {} bytes)", acc.data.len()),
                }
            }
        }
    }

    Ok(())
}

fn parse_account_id(s: &str) -> Result<AccountId> {
    let bytes = bs58::decode(s).into_vec()
        .context("Invalid base58 account ID")?;
    let arr: [u8; 32] = bytes.try_into()
        .map_err(|_| anyhow::anyhow!("Account ID must be 32 bytes"))?;
    Ok(AccountId::new(arr))
}

fn account_id_to_u64(id: AccountId) -> u64 {
    let bytes = id.as_ref();
    u64::from_le_bytes(bytes[0..8].try_into().unwrap())
}
