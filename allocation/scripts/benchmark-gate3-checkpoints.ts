import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createArchiveReadDependencies, readVaultAccountingFromArchive } from "../../src/allocation/Effects.js";

const rpcUrl = process.env.ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM;
if (!rpcUrl) {
  console.log("Gate 3 checkpoint benchmark: NOT RUN (ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM is unset)");
  process.exit(0);
}

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/ethereum/gate3-benchmark.json", import.meta.url), "utf8"),
) as {
  chainId: number;
  vaultAddress: string;
  duplicateLogicalRequests: number;
  blocks: Array<{ numberHex: `0x${string}` }>;
  projectionScenarios: number[];
};

const percentile = (values: number[], fraction: number): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
};

try {
  const dependencies = createArchiveReadDependencies(fixture.chainId);
  const inputs = await Promise.all(fixture.blocks.map(async ({ numberHex }) => {
    const blockNumber = Number(BigInt(numberHex));
    return {
      vaultAddress: fixture.vaultAddress,
      blockNumber,
      expectedBlockHash: await dependencies.getBlockHash(blockNumber),
    };
  }));
  const logicalInputs = [...inputs, ...inputs.slice(0, fixture.duplicateLogicalRequests)];
  const cache = new Map<string, Promise<unknown>>();
  const latencies: number[] = [];
  let errors = 0;
  let nextStartAt = performance.now();

  const startedAt = performance.now();
  for (const input of logicalInputs) {
    const key = `${input.vaultAddress}:${input.blockNumber}:${input.expectedBlockHash}`;
    if (cache.has(key)) continue;
    const delay = Math.max(0, nextStartAt - performance.now());
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    nextStartAt = performance.now() + 200;
    const requestStartedAt = performance.now();
    const request = readVaultAccountingFromArchive(
      fixture.chainId,
      input.vaultAddress,
      input.blockNumber,
      input.expectedBlockHash,
    ).catch((error) => {
      errors += 1;
      throw error;
    }).finally(() => {
      latencies.push(performance.now() - requestStartedAt);
    });
    cache.set(key, request);
  }
  await Promise.all(cache.values());
  const elapsedSeconds = (performance.now() - startedAt) / 1_000;
  const uniqueRequests = cache.size;
  const cacheHits = logicalInputs.length - uniqueRequests;
  const observedRate = uniqueRequests / elapsedSeconds;
  const projectionHours = Object.fromEntries(
    fixture.projectionScenarios.map((count) => [count, Number((count / 5 / 3_600).toFixed(2))]),
  );

  if (errors > 0) throw new Error("Benchmark contained archive RPC failures");
  console.log(JSON.stringify({
    logicalRequests: logicalInputs.length,
    uniqueRequests,
    cacheHits,
    cacheHitRate: Number((cacheHits / logicalInputs.length).toFixed(4)),
    errors,
    errorRate: 0,
    elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
    observedUniqueRequestsPerSecond: Number(observedRate.toFixed(3)),
    latencyMs: {
      p50: Number(percentile(latencies, 0.5).toFixed(1)),
      p95: Number(percentile(latencies, 0.95).toFixed(1)),
      max: Number(Math.max(...latencies).toFixed(1)),
    },
    projectedHoursAtFiveCallsPerSecond: projectionHours,
  }, null, 2));
} catch {
  console.error("Gate 3 checkpoint benchmark: FAILED (archive RPC details and URL suppressed)");
  process.exit(1);
}
