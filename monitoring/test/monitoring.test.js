import assert from "node:assert/strict";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createMonitoringServer,
  DEFAULT_GRAPHQL_URL,
  getStatus,
  resolveGraphQLConfig,
  resolveIndexerProjectPath,
} from "../server.js";
import {
  chainVisualState,
  formatPercent,
  summaryDetail,
  summaryVisualState,
} from "../public/status.js";

const monitoringDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function metadata(overrides = {}) {
  return {
    chain_id: 1,
    block_height: 100,
    start_block: 0,
    end_block: null,
    first_event_block_number: 0,
    latest_processed_block: 100,
    latest_fetched_block_number: 100,
    num_events_processed: 7,
    is_hyper_sync: false,
    timestamp_caught_up_to_head_or_endblock: null,
    ...overrides,
  };
}

async function statusFor(chains, options = {}) {
  return getStatus({
    queryGraphQLFn: async () => ({ chain_metadata: chains }),
    rpcUrlForChainFn: () => "https://rpc.example",
    now: () => new Date("2026-07-29T12:00:00.000Z"),
    ...options,
  });
}

test("a historical Envio caught-up timestamp cannot mask live RPC lag", async () => {
  const status = await statusFor([
    metadata({
      block_height: 100,
      latest_fetched_block_number: 101,
      latest_processed_block: 100,
      timestamp_caught_up_to_head_or_endblock: "2026-07-28T00:00:00Z",
    }),
  ], {
    fetchChainHeadFn: async () => 120,
    blockTolerance: 2,
  });

  const [chain] = status.chains;
  assert.equal(chain.status, "behind");
  assert.equal(chain.caughtUp, false);
  assert.equal(chain.percentSynced, 100 / 120 * 100);
  assert.equal(chain.blocksBehind, 20);
  assert.equal(chain.rpcHead, 120);
  assert.equal(chain.metadataHead, 101);
  assert.equal(chain.headSource, "rpc");
  assert.equal(chain.observedAt, "2026-07-29T12:00:00.000Z");
  assert.equal(chain.metadataCaughtUpAt, "2026-07-28T00:00:00Z");
  assert.equal("caughtUpAt" in chain, false);
  assert.equal(status.totals.allCaughtUp, false);
});

test("an unavailable RPC produces unknown status instead of trusting metadata", async () => {
  const status = await statusFor([
    metadata({ block_height: 999, latest_fetched_block_number: 998 }),
  ], {
    fetchChainHeadFn: async () => null,
  });

  const [chain] = status.chains;
  assert.equal(chain.status, "unknown");
  assert.equal(chain.headSource, "unknown");
  assert.equal(chain.targetBlock, null);
  assert.equal(chain.blocksBehind, null);
  assert.equal(chain.percentSynced, null);
  assert.equal(chain.metadataHead, 999);
  assert.equal(status.totals.unknownChainCount, 1);
  assert.equal(status.totals.averagePercentSynced, null);
});

test("an explicit end block remains a readiness target without an RPC", async () => {
  const status = await statusFor([
    metadata({ end_block: 150, latest_processed_block: 149 }),
  ], {
    fetchChainHeadFn: async () => null,
    blockTolerance: 1,
  });

  const [chain] = status.chains;
  assert.equal(chain.status, "caught_up");
  assert.equal(chain.headSource, "end_block");
  assert.equal(chain.targetBlock, 150);
  assert.equal(chain.rpcHead, null);
  assert.equal(chain.blocksBehind, 1);
  assert.equal(chain.percentSynced, 100);
});

async function withServer(server, run) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

test("liveness, semantic canary, and readiness use separate endpoints", async () => {
  let statusCalls = 0;
  let healthCalls = 0;
  const server = createMonitoringServer({
    getStatusFn: async () => {
      statusCalls += 1;
      return {
        fetchedAt: "2026-07-29T12:00:00.000Z",
        chains: [
          { chainId: 1, chainName: "Ethereum", status: "behind", blocksBehind: 8, headSource: "rpc", observedAt: "2026-07-29T12:00:00.000Z" },
          { chainId: 10, chainName: "Optimism", status: "unknown", blocksBehind: null, headSource: "unknown", observedAt: "2026-07-29T12:00:00.000Z" },
        ],
      };
    },
    runHealthChecksFn: async () => {
      healthCalls += 1;
      return { ok: true, maxAgeDays: 30, results: [] };
    },
  });

  await withServer(server, async (baseUrl) => {
    const live = await fetch(`${baseUrl}/livez`);
    assert.equal(live.status, 200);
    assert.equal(await live.text(), "ok");
    assert.equal(statusCalls, 0);
    assert.equal(healthCalls, 0);

    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(statusCalls, 0);
    assert.equal(healthCalls, 1);

    const ready = await fetch(`${baseUrl}/readyz`);
    assert.equal(ready.status, 503);
    assert.deepEqual((await ready.json()).failingChains, [
      { chainId: 1, chainName: "Ethereum", status: "behind", blocksBehind: 8, headSource: "rpc", observedAt: "2026-07-29T12:00:00.000Z" },
      { chainId: 10, chainName: "Optimism", status: "unknown", blocksBehind: null, headSource: "unknown", observedAt: "2026-07-29T12:00:00.000Z" },
    ]);
    assert.equal(statusCalls, 1);
    assert.equal(healthCalls, 1);
  });
});

