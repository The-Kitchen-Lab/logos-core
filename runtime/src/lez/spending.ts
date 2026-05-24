/**
 * Off-chain spending tracker — mirrors the on-chain SpendingPeriod state so
 * the runtime can pre-check limits before submitting transactions.
 *
 * The source of truth is always on-chain; this is a best-effort cache to
 * avoid unnecessary round-trips and wasted gas.
 */

export class SpendingTracker {
  private currentSpend = 0n;
  private periodStartMs: number;

  constructor(
    private readonly threshold: bigint,
    private readonly periodMs: number // 0 = no auto-reset
  ) {
    this.periodStartMs = Date.now();
  }

  /** Returns true if the cost can be spent autonomously. */
  canSpend(cost: bigint): boolean {
    this.maybeReset();
    return this.currentSpend + cost <= this.threshold;
  }

  /** Record a spend (call after successful on-chain RecordExecution). */
  record(cost: bigint): void {
    this.maybeReset();
    this.currentSpend += cost;
  }

  get remaining(): bigint {
    this.maybeReset();
    return this.threshold > this.currentSpend
      ? this.threshold - this.currentSpend
      : 0n;
  }

  get spent(): bigint {
    return this.currentSpend;
  }

  private maybeReset(): void {
    if (this.periodMs <= 0) return;
    if (Date.now() - this.periodStartMs >= this.periodMs) {
      this.currentSpend = 0n;
      this.periodStartMs = Date.now();
    }
  }
}
