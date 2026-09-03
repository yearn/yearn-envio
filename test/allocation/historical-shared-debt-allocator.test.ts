import { readFileSync } from "node:fs";
import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";

type Fixture = {
  chainId: number;
  factory: {
    address: `0x${string}`;
    firstDeployment: {
      allocator: `0x${string}`;
      governance: `0x${string}`;
      blockNumber: number;
      blockTimestamp: number;
      transactionHash: `0x${string}`;
      transactionIndex: number;
      logIndex: number;
    };
  };
  logs: Array<{
    address: `0x${string}`;
    blockNumber: number;
    blockTimestamp: number;
    blockHash: `0x${string}`;
    transactionHash: `0x${string}`;
    transactionIndex: number;
    transactionFrom: `0x${string}`;
    transactionTo: `0x${string}`;
    inputSelector: `0x${string}`;
    logIndex: number;
    expected: {
      vault: `0x${string}`;
      strategy: `0x${string}`;
      newTargetRatio: string;
      newMaxRatio: string;
      newTotalDebtRatio: string;
    };
  }>;
};

const fixture = JSON.parse(
  readFileSync(
    new URL("../../fixtures/allocation/ethereum/shared-debt-allocator.json", import.meta.url),
    "utf8",
  ),
) as Fixture;

const factoryEvent = {
  contract: "SharedDebtAllocatorFactory" as const,
  event: "NewDebtAllocator" as const,
  srcAddress: fixture.factory.address,
  logIndex: fixture.factory.firstDeployment.logIndex,
  block: {
    number: fixture.factory.firstDeployment.blockNumber,
    timestamp: fixture.factory.firstDeployment.blockTimestamp,
    hash: `0x${"1".repeat(64)}` as const,
  },
  transaction: {
    hash: fixture.factory.firstDeployment.transactionHash,
    transactionIndex: fixture.factory.firstDeployment.transactionIndex,
    from: fixture.factory.firstDeployment.governance,
    to: fixture.factory.address,
    input: "0x28d34c90",
  },
  params: {
    allocator: fixture.factory.firstDeployment.allocator,
    governance: fixture.factory.firstDeployment.governance,
  },
};

const ratioEvents = fixture.logs.map((log) => ({
  contract: "SharedDebtAllocator" as const,
  event: "UpdateStrategyDebtRatio" as const,
  srcAddress: log.address,
  logIndex: log.logIndex,
  block: {
    number: log.blockNumber,
    timestamp: log.blockTimestamp,
    hash: log.blockHash,
  },
  transaction: {
    hash: log.transactionHash,
    transactionIndex: log.transactionIndex,
    from: log.transactionFrom,
    to: log.transactionTo,
    input: log.inputSelector,
  },
  params: {
    vault: log.expected.vault,
    strategy: log.expected.strategy,
    newTargetRatio: BigInt(log.expected.newTargetRatio),
    newMaxRatio: BigInt(log.expected.newMaxRatio),
    newTotalDebtRatio: BigInt(log.expected.newTotalDebtRatio),
  },
}));

const processEvents = async (
  testIndexer: ReturnType<typeof createTestIndexer>,
  events: Array<typeof factoryEvent | (typeof ratioEvents)[number]>,
) => {
  await testIndexer.process({ chains: { 1: { simulate: events } } });
};

const stable = (values: readonly { id: string }[]) =>
  JSON.parse(
    JSON.stringify(
      [...values].sort((left, right) => left.id.localeCompare(right.id)),
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    ),
  );

const snapshot = async (testIndexer: ReturnType<typeof createTestIndexer>) => ({
  normalized: stable(await testIndexer.AllocationSourceEvent.getAll()),
  raw: stable(await testIndexer.SharedUpdateStrategyDebtRatio.getAll()),
  deployments: stable(await testIndexer.SharedDebtAllocatorDeployment.getAll()),
  unresolved: stable(await testIndexer.UnresolvedAllocationSourceEvent.getAll()),
});

describe("shared allocator real-log replay fixture", () => {
  it("normalizes real fixtures deterministically with unique IDs", async () => {
    const full = createTestIndexer();
    const reverseInput = createTestIndexer();

    await processEvents(full, [factoryEvent, ...ratioEvents]);
    await processEvents(reverseInput, [factoryEvent, ...[...ratioEvents].reverse()]);

    expect(await snapshot(reverseInput)).toEqual(await snapshot(full));
    const normalized = await full.AllocationSourceEvent.getAll();
    expect(normalized).toHaveLength(3);
    expect(new Set(normalized.map(({ id }) => id)).size).toBe(3);
    expect(normalized.every(({ scope }) => scope === "vault")).toBe(true);
    expect(new Set(normalized.map(({ vaultAddress }) => vaultAddress))).toEqual(
      new Set(fixture.logs.map(({ expected }) => expected.vault)),
    );
    expect(await full.UnresolvedAllocationSourceEvent.getAll()).toEqual([]);
  });
});
