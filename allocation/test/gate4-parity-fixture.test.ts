import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allocationEventId } from "../../src/allocation/normalization.js";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/ethereum/gate4-parity.json", import.meta.url), "utf8"),
) as {
  schemaVersion: number;
  cases: Array<{
    id: string;
    vaultAddress: string;
    blockNumber: number;
    blockHash: string;
    requirements: string[];
    events: Array<{
      id: string;
      chainId: number;
      vaultAddress: string;
      sourceAddress: string;
      sourceType: string;
      eventName: string;
      signature: string;
      normalizationVersion: number;
      abiVariant: string | null;
      blockNumber: number;
      blockTimestamp: number;
      blockHash: string;
      transactionHash: string;
      transactionIndex: number;
      logIndex: number;
      argsJson: string;
    }>;
    accounting: {
      totalAssets: string;
      totalDebt: string;
      totalIdle: string;
      accountingIdentityHolds: boolean;
      canonicalBlockVerified: boolean;
    };
    strategyStates: Array<{ strategyAddress: string; currentDebt: string }>;
    strategyDebtSum: string;
    strategyDebtMatchesTotalDebt: boolean;
    outsideAllocatorTargetEvidence: null | {
      strategyAddress: string;
      matchingEventCount: number;
    };
  }>;
  assignmentChangeReference: {
    fixture: string;
    vaultAddress: string;
    blockNumber: number;
    blockHash: string;
    sourceEventId: string;
    allocatorAddress: string;
    expected: {
      sourceEvent: { id: string; eventName: string; vaultAddress: string };
      assignment: {
        id: string;
        allocatorAddress: string;
        implementationRecognition: string;
        assignmentType: string;
      };
      unboundDeployment: {
        id: string;
        allocatorAddress: string;
        implementationRecognition: string;
      };
      boundDeploymentIds: string[];
      conflictIds: string[];
    };
  };
};
const gate2 = JSON.parse(
  readFileSync(new URL("../fixtures/ethereum/gate2.json", import.meta.url), "utf8"),
) as { historicalReplay: Array<{ event: string; block: { number: number; hash: string }; params: Record<string, string>; logIndex: number; transaction: { hash: string } }> };

describe("Gate 4 exact Ethereum parity fixtures", () => {
  it("pins deterministic event ordering, IDs, and canonical accounting for every block", () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.cases).toHaveLength(3);
    for (const parityCase of fixture.cases) {
      expect(parityCase.blockHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(parityCase.accounting.canonicalBlockVerified).toBe(true);
      expect(parityCase.accounting.accountingIdentityHolds).toBe(true);
      expect(BigInt(parityCase.accounting.totalAssets)).toBe(
        BigInt(parityCase.accounting.totalDebt) + BigInt(parityCase.accounting.totalIdle),
      );
      expect(parityCase.strategyDebtMatchesTotalDebt).toBe(true);
      expect(BigInt(parityCase.strategyDebtSum)).toBe(BigInt(parityCase.accounting.totalDebt));
      expect(parityCase.events).toEqual([...parityCase.events].sort(
        (left, right) => left.transactionIndex - right.transactionIndex || left.logIndex - right.logIndex || left.id.localeCompare(right.id),
      ));
      for (const event of parityCase.events) {
        expect(event.id).toBe(allocationEventId(1, event.transactionHash, event.logIndex));
        expect(event.chainId).toBe(1);
        expect(event.vaultAddress).toBe(parityCase.vaultAddress);
        expect(event.sourceAddress).toBe(parityCase.vaultAddress);
        expect(event.sourceType).toBe("vault");
        expect(event.normalizationVersion).toBe(1);
        expect(event.blockNumber).toBe(parityCase.blockNumber);
        expect(event.blockHash).toBe(parityCase.blockHash);
        expect(event.signature).toMatch(/^0x[0-9a-f]{64}$/);
        expect(JSON.parse(event.argsJson)).toBeTypeOf("object");
      }
    }
  });

  it("covers the required yvWETH multi-strategy and idle-changing block", () => {
    const value = fixture.cases.find(({ id }) => id === "yvweth-1-multi-strategy-debt-update")!;
    expect(value.vaultAddress).toBe("0xc56413869c6cdf96496f2b1ef801fedbdfa7ddb0");
    expect(value.requirements).toEqual(expect.arrayContaining([
      "yvWETH-1",
      "multiple-strategies",
      "multiple-relevant-events",
      "withdraw",
      "idle-change",
    ]));
    expect(value.events.map(({ eventName }) => eventName)).toEqual([
      "DebtUpdated",
      "DebtUpdated",
      "DebtUpdated",
      "Withdraw",
    ]);
    expect(value.strategyStates.filter(({ currentDebt }) => BigInt(currentDebt) > 0n)).toHaveLength(2);
  });

  it("keeps the positive-debt yvUSDC strategy even with no allocator target", () => {
    const value = fixture.cases.find(({ id }) => id === "yvusdc-1-outside-optimizer-loss-report")!;
    const evidence = value.outsideAllocatorTargetEvidence!;
    const state = value.strategyStates.find(({ strategyAddress }) => strategyAddress === evidence.strategyAddress)!;
    const report = JSON.parse(value.events[0]!.argsJson) as { loss: string; strategy: string };
    expect(value.requirements).toEqual(expect.arrayContaining(["yvUSDC-1", "outside-optimizer-strategy", "loss-sensitive-report"]));
    expect(evidence.matchingEventCount).toBe(0);
    expect(BigInt(state.currentDebt)).toBeGreaterThan(0n);
    expect(report.strategy).toBe(evidence.strategyAddress);
    expect(BigInt(report.loss)).toBeGreaterThan(0n);
  });

  it("pins a yvUSDC deposit whose block-end accounting is entirely idle", () => {
    const value = fixture.cases.find(({ id }) => id === "yvusdc-1-deposit-idle-change")!;
    expect(value.events.map(({ eventName }) => eventName)).toEqual(["Deposit"]);
    expect(value.accounting.totalDebt).toBe("0");
    expect(value.accounting.totalIdle).toBe(value.accounting.totalAssets);
  });

  it("references the exact committed allocator assignment-change fixture", () => {
    const reference = fixture.assignmentChangeReference;
    const event = gate2.historicalReplay.find((candidate) =>
      candidate.event === "UpdateDebtAllocator" &&
      candidate.block.number === reference.blockNumber &&
      candidate.params.vault === reference.vaultAddress
    )!;
    expect(reference.fixture).toBe("gate2.json");
    expect(event.block.hash).toBe(reference.blockHash);
    expect(allocationEventId(1, event.transaction.hash, event.logIndex)).toBe(reference.sourceEventId);
    expect(reference.expected.sourceEvent).toEqual(expect.objectContaining({
      id: reference.sourceEventId,
      eventName: "UpdateDebtAllocator",
      vaultAddress: reference.vaultAddress,
    }));
    expect(reference.expected.assignment).toEqual(expect.objectContaining({
      id: reference.sourceEventId,
      allocatorAddress: reference.allocatorAddress,
      implementationRecognition: "other",
      assignmentType: "updated",
    }));
    expect(reference.expected.unboundDeployment).toEqual(expect.objectContaining({
      id: `1:${reference.allocatorAddress}`,
      allocatorAddress: reference.allocatorAddress,
      implementationRecognition: "other",
    }));
    expect(reference.expected.boundDeploymentIds).toEqual([]);
    expect(reference.expected.conflictIds).toEqual([]);
  });
});
