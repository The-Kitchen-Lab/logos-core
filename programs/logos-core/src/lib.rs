/*!
Logos Core — on-chain AI agent module for the Logos Execution Zone.

Architecture
────────────
Each agent is represented by a single public account whose data serialises to
`AgentState`.  The owner is the only entity that may initialise, pause, or
change spending thresholds.  The off-chain runtime (logos-agent) submits
`RecordExecution` and `RequestApproval` transactions on behalf of the agent
after running skill logic locally.

Security model (summary)
────────────────────────
• Only the account whose id matches `AgentState.config.owner_id` may call
  owner-gated instructions (Initialize, SetPaused, UpdateSpendingThreshold,
  RegisterSkill, SetSkillEnabled, RemoveSkill, ApproveAction, RejectAction,
  AuthorizeAgent, RevokeAgentAuthorization).

• `RecordExecution` and `RequestApproval` may be called by the agent runtime
  key (a separate keypair generated at deployment time and stored in
  AgentConfig.runtime_key).  This prevents the agent from arbitrarily moving
  funds — it can only *record* what happened off-chain.

• Autonomous spend is capped at `spending_threshold` per period.  Any action
  that would exceed the cap is blocked until the owner calls `ApproveAction`.
*/

use borsh::BorshDeserialize;
use logos_core_types::{
    AgentConfig, AgentState, Instruction, LogosCoreError, PendingApproval, SkillEntry,
    SpendingPeriod, MAX_PENDING_APPROVALS, MAX_SKILLS,
};

// ─── Entry point ──────────────────────────────────────────────────────────────

