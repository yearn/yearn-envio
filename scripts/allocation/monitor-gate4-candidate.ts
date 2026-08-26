import { readFileSync } from "node:fs";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const endpoint = process.env.ENVIO_ALLOCATION_GRAPHQL_URL;
const token = process.env.ENVIO_ALLOCATION_GRAPHQL_TOKEN;
const rpcUrl = process.env.ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM;
if (!endpoint || !rpcUrl) {
  console.log("Gate 4 candidate monitor: NOT RUN (allocation GraphQL and archive RPC configuration are required)");
  process.exit(0);
}

const manifest = JSON.parse(
  readFileSync(new URL("../../coverage/allocation/ethereum.json", import.meta.url), "utf8"),
) as { coverageRevision: string; entries: Array<{ safeForTimeline: boolean }> };
const fixture = JSON.parse(
  readFileSync(new URL("../../fixtures/allocation/ethereum/gate4-parity.json", import.meta.url), "utf8"),
) as {
  cases: Array<{
    id: string;
    chainId: number;
    vaultAddress: string;
    blockNumber: number;
    blockHash: string;
    accounting: { totalAssets: string; totalDebt: string; totalIdle: string };
  }>;
};
const canary = fixture.cases.find(({ id }) => id === "yvusdc-1-deposit-idle-change")!;
const tolerance = Number(process.env.ENVIO_ALLOCATION_SYNC_BLOCK_TOLERANCE ?? 20);
if (!Number.isSafeInteger(tolerance) || tolerance < 0) throw new Error("Invalid allocation sync block tolerance");

const query = `
  query Gate4CandidateHealth($revision: String!, $canaryId: ID!) {
    chain_metadata {
      chain_id latest_processed_block latest_fetched_block_number
      num_events_processed timestamp_caught_up_to_head_or_endblock
    }
    VaultAllocationCoverage(
      where: { coverageRevision: { _eq: $revision } }
      order_by: [{ chainId: asc }, { vaultAddress: asc }]
    ) { id safeForTimeline }
    latestEvent: AllocationSourceEvent(
      order_by: [{ blockNumber: desc }, { transactionIndex: desc }, { logIndex: desc }, { id: desc }]
      limit: 1
    ) { id blockNumber blockTimestamp }
    latestCheckpoint: VaultAccountingCheckpoint(
      order_by: [{ blockNumber: desc }]
      limit: 1
    ) { id blockNumber blockTimestamp canonicalBlockVerified }
    unresolvedCheckpointFailures: VaultAccountingCheckpointFailure(
      where: { chainId: { _eq: 1 }, resolved: { _eq: false } }
      limit: 1
    ) { id blockNumber vaultAddress reason }
    canaryCheckpoint: VaultAccountingCheckpoint(where: { id: { _eq: $canaryId } }, limit: 1) {
      id blockNumber blockHash totalAssets totalDebt totalIdle canonicalBlockVerified
    }
  }
`;

try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      query,
      variables: {
        revision: manifest.coverageRevision,
        canaryId: `${canary.chainId}:${canary.vaultAddress}:${canary.blockNumber}`,
      },
    }),
  });
  if (!response.ok) throw new Error(`Candidate GraphQL request failed with HTTP ${response.status}`);
  const body = await response.json() as {
    data?: {
      chain_metadata: Array<Record<string, unknown>>;
      VaultAllocationCoverage: Array<{ id: string; safeForTimeline: boolean }>;
      latestEvent: Array<{ id: string; blockNumber: number; blockTimestamp: string }>;
      latestCheckpoint: Array<{ id: string; blockNumber: number; blockTimestamp: string; canonicalBlockVerified: boolean }>;
      unresolvedCheckpointFailures: Array<{ id: string; blockNumber: number; vaultAddress: string; reason: string }>;
      canaryCheckpoint: Array<Record<string, unknown>>;
    };
    errors?: unknown[];
  };
  if (body.errors || !body.data) throw new Error("Candidate GraphQL request returned errors");

  const metadata = body.data.chain_metadata.find((row) => row.chain_id === 1);
  if (!metadata) throw new Error("Candidate has no Ethereum chain metadata");
  const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl, { retryCount: 2, timeout: 20_000 }) });
  const rpcHead = Number(await client.getBlockNumber());
  const processedBlock = Number(metadata.latest_processed_block ?? 0);
  const blocksBehind = Math.max(0, rpcHead - processedBlock);
  const coverageRows = body.data.VaultAllocationCoverage;
  const expectedSafeRows = manifest.entries.filter(({ safeForTimeline }) => safeForTimeline).length;
  const observedSafeRows = coverageRows.filter(({ safeForTimeline }) => safeForTimeline).length;
  const observedCanary = body.data.canaryCheckpoint[0];
  const expectedCanary = {
    id: `${canary.chainId}:${canary.vaultAddress}:${canary.blockNumber}`,
    blockNumber: canary.blockNumber,
    blockHash: canary.blockHash,
    totalAssets: canary.accounting.totalAssets,
    totalDebt: canary.accounting.totalDebt,
    totalIdle: canary.accounting.totalIdle,
    canonicalBlockVerified: true,
  };
  const checks = {
    syncReady: blocksBehind <= tolerance,
    coverageRevisionComplete: coverageRows.length === manifest.entries.length,
    safeRowCountMatchesManifest: observedSafeRows === expectedSafeRows,
    noUnresolvedCheckpointFailures: body.data.unresolvedCheckpointFailures.length === 0,
    semanticCanaryMatches: JSON.stringify(observedCanary) === JSON.stringify(expectedCanary),
  };
  const ready = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({
    status: ready ? "ready" : "not_ready",
    observedAt: new Date().toISOString(),
    coverageRevision: manifest.coverageRevision,
    checks,
    sync: { rpcHead, processedBlock, blocksBehind, tolerance },
    coverage: { expectedRows: manifest.entries.length, observedRows: coverageRows.length, expectedSafeRows, observedSafeRows },
    latestEvent: body.data.latestEvent[0] ?? null,
    latestCheckpoint: body.data.latestCheckpoint[0] ?? null,
    unresolvedCheckpointFailure: body.data.unresolvedCheckpointFailures[0] ?? null,
  }, null, 2));
  if (!ready) process.exit(1);
} catch {
  console.error("Gate 4 candidate monitor: FAILED (credentials and endpoint details suppressed)");
  process.exit(1);
}
