//! Logos Core — RISC-V guest entry point for LEZ.
//!
//! The agent state is stored in the single account's `data` field as
//! Borsh-encoded `AgentState`.  Caller/owner identity comes from the
//! account's `program_owner` field (set on Initialize) or is validated
//! off-chain by requiring the owner to sign the transaction.
//!
//! `current_block` is supplied inside the instruction envelope so the
//! guest can enforce spending-period resets without a clock account.

use borsh::{BorshDeserialize, BorshSerialize};
use logos_core_types::Instruction;
use nssa_core::program::{
    AccountPostState, Claim, ProgramInput, ProgramOutput, read_nssa_inputs,
};
use serde::{Deserialize, Serialize};

/// Thin wrapper so we can pass block height alongside the instruction.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
struct EnvelopedInstruction {
    /// Current block height — used for spending-period resets.
    block: u64,
    /// Caller / owner account ID as a u64 (lower 8 bytes of account key).
    caller_id: u64,
    /// The actual logos-core instruction.
    inner: Instruction,
}

fn main() {
    let (
        ProgramInput {
            self_program_id,
            caller_program_id,
            pre_states,
            instruction,
        },
        instruction_words,
    ) = read_nssa_inputs::<EnvelopedInstruction>();

    let EnvelopedInstruction {
        block,
        caller_id,
        inner,
    } = instruction;

    // The logos-core program operates on exactly one account (the agent).
    let [pre_state] = pre_states
        .clone()
        .try_into()
        .unwrap_or_else(|_| panic!("logos-core requires exactly one account"));

    // Agent state is stored as Borsh bytes in the account data field.
    let state_bytes: Vec<u8> = pre_state.account.data.clone().into_inner();
    let instruction_bytes = borsh::to_vec(&inner).expect("Failed to serialize instruction");

    let new_state_bytes = logos_core::process(caller_id, block, &state_bytes, &instruction_bytes)
        .unwrap_or_else(|e| panic!("logos-core process error: {e:?}"));

    // Write updated state back into the account data field.
    let mut post_account = pre_state.account.clone();
    post_account.data = new_state_bytes
        .try_into()
        .expect("State bytes exceed account data limit");

    let post_state = AccountPostState::new_claimed_if_default(post_account, Claim::Authorized);

    ProgramOutput::new(
        self_program_id,
        caller_program_id,
        instruction_words,
        pre_states.into_iter().collect(),
        vec![post_state],
    )
    .write();
}
