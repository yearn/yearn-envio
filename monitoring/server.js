import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// Prefer package-local .env, then repo-root .env (shared cloud credentials).
loadDotEnv(join(__dirname, ".env"));
loadDotEnv(join(__dirname, "..", ".env"));

const PORT = Number(process.env.PORT || 4100);

// Default = Envio cloud HyperIndex instance for this project.
export const DEFAULT_GRAPHQL_URL = "https://indexer.hyperindex.xyz/5a089e4/v1/graphql";

// Cloud-first GraphQL config: ENVIO_GRAPHQL_URL + ENVIO_PASSWORD (Bearer),
// then legacy self-hosted / Render names, then the cloud default.
export function resolveGraphQLConfig(env = process.env) {
  const url =
    env.ENVIO_GRAPHQL_URL ||
    env.GRAPHQL_URL ||
    (env.GRAPHQL_HOST ? `http://${env.GRAPHQL_HOST}:8080/v1/graphql` : null) ||
    DEFAULT_GRAPHQL_URL;
  const bearerToken =
    env.ENVIO_PASSWORD ||
    env.GRAPHQL_BEARER_TOKEN ||
    env.HASURA_GRAPHQL_JWT ||
    null;
  return { url, bearerToken };
}

export function resolveIndexerProjectPath(
  env = process.env,
  baseDir = __dirname,
) {
  return resolve(baseDir, env.INDEXER_PROJECT_PATH || "..");
}

const { url: GRAPHQL_URL, bearerToken: GRAPHQL_BEARER_TOKEN } =
  resolveGraphQLConfig();
const INDEXER_PROJECT_PATH = resolveIndexerProjectPath();
// A chain can be a handful of blocks behind its current target without being
// operationally behind (for example, while its final fetch is in flight). Keep
// that allowance explicit and small; it must never be inferred from Envio's
// historical caught-up timestamp.
const SYNC_BLOCK_TOLERANCE = nonNegativeInteger(
  process.env.SYNC_BLOCK_TOLERANCE,
  2,
);

const CHAIN_NAMES = {
  1: "Ethereum",
  10: "Optimism",
  100: "Gnosis",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum",
  80094: "Berachain",
  747474: "Katana",
};

// envio's chain_metadata.block_height tracks the last-processed block once a
// chain looks caught up, so it can't reveal real lag. Query each chain's RPC
// for the live head instead. Resolved from RPC_URL_<chainId>, falling back to
// the indexer's ENVIO_RPC_URL_<NAME> naming.
const RPC_NAME_BY_CHAIN = {
  1: "ETHEREUM",
  10: "OPTIMISM",
  100: "GNOSIS",
  137: "POLYGON",
  8453: "BASE",
  42161: "ARBITRUM",
  80094: "BERACHAIN",
  747474: "KATANA",
};

// /healthz sanity-checks that the indexer is still ingesting real vault activity,
// not just advancing block_height. envio reports a chain as "caught up" even when a
// sync/build has silently stalled and no new events are landing, so for each canary
// vault below the newest Deposit or Withdraw must be no older than
// HEALTH_MAX_DATA_AGE_DAYS (default 30). A stale or missing latest event fails the
// check, and a GraphQL/transport error propagates to the outer handler as a 5xx:
// both are deliberately fail-closed, so /healthz only returns "ok" when the data is
// provably fresh. Addresses are EIP-55 checksummed to match how the indexer stores
// vaultAddress (viem getAddress). Edit the list to add more canary vaults.
const HEALTH_CHECK_VAULTS = [
  {
    vaultAddress: "0xBe53A109B494E5c9f97b9Cd39Fe969BE68BF6204",
    chainId: 1,
    label: "yvUSDC-1",
  },
  {
    vaultAddress: "0x9F4330700a36B29952869fac9b33f45EEdd8A3d8",
    chainId: 1,
    label: "yBOLD",
  },
  {
    vaultAddress: "0x80c34BD3A3569E126e7055831036aa7b212cB159",
    chainId: 747474,
    label: "yvvbUSDC",
  },
  {
    vaultAddress: "0xc3BD0A2193c8F027B82ddE3611D18589ef3f62a9",
    chainId: 8453,
    label: "yvUSDC-H",
  },
];
const HEALTH_MAX_DATA_AGE_DAYS = Number(
  process.env.HEALTH_MAX_DATA_AGE_DAYS || 30,
);
const HEALTH_MAX_DATA_AGE_MS = HEALTH_MAX_DATA_AGE_DAYS * 24 * 60 * 60 * 1000;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function rpcUrlForChain(chainId) {
  const named = RPC_NAME_BY_CHAIN[chainId];
  return (
    process.env[`RPC_URL_${chainId}`] ||
    (named ? process.env[`ENVIO_RPC_URL_${named}`] : null) ||
    null
  );
}

