import { createTestIndexer } from "envio";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";

const rawStrategy = "0x1234567890abcdef1234567890abcdef12345678";
const rawAsset = "0xabcdef1234567890abcdef1234567890abcdef12";
const strategy = getAddress(rawStrategy);
const asset = getAddress(rawAsset);
const sender = getAddress("0x1111111111111111111111111111111111111111");
const factory = "0xE9E8C89c8Fc7E8b8F23425688eb68987231178e5";
const vault = "0x2222222222222222222222222222222222222222";
const block = {
  number: 30_000_000,
  timestamp: 1_788_000_000,
  hash: `0x${"ab".repeat(32)}`,
};
const transaction = { hash: `0x${"cd".repeat(32)}`, transactionIndex: 3, from: sender };
const provenance = {
  blockNumber: block.number,
  blockTimestamp: block.timestamp,
  blockHash: block.hash,
  transactionHash: transaction.hash,
  transactionIndex: transaction.transactionIndex,
  transactionFrom: sender,
};
const deployment = {
  contract: "YearnV3Strategy",
  event: "NewTokenizedStrategy",
  srcAddress: rawStrategy,
  params: { strategy, asset: rawAsset, apiVersion: "3.0.4" },
  block,
  transaction,
  logIndex: 0,
} as const;
const report = {
  contract: "YearnV3Strategy",
  event: "Reported",
  srcAddress: strategy,
  params: { profit: 100n, loss: 2n, protocolFees: 3n, performanceFees: 4n },
  block,
  transaction,
  logIndex: 1,
} as const;
const shutdown = {
  contract: "YearnV3Strategy",
  event: "StrategyShutdown",
  srcAddress: strategy,
  block: { ...block, number: block.number + 1 },
  transaction,
  logIndex: 2,
} as const;

describe("tokenized strategy lifecycle routing", () => {
  it.each(createTestIndexer().chainIds)(
    "discovers a standalone strategy and tracks its lifecycle on chain %i",
    async (chainId) => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: { [chainId]: { simulate: [deployment, report, shutdown] } },
      });

      expect(await indexer.V3TokenizedStrategyDeployed.getAll()).toEqual([{
        ...provenance,
        id: `${chainId}_${block.number}_0`,
        chainId,
        logIndex: 0,
        strategyAddress: strategy,
        strategy,
        asset,
        apiVersion: "3.0.4",
      }]);
      expect(await indexer.V3StrategyReported.getAll()).toEqual([{
        ...provenance,
        id: `${chainId}_${block.number}_1`,
        chainId,
        logIndex: 1,
        strategyAddress: strategy,
        ...report.params,
      }]);
      expect(await indexer.V3StrategyShutdown.getAll()).toEqual([{
        ...provenance,
        id: `${chainId}_${block.number + 1}_2`,
        chainId,
        blockNumber: block.number + 1,
        logIndex: 2,
        strategyAddress: strategy,
      }]);
    },
  );

  it("preserves factory-to-vault strategy discovery, reporting, and shutdowns", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "YearnV3VaultFactory",
              event: "NewVault",
              srcAddress: factory,
              params: { vault_address: vault, asset },
              block,
              logIndex: 0,
            },
            {
              contract: "YearnV3Vault",
              event: "StrategyChanged",
              srcAddress: vault,
              params: { strategy, change_type: 1n },
              block,
              logIndex: 1,
            },
            { ...report, logIndex: 2 },
            shutdown,
          ],
        },
      },
    });

    expect(await indexer.V3VaultFactoryNewVault.getAll()).toHaveLength(1);
    expect(await indexer.StrategyChanged.getAll()).toHaveLength(1);
    expect(await indexer.V3TokenizedStrategyDeployed.getAll()).toEqual([]);
    expect(await indexer.V3StrategyReported.getAll()).toHaveLength(1);
    expect(await indexer.V3StrategyShutdown.getAll()).toHaveLength(1);
  });

  it("does not record or register a strategy named by a different emitter", async () => {
    const indexer = createTestIndexer();
    await expect(indexer.process({
      chains: {
        1: {
          simulate: [
            { ...deployment, srcAddress: sender },
            shutdown,
            { ...shutdown, srcAddress: sender, logIndex: 3 },
          ],
        },
      },
    })).rejects.toThrow("never reached a handler");
    expect(await indexer.V3TokenizedStrategyDeployed.getAll()).toEqual([]);
    expect(await indexer.V3StrategyShutdown.getAll()).toEqual([]);
  });

  it.each([report, shutdown])("keeps $event restricted to discovered strategies", async (event) => {
    const indexer = createTestIndexer();
    await expect(indexer.process({
      chains: { 1: { simulate: [event] } },
    })).rejects.toThrow("never reached a handler");
    expect(await indexer.V3StrategyReported.getAll()).toEqual([]);
    expect(await indexer.V3StrategyShutdown.getAll()).toEqual([]);
  });
});
