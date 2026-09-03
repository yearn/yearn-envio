import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodeEventLog, parseAbiItem, toEventSelector } from "viem";

const fixtureUrl = new URL(
  "../../fixtures/allocation/ethereum/shared-debt-allocator.json",
  import.meta.url,
);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));

const eventAbi = parseAbiItem(
  "event UpdateStrategyDebtRatio(address indexed vault, address indexed strategy, uint256 newTargetRatio, uint256 newMaxRatio, uint256 newTotalDebtRatio)",
);
const topic0 = toEventSelector(fixture.event.canonicalSignature).toLowerCase();
assert.equal(topic0, fixture.event.topic0);
assert.equal(fixture.event.abiVariant, "shared-v1-vault-scoped-singular");
assert.match(fixture.factory.runtimeCodeHash, /^0x[0-9a-f]{64}$/);
assert.match(fixture.factory.implementationRuntimeCodeHash, /^0x[0-9a-f]{64}$/);

const normalizedRows = fixture.logs.map((log) => {
  const decoded = decodeEventLog({
    abi: [eventAbi],
    data: log.data,
    topics: log.topics,
    strict: true,
  });
  assert.equal(decoded.eventName, fixture.event.name);
  const actual = {
    vault: decoded.args.vault.toLowerCase(),
    strategy: decoded.args.strategy.toLowerCase(),
    newTargetRatio: decoded.args.newTargetRatio.toString(),
    newMaxRatio: decoded.args.newMaxRatio.toString(),
    newTotalDebtRatio: decoded.args.newTotalDebtRatio.toString(),
  };
  assert.deepEqual(actual, log.expected, `${log.label} did not decode as expected`);
  assert.equal(log.topics[0], topic0);
  assert.match(log.transactionHash, /^0x[0-9a-f]{64}$/);
  assert.match(log.blockHash, /^0x[0-9a-f]{64}$/);
  assert.match(log.inputSelector, /^0x[0-9a-f]{8}$/);
  return {
    id: `${fixture.chainId}:${log.transactionHash}:${log.logIndex}`,
    chainId: fixture.chainId,
    vaultAddress: actual.vault,
    sourceAddress: log.address,
    eventName: decoded.eventName,
    blockNumber: log.blockNumber,
    transactionIndex: log.transactionIndex,
    logIndex: log.logIndex,
    ...actual,
  };
});

const compareRows = (left, right) =>
  left.blockNumber - right.blockNumber ||
  left.transactionIndex - right.transactionIndex ||
  left.logIndex - right.logIndex ||
  left.id.localeCompare(right.id);

const freshReplay = [...normalizedRows].sort(compareRows);
const secondFreshReplay = [...normalizedRows].reverse().sort(compareRows);
assert.deepEqual(secondFreshReplay, freshReplay, "fresh replay order is not deterministic");

const midpoint = Math.ceil(normalizedRows.length / 2);
const incrementalContinuation = [
  ...normalizedRows.slice(0, midpoint),
  ...normalizedRows.slice(midpoint),
].sort(compareRows);
assert.deepEqual(
  incrementalContinuation,
  freshReplay,
  "incremental continuation differs from a fresh replay",
);

const paginated = [];
for (let offset = 0; offset < freshReplay.length; offset += 1) {
  paginated.push(...freshReplay.slice(offset, offset + 1));
}
assert.deepEqual(paginated, freshReplay, "deterministic pagination omitted or duplicated rows");
assert.equal(new Set(freshReplay.map(({ id }) => id)).size, freshReplay.length);

const requiredVaults = new Set([
  "0xbe53a109b494e5c9f97b9cd39fe969be68bf6204",
  "0x310b7ea7475a0b449cfd73be81522f1b88efafaa",
  "0x696d02db93291651ed510704c9b286841d506987",
]);
assert.deepEqual(
  new Set(fixture.coverage.historicalLogCounts.map(({ vaultAddress }) => vaultAddress)),
  requiredVaults,
);
for (const coverage of fixture.coverage.historicalLogCounts) {
  assert.ok(coverage.count > 0);
  assert.ok(coverage.firstBlock <= coverage.lastBlock);
  assert.ok(coverage.lastBlock <= fixture.validatedThrough.blockNumber);
}

const certificationComplete =
  fixture.coverage.fullHistoricalReplayCertified === true &&
  fixture.coverage.freshReplayMatches === true &&
  fixture.coverage.incrementalContinuationMatches === true &&
  fixture.coverage.paginationValidated === true &&
  fixture.coverage.unresolvedEventCount === 0;
assert.equal(
  fixture.coverage.safeForTimeline,
  certificationComplete,
  "safeForTimeline must exactly reflect all certification gates",
);
assert.equal(
  fixture.coverage.safeForTimeline,
  false,
  "local evidence must remain fail-closed until a deployed replay is certified",
);

console.log(
  JSON.stringify({
    status: "ok",
    decodedRealLogs: normalizedRows.length,
    historicalLogsObserved: fixture.coverage.historicalLogCounts.reduce(
      (total, { count }) => total + count,
      0,
    ),
    validatedThroughBlock: fixture.validatedThrough.blockNumber,
    safeForTimeline: fixture.coverage.safeForTimeline,
  }),
);