async function fetchChainHead(url) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_blockNumber",
        params: [],
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const hex = json?.result;
    if (typeof hex !== "string") return null;
    const n = Number.parseInt(hex, 16);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function readDeployedCommit() {
  const envSha =
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    process.env.COMMIT_SHA ||
    process.env.SOURCE_COMMIT ||
    process.env.VERCEL_GIT_COMMIT_SHA;
  const envMessage =
    process.env.RENDER_GIT_COMMIT_MESSAGE ||
    process.env.GIT_COMMIT_MESSAGE ||
    process.env.VERCEL_GIT_COMMIT_MESSAGE;
  const envBranch =
    process.env.RENDER_GIT_BRANCH ||
    process.env.GIT_BRANCH ||
    process.env.VERCEL_GIT_COMMIT_REF;
  const repoUrl =
    process.env.GIT_REPO_URL ||
    process.env.RENDER_GIT_REPO_SLUG ||
    process.env.GITHUB_REPOSITORY;

  let sha = envSha || null;
  let message = envMessage || null;
  let branch = envBranch || null;
  let date = null;
  let author = null;

  try {
    const opts = { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] };
    if (!sha)
      sha = execSync("git rev-parse HEAD", opts).toString().trim() || null;
    if (sha) {
      const fmt = execSync(`git show -s --format=%s%n%an%n%cI ${sha}`, opts)
        .toString()
        .split("\n");
      message = message || fmt[0] || null;
      author = fmt[1] || null;
      date = fmt[2] || null;
    }
    if (!branch) {
      branch =
        execSync("git rev-parse --abbrev-ref HEAD", opts).toString().trim() ||
        null;
    }
  } catch {}

  if (!sha) return null;
  const shortSha = sha.slice(0, 7);
  let url = null;
  if (repoUrl) {
    const slug = repoUrl
      .replace(/^git@github\.com:/, "https://github.com/")
      .replace(/^https?:\/\/github\.com\//, "https://github.com/")
      .replace(/\.git$/, "");
    url = slug.startsWith("http")
      ? `${slug}/commit/${sha}`
      : `https://github.com/${slug}/commit/${sha}`;
  }
  return { sha, shortSha, message, author, date, branch, url };
}

function readEnvioVersion() {
  const candidates = [
    {
      path: join(
        INDEXER_PROJECT_PATH,
        "generated",
        "persisted_state.envio.json",
      ),
      extract: (json) => json.envio_version,
    },
    {
      path: join(INDEXER_PROJECT_PATH, "package.json"),
      extract: (json) =>
        json?.dependencies?.envio ?? json?.devDependencies?.envio,
    },
  ];
  for (const { path, extract } of candidates) {
    try {
      if (!existsSync(path)) continue;
      const json = JSON.parse(readFileSync(path, "utf8"));
      const v = extract(json);
      if (v) return v;
    } catch {}
  }
  return null;
}

async function queryGraphQL(query) {
  if (!GRAPHQL_URL) {
    throw new Error(
      "ENVIO_GRAPHQL_URL (or GRAPHQL_URL / GRAPHQL_HOST) is required",
    );
  }
  const headers = { "Content-Type": "application/json" };
  if (GRAPHQL_BEARER_TOKEN) {
    headers.Authorization = `Bearer ${GRAPHQL_BEARER_TOKEN}`;
  }
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });
  if (!res.ok)
    throw new Error(`GraphQL request failed: ${res.status} ${res.statusText}`);
  const body = await res.json();
  if (body.errors)
    throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  return body.data;
}

