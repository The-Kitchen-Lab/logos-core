pub mod instruction;
pub mod state;
pub mod error;

pub use instruction::Instruction;
pub use state::{AgentConfig, AgentState, PendingApproval, SkillEntry, SpendingPeriod,
    MAX_PENDING_APPROVALS, MAX_SKILLS};
pub use error::LogosCoreError;

use sha2::{Sha256, Digest};

/// Domain separator for PDA seed derivation — unique per version.
pub const AGENT_SEED_DOMAIN: &[u8; 32] = b"/LEZ/v0.1/LogosCore/Agent/000000";

/// Compute deterministic PDA seed for an agent owned by `owner_id`.
pub fn compute_agent_seed(owner_id: u64) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(AGENT_SEED_DOMAIN);
    h.update(owner_id.to_le_bytes());
    h.finalize().into()
}
