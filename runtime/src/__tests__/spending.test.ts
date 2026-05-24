import { SpendingTracker } from "../lez/spending.js";

describe("SpendingTracker", () => {
  test("allows spending within threshold", () => {
    const t = new SpendingTracker(1000n, 0);
    expect(t.canSpend(500n)).toBe(true);
    expect(t.canSpend(1000n)).toBe(true);
  });

  test("blocks spending above threshold", () => {
    const t = new SpendingTracker(100n, 0);
    expect(t.canSpend(101n)).toBe(false);
  });

  test("blocks after cumulative spend exceeds threshold", () => {
    const t = new SpendingTracker(100n, 0);
    t.record(80n);
    expect(t.canSpend(21n)).toBe(false);
    expect(t.canSpend(20n)).toBe(true);
  });

  test("remaining decreases after record", () => {
    const t = new SpendingTracker(100n, 0);
    expect(t.remaining).toBe(100n);
    t.record(40n);
    expect(t.remaining).toBe(60n);
    expect(t.spent).toBe(40n);
  });

  test("remaining never goes below zero", () => {
    const t = new SpendingTracker(50n, 0);
    t.record(50n);
    expect(t.remaining).toBe(0n);
  });

  test("zero threshold blocks all spending", () => {
    const t = new SpendingTracker(0n, 0);
    expect(t.canSpend(1n)).toBe(false);
    expect(t.canSpend(0n)).toBe(true);
  });

  test("resets after period elapses", async () => {
    const t = new SpendingTracker(100n, 50); // 50ms period
    t.record(100n);
    expect(t.canSpend(1n)).toBe(false);

    await new Promise((r) => setTimeout(r, 60));
    expect(t.canSpend(100n)).toBe(true);
    expect(t.spent).toBe(0n);
  });

  test("no reset when periodMs is 0", async () => {
    const t = new SpendingTracker(100n, 0);
    t.record(100n);
    await new Promise((r) => setTimeout(r, 20));
    expect(t.canSpend(1n)).toBe(false);
  });
});