export async function getStatus({
  queryGraphQLFn = queryGraphQL,
  fetchChainHeadFn = fetchChainHead,
  rpcUrlForChainFn = rpcUrlForChain,
  now = () => new Date(),
  blockTolerance = SYNC_BLOCK_TOLERANCE,
} = {}) {
  const observedAt = now().toISOString();
  const data = await queryGraphQLFn(`
    {
      chain_metadata {
        chain_id
        block_height
        start_block
        end_block
        first_event_block_number
        latest_processed_block
        latest_fetched_block_number
        num_events_processed
        is_hyper_sync
        timestamp_caught_up_to_head_or_endblock
      }
    }
  `);

  const metas = data.chain_metadata ?? [];
  const rpcHeads = await Promise.all(
    metas.map((c) => {
      const url = rpcUrlForChainFn(c.chain_id);
      return url ? fetchChainHeadFn(url) : Promise.resolve(null);
    }),
  );

  const chains = metas.map((c, i) => {
    const syncStart = c.first_event_block_number ?? c.start_block ?? 0;
    const metadataHead = Math.max(
      c.block_height ?? 0,
      c.latest_fetched_block_number ?? 0,
    );
    const rpcHead = rpcHeads[i];
    // An explicit end block is a complete target by itself. For an open-ended
    // chain, only the independently observed RPC head is trustworthy enough to
    // claim current readiness; metadata is diagnostic, never a fallback target.
    const hasEndBlock = c.end_block != null;
    const targetBlock = hasEndBlock ? c.end_block : rpcHead;
    const headSource = hasEndBlock
      ? "end_block"
      : rpcHead != null
        ? "rpc"
        : "unknown";
    const processed = c.latest_processed_block ?? 0;
    const knownTarget = targetBlock != null;
    const totalRange = knownTarget
      ? Math.max(0, targetBlock - syncStart)
      : null;
    const doneRange = Math.max(0, processed - syncStart);
    const blocksBehind = knownTarget
      ? Math.max(0, targetBlock - processed)
      : null;
    const status = !knownTarget
      ? "unknown"
      : blocksBehind <= blockTolerance
        ? "caught_up"
        : "behind";
    const caughtUp = status === "caught_up";
    let percent = null;
    if (knownTarget) {
      percent = caughtUp
        ? 100
        : totalRange > 0
          ? Math.min(100, (doneRange / totalRange) * 100)
          : 0;
    }
    return {
      chainId: c.chain_id,
      chainName: CHAIN_NAMES[c.chain_id] ?? `Chain ${c.chain_id}`,
      // blockHeight is retained for existing API consumers. New consumers
      // should use the explicitly sourced fields below.
      blockHeight: targetBlock,
      startBlock: c.start_block,
      endBlock: c.end_block,
      firstEventBlock: c.first_event_block_number,
      latestProcessedBlock: processed,
      latestFetchedBlock: c.latest_fetched_block_number,
      numEventsProcessed: Number(c.num_events_processed ?? 0),
      isHyperSync: c.is_hyper_sync,
      rpcHead,
      metadataHead,
      targetBlock,
      headSource,
      observedAt,
      status,
      caughtUp,
      metadataCaughtUpAt: c.timestamp_caught_up_to_head_or_endblock,
      percentSynced: percent,
      blocksBehind,
    };
  });

  chains.sort((a, b) => a.chainId - b.chainId);

  const totalEvents = chains.reduce((acc, c) => acc + c.numEventsProcessed, 0);
  const knownChains = chains.filter((c) => c.status !== "unknown");
  const avgPercent =
    knownChains.length === chains.length && chains.length
      ? chains.reduce((acc, c) => acc + c.percentSynced, 0) / chains.length
      : null;
  const caughtUpChainCount = chains.filter(
    (c) => c.status === "caught_up",
  ).length;
  const behindChainCount = chains.filter((c) => c.status === "behind").length;
  const unknownChainCount = chains.filter((c) => c.status === "unknown").length;

  return {
    envioVersion: readEnvioVersion(),
    deployedCommit: readDeployedCommit(),
    indexerProjectPath: INDEXER_PROJECT_PATH,
    fetchedAt: observedAt,
    chains,
    totals: {
      chainCount: chains.length,
      caughtUpChainCount,
      behindChainCount,
      unknownChainCount,
      totalEvents,
      averagePercentSynced: avgPercent,
      allCaughtUp: chains.length > 0 && caughtUpChainCount === chains.length,
    },
  };
}

// Newest blockTimestamp (epoch seconds) across the latest Deposit and Withdraw for
// a single vault+chain, or null if neither table has a matching row.
async function latestVaultEventTimestamp(vaultAddress, chainId) {
  if (!ADDRESS_RE.test(vaultAddress)) {
    throw new Error(`invalid vault address: ${vaultAddress}`);
  }
  const filter = `vaultAddress: { _eq: "${vaultAddress}" } chainId: { _eq: ${chainId} }`;
  const data = await queryGraphQL(`{
    Deposit(where: { ${filter} }, order_by: { blockTimestamp: desc }, limit: 1) { blockTimestamp }
    Withdraw(where: { ${filter} }, order_by: { blockTimestamp: desc }, limit: 1) { blockTimestamp }
  }`);
  const timestamps = [...(data.Deposit ?? []), ...(data.Withdraw ?? [])].map(
    (row) => Number(row.blockTimestamp),
  );
  return timestamps.length ? Math.max(...timestamps) : null;
}

