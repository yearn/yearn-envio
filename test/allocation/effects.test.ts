import { describe, expect, it, vi } from "vitest";
import { executeVaultAccountingRead } from "../../src/allocation/Effects.js";

const input = {
  vaultAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  blockNumber: 123,
  expectedBlockHash: `0x${"b".repeat(64)}`,
};

describe("Gate 3 archive RPC Effect", () => {
  it("keeps successful canonical reads cacheable", async () => {
    const context = { cache: true, chain: { id: 1 } };
    const read = vi.fn().mockResolvedValue({
      totalAssets: 12n,
      totalDebt: 7n,
      totalIdle: 5n,
      canonicalBlockVerified: true as const,
    });
    await expect(executeVaultAccountingRead(context, input, read)).resolves.toEqual(
      expect.objectContaining({ totalAssets: 12n }),
    );
    expect(context.cache).toBe(true);
    expect(read).toHaveBeenCalledWith(1, input.vaultAddress, input.blockNumber, input.expectedBlockHash);
  });

  it("disables caching and throws after final failure", async () => {
    const context = { cache: true, chain: { id: 1 } };
    const read = vi.fn().mockRejectedValue(new Error("contract reverted"));
    await expect(executeVaultAccountingRead(context, input, read)).rejects.toThrow("contract reverted");
    expect(context.cache).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
