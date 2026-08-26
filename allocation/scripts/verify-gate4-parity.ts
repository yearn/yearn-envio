import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { readVaultAccountingFromArchive } from "../src/Effects.js";

type FixtureEvent = {
  id: string;
  eventName: string;
  signature: string;
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

const endpoint = process.env.ENVIO_ALLOCATION_GRAPHQL_URL;
const token = process.env.ENVIO_ALLOCATION_GRAPHQL_TOKEN;
const archiveRpc = process.env.ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM;
if (!endpoint || !archiveRpc) {
  console.log("Gate 4 deployed-candidate parity: NOT RUN (allocation GraphQL and archive RPC configuration are required)");
  process.exit(0);
}

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/ethereum/gate4-parity.json", import.meta.url), "utf8"),
) as { cases: FixtureCase[] };

const query = `
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
    ) {
      id eventName signature blockNumber blockTimestamp blockHash
      transactionHash transactionIndex logIndex
      topLevelTransactionFrom topLevelTransactionTo topLevelInputSelector
      strategyAddress argsJson
    }
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

const request = async (parityCase: FixtureCase) => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      query,
      variables: {
        chainId: parityCase.chainId,
        vaultAddress: parityCase.vaultAddress,
        blockNumber: parityCase.blockNumber,
      },
    }),
  });
  if (!response.ok) throw new Error(`Candidate GraphQL request failed with HTTP ${response.status}`);
  const body = await response.json() as {
    data?: {
      AllocationSourceEvent: Array<Record<string, unknown>>;
      VaultAccountingCheckpoint: Array<Record<string, unknown>>;
    };
    errors?: unknown[];
  };
  if (body.errors || !body.data) throw new Error("Candidate GraphQL request returned errors");
  return body.data;
};

try {
  for (const parityCase of fixture.cases) {
    const candidate = await request(parityCase);
    const candidateEvents = candidate.AllocationSourceEvent.map((event) => ({
      id: event.id,
      eventName: event.eventName,
      signature: event.signature,
      transactionHash: event.transactionHash,
      transactionIndex: event.transactionIndex,
      logIndex: event.logIndex,
      topLevelTransactionFrom: event.topLevelTransactionFrom,
      topLevelTransactionTo: event.topLevelTransactionTo ?? null,
      topLevelInputSelector: event.topLevelInputSelector ?? null,
      strategyAddress: event.strategyAddress ?? null,
      argsJson: event.argsJson,
    }));
    assert.deepEqual(candidateEvents, parityCase.events.map((event) => ({
      id: event.id,
      eventName: event.eventName,
      signature: event.signature,
      transactionHash: event.transactionHash,
      transactionIndex: event.transactionIndex,
      logIndex: event.logIndex,
      topLevelTransactionFrom: event.topLevelTransactionFrom,
      topLevelTransactionTo: event.topLevelTransactionTo,
      topLevelInputSelector: event.topLevelInputSelector,
      strategyAddress: event.strategyAddress,
      argsJson: event.argsJson,
    })));

    assert.equal(candidate.VaultAccountingCheckpoint.length, 1);
    const checkpoint = candidate.VaultAccountingCheckpoint[0]!;
    assert.deepEqual(checkpoint, {
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
  console.log(`Gate 4 deployed-candidate parity: PASS (${fixture.cases.length} exact blocks)`);
} catch {
  console.error("Gate 4 deployed-candidate parity: FAILED (credentials and endpoint details suppressed)");
  process.exit(1);
}
