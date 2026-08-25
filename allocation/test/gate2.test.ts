import { describe, expect, it } from "vitest";
import {
  assertImmutableDeployment,
  deploymentConflictsWithAssignment,
  mergePendingEvent,
  parsePendingEvents,
  recognizeImplementation,
  type PendingAllocatorEvent,
} from "../src/gate2.js";

const VAULT_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const VAULT_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const pendingEvent = (
  id: string,
  blockNumber: number,
  transactionIndex: number,
  logIndex: number,
): PendingAllocatorEvent => ({
  id,
  sourceAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
  eventName: "UpdateKeeper",
  signature: `0x${"1".repeat(64)}`,
  normalizationVersion: 1,
  blockNumber,
  blockTimestamp: "1700000000",
  blockHash: `0x${"2".repeat(64)}`,
  transactionHash: `0x${"3".repeat(64)}`,
  transactionIndex,
  logIndex,
  argsJson: '{"keeper":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","allowed":true}',
});

describe("allocator implementation recognition", () => {
  it("distinguishes a factory-recognized deployment from an unknown assignee", () => {
    expect(recognizeImplementation({ id: "1:allocator", vaultAddress: VAULT_A })).toBe("knownGenericAllocator");
    expect(recognizeImplementation(undefined)).toBe("unknown");
  });

  it("surfaces a deployment and assignment vault disagreement", () => {
    const deployment = { id: "1:allocator", vaultAddress: VAULT_A };
    expect(deploymentConflictsWithAssignment(deployment, VAULT_A)).toBe(false);
    expect(deploymentConflictsWithAssignment(deployment, VAULT_B)).toBe(true);
    expect(deploymentConflictsWithAssignment(undefined, VAULT_B)).toBe(false);
  });

  it("accepts an idempotent deployment and rejects an immutable binding change", () => {
    const deployment = {
      id: "1:allocator",
      vaultAddress: VAULT_A,
      factoryAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
      createdBlock: 100,
    };
    expect(() => assertImmutableDeployment(undefined, deployment)).not.toThrow();
    expect(() => assertImmutableDeployment(deployment, deployment)).not.toThrow();
    expect(() => assertImmutableDeployment(deployment, { ...deployment, vaultAddress: VAULT_B })).toThrow(
      "Conflicting immutable debt allocator deployment 1:allocator",
    );
    expect(() => assertImmutableDeployment(deployment, { ...deployment, createdBlock: 101 })).toThrow(
      "Conflicting immutable debt allocator deployment 1:allocator",
    );
  });
});

describe("same-block allocator event deferral", () => {
  it("orders pending events deterministically and deduplicates reprocessing", () => {
    const later = pendingEvent("1:0xbbb:9", 100, 2, 9);
    const earlier = pendingEvent("1:0xaaa:4", 100, 1, 4);
    const firstMerge = mergePendingEvent(undefined, later);
    const orderedMerge = mergePendingEvent(firstMerge, earlier);
    const replayedMerge = mergePendingEvent(orderedMerge, earlier);

    expect(parsePendingEvents(replayedMerge).map(({ id }) => id)).toEqual([earlier.id, later.id]);
    expect(replayedMerge).toBe(orderedMerge);
  });

  it("rejects malformed persisted buffer data", () => {
    expect(() => parsePendingEvents("{}")).toThrow("Debt allocator pending event buffer must contain an array");
  });
});
