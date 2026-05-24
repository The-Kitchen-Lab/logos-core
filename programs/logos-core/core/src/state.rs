use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};

/// Maximum number of skills that can be registered on a single agent.
pub const MAX_SKILLS: usize = 64;
/// Maximum number of pending owner-approval requests.
pub const MAX_PENDING_APPROVALS: usize = 16;
/// Maximum byte length of a skill identifier string.
pub const MAX_SKILL_ID_LEN: usize = 64;
/// Maximum byte length of a human-readable label / description.
pub const MAX_LABEL_LEN: usize = 128;

// ──────────────────────────────────────────────────────────────────────────────
// Skill registry entry
// ──────────────────────────────────────────────────────────────────────────────

/// A skill registered on an agent.
#[derive(Debug, Clone, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct SkillEntry {
    /// Short identifier, e.g. "sc:build", "sc:test", "sc:analyze".
    pub id: String,
    /// SHA-256 hash of the skill implementation (for integrity verification).
    pub implementation_hash: [u8; 32],
    /// Human-readable description of what this skill does.
    pub description: String,
    /// Whether the owner has enabled this skill.
    pub enabled: bool,
    /// Optional per-skill spending cap (native tokens). None = no extra cap.
    pub spending_cap: Option<u128>,
    /// Total lifetime spend attributed to this skill.
    pub lifetime_spend: u128,
}

// ──────────────────────────────────────────────────────────────────────────────
// Spending period tracker
// ──────────────────────────────────────────────────────────────────────────────

/// Tracks autonomous spending within a rolling period.
#[derive(Debug, Clone, Default, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct SpendingPeriod {
    /// Cumulative spend in the current period (native token units).
    pub current_spend: u128,
    /// Block height at which the current period started.
    pub period_start_block: u64,
    /// Period length in blocks (set at initialization; 0 = single-period).
    pub period_blocks: u64,
}

impl SpendingPeriod {
    /// Returns `true` if `amount` can be spent autonomously given the threshold.
    pub fn can_spend_autonomously(&self, amount: u128, threshold: u128) -> bool {
        self.current_spend.saturating_add(amount) <= threshold
    }

    /// Record a spend. Caller is responsible for checking the limit first.
    pub fn record_spend(&mut self, amount: u128) {
        self.current_spend = self.current_spend.saturating_add(amount);
    }

    /// Reset if the current block has passed the period boundary.
    pub fn maybe_reset(&mut self, current_block: u64) {
        if self.period_blocks > 0
            && current_block >= self.period_start_block + self.period_blocks
        {
            self.current_spend = 0;
            self.period_start_block = current_block;
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Pending approval record
// ──────────────────────────────────────────────────────────────────────────────

/// Represents an action that requires owner approval before execution.
#[derive(Debug, Clone, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct PendingApproval {
    /// Monotonically increasing ID assigned at request time.
    pub id: u64,
    /// Skill that requested approval.
    pub skill_id: String,
    /// Human-readable description of the action requiring approval.
    pub action_description: String,
    /// Estimated cost in native tokens.
    pub estimated_cost: u128,
    /// Block height at which this request was submitted.
    pub submitted_at_block: u64,
    /// Whether it has been explicitly approved (true) or is still pending (false).
    pub approved: bool,
}

// ──────────────────────────────────────────────────────────────────────────────
// Top-level agent configuration (stored on-chain)
// ──────────────────────────────────────────────────────────────────────────────

/// Immutable-ish configuration set at initialization.
#[derive(Debug, Clone, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct AgentConfig {
    /// The account ID of the human owner.
    pub owner_id: u64,
    /// Spending threshold per period in native tokens.
    /// Autonomous actions above this require explicit owner approval.
    pub spending_threshold: u128,
    /// Whether the agent is paused (all skill execution blocked).
    pub paused: bool,
    /// Human-readable name for this agent instance.
    pub name: String,
}

/// Full mutable state stored in the agent's on-chain account.
#[derive(Debug, Clone, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct AgentState {
    pub config: AgentConfig,
    pub spending: SpendingPeriod,
    /// Registered skills.
    pub skills: Vec<SkillEntry>,
    /// Pending approval requests awaiting owner sign-off.
    pub pending_approvals: Vec<PendingApproval>,
    /// Next approval ID (monotonically increasing counter).
    pub next_approval_id: u64,
    /// Total number of skill executions (for analytics / on-chain record).
    pub total_executions: u64,
    /// Monotonic nonce of the last SendMessage instruction — replay protection.
    pub last_message_nonce: u64,
    /// Total number of messages sent by this agent via Logos Messaging.
    pub total_messages_sent: u64,
}

impl AgentState {
    pub fn find_skill(&self, id: &str) -> Option<&SkillEntry> {
        self.skills.iter().find(|s| s.id == id)
    }

    pub fn find_skill_mut(&mut self, id: &str) -> Option<&mut SkillEntry> {
        self.skills.iter_mut().find(|s| s.id == id)
    }

    pub fn find_approval(&self, id: u64) -> Option<&PendingApproval> {
        self.pending_approvals.iter().find(|a| a.id == id)
    }
}
