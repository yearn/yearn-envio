import { createTestIndexer } from "envio";
import { describe, expect, it, vi } from "vitest";
import { writeAccountingCheckpoint } from "../src/EventHandlers.js";

const VAULT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BLOCK_HASH = `0x${"b".repeat(64)}`;
const TX_HASH = `0x${"c".repeat(64)}`;

const event = (transactionIndex: number, logIndex: number) => ({
  chainId: 1,
  srcAddress: VAULT,
  block: { number: 123, timestamp: 1_700_000_123, hash: BLOCK_HASH },
  transaction: { hash: TX_HASH, transactionIndex },
  logIndex,
});

describe("Gate 3 checkpoint handler", () => {
  it("records official factory provenance as the checkpoint support boundary", async () => {
    const testIndexer = createTestIndexer();
    await testIndexer.process({
      chains: {
        1: {
          simulate: [{
            contract: "YearnV3VaultFactory",
            event: "NewVault",
            srcAddress: "0x770D0d1Fb036483Ed4AbB6d53c1C88fb277D812F",
            logIndex: 1,
            block: { number: 123, timestamp: 1_700_000_123, hash: BLOCK_HASH },
            transaction: { hash: TX_HASH, transactionIndex: 0 },
            params: { vault_address: VAULT, asset: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
          }],
        },
      },
    });
    expect(await testIndexer.VaultAccountingSupport.getAll()).toEqual([
      expect.objectContaining({
        id: `1:${VAULT}`,
        vaultAddress: VAULT,
        factoryAddress: "0x770d0d1fb036483ed4abb6d53c1c88fb277d812f",
        apiVersion: "3.0.4",
      }),
    ]);
  });

  it("merges multiple same-block triggers into one deterministically ordered checkpoint", async () => {
    let triggerSet: { id: string; triggersJson: string } | undefined;
    let checkpoint: Record<string, unknown> | undefined;
    const context = {
      effect: vi.fn().mockResolvedValue({
        totalAssets: 12n,
        totalDebt: 7n,
        totalIdle: 5n,
        canonicalBlockVerified: true,
      }),
      VaultAccountingCheckpointTriggerSet: {
        get: vi.fn(async () => triggerSet),
        set: vi.fn((value) => {
          triggerSet = value;
        }),
      },
      VaultAccountingSupport: {
        get: vi.fn().mockResolvedValue({ id: `1:${VAULT}` }),
      },
      VaultAccountingCheckpoint: {
        set: vi.fn((value) => {
          checkpoint = value;
        }),
      },
    };

    await writeAccountingCheckpoint(event(1, 3), context);
    await writeAccountingCheckpoint(event(0, 9), context);
    await writeAccountingCheckpoint(event(1, 3), context);

    expect(context.VaultAccountingCheckpoint.set).toHaveBeenCalledTimes(3);
    expect(checkpoint).toEqual(
      expect.objectContaining({
        id: `1:${VAULT}:123`,
        totalAssets: 12n,
        totalDebt: 7n,
        totalIdle: 5n,
        accountingIdentityHolds: true,
        canonicalBlockVerified: true,
        source: "archive-rpc-effect",
        sourceEventIds: [`1:${TX_HASH}:9`, `1:${TX_HASH}:3`],
      }),
    );
    expect(context.effect).toHaveBeenCalledWith(
      expect.anything(),
      { vaultAddress: VAULT, blockNumber: 123, expectedBlockHash: BLOCK_HASH },
    );
  });

  it("does not certify checkpoints for vaults without official factory provenance", async () => {
    const context = {
      effect: vi.fn(),
      VaultAccountingSupport: { get: vi.fn().mockResolvedValue(undefined) },
      VaultAccountingCheckpointTriggerSet: { get: vi.fn(), set: vi.fn() },
      VaultAccountingCheckpoint: { set: vi.fn() },
    };
    await writeAccountingCheckpoint(event(0, 1), context);
    expect(context.effect).not.toHaveBeenCalled();
    expect(context.VaultAccountingCheckpoint.set).not.toHaveBeenCalled();
  });

  it("keeps normalized events for unsupported custom vaults without calling the archive Effect", async () => {
    const testIndexer = createTestIndexer();
    await testIndexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "YearnV3Registry",
              event: "NewEndorsedVault",
              srcAddress: "0xff31A1B020c868F6eA3f61Eb953344920EeCA3af",
              logIndex: 1,
              block: { number: 123, timestamp: 1_700_000_123, hash: BLOCK_HASH },
              transaction: { hash: `0x${"d".repeat(64)}` as `0x${string}`, transactionIndex: 0 },
              params: {
                vault: VAULT,
                asset: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                releaseVersion: 1n,
                vaultType: 1n,
              },
            },
            {
              contract: "YearnV3Vault",
              event: "Deposit",
              srcAddress: VAULT,
              logIndex: 2,
              block: { number: 124, timestamp: 1_700_000_124, hash: BLOCK_HASH },
              transaction: { hash: TX_HASH, transactionIndex: 0 },
              params: { sender: VAULT, owner: VAULT, assets: 10n, shares: 10n },
            },
          ],
        },
      },
    });
    expect(await testIndexer.AllocationSourceEvent.getAll()).toEqual([
      expect.objectContaining({ vaultAddress: VAULT, eventName: "Deposit" }),
    ]);
    expect(await testIndexer.VaultAccountingCheckpoint.getAll()).toEqual([]);
  });
});