// Runs every canary-vault freshness check in parallel. Returns { ok, maxAgeDays,
// results } so the caller can render a human-readable failure body on 503.
async function runHealthChecks() {
  const results = await Promise.all(
    HEALTH_CHECK_VAULTS.map(async (vault) => {
      const latest = await latestVaultEventTimestamp(
        vault.vaultAddress,
        vault.chainId,
      );
      let ok;
      let detail;
      if (latest == null) {
        ok = false;
        detail = "no deposit/withdraw events indexed for this vault";
      } else {
        const ageMs = Date.now() - latest * 1000;
        const ageDays = ageMs / (24 * 60 * 60 * 1000);
        ok = ageMs <= HEALTH_MAX_DATA_AGE_MS;
        detail = `latest event ${new Date(latest * 1000).toISOString()} (${ageDays.toFixed(1)} days ago)`;
      }
      return {
        label: vault.label,
        vaultAddress: vault.vaultAddress,
        chainId: vault.chainId,
        ok,
        detail,
      };
    }),
  );
  return {
    ok: results.every((r) => r.ok),
    maxAgeDays: HEALTH_MAX_DATA_AGE_DAYS,
    results,
  };
}

export function createMonitoringServer({
  getStatusFn = getStatus,
  runHealthChecksFn = runHealthChecks,
} = {}) {
  return createServer(async (req, res) => {
    try {
      // This intentionally stays independent of GraphQL, RPC, and canary data.
      // Render uses it to determine whether the monitoring process itself lives.
      if (req.url === "/livez") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return;
      }
      if (req.url === "/api/status") {
        const status = await getStatusFn();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(status));
        return;
      }
      if (req.url === "/readyz") {
        try {
          const status = await getStatusFn();
          const failingChains = status.chains
            .filter((chain) => chain.status !== "caught_up")
            .map(
              ({
                chainId,
                chainName,
                status: chainStatus,
                blocksBehind,
                headSource,
                observedAt,
              }) => ({
                chainId,
                chainName,
                status: chainStatus,
                blocksBehind,
                headSource,
                observedAt,
              }),
            );
          const ready = failingChains.length === 0 && status.chains.length > 0;
          res.writeHead(ready ? 200 : 503, {
            "Content-Type": "application/json",
          });
          res.end(
            JSON.stringify({
              status: ready ? "ready" : "not_ready",
              observedAt: status.fetchedAt,
              failingChains,
            }),
          );
        } catch (err) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              status: "not_ready",
              error: err.message,
              failingChains: [],
            }),
          );
        }
        return;
      }
      if (req.url === "/healthz") {
        const health = await runHealthChecksFn();
        if (health.ok) {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("ok");
        } else {
          const failing = health.results
            .filter((r) => !r.ok)
            .map(
              (r) =>
                `- ${r.label} (${r.vaultAddress}, chain ${r.chainId}): ${r.detail}`,
            )
            .join("\n");
          res.writeHead(503, { "Content-Type": "text/plain" });
          res.end(
            `not ok: vault data not fresh within ${health.maxAgeDays} days\n${failing}\n`,
          );
        }
        return;
      }
      if (req.url === "/" || req.url === "/index.html") {
        const html = await readFile(join(__dirname, "public", "index.html"));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      if (req.url === "/status.js") {
        const script = await readFile(join(__dirname, "public", "status.js"));
        res.writeHead(200, {
          "Content-Type": "text/javascript; charset=utf-8",
        });
        res.end(script);
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function startServer() {
  if (!GRAPHQL_URL) {
    console.error(
      "ENVIO_GRAPHQL_URL (or GRAPHQL_URL / GRAPHQL_HOST) is required",
    );
    process.exit(1);
  }
  const server = createMonitoringServer();
  server.listen(PORT, () => {
    console.log(`envio-monitoring dashboard: http://localhost:${PORT}`);
    console.log(`  GraphQL: ${GRAPHQL_URL}`);
    console.log(`  Indexer project: ${INDEXER_PROJECT_PATH}`);
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  startServer();
}
