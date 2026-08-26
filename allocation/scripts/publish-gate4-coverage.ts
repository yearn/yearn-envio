import { readFileSync } from "node:fs";
import { coverageEntityRows, validateCoverageManifest, type CoverageManifest } from "../src/gate4.js";

type CoverageRow = {
  id: string;
  chainId: number;
  vaultAddress: string;
  coverageStartBlock: number;
  coverageStartBlockHash: string;
  validatedThroughBlock: number;
  validatedThroughBlockHash: string;
  vaultDiscoveryComplete: boolean;
  eventHistoryComplete: boolean;
  allocatorDeploymentHistoryComplete: boolean;
  allocatorAssignmentHistoryComplete: boolean;
  checkpointTriggerAuditComplete: boolean;
  safeForTimeline: boolean;
  knownGapsJson: string;
  coverageRevision: string;
  producerCommit: string;
  validatedAt: string;
};

type CoverageRowsFile = {
  manifestVersion: number;
  coverageRevision: string;
  rows: CoverageRow[];
};

const publish = process.argv.includes("--publish");
const endpoint = process.env.ENVIO_ALLOCATION_GRAPHQL_URL;
const token = process.env.ENVIO_ALLOCATION_GRAPHQL_TOKEN;
const input = JSON.parse(
  readFileSync(new URL("../coverage/ethereum.entities.json", import.meta.url), "utf8"),
) as CoverageRowsFile;
const manifest = validateCoverageManifest(
  JSON.parse(readFileSync(new URL("../coverage/ethereum.json", import.meta.url), "utf8")) as CoverageManifest,
);
if (
  input.coverageRevision !== manifest.coverageRevision ||
  JSON.stringify(input.rows) !== JSON.stringify(coverageEntityRows(manifest))
) {
  throw new Error("Generated coverage rows are stale; run coverage:generate before publication");
}

if (!publish) {
  console.log(`Gate 4 coverage publication: DRY RUN (${input.rows.length} rows, revision ${input.coverageRevision}, 0 writes)`);
  process.exit(0);
}
if (!endpoint) throw new Error("ENVIO_ALLOCATION_GRAPHQL_URL is required for --publish");

const request = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Allocation GraphQL request failed with HTTP ${response.status}`);
  const body = await response.json() as { data?: T; errors?: unknown[] };
  if (body.errors || !body.data) throw new Error("Allocation GraphQL request returned errors");
  return body.data;
};

const fields = `
  id chainId vaultAddress coverageStartBlock coverageStartBlockHash
  validatedThroughBlock validatedThroughBlockHash vaultDiscoveryComplete
  eventHistoryComplete allocatorDeploymentHistoryComplete
  allocatorAssignmentHistoryComplete checkpointTriggerAuditComplete
  safeForTimeline knownGapsJson coverageRevision producerCommit validatedAt
`;
const existing = await request<{ VaultAllocationCoverage: CoverageRow[] }>(`
  query ExistingCoverageRevision($revision: String!) {
    VaultAllocationCoverage(
      where: { coverageRevision: { _eq: $revision } }
      order_by: [{ chainId: asc }, { vaultAddress: asc }]
    ) { ${fields} }
  }
`, { revision: input.coverageRevision });

const canonicalRows = (rows: CoverageRow[]): string => JSON.stringify(
  [...rows].sort((left, right) => left.chainId - right.chainId || left.vaultAddress.localeCompare(right.vaultAddress)),
);
if (existing.VaultAllocationCoverage.length > 0) {
  if (canonicalRows(existing.VaultAllocationCoverage) !== canonicalRows(input.rows)) {
    throw new Error("Published coverage revision conflicts with the checked-in immutable revision");
  }
  console.log(`Gate 4 coverage publication: ALREADY PRESENT (${input.rows.length} exact rows, revision ${input.coverageRevision})`);
  process.exit(0);
}

const mutation = `
  mutation PublishCoverageRevision($objects: [VaultAllocationCoverage_insert_input!]!) {
    insert_VaultAllocationCoverage(objects: $objects) { affected_rows }
  }
`;
const result = await request<{ insert_VaultAllocationCoverage: { affected_rows: number } }>(
  mutation,
  { objects: input.rows },
);
const affectedRows = result.insert_VaultAllocationCoverage.affected_rows;
if (affectedRows !== input.rows.length) throw new Error("Coverage publication inserted an unexpected row count");
console.log(`Gate 4 coverage publication: PASS (${affectedRows} rows, revision ${input.coverageRevision})`);
