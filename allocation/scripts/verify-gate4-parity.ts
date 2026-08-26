import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readVaultAccountingFromArchive } from "../src/Effects.js";
import { validateAllocationCursor, type AllocationCursor } from "../src/gate4.js";

type FixtureEvent = {
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
  topLevelTransactionFrom: string;
  topLevelTransactionTo: string | null;
  topLevelInputSelector: string | null;
  strategyAddress: string | null;
  argsJson: string;
};

type FixtureCase = {
  id: string;
  chainId: number;
  vaultAddress: string;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: number;
  events: FixtureEvent[];
  accounting: {
    totalAssets: string;
    totalDebt: string;
    totalIdle: string;
    accountingIdentityHolds: boolean;
    canonicalBlockVerified: boolean;
  };
};

type AssignmentChangeReference = {
  sourceEventId: string;
  allocatorAddress: string;
  expected: {
    sourceEvent: FixtureEvent;
    assignment: Record<string, unknown>;
    unboundDeployment: Record<string, unknown>;
    boundDeploymentIds: string[];
    conflictIds: string[];
  };
};

type Fixture = {
  cases: FixtureCase[];
  assignmentChangeReference: AssignmentChangeReference;
};

type EventRecord = Record<string, unknown>;

const endpoint = process.env.ENVIO_ALLOCATION_GRAPHQL_URL;
const token = process.env.ENVIO_ALLOCATION_GRAPHQL_TOKEN;
const archiveRpc = process.env.ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM;
if (!endpoint || !archiveRpc) {
  console.log("Gate 4 deployed-candidate parity: NOT RUN (allocation GraphQL and archive RPC configuration are required)");
  process.exit(0);
}

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/ethereum/gate4-parity.json", import.meta.url), "utf8"),
) as Fixture;
const manifest = JSON.parse(
  readFileSync(new URL("../coverage/ethereum.json", import.meta.url), "utf8"),
) as { coverageRevision: string };

const eventFields = `
  id chainId vaultAddress sourceAddress sourceType eventName signature
  normalizationVersion abiVariant blockNumber blockTimestamp blockHash
  transactionHash transactionIndex logIndex topLevelTransactionFrom
  topLevelTransactionTo topLevelInputSelector strategyAddress argsJson
`;

const parityQuery = `
  query Gate4ParityCase($chainId: Int!, $vaultAddress: String!, $blockNumber: Int!) {
    AllocationSourceEvent(
      where: {
        chainId: { _eq: $chainId }
        vaultAddress: { _eq: $vaultAddress }
        blockNumber: { _eq: $blockNumber }
      }
      order_by: [
        { blockNumber: asc }
        { transactionIndex: asc }
        { logIndex: asc }
        { id: asc }
      ]
    ) { ${eventFields} }
    VaultAccountingCheckpoint(
      where: {
        chainId: { _eq: $chainId }
        vaultAddress: { _eq: $vaultAddress }
        blockNumber: { _eq: $blockNumber }
      }
      limit: 1
    ) {
      id blockNumber blockTimestamp blockHash totalAssets totalDebt totalIdle
      accountingIdentityHolds canonicalBlockVerified source sourceEventIds
    }
  }
`;

const initialPageQuery = `
  query AllocationEventsInitialPage($chainId: Int!, $vaultAddress: String!, $limit: Int!) {
    AllocationSourceEvent(
      where: {
        chainId: { _eq: $chainId }
        vaultAddress: { _eq: $vaultAddress }
      }
      order_by: [
        { blockNumber: asc }
        { transactionIndex: asc }
        { logIndex: asc }
        { id: asc }
      ]
      limit: $limit
    ) { ${eventFields} }
  }
`;

const continuationPageQuery = `
  query AllocationEventsContinuationPage(
    $chainId: Int!
    $vaultAddress: String!
    $limit: Int!
    $blockNumber: Int!
    $transactionIndex: Int!
    $logIndex: Int!
    $id: String!
  ) {
    AllocationSourceEvent(
      where: {
        chainId: { _eq: $chainId }
        vaultAddress: { _eq: $vaultAddress }
        _or: [
          { blockNumber: { _gt: $blockNumber } }
          {
            blockNumber: { _eq: $blockNumber }
            transactionIndex: { _gt: $transactionIndex }
          }
          {
            blockNumber: { _eq: $blockNumber }
            transactionIndex: { _eq: $transactionIndex }
            logIndex: { _gt: $logIndex }
          }
          {
            blockNumber: { _eq: $blockNumber }
            transactionIndex: { _eq: $transactionIndex }
            logIndex: { _eq: $logIndex }
            id: { _gt: $id }
          }
        ]
      }
      order_by: [
        { blockNumber: asc }
        { transactionIndex: asc }
        { logIndex: asc }
        { id: asc }
      ]
      limit: $limit
    ) { ${eventFields} }
  }
`;

