use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};

/// All instructions accepted by the Logos Core program.
#[derive(Debug, Clone, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub enum Instruction {
    // ── Lifecycle ──────────────────────────────────────────────────────────────

    /// Create and configure a new agent account.
    Initialize {
        /// Human-readable name for this agent.
        name: String,
        /// Per-period autonomous spending limit (native tokens).
        spending_threshold: u128,
        /// Period length in blocks (0 = no auto-reset).
        period_blocks: u64,
    },

    /// Pause / unpause all skill execution on this agent.
    SetPaused { paused: bool },

    /// Update the spending threshold (owner only).
    UpdateSpendingThreshold {
        new_threshold: u128,
        new_period_blocks: u64,
    },

    // ── Skill management ──────────────────────────────────────────────────────

    /// Register a new skill or update an existing one.
    RegisterSkill {
        id: String,
        /// SHA-256 of the skill bundle for integrity verification.
        implementation_hash: [u8; 32],
        description: String,
        /// Optional per-skill spending cap.
        spending_cap: Option<u128>,
    },

    /// Enable or disable an individual skill.
    SetSkillEnabled { skill_id: String, enabled: bool },

    /// Remove a skill from the registry entirely.
    RemoveSkill { skill_id: String },

    // ── Execution ─────────────────────────────────────────────────────────────

    /// Record that a skill executed and consumed `cost` tokens.
    /// The runtime calls this after successful off-chain execution.
    RecordExecution {
        skill_id: String,
        /// Actual cost incurred (native tokens).
        cost: u128,
        /// Short summary written to chain for auditability.
        result_summary: String,
    },

    // ── Approval flow ─────────────────────────────────────────────────────────

    /// Runtime submits a request for owner approval when cost > threshold.
    RequestApproval {
        skill_id: String,
        action_description: String,
        estimated_cost: u128,
    },

    /// Owner approves a pending request by its ID.
    ApproveAction { approval_id: u64 },

    /// Owner rejects and removes a pending approval request.
    RejectAction { approval_id: u64 },

    // ── Agent-to-Agent (A2A) ──────────────────────────────────────────────────

    /// Authorise another agent (by account ID) to call skills on this agent.
    AuthorizeAgent {
        agent_account_id: u64,
        /// List of skill IDs the remote agent is allowed to invoke.
        allowed_skills: Vec<String>,
    },

    /// Revoke a previously granted A2A authorisation.
    RevokeAgentAuthorization { agent_account_id: u64 },
}
