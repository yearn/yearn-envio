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

const orderedRows = [...normalizedRows].sort(compareRows);
const reverseInputOrder = [...normalizedRows].reverse().sort(compareRows);
assert.deepEqual(reverseInputOrder, orderedRows, "fixture ordering is not deterministic");
assert.equal(new Set(orderedRows.map(({ id }) => id)).size, orderedRows.length);

const requiredVaults = new Set([
  "0xbe53a109b494e5c9f97b9cd39fe969be68bf6204",
  "0x310b7ea7475a0b449cfd73be81522f1b88efafaa",
  "0x696d02db93291651ed510704c9b286841d506987",
]);
assert.deepEqual(
  new Set(fixture.historicalEvidence.historicalLogCounts.map(({ vaultAddress }) => vaultAddress)),
  requiredVaults,
);
for (const evidence of fixture.historicalEvidence.historicalLogCounts) {
  assert.ok(evidence.count > 0);
  assert.ok(evidence.firstBlock <= evidence.lastBlock);
  assert.ok(evidence.lastBlock <= fixture.validatedThrough.blockNumber);
}

console.log(
  JSON.stringify({
    status: "ok",
    decodedRealLogs: normalizedRows.length,
    historicalLogsObserved: fixture.historicalEvidence.historicalLogCounts.reduce(
      (total, { count }) => total + count,
      0,
    ),
    validatedThroughBlock: fixture.validatedThrough.blockNumber,
  }),
);