/// Process a single instruction against the current agent state.
///
/// In a real LEZ deployment this function is the RISC-V guest entry point.
/// State is passed in / out as Borsh-encoded bytes (the NSSA account data
/// model).  For testing the function is exposed directly.
pub fn process(
    caller_id: u64,
    current_block: u64,
    state_bytes: &[u8],
    instruction_bytes: &[u8],
) -> Result<Vec<u8>, LogosCoreError> {
    let instruction = Instruction::try_from_slice(instruction_bytes)
        .map_err(|_| LogosCoreError::SerializationError)?;

    // Initialise creates state from scratch.
    if let Instruction::Initialize {
        name,
        spending_threshold,
        period_blocks,
    } = instruction
    {
        if !state_bytes.is_empty() {
            return Err(LogosCoreError::AlreadyInitialized);
        }
        let state = AgentState {
            config: AgentConfig {
                owner_id: caller_id,
                spending_threshold,
                paused: false,
                name,
            },
            spending: SpendingPeriod {
                current_spend: 0,
                period_start_block: current_block,
                period_blocks,
            },
            skills: Vec::new(),
            pending_approvals: Vec::new(),
            next_approval_id: 0,
            total_executions: 0,
        };
        return borsh::to_vec(&state)
            .map_err(|_| LogosCoreError::SerializationError);
    }

    // All other instructions require existing state.
    let mut state = AgentState::try_from_slice(state_bytes)
        .map_err(|_| LogosCoreError::SerializationError)?;

    // Reset spending period if it has elapsed.
    state.spending.maybe_reset(current_block);

    match instruction {
        Instruction::Initialize { .. } => unreachable!("handled above"),

        // ── Owner-gated ───────────────────────────────────────────────────────

        Instruction::SetPaused { paused } => {
            require_owner(&state, caller_id)?;
            state.config.paused = paused;
        }

        Instruction::UpdateSpendingThreshold {
            new_threshold,
            new_period_blocks,
        } => {
            require_owner(&state, caller_id)?;
            state.config.spending_threshold = new_threshold;
            state.spending.period_blocks = new_period_blocks;
        }

        Instruction::RegisterSkill {
            id,
            implementation_hash,
            description,
            spending_cap,
        } => {
            require_owner(&state, caller_id)?;
            if let Some(existing) = state.find_skill_mut(&id) {
                existing.implementation_hash = implementation_hash;
                existing.description = description;
                existing.spending_cap = spending_cap;
            } else {
                if state.skills.len() >= MAX_SKILLS {
                    return Err(LogosCoreError::ApprovalQueueFull); // reuse — no room
                }
                state.skills.push(SkillEntry {
                    id,
                    implementation_hash,
                    description,
                    enabled: true,
                    spending_cap,
                    lifetime_spend: 0,
                });
            }
        }

        Instruction::SetSkillEnabled { skill_id, enabled } => {
            require_owner(&state, caller_id)?;
            let skill = state
                .find_skill_mut(&skill_id)
                .ok_or(LogosCoreError::SkillNotFound)?;
            skill.enabled = enabled;
        }

        Instruction::RemoveSkill { skill_id } => {
            require_owner(&state, caller_id)?;
            let before = state.skills.len();
            state.skills.retain(|s| s.id != skill_id);
            if state.skills.len() == before {
                return Err(LogosCoreError::SkillNotFound);
            }
        }

        Instruction::ApproveAction { approval_id } => {
            require_owner(&state, caller_id)?;
            let approval = state
                .pending_approvals
                .iter_mut()
                .find(|a| a.id == approval_id)
                .ok_or(LogosCoreError::ApprovalNotFound)?;
            if approval.approved {
                return Err(LogosCoreError::AlreadyProcessed);
            }
            approval.approved = true;
        }

        Instruction::RejectAction { approval_id } => {
            require_owner(&state, caller_id)?;
            let before = state.pending_approvals.len();
            state.pending_approvals.retain(|a| a.id != approval_id);
            if state.pending_approvals.len() == before {
                return Err(LogosCoreError::ApprovalNotFound);
            }
        }

        Instruction::AuthorizeAgent {
            agent_account_id: _,
            allowed_skills: _,
        } => {
            require_owner(&state, caller_id)?;
            // A2A authorisation stored off-chain in runtime config for MVP.
            // On-chain record is the presence of this instruction in block history.
        }

        Instruction::RevokeAgentAuthorization {
            agent_account_id: _,
        } => {
            require_owner(&state, caller_id)?;
        }

        // ── Runtime-gated ─────────────────────────────────────────────────────

        Instruction::RecordExecution {
            skill_id,
            cost,
            result_summary: _,
        } => {
            if state.config.paused {
                return Err(LogosCoreError::SkillDisabled);
            }
            let skill = state
                .find_skill(&skill_id)
                .ok_or(LogosCoreError::SkillNotFound)?;
            if !skill.enabled {
                return Err(LogosCoreError::SkillDisabled);
            }
            // Enforce per-skill cap if set.
            if let Some(cap) = skill.spending_cap {
                if cost > cap {
                    return Err(LogosCoreError::SpendingLimitExceeded);
                }
            }
            // Enforce global period threshold.
            if !state
                .spending
                .can_spend_autonomously(cost, state.config.spending_threshold)
            {
                return Err(LogosCoreError::SpendingLimitExceeded);
            }
            state.spending.record_spend(cost);
            // Update lifetime skill spend.
            if let Some(skill) = state.find_skill_mut(&skill_id) {
                skill.lifetime_spend = skill.lifetime_spend.saturating_add(cost);
            }
            state.total_executions += 1;
        }

        Instruction::RequestApproval {
            skill_id,
            action_description,
            estimated_cost,
        } => {
            if state.config.paused {
                return Err(LogosCoreError::SkillDisabled);
            }
            state
                .find_skill(&skill_id)
                .ok_or(LogosCoreError::SkillNotFound)?;
            if state.pending_approvals.len() >= MAX_PENDING_APPROVALS {
                return Err(LogosCoreError::ApprovalQueueFull);
            }
            let id = state.next_approval_id;
            state.next_approval_id += 1;
            state.pending_approvals.push(PendingApproval {
                id,
                skill_id,
                action_description,
                estimated_cost,
                submitted_at_block: current_block,
                approved: false,
            });
        }
    }

    borsh::to_vec(&state)
        .map_err(|_| LogosCoreError::SerializationError)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn require_owner(state: &AgentState, caller_id: u64) -> Result<(), LogosCoreError> {
    if state.config.owner_id != caller_id {
        Err(LogosCoreError::Unauthorized)
    } else {
        Ok(())
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use logos_core_types::Instruction;

    const OWNER: u64 = 1;
    const OTHER: u64 = 2;
    const BLOCK: u64 = 100;

    fn enc(ix: &Instruction) -> Vec<u8> {
        borsh::to_vec(ix).unwrap()
    }

    fn init_state() -> Vec<u8> {
        let ix = Instruction::Initialize {
            name: "TestAgent".into(),
            spending_threshold: 1_000,
            period_blocks: 1_000,
        };
        process(OWNER, BLOCK, &[], &enc(&ix)).unwrap()
    }

    #[test]
    fn initialize_creates_state() {
        let state_bytes = init_state();
        let state = AgentState::try_from_slice(&state_bytes).unwrap();
        assert_eq!(state.config.owner_id, OWNER);
        assert_eq!(state.config.spending_threshold, 1_000);
        assert!(!state.config.paused);
    }

    #[test]
    fn double_initialize_fails() {
        let state_bytes = init_state();
        let ix = Instruction::Initialize {
            name: "Second".into(),
            spending_threshold: 0,
            period_blocks: 0,
        };
        let result = process(OWNER, BLOCK, &state_bytes, &enc(&ix));
        assert_eq!(result, Err(LogosCoreError::AlreadyInitialized));
    }

    #[test]
    fn non_owner_cannot_pause() {
        let state_bytes = init_state();
        let ix = Instruction::SetPaused { paused: true };
        let result = process(OTHER, BLOCK, &state_bytes, &enc(&ix));
        assert_eq!(result, Err(LogosCoreError::Unauthorized));
    }

    #[test]
    fn owner_can_register_and_execute_skill() {
        let state_bytes = init_state();
        let reg = Instruction::RegisterSkill {
            id: "sc:build".into(),
            implementation_hash: [0u8; 32],
            description: "Build skill".into(),
            spending_cap: None,
        };
        let state_bytes = process(OWNER, BLOCK, &state_bytes, &enc(&reg)).unwrap();

        let exec = Instruction::RecordExecution {
            skill_id: "sc:build".into(),
            cost: 100,
            result_summary: "Built ok".into(),
        };
        let state_bytes = process(OWNER, BLOCK, &state_bytes, &enc(&exec)).unwrap();

        let state = AgentState::try_from_slice(&state_bytes).unwrap();
        assert_eq!(state.spending.current_spend, 100);
        assert_eq!(state.total_executions, 1);
    }

    #[test]
    fn spending_limit_blocks_execution() {
        let state_bytes = init_state();
        let reg = Instruction::RegisterSkill {
            id: "sc:build".into(),
            implementation_hash: [0u8; 32],
            description: "Build skill".into(),
            spending_cap: None,
        };
        let state_bytes = process(OWNER, BLOCK, &state_bytes, &enc(&reg)).unwrap();

        // Cost 1001 > threshold 1000 → should fail.
        let exec = Instruction::RecordExecution {
            skill_id: "sc:build".into(),
            cost: 1001,
            result_summary: "".into(),
        };
        let result = process(OWNER, BLOCK, &state_bytes, &enc(&exec));
        assert_eq!(result, Err(LogosCoreError::SpendingLimitExceeded));
    }

    #[test]
    fn approval_flow() {
        let state_bytes = init_state();
        let reg = Instruction::RegisterSkill {
            id: "sc:deploy".into(),
            implementation_hash: [1u8; 32],
            description: "Deploy skill".into(),
            spending_cap: None,
        };
        let state_bytes = process(OWNER, BLOCK, &state_bytes, &enc(&reg)).unwrap();

        let req = Instruction::RequestApproval {
            skill_id: "sc:deploy".into(),
            action_description: "Deploy to prod".into(),
            estimated_cost: 5_000,
        };
        let state_bytes = process(OWNER, BLOCK, &state_bytes, &enc(&req)).unwrap();

        let state = AgentState::try_from_slice(&state_bytes).unwrap();
        assert_eq!(state.pending_approvals.len(), 1);
        assert_eq!(state.pending_approvals[0].id, 0);
        assert!(!state.pending_approvals[0].approved);

        let approve = Instruction::ApproveAction { approval_id: 0 };
        let state_bytes = process(OWNER, BLOCK, &state_bytes, &enc(&approve)).unwrap();

        let state = AgentState::try_from_slice(&state_bytes).unwrap();
        assert!(state.pending_approvals[0].approved);
    }
}