test("UI status semantics never render behind or unknown chains as green", () => {
  assert.deepEqual(chainVisualState({ status: "caught_up" }), { tone: "ok", label: "caught up" });
  assert.deepEqual(chainVisualState({ status: "behind" }), { tone: "warn", label: "behind" });
  assert.deepEqual(chainVisualState({ status: "unknown" }), { tone: "error", label: "head unknown" });
  assert.deepEqual(summaryVisualState({ allCaughtUp: false, unknownChainCount: 1 }), {
    tone: "err",
    label: "chain head unknown",
  });
  assert.equal(summaryDetail({ allCaughtUp: false, behindChainCount: 1, unknownChainCount: 1 }), "1 behind, 1 unknown");
  assert.equal(formatPercent(null), "—");
  assert.equal(formatPercent(100), "100.00");
});

test("cloud GraphQL env names win over legacy self-hosted aliases", () => {
  const cloud = resolveGraphQLConfig({
    ENVIO_GRAPHQL_URL: "https://indexer.hyperindex.xyz/3fec0a4/v1/graphql",
    ENVIO_PASSWORD: "cloud-token",
    GRAPHQL_URL: "https://legacy.example/v1/graphql",
    GRAPHQL_BEARER_TOKEN: "legacy-token",
    HASURA_GRAPHQL_JWT: "jwt-token",
    GRAPHQL_HOST: "legacy-host",
  });
  assert.equal(cloud.url, "https://indexer.hyperindex.xyz/3fec0a4/v1/graphql");
  assert.equal(cloud.bearerToken, "cloud-token");

  const legacyUrl = resolveGraphQLConfig({
    GRAPHQL_URL: "https://envio-gql.yearn.dev/v1/graphql",
    HASURA_GRAPHQL_JWT: "jwt-token",
  });
  assert.equal(legacyUrl.url, "https://envio-gql.yearn.dev/v1/graphql");
  assert.equal(legacyUrl.bearerToken, "jwt-token");

  const hostBuilt = resolveGraphQLConfig({ GRAPHQL_HOST: "graphql-engine" });
  assert.equal(hostBuilt.url, "http://graphql-engine:8080/v1/graphql");
  assert.equal(hostBuilt.bearerToken, null);

  const empty = resolveGraphQLConfig({});
  assert.equal(empty.url, DEFAULT_GRAPHQL_URL);
  assert.equal(empty.bearerToken, null);
});

test("indexer project path defaults to repo root (parent of monitoring/)", () => {
  const base = resolve(monitoringDir);
  assert.equal(
    resolveIndexerProjectPath({}, base),
    resolve(base, ".."),
  );
  assert.equal(
    resolveIndexerProjectPath({ INDEXER_PROJECT_PATH: "../custom" }, base),
    resolve(base, "../custom"),
  );
});

test("/api/status JSON includes chains and totals from shipped getStatus", async () => {
  const server = createMonitoringServer({
    getStatusFn: async () =>
      getStatus({
        queryGraphQLFn: async () => ({
          chain_metadata: [
            metadata({
              chain_id: 1,
              latest_processed_block: 100,
              end_block: 100,
              num_events_processed: 5,
            }),
          ],
        }),
        fetchChainHeadFn: async () => null,
        now: () => new Date("2026-07-29T12:00:00.000Z"),
        blockTolerance: 2,
      }),
  });

  await withServer(server, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.chains));
    assert.equal(body.chains.length, 1);
    assert.equal(body.chains[0].chainId, 1);
    assert.equal(body.chains[0].status, "caught_up");
    assert.ok(body.totals);
    assert.equal(body.totals.chainCount, 1);
    assert.equal(body.totals.caughtUpChainCount, 1);
    assert.equal(body.totals.totalEvents, 5);
    assert.equal(body.totals.allCaughtUp, true);
  });
});