const assignmentQuery = `
  query Gate4AssignmentParity($sourceEventId: ID!, $allocatorId: ID!) {
    sourceEvent: AllocationSourceEvent(where: { id: { _eq: $sourceEventId } }, limit: 1) {
      ${eventFields}
    }
    assignment: VaultDebtAllocatorAssignment(where: { id: { _eq: $sourceEventId } }, limit: 1) {
      id chainId vaultAddress allocatorAddress roleManagerAddress assignmentType
      implementationRecognition blockNumber blockTimestamp blockHash transactionHash
      transactionIndex logIndex sourceEventId
    }
    unboundDeployment: DebtAllocatorUnboundDeployment(where: { id: { _eq: $allocatorId } }, limit: 1) {
      id chainId allocatorAddress factoryAddress governanceAddress implementationRecognition
      abiVariant createdBlock createdTimestamp createdTransactionHash createdEventId
    }
    boundDeployment: DebtAllocatorDeployment(where: { id: { _eq: $allocatorId } }) { id }
    conflicts: DebtAllocatorAssignmentConflict(where: { sourceEventId: { _eq: $sourceEventId } }) { id }
  }
`;

const graphql = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Candidate GraphQL request failed with HTTP ${response.status}`);
  const body = await response.json() as { data?: T; errors?: unknown[] };
  if (body.errors || !body.data) throw new Error("Candidate GraphQL request returned errors");
  return body.data;
};

const candidateEvent = (event: EventRecord): FixtureEvent => ({
  id: String(event.id),
  chainId: Number(event.chainId),
  vaultAddress: String(event.vaultAddress),
  sourceAddress: String(event.sourceAddress),
  sourceType: String(event.sourceType),
  eventName: String(event.eventName),
  signature: String(event.signature),
  normalizationVersion: Number(event.normalizationVersion),
  abiVariant: event.abiVariant === null || event.abiVariant === undefined ? null : String(event.abiVariant),
  blockNumber: Number(event.blockNumber),
  blockTimestamp: Number(event.blockTimestamp),
  blockHash: String(event.blockHash),
  transactionHash: String(event.transactionHash),
  transactionIndex: Number(event.transactionIndex),
  logIndex: Number(event.logIndex),
  topLevelTransactionFrom: String(event.topLevelTransactionFrom),
  topLevelTransactionTo: event.topLevelTransactionTo === null || event.topLevelTransactionTo === undefined
    ? null
    : String(event.topLevelTransactionTo),
  topLevelInputSelector: event.topLevelInputSelector === null || event.topLevelInputSelector === undefined
    ? null
    : String(event.topLevelInputSelector),
  strategyAddress: event.strategyAddress === null || event.strategyAddress === undefined
    ? null
    : String(event.strategyAddress),
  argsJson: String(event.argsJson),
});

const cursorFor = (event: FixtureEvent): AllocationCursor => validateAllocationCursor({
  v: 1,
  chainId: event.chainId,
  vaultAddress: event.vaultAddress,
  coverageRevision: manifest.coverageRevision,
  blockNumber: event.blockNumber,
  transactionIndex: event.transactionIndex,
  logIndex: event.logIndex,
  id: event.id,
}, {
  chainId: event.chainId,
  vaultAddress: event.vaultAddress,
  coverageRevision: manifest.coverageRevision,
});

const cursorVariables = (cursor: AllocationCursor, limit: number) => ({
  chainId: cursor.chainId,
  vaultAddress: cursor.vaultAddress,
  limit,
  blockNumber: cursor.blockNumber,
  transactionIndex: cursor.transactionIndex,
  logIndex: cursor.logIndex,
  id: cursor.id,
});

try {
  for (const parityCase of fixture.cases) {
    const candidate = await graphql<{
      AllocationSourceEvent: EventRecord[];
      VaultAccountingCheckpoint: Array<Record<string, unknown>>;
    }>(parityQuery, {
      chainId: parityCase.chainId,
      vaultAddress: parityCase.vaultAddress,
      blockNumber: parityCase.blockNumber,
    });
    assert.deepEqual(candidate.AllocationSourceEvent.map(candidateEvent), parityCase.events);

    assert.equal(candidate.VaultAccountingCheckpoint.length, 1);
    assert.deepEqual(candidate.VaultAccountingCheckpoint[0], {
      id: `${parityCase.chainId}:${parityCase.vaultAddress}:${parityCase.blockNumber}`,
      blockNumber: parityCase.blockNumber,
      blockTimestamp: String(parityCase.blockTimestamp),
      blockHash: parityCase.blockHash,
      totalAssets: parityCase.accounting.totalAssets,
      totalDebt: parityCase.accounting.totalDebt,
      totalIdle: parityCase.accounting.totalIdle,
      accountingIdentityHolds: parityCase.accounting.accountingIdentityHolds,
      canonicalBlockVerified: true,
      source: "archive-rpc-effect",
      sourceEventIds: parityCase.events.map(({ id }) => id),
    });

    const archive = await readVaultAccountingFromArchive(
      parityCase.chainId,
      parityCase.vaultAddress,
      parityCase.blockNumber,
      parityCase.blockHash,
    );
    assert.deepEqual({
      totalAssets: archive.totalAssets.toString(),
      totalDebt: archive.totalDebt.toString(),
      totalIdle: archive.totalIdle.toString(),
      accountingIdentityHolds: archive.totalAssets === archive.totalDebt + archive.totalIdle,
      canonicalBlockVerified: archive.canonicalBlockVerified,
    }, parityCase.accounting);
  }

  const assignmentReference = fixture.assignmentChangeReference;
  const assignment = await graphql<{
    sourceEvent: EventRecord[];
    assignment: Array<Record<string, unknown>>;
    unboundDeployment: Array<Record<string, unknown>>;
    boundDeployment: Array<{ id: string }>;
    conflicts: Array<{ id: string }>;
  }>(assignmentQuery, {
    sourceEventId: assignmentReference.sourceEventId,
    allocatorId: `1:${assignmentReference.allocatorAddress}`,
  });
  assert.deepEqual(assignment.sourceEvent.map(candidateEvent), [assignmentReference.expected.sourceEvent]);
  assert.deepEqual(assignment.assignment, [assignmentReference.expected.assignment]);
  assert.deepEqual(assignment.unboundDeployment, [assignmentReference.expected.unboundDeployment]);
  assert.deepEqual(assignment.boundDeployment.map(({ id }) => id), assignmentReference.expected.boundDeploymentIds);
  assert.deepEqual(assignment.conflicts.map(({ id }) => id), assignmentReference.expected.conflictIds);

  const yvWeth = fixture.cases.find(({ id }) => id === "yvweth-1-multi-strategy-debt-update")!;
  const firstPage = await graphql<{ AllocationSourceEvent: EventRecord[] }>(initialPageQuery, {
    chainId: yvWeth.chainId,
    vaultAddress: yvWeth.vaultAddress,
    limit: 2,
  });
  assert.equal(firstPage.AllocationSourceEvent.length, 2);
  const firstPageEvents = firstPage.AllocationSourceEvent.map(candidateEvent);
  const secondPage = await graphql<{ AllocationSourceEvent: EventRecord[] }>(
    continuationPageQuery,
    cursorVariables(cursorFor(firstPageEvents[1]!), 2),
  );
  const controlPage = await graphql<{ AllocationSourceEvent: EventRecord[] }>(initialPageQuery, {
    chainId: yvWeth.chainId,
    vaultAddress: yvWeth.vaultAddress,
    limit: 4,
  });
  assert.deepEqual(
    [...firstPageEvents, ...secondPage.AllocationSourceEvent.map(candidateEvent)],
    controlPage.AllocationSourceEvent.map(candidateEvent),
  );

  const sameTransactionContinuation = await graphql<{ AllocationSourceEvent: EventRecord[] }>(
    continuationPageQuery,
    cursorVariables(cursorFor(yvWeth.events[1]!), 2),
  );
  assert.deepEqual(sameTransactionContinuation.AllocationSourceEvent.map(candidateEvent), yvWeth.events.slice(2));

  console.log(`Gate 4 deployed-candidate parity: PASS (${fixture.cases.length} exact blocks, assignment provenance, cursor pages)`);
} catch {
  console.error("Gate 4 deployed-candidate parity: FAILED (credentials and endpoint details suppressed)");
  process.exit(1);
}
