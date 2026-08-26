export const COVERAGE_MANIFEST_VERSION = 1 as const;
export const ALLOCATION_CURSOR_VERSION = 1 as const;
export const DEFAULT_PAGE_SIZE = 500;
export const MAX_PAGE_SIZE = 2_000;

const addressPattern = /^0x[0-9a-f]{40}$/;
const hashPattern = /^0x[0-9a-f]{64}$/;
const commitPattern = /^[0-9a-f]{40}$/;

export type CoverageGap = {
  code: string;
  detail: string;
};

export type CoverageEntry = {
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
  knownGaps: CoverageGap[];
  vaultDeploymentBlock: number;
  discoveryBlock: number;
  firstRequiredEventBlock: number | null;
  allocatorHistoryStartBlock: number | null;
  apiVersion: string;
  runtimeCodeHash: string;
  earliestSafeTimelineBlock: number | null;
};

export type CoverageExclusion = {
  chainId: number;
  vaultAddress: string;
  discoveryBlock: number;
  apiVersion: string;
  runtimeCodeHash: string;
  reason: string;
};

export type CoverageManifest = {
  manifestVersion: typeof COVERAGE_MANIFEST_VERSION;
  coverageRevision: string;
  producerCommit: string;
  validatedAt: number;
  entries: CoverageEntry[];
  exclusions: CoverageExclusion[];
};

export type AllocationCursor = {
  v: typeof ALLOCATION_CURSOR_VERSION;
  chainId: number;
  vaultAddress: string;
  coverageRevision: string;
  blockNumber: number;
  transactionIndex: number;
  logIndex: number;
  id: string;
};

function assertNonNegativeInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${field} must be a non-negative integer`);
}

const assertLowercaseAddress = (value: string, field: string): void => {
  if (!addressPattern.test(value)) throw new Error(`${field} must be a lowercase address`);
};

const assertHash = (value: string, field: string): void => {
  if (!hashPattern.test(value)) throw new Error(`${field} must be a lowercase 32-byte hash`);
};

export const coverageId = (revision: string, chainId: number, vaultAddress: string): string =>
  `${revision}:${chainId}:${vaultAddress}`;

export const validateCoverageManifest = (manifest: CoverageManifest): CoverageManifest => {
  if (manifest.manifestVersion !== COVERAGE_MANIFEST_VERSION) throw new Error("Unsupported coverage manifest version");
  if (!manifest.coverageRevision) throw new Error("coverageRevision is required");
  if (!commitPattern.test(manifest.producerCommit)) throw new Error("producerCommit must be a full lowercase git SHA");
  assertNonNegativeInteger(manifest.validatedAt, "validatedAt");

  const ids = new Set<string>();
  for (const entry of manifest.entries) {
    assertNonNegativeInteger(entry.chainId, "chainId");
    assertLowercaseAddress(entry.vaultAddress, "vaultAddress");
    assertNonNegativeInteger(entry.coverageStartBlock, "coverageStartBlock");
    assertHash(entry.coverageStartBlockHash, "coverageStartBlockHash");
    assertNonNegativeInteger(entry.validatedThroughBlock, "validatedThroughBlock");
    assertHash(entry.validatedThroughBlockHash, "validatedThroughBlockHash");
    assertNonNegativeInteger(entry.vaultDeploymentBlock, "vaultDeploymentBlock");
    assertNonNegativeInteger(entry.discoveryBlock, "discoveryBlock");
    if (entry.firstRequiredEventBlock !== null) assertNonNegativeInteger(entry.firstRequiredEventBlock, "firstRequiredEventBlock");
    if (entry.allocatorHistoryStartBlock !== null) assertNonNegativeInteger(entry.allocatorHistoryStartBlock, "allocatorHistoryStartBlock");
    if (entry.earliestSafeTimelineBlock !== null) assertNonNegativeInteger(entry.earliestSafeTimelineBlock, "earliestSafeTimelineBlock");
    assertHash(entry.runtimeCodeHash, "runtimeCodeHash");
    if (entry.coverageStartBlock > entry.validatedThroughBlock) throw new Error("Coverage range is inverted");

    const id = coverageId(manifest.coverageRevision, entry.chainId, entry.vaultAddress);
    if (ids.has(id)) throw new Error(`Duplicate coverage entry ${id}`);
    ids.add(id);

    const completeness = [
      entry.vaultDiscoveryComplete,
      entry.eventHistoryComplete,
      entry.allocatorDeploymentHistoryComplete,
      entry.allocatorAssignmentHistoryComplete,
      entry.checkpointTriggerAuditComplete,
    ];
    if (entry.safeForTimeline && (!completeness.every(Boolean) || entry.knownGaps.length > 0)) {
      throw new Error(`Unsafe timeline certification for ${id}`);
    }
    if (entry.safeForTimeline && entry.earliestSafeTimelineBlock === null) {
      throw new Error(`Safe coverage requires earliestSafeTimelineBlock for ${id}`);
    }
  }
  for (const exclusion of manifest.exclusions) {
    assertNonNegativeInteger(exclusion.chainId, "exclusion.chainId");
    assertLowercaseAddress(exclusion.vaultAddress, "exclusion.vaultAddress");
    assertNonNegativeInteger(exclusion.discoveryBlock, "exclusion.discoveryBlock");
    assertHash(exclusion.runtimeCodeHash, "exclusion.runtimeCodeHash");
    if (!exclusion.apiVersion || !exclusion.reason) throw new Error("Coverage exclusions require API version and reason");
    const id = coverageId(manifest.coverageRevision, exclusion.chainId, exclusion.vaultAddress);
    if (ids.has(id)) throw new Error(`Duplicate included or excluded vault ${id}`);
    ids.add(id);
  }
  return manifest;
};

export const coverageEntity = (manifest: CoverageManifest, entry: CoverageEntry) => ({
  id: coverageId(manifest.coverageRevision, entry.chainId, entry.vaultAddress),
  chainId: entry.chainId,
  vaultAddress: entry.vaultAddress,
  coverageStartBlock: entry.coverageStartBlock,
  coverageStartBlockHash: entry.coverageStartBlockHash,
  validatedThroughBlock: entry.validatedThroughBlock,
  validatedThroughBlockHash: entry.validatedThroughBlockHash,
  vaultDiscoveryComplete: entry.vaultDiscoveryComplete,
  eventHistoryComplete: entry.eventHistoryComplete,
  allocatorDeploymentHistoryComplete: entry.allocatorDeploymentHistoryComplete,
  allocatorAssignmentHistoryComplete: entry.allocatorAssignmentHistoryComplete,
  checkpointTriggerAuditComplete: entry.checkpointTriggerAuditComplete,
  safeForTimeline: entry.safeForTimeline,
  knownGapsJson: JSON.stringify(entry.knownGaps),
  coverageRevision: manifest.coverageRevision,
  producerCommit: manifest.producerCommit,
  validatedAt: BigInt(manifest.validatedAt),
});

export const orderedCoverageEntries = (manifest: CoverageManifest): CoverageEntry[] =>
  [...validateCoverageManifest(manifest).entries].sort(
    (left, right) => left.chainId - right.chainId || left.vaultAddress.localeCompare(right.vaultAddress),
  );

export const coverageEntityRows = (manifest: CoverageManifest) =>
  orderedCoverageEntries(manifest).map((entry) => {
    const entity = coverageEntity(manifest, entry);
    return { ...entity, validatedAt: entity.validatedAt.toString() };
  });

const markdownValue = (value: number | string | null): string => value === null ? "unavailable" : String(value);

export const coverageMarkdown = (manifest: CoverageManifest): string => {
  const entries = orderedCoverageEntries(manifest);
  const exclusions = [...manifest.exclusions].sort(
    (left, right) => left.chainId - right.chainId || left.vaultAddress.localeCompare(right.vaultAddress),
  );
  const safeCount = entries.filter(({ safeForTimeline }) => safeForTimeline).length;
  const lines = [
    "# Ethereum allocation coverage",
    "",
    `Coverage revision: \`${manifest.coverageRevision}\``,
    "",
    `Producer commit: \`${manifest.producerCommit}\``,
    "",
    `Validated at: \`${manifest.validatedAt}\``,
    "",
    `Entries: ${entries.length}; safe for timeline: ${safeCount}; explicit exclusions: ${exclusions.length}`,
    "",
    "> This file is generated from `ethereum.json`. Do not edit it directly.",
    "",
    "| Chain | Vault | API | Deployment | Discovery | First event | Allocator start | Coverage range | Runtime hash | Safe | Known gaps |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | --- | --- | :---: | --- |",
  ];
  for (const entry of entries) {
    const gaps = [...entry.knownGaps]
      .sort((left, right) => left.code.localeCompare(right.code) || left.detail.localeCompare(right.detail))
      .map(({ code, detail }) => `${code}: ${detail}`)
      .join("; ") || "none";
    lines.push([
      `| ${entry.chainId}`,
      `\`${entry.vaultAddress}\``,
      entry.apiVersion,
      markdownValue(entry.vaultDeploymentBlock),
      markdownValue(entry.discoveryBlock),
      markdownValue(entry.firstRequiredEventBlock),
      markdownValue(entry.allocatorHistoryStartBlock),
      `${entry.coverageStartBlock}–${entry.validatedThroughBlock}`,
      `\`${entry.runtimeCodeHash}\``,
      entry.safeForTimeline ? "yes" : "no",
      `${gaps} |`,
    ].join(" | "));
  }
  lines.push(
    "",
    "## Explicit exclusions",
    "",
    "| Chain | Vault | API | Discovery | Runtime hash | Reason |",
    "| ---: | --- | --- | ---: | --- | --- |",
  );
  for (const exclusion of exclusions) {
    lines.push(`| ${exclusion.chainId} | \`${exclusion.vaultAddress}\` | ${exclusion.apiVersion} | ${exclusion.discoveryBlock} | \`${exclusion.runtimeCodeHash}\` | ${exclusion.reason} |`);
  }
  return `${lines.join("\n")}\n`;
};

