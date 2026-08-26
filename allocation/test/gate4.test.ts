import { describe, expect, it } from "vitest";
import {
  ALLOCATION_CURSOR_VERSION,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  allocationContinuationWhere,
  coverageEntityRows,
  coverageEntity,
  coverageMarkdown,
  compareAllocationOrder,
  isAfterAllocationCursor,
  normalizePageSize,
  validateAllocationCursor,
  validateCoverageManifest,
  type AllocationCursor,
  type CoverageManifest,
} from "../src/gate4.js";

const HASH = `0x${"a".repeat(64)}`;
const VAULT = `0x${"b".repeat(40)}`;
const REVISION = "ethereum-2026-08-26-draft-1";

const manifest = (safeForTimeline = false): CoverageManifest => ({
  manifestVersion: 1,
  coverageRevision: REVISION,
  producerCommit: "c".repeat(40),
  validatedAt: 1_777_000_000,
  exclusions: [],
  entries: [{
    chainId: 1,
    vaultAddress: VAULT,
    coverageStartBlock: 18_000_000,
    coverageStartBlockHash: HASH,
    validatedThroughBlock: 25_835_600,
    validatedThroughBlockHash: HASH,
    vaultDiscoveryComplete: safeForTimeline,
    eventHistoryComplete: safeForTimeline,
    allocatorDeploymentHistoryComplete: safeForTimeline,
    allocatorAssignmentHistoryComplete: safeForTimeline,
    checkpointTriggerAuditComplete: true,
    safeForTimeline,
    knownGaps: safeForTimeline ? [] : [{ code: "parity-not-run", detail: "Candidate deployment parity has not run" }],
    vaultDeploymentBlock: 18_000_000,
    discoveryBlock: 18_000_000,
    firstRequiredEventBlock: 18_000_001,
    allocatorHistoryStartBlock: null,
    apiVersion: "3.0.4",
    runtimeCodeHash: HASH,
    earliestSafeTimelineBlock: safeForTimeline ? 18_000_000 : null,
  }],
});

const cursor: AllocationCursor = {
  v: ALLOCATION_CURSOR_VERSION,
  chainId: 1,
  vaultAddress: VAULT,
  coverageRevision: REVISION,
  blockNumber: 123,
  transactionIndex: 4,
  logIndex: 17,
  id: `1:${HASH}:17`,
};

describe("Gate 4 coverage contract", () => {
  it("maps a validated manifest entry to the exact queryable entity", () => {
    const value = validateCoverageManifest(manifest());
    expect(coverageEntity(value, value.entries[0]!)).toEqual({
      id: `${REVISION}:1:${VAULT}`,
      chainId: 1,
      vaultAddress: VAULT,
      coverageStartBlock: 18_000_000,
      coverageStartBlockHash: HASH,
      validatedThroughBlock: 25_835_600,
      validatedThroughBlockHash: HASH,
      vaultDiscoveryComplete: false,
      eventHistoryComplete: false,
      allocatorDeploymentHistoryComplete: false,
      allocatorAssignmentHistoryComplete: false,
      checkpointTriggerAuditComplete: true,
      safeForTimeline: false,
      knownGapsJson: '[{"code":"parity-not-run","detail":"Candidate deployment parity has not run"}]',
      coverageRevision: REVISION,
      producerCommit: "c".repeat(40),
      validatedAt: 1_777_000_000n,
    });
  });

  it("rejects safe coverage unless every completeness fact is true and no gaps remain", () => {
    const invalid = manifest(true);
    invalid.entries[0]!.eventHistoryComplete = false;
    expect(() => validateCoverageManifest(invalid)).toThrow("Unsafe timeline certification");
    expect(validateCoverageManifest(manifest(true)).entries[0]!.safeForTimeline).toBe(true);
  });

  it("rejects duplicate revision-scoped vault rows", () => {
    const invalid = manifest();
    invalid.entries.push({ ...invalid.entries[0]! });
    expect(() => validateCoverageManifest(invalid)).toThrow("Duplicate coverage entry");
  });

  it("generates entity rows and the human matrix in deterministic vault order", () => {
    const value = manifest();
    value.entries.push({ ...value.entries[0]!, vaultAddress: `0x${"a".repeat(40)}` });
    expect(coverageEntityRows(value).map(({ vaultAddress }) => vaultAddress)).toEqual([
      `0x${"a".repeat(40)}`,
      VAULT,
    ]);
    const markdown = coverageMarkdown(value);
    expect(markdown).toContain("Entries: 2; safe for timeline: 0; explicit exclusions: 0");
    expect(markdown.indexOf(`0x${"a".repeat(40)}`)).toBeLessThan(markdown.indexOf(VAULT));
    expect(markdown).toContain("parity-not-run: Candidate deployment parity has not run");
  });
});

describe("Gate 4 allocation cursor contract", () => {
  it("accepts only a cursor from the requested chain, vault, and coverage revision", () => {
    expect(validateAllocationCursor(cursor, cursor)).toEqual(cursor);
    expect(() => validateAllocationCursor({ ...cursor, chainId: 10 }, cursor)).toThrow("chain mismatch");
    expect(() => validateAllocationCursor({ ...cursor, vaultAddress: `0x${"d".repeat(40)}` }, cursor)).toThrow("vault mismatch");
    expect(() => validateAllocationCursor({ ...cursor, coverageRevision: "other" }, cursor)).toThrow("revision mismatch");
    expect(() => validateAllocationCursor({ ...cursor, v: 2 }, cursor)).toThrow("Unsupported");
  });

  it("builds the exclusive lexicographic continuation predicate", () => {
    expect(allocationContinuationWhere(cursor)).toEqual({
      _or: [
        { blockNumber: { _gt: 123 } },
        { blockNumber: { _eq: 123 }, transactionIndex: { _gt: 4 } },
        { blockNumber: { _eq: 123 }, transactionIndex: { _eq: 4 }, logIndex: { _gt: 17 } },
        { blockNumber: { _eq: 123 }, transactionIndex: { _eq: 4 }, logIndex: { _eq: 17 }, id: { _gt: cursor.id } },
      ],
    });
  });

  it("enforces the documented page-size bounds", () => {
    expect(normalizePageSize()).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize(MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE);
    expect(() => normalizePageSize(0)).toThrow("between 1");
    expect(() => normalizePageSize(MAX_PAGE_SIZE + 1)).toThrow("between 1");
  });

  it("reconstructs a same-transaction page boundary without gaps or duplicates", () => {
    const rows = [151, 160, 170, 173].map((logIndex) => ({
      blockNumber: 21_589_454,
      transactionIndex: 44,
      logIndex,
      id: `1:0x${"e".repeat(64)}:${logIndex}`,
    }));
    const firstPage = rows.slice(0, 2);
    const last = firstPage.at(-1)!;
    const pageCursor: AllocationCursor = {
      ...cursor,
      ...last,
    };
    const continuation = rows.filter((row) => isAfterAllocationCursor(row, pageCursor));
    expect([...firstPage, ...continuation]).toEqual(rows);
    expect(continuation).toEqual(rows.slice(2));
    expect([...rows].reverse().sort(compareAllocationOrder)).toEqual(rows);
  });
});
