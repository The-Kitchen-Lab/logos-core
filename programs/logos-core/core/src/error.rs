use borsh::{BorshDeserialize, BorshSerialize};

#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
#[borsh(use_discriminant = true)]
#[repr(u32)]
pub enum LogosCoreError {
    /// Caller is not the agent owner.
    Unauthorized = 1,
    /// Skill is not registered on this agent.
    SkillNotFound = 2,
    /// Skill is currently disabled by the owner.
    SkillDisabled = 3,
    /// Requested spend exceeds the per-period threshold — owner approval required.
    SpendingLimitExceeded = 4,
    /// Approval record not found or already consumed.
    ApprovalNotFound = 5,
    /// Action has already been approved or executed.
    AlreadyProcessed = 6,
    /// Serialization / deserialization failure.
    SerializationError = 7,
    /// Agent has already been initialized.
    AlreadyInitialized = 8,
    /// Pending approvals queue is full.
    ApprovalQueueFull = 9,
}