export const validateAllocationCursor = (
  value: unknown,
  scope: { chainId: number; vaultAddress: string; coverageRevision: string },
): AllocationCursor => {
  if (!value || typeof value !== "object") throw new Error("Malformed allocation cursor");
  const cursor = value as Partial<AllocationCursor>;
  if (cursor.v !== ALLOCATION_CURSOR_VERSION) throw new Error("Unsupported allocation cursor version");
  if (cursor.chainId !== scope.chainId) throw new Error("Allocation cursor chain mismatch");
  if (cursor.vaultAddress !== scope.vaultAddress) throw new Error("Allocation cursor vault mismatch");
  if (cursor.coverageRevision !== scope.coverageRevision) throw new Error("Allocation cursor coverage revision mismatch");
  assertLowercaseAddress(cursor.vaultAddress, "cursor.vaultAddress");
  assertNonNegativeInteger(cursor.blockNumber, "cursor.blockNumber");
  assertNonNegativeInteger(cursor.transactionIndex, "cursor.transactionIndex");
  assertNonNegativeInteger(cursor.logIndex, "cursor.logIndex");
  if (typeof cursor.id !== "string" || !cursor.id) throw new Error("cursor.id is required");
  return cursor as AllocationCursor;
};

export const normalizePageSize = (value = DEFAULT_PAGE_SIZE): number => {
  assertNonNegativeInteger(value, "pageSize");
  if (value === 0 || value > MAX_PAGE_SIZE) throw new Error(`pageSize must be between 1 and ${MAX_PAGE_SIZE}`);
  return value;
};

export const allocationContinuationWhere = (cursor: AllocationCursor) => ({
  _or: [
    { blockNumber: { _gt: cursor.blockNumber } },
    { blockNumber: { _eq: cursor.blockNumber }, transactionIndex: { _gt: cursor.transactionIndex } },
    {
      blockNumber: { _eq: cursor.blockNumber },
      transactionIndex: { _eq: cursor.transactionIndex },
      logIndex: { _gt: cursor.logIndex },
    },
    {
      blockNumber: { _eq: cursor.blockNumber },
      transactionIndex: { _eq: cursor.transactionIndex },
      logIndex: { _eq: cursor.logIndex },
      id: { _gt: cursor.id },
    },
  ],
});

export type AllocationOrderKey = Pick<AllocationCursor, "blockNumber" | "transactionIndex" | "logIndex" | "id">;

export const compareAllocationOrder = (left: AllocationOrderKey, right: AllocationOrderKey): number =>
  left.blockNumber - right.blockNumber ||
  left.transactionIndex - right.transactionIndex ||
  left.logIndex - right.logIndex ||
  left.id.localeCompare(right.id);

export const isAfterAllocationCursor = (row: AllocationOrderKey, cursor: AllocationCursor): boolean =>
  compareAllocationOrder(row, cursor) > 0;
