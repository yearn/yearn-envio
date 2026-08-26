import { readFileSync } from "node:fs";
import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";

type FixtureEvent = {
  contract: string;
  event: string;
  srcAddress: `0x${string}`;
  logIndex: number;
  block: { number: number; timestamp: number; hash: `0x${string}` };
  transaction: {
    hash: `0x${string}`;
    transactionIndex: number;
    from: `0x${string}`;
    to: `0x${string}`;
    input: `0x${string}`;
  };
  params: Record<string, string>;
};

type Gate2Fixture = {
  historicalReplay: FixtureEvent[];
  expected: {
    deploymentCount: number;
    unboundDeploymentCount: number;
    assignmentCount: number;
    knownAllocatorEventCount: number;
    assignmentRecognitions: string[];
    unresolvedAssociationCount: number;
    conflictCount: number;
  };
};

const fixture = JSON.parse(
  readFileSync(new URL("../../fixtures/allocation/ethereum/gate2.json", import.meta.url), "utf8"),
) as Gate2Fixture;

const simulationEvent = (event: FixtureEvent) => {
  const params = { ...event.params } as Record<string, string | bigint>;
  for (const key of ["category", "newTargetRatio", "newMaxRatio", "newTotalDebtRatio"]) {
    if (params[key] !== undefined) params[key] = BigInt(params[key]);
  }
  return { ...event, params };
};

const processEvents = async (
  testIndexer: ReturnType<typeof createTestIndexer>,
  events: FixtureEvent[],
) => {
  await testIndexer.process({
    chains: { 1: { simulate: events.map(simulationEvent) } },
    // The fixture is schema-validated by Envio at runtime. Its discriminants originate in JSON.
  } as Parameters<typeof testIndexer.process>[0]);
};

const stableEntities = (entities: readonly { id: string }[]) =>
  JSON.parse(JSON.stringify([...entities].sort((left, right) => left.id.localeCompare(right.id)), (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  ));

const snapshot = async (testIndexer: ReturnType<typeof createTestIndexer>) => ({
  sourceEvents: stableEntities(await testIndexer.AllocationSourceEvent.getAll()),
  deployments: stableEntities(await testIndexer.DebtAllocatorDeployment.getAll()),
  unboundDeployments: stableEntities(await testIndexer.DebtAllocatorUnboundDeployment.getAll()),
  assignments: stableEntities(await testIndexer.VaultDebtAllocatorAssignment.getAll()),
  memberships: stableEntities(await testIndexer.VaultRoleManagerMembership.getAll()),
  conflicts: stableEntities(await testIndexer.DebtAllocatorAssignmentConflict.getAll()),
  pending: stableEntities(await testIndexer.DebtAllocatorPendingEventBuffer.getAll()),
});

describe("Gate 2 exact Ethereum fixture", () => {
  it("replays real provenance, assignments, and allocator target events", async () => {
    const testIndexer = createTestIndexer();
    await processEvents(testIndexer, fixture.historicalReplay);

    const deployments = await testIndexer.DebtAllocatorDeployment.getAll();
    const unboundDeployments = await testIndexer.DebtAllocatorUnboundDeployment.getAll();
    const assignments = await testIndexer.VaultDebtAllocatorAssignment.getAll();
    const targetEvents = await testIndexer.AllocationSourceEvent.getWhere({
      eventName: { _eq: "UpdateStrategyDebtRatio" },
    });

    expect(deployments).toHaveLength(fixture.expected.deploymentCount);
    expect(unboundDeployments).toHaveLength(fixture.expected.unboundDeploymentCount);
    expect(assignments).toHaveLength(fixture.expected.assignmentCount);
    expect(targetEvents).toHaveLength(fixture.expected.knownAllocatorEventCount);
    expect(assignments.map(({ implementationRecognition }) => implementationRecognition)).toEqual(
      fixture.expected.assignmentRecognitions,
    );
    expect(targetEvents).toEqual([
      expect.objectContaining({
        vaultAddress: "0xbe53a109b494e5c9f97b9cd39fe969be68bf6204",
        argsJson: '{"strategy":"0xbdb97ec319c41c6fa383e94ece6bdf383dfc7be4","newTargetRatio":"2000","newMaxRatio":"2400","newTotalDebtRatio":"2000"}',
      }),
      expect.objectContaining({
        vaultAddress: "0xbe53a109b494e5c9f97b9cd39fe969be68bf6204",
        argsJson: '{"strategy":"0x7ee351aa702c8fc735d77fb229b7676ac15d7c79","newTargetRatio":"8000","newMaxRatio":"9600","newTotalDebtRatio":"10000"}',
      }),
    ]);
    expect(await testIndexer.DebtAllocatorPendingEventBuffer.getAll()).toHaveLength(
      fixture.expected.unresolvedAssociationCount,
    );
    expect(await testIndexer.DebtAllocatorAssignmentConflict.getAll()).toHaveLength(
      fixture.expected.conflictCount,
    );
  });

  it("produces the same state for full replay and incremental continuation", async () => {
    const full = createTestIndexer();
    const repeatedFull = createTestIndexer();
    const incremental = createTestIndexer();
    const cutoff = 2;

    await processEvents(full, fixture.historicalReplay);
    await processEvents(repeatedFull, fixture.historicalReplay);
    await processEvents(incremental, fixture.historicalReplay.slice(0, cutoff));
    await processEvents(incremental, fixture.historicalReplay.slice(cutoff));
    expect(await snapshot(incremental)).toEqual(await snapshot(full));
    expect(await snapshot(repeatedFull)).toEqual(await snapshot(full));
  });
});
