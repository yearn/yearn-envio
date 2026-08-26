import { describe, expect, it, vi } from "vitest";
import {
  CanonicalBlockMismatchError,
  UnsupportedHistoricalStateError,
  accountingIdentityHolds,
  checkpointId,
  checkpointSourceEventIds,
  mergeCheckpointTriggers,
  readCanonicalVaultAccounting,
  sanitizeArchiveRpcError,
  withTransientRpcRetry,
} from "../src/checkpoints.js";
import { HttpRequestError } from "viem";

const HASH = `0x${"a".repeat(64)}`;
const OTHER_HASH = `0x${"b".repeat(64)}`;
const VAULT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const totals = { totalAssets: 12n, totalDebt: 7n, totalIdle: 5n };

describe("Gate 3 checkpoint core", () => {
  it("builds the canonical checkpoint identity", () => {
    expect(checkpointId(1, VAULT.toUpperCase(), 123)).toBe(`1:${VAULT}:123`);
  });

  it("sorts same-block triggers by transaction index, log index, and id while deduplicating", () => {
    const merged = [
      { id: "z", transactionIndex: 2, logIndex: 0 },
      { id: "b", transactionIndex: 1, logIndex: 3 },
      { id: "a", transactionIndex: 1, logIndex: 3 },
      { id: "ignored", transactionIndex: 9, logIndex: 9 },
    ].reduce(
      (current, trigger) => mergeCheckpointTriggers(current, trigger),
      [{ id: "ignored", transactionIndex: 9, logIndex: 9 }],
    );
    expect(checkpointSourceEventIds(merged)).toEqual(["a", "b", "z", "ignored"]);
  });

  it("accepts hash-pinned reads without a second block lookup", async () => {
    const dependencies = {
      getBlockHash: vi.fn().mockResolvedValue(HASH),
      readHashPinned: vi.fn().mockResolvedValue(totals),
      readAtBlockNumber: vi.fn(),
      isHashPinnedUnsupportedError: vi.fn(),
    };
    await expect(readCanonicalVaultAccounting(dependencies, VAULT, 123, HASH)).resolves.toEqual({
      ...totals,
      canonicalBlockVerified: true,
    });
    expect(dependencies.getBlockHash).toHaveBeenCalledTimes(1);
    expect(dependencies.readAtBlockNumber).not.toHaveBeenCalled();
  });

  it("falls back to block-number reads and verifies the hash again", async () => {
    const dependencies = {
      getBlockHash: vi.fn().mockResolvedValue(HASH),
      readHashPinned: vi.fn().mockRejectedValue(new Error("invalid argument 1: blockHash object unsupported")),
      readAtBlockNumber: vi.fn().mockResolvedValue(totals),
      isHashPinnedUnsupportedError: vi.fn().mockReturnValue(true),
    };
    await expect(readCanonicalVaultAccounting(dependencies, VAULT, 123, HASH)).resolves.toEqual({
      ...totals,
      canonicalBlockVerified: true,
    });
    expect(dependencies.getBlockHash).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the canonical hash changes", async () => {
    const dependencies = {
      getBlockHash: vi.fn().mockResolvedValueOnce(HASH).mockResolvedValueOnce(OTHER_HASH),
      readHashPinned: vi.fn().mockRejectedValue(new Error("unsupported blockHash object")),
      readAtBlockNumber: vi.fn().mockResolvedValue(totals),
      isHashPinnedUnsupportedError: vi.fn().mockReturnValue(true),
    };
    await expect(readCanonicalVaultAccounting(dependencies, VAULT, 123, HASH)).rejects.toBeInstanceOf(
      CanonicalBlockMismatchError,
    );
  });

  it("retries transient failures three total times with capped full-jitter delays", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("HTTP 503 network error"));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(withTransientRpcRetry(operation, { random: () => 0.5, sleep })).rejects.toThrow("503");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[250], [500]]);
  });

  it("does not retry unsupported historical state", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("missing trie node"));
    await expect(withTransientRpcRetry(operation)).rejects.toBeInstanceOf(UnsupportedHistoricalStateError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("removes RPC URLs and request bodies from transport failures", () => {
    const error = new HttpRequestError({
      body: { method: "eth_call" },
      url: "https://secret-rpc.example/token",
      status: 503,
    });
    const sanitized = sanitizeArchiveRpcError(error);
    expect(sanitized.message).toBe("Transient archive RPC request failed");
    expect(String(sanitized)).not.toContain("secret-rpc");
    expect(sanitized).not.toHaveProperty("cause");
  });

  it("persists the accounting identity result without changing totals", () => {
    expect(accountingIdentityHolds(totals)).toBe(true);
    expect(accountingIdentityHolds({ ...totals, totalAssets: 13n })).toBe(false);
  });
});
