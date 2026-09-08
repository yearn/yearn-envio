import { spawn } from "node:child_process";
import postgres from "postgres";
import { ChainProgressTracker } from "./chain-progress-tracker.mjs";
import { observeLiveHeads } from "./live-head-source.mjs";
import { resolveWatchdogMode } from "./watchdog-mode.mjs";

const env = { ...process.env };
const databaseUrlSource = env.ENVIO_DATABASE_URL
  ? "ENVIO_DATABASE_URL"
  : env.DATABASE_URL
    ? "DATABASE_URL"
    : undefined;
const databaseUrl = databaseUrlSource ? env[databaseUrlSource] : undefined;

if (env.RENDER && !env.ENVIO_DATABASE_URL) {
  console.error(
    "Missing ENVIO_DATABASE_URL on Render. Sync the Blueprint or add ENVIO_DATABASE_URL from the Render Postgres internal connection string.",
  );
  process.exit(1);
}

if (databaseUrl) {
  const url = new URL(databaseUrl);
  env.ENVIO_PG_HOST = url.hostname;
  env.ENVIO_PG_PORT = url.port || "5432";
  env.ENVIO_PG_USER = decodeURIComponent(url.username);
  env.ENVIO_POSTGRES_PASSWORD = decodeURIComponent(url.password);
  env.ENVIO_PG_DATABASE = decodeURIComponent(url.pathname.replace(/^\//, ""));
}

for (const key of [
  "ENVIO_PG_HOST",
  "ENVIO_PG_PORT",
  "ENVIO_PG_USER",
  "ENVIO_POSTGRES_PASSWORD",
  "ENVIO_PG_DATABASE",
]) {
  if (!env[key]) {
    console.error(`Missing required database environment variable: ${key}`);
    process.exit(1);
  }
}

console.log(
  `Starting Envio with Postgres ${env.ENVIO_PG_USER}@${env.ENVIO_PG_HOST}:${env.ENVIO_PG_PORT}/${env.ENVIO_PG_DATABASE}`,
);
console.log(`Database config source: ${databaseUrlSource ?? "ENVIO_PG_*"}`);

// Envio itself only reads HASURA_GRAPHQL_ENDPOINT (must be a full URL ending
// in /v1/metadata) — it has no notion of HASURA_SERVICE_HOST/PORT. Render's
// blueprint sets those two (see render.yaml) so the indexer can resolve
// graphql-engine's internal hostname without hardcoding it; assemble them
// into the URL envio actually expects.
if (!env.HASURA_GRAPHQL_ENDPOINT && env.HASURA_SERVICE_HOST) {
  const hasuraPort = env.HASURA_SERVICE_PORT || "8080";
  env.HASURA_GRAPHQL_ENDPOINT = `http://${env.HASURA_SERVICE_HOST}:${hasuraPort}/v1/metadata`;
  console.log(`Derived HASURA_GRAPHQL_ENDPOINT: ${env.HASURA_GRAPHQL_ENDPOINT}`);
}

let activeIndexerChild;
let watchdogRestartRequested = false;

const isIndexerStart = (args) =>
  args[0] === "envio" && args[1] === "start";

const terminateIndexerProcessGroup = (child) => {
  if (!child || child.exitCode !== null) return;

  const signal = (name) => {
    try {
      if (process.platform === "win32") {
        child.kill(name);
      } else {
        process.kill(-child.pid, name);
      }
      return true;
    } catch {
      return false;
    }
  };

  if (!signal("SIGTERM")) {
    child.kill("SIGTERM");
  }

  setTimeout(() => {
    if (child.exitCode === null && !signal("SIGKILL")) {
      child.kill("SIGKILL");
    }
  }, 15_000).unref();
};

const runPnpm = (args) =>
  new Promise((resolve) => {
    const startsIndexer = isIndexerStart(args);
    const child = spawn("pnpm", args, {
      env,
      stdio: "inherit",
      // Give the long-running pnpm/envio process tree its own group so the
      // watchdog can terminate both processes. Killing only pnpm can orphan
      // the actual indexer and leave two workers writing to the same database.
      detached: startsIndexer && process.platform !== "win32",
    });
    if (startsIndexer) {
      activeIndexerChild = child;
      watchdogRestartRequested = false;
    }

    child.on("close", (code) => {
      if (activeIndexerChild === child) {
        activeIndexerChild = undefined;
      }
      resolve(watchdogRestartRequested ? 1 : code);
    });
  });

// Startup is deliberately fail-closed. Envio performs its own compatibility
// checks; if migration or startup fails for any reason, preserve PostgreSQL
// exactly as-is and let the deployment fail for investigation.
const runPnpmOrExit = async (args) => {
  const code = await runPnpm(args);
  if (code !== 0) {
    process.exit(code ?? 1);
  }
};

// Envio can rebuild Hasura metadata during startup (clear then re-track), but
// it only ever grants `select` to the `public` role —
// hardcoded in its own Hasura.res.mjs, with no env var to change it. Clients
// authenticated via HASURA_GRAPHQL_JWT (graphiql, apps/monitoring) are pinned
// to the `readonly` role instead (see HASURA_GRAPHQL_JWT_SECRET's claims_map),
// which Hasura doesn't even know exists after a metadata wipe, so those clients
// see a GraphQL schema missing every table. `readonly` must be recreated as an
// inherited role of `public` (see scripts/hasura_grant_public_select.js) so it
// automatically has public's select on every table.
//
// This used to be triggered by scraping envio's stdout for a "tracking done"
// log line, but that marker never reliably fired in production (envio's exact
// wording isn't guaranteed and a single miss leaves readonly broken). Instead,
// reconcile against Hasura's actual state: poll its metadata while envio runs
// and, whenever tables are tracked and `public` has been granted but the
// readonly inherited role is missing, (re)create it. This self-heals across the
// initial startup and any later metadata rebuild, with no dependency on log
// wording.
const HASURA_RECONCILE_INTERVAL_MS = 20_000;

const hasuraMetadataUrl = () => {
  const base = (env.HASURA_GRAPHQL_ENDPOINT || "").replace(/\/v1\/metadata\/?$/, "");
  return base ? `${base}/v1/metadata` : undefined;
};

// One reconciliation pass. Returns without acting (and stays quiet) whenever
// there's nothing to do, so the steady state is silent. Never throws — a
// transient Hasura/network error just means we retry on the next tick.
const reconcileReadonlyRoleOnce = async () => {
  const url = hasuraMetadataUrl();
  const secret = env.HASURA_GRAPHQL_ADMIN_SECRET;
  if (!url || !secret) return;

  let metadata;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hasura-admin-secret": secret,
      },
      body: JSON.stringify({ type: "export_metadata", args: {} }),
    });
    if (!res.ok) return;
    metadata = await res.json();
  } catch {
    return;
  }

  const sources = metadata.sources || [];
  // Only act once `public` actually has grants: envio applies them as part of
  // tracking, and add_inherited_role fails if its parent role doesn't exist
  // yet. This gate also means we wait out the brief post-clear window.
  const publicHasSelect = sources.some((s) =>
    (s.tables || []).some((t) =>
      (t.select_permissions || []).some((p) => p.role === "public"),
    ),
  );
  if (!publicHasSelect) return;

  const readonlyReady = (metadata.inherited_roles || []).some(
    (r) => r.role_name === "readonly" && (r.role_set || []).includes("public"),
  );
  if (readonlyReady) return;

  console.log(
    "readonly inherited role missing from Hasura — creating it (inherits public)...",
  );
  await new Promise((resolve) => {
    const grant = spawn(
      "node",
      ["scripts/hasura_grant_public_select.js", "readonly"],
      { env, stdio: "inherit" },
    );
    // A spawn 'error' event is otherwise an uncaught exception that would crash
    // the indexer — reconciling the readonly role must never take down envio.
    grant.on("error", (err) => {
      console.warn(
        `Failed to spawn the readonly role reconciler: ${err.message} — graphiql and the monitoring dashboard may see "field not found" errors until this succeeds; retrying.`,
      );
      resolve();
    });
    grant.on("close", (code) => {
      if (code !== 0) {
        console.warn(
          `readonly role reconciler exited ${code} — will retry on the next tick.`,
        );
      }
      resolve();
    });
  });
};

const startReadonlyRoleReconciler = () => {
  let running = false;
  const tick = async () => {
    if (running) return; // never overlap passes (a create can outlast a tick)
    running = true;
    try {
      await reconcileReadonlyRoleOnce();
    } finally {
      running = false;
    }
  };
  tick();
  // .unref() so this timer alone never keeps the process alive; `envio start`
  // is what holds it open.
  setInterval(tick, HASURA_RECONCILE_INTERVAL_MS).unref();
};

// HyperIndex fetches each chain through multiple address partitions. During a
// large unordered multi-chain backfill, a worker can remain healthy and keep
// fetching other chains/partitions while one chain's durable cursor stops
// advancing. Render therefore sees a live worker even though user-facing
// history on that chain is silently becoming stale.
//
// Render already restarts a process that exits. This watchdog turns that
// otherwise-invisible partial stall into a normal process restart, preserving
// the existing checkpoint. It deliberately considers all three durable
// progress counters so a slow handler or a fetch-heavy phase is not mistaken
// for a stall. The target comes from an independent eth_blockNumber query;
// chain_metadata.block_height is never used as a live-head proxy.
const { requestedMode: requestedWatchdogMode, mode: WATCHDOG_MODE } =
  resolveWatchdogMode(env.ENVIO_STALL_WATCHDOG_MODE);
const WATCHDOG_INTERVAL_MS = Number(
  env.ENVIO_STALL_WATCHDOG_INTERVAL_MILLIS ?? 60_000,
);
const WATCHDOG_TIMEOUT_MS = Number(
  env.ENVIO_STALL_WATCHDOG_TIMEOUT_MILLIS ?? 0,
);
const WATCHDOG_MIN_BLOCK_LAG = Number(
  env.ENVIO_STALL_WATCHDOG_MIN_BLOCK_LAG ?? 10_000,
);
const WATCHDOG_STARTUP_GRACE_MS = Number(
  env.ENVIO_STALL_WATCHDOG_STARTUP_GRACE_MILLIS ?? WATCHDOG_TIMEOUT_MS,
);
const WATCHDOG_COOLDOWN_MS = Number(
  env.ENVIO_STALL_WATCHDOG_COOLDOWN_MILLIS ?? WATCHDOG_TIMEOUT_MS,
);
const WATCHDOG_CONSECUTIVE_OBSERVATIONS = Number(
  env.ENVIO_STALL_WATCHDOG_CONSECUTIVE_OBSERVATIONS ?? 2,
);
const WATCHDOG_RESTART_BUDGET = Number(
  env.ENVIO_STALL_WATCHDOG_RESTART_BUDGET ?? 1,
);
const WATCHDOG_RPC_TIMEOUT_MS = Number(
  env.ENVIO_STALL_WATCHDOG_RPC_TIMEOUT_MILLIS ?? 10_000,
);
const WATCHDOG_RPC_CONCURRENCY = Number(
  env.ENVIO_STALL_WATCHDOG_RPC_CONCURRENCY ?? 4,
);

const validPositiveNumber = (value) => Number.isFinite(value) && value > 0;
const validNonNegativeNumber = (value) => Number.isFinite(value) && value >= 0;
const validPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const validNonNegativeInteger = (value) =>
  Number.isSafeInteger(value) && value >= 0;
const validWatchdogConfiguration = () =>
  validPositiveNumber(WATCHDOG_INTERVAL_MS) &&
  validPositiveNumber(WATCHDOG_TIMEOUT_MS) &&
  validNonNegativeNumber(WATCHDOG_MIN_BLOCK_LAG) &&
  validNonNegativeNumber(WATCHDOG_STARTUP_GRACE_MS) &&
  validNonNegativeNumber(WATCHDOG_COOLDOWN_MS) &&
  validPositiveInteger(WATCHDOG_CONSECUTIVE_OBSERVATIONS) &&
  validNonNegativeInteger(WATCHDOG_RESTART_BUDGET) &&
  validPositiveNumber(WATCHDOG_RPC_TIMEOUT_MS) &&
  validPositiveInteger(WATCHDOG_RPC_CONCURRENCY);

const watchdogLog = (level, details) => {
  console[level](`chain_progress_watchdog ${JSON.stringify(details)}`);
};

const startChainProgressWatchdog = () => {
  if (requestedWatchdogMode !== WATCHDOG_MODE) {
    watchdogLog("warn", {
      mode: "off",
      reason: "invalid_mode",
      requestedMode: requestedWatchdogMode,
    });
  }
  if (WATCHDOG_MODE === "off") return;

  if (!validWatchdogConfiguration()) {
    // Do not coerce invalid values into an aggressive watchdog. Failing open
    // here avoids a deployment typo turning a monitoring feature into a
    // restart loop.
    watchdogLog("warn", { mode: WATCHDOG_MODE, reason: "invalid_configuration" });
    return;
  }

  const schema = env.ENVIO_PG_PUBLIC_SCHEMA || "envio";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    watchdogLog("warn", { mode: WATCHDOG_MODE, reason: "invalid_schema" });
    return;
  }

  const sql = postgres({
    host: env.ENVIO_PG_HOST,
    port: Number(env.ENVIO_PG_PORT),
    database: env.ENVIO_PG_DATABASE,
    username: env.ENVIO_PG_USER,
    password: env.ENVIO_POSTGRES_PASSWORD,
    ssl: env.ENVIO_PG_SSL_MODE === "false" ? false : "require",
    max: 1,
    connect_timeout: 10,
    idle_timeout: 20,
  });

  const tracker = new ChainProgressTracker({
    timeoutMs: WATCHDOG_TIMEOUT_MS,
    minBlockLag: WATCHDOG_MIN_BLOCK_LAG,
    startupGraceMs: WATCHDOG_STARTUP_GRACE_MS,
    cooldownMs: WATCHDOG_COOLDOWN_MS,
    consecutiveObservations: WATCHDOG_CONSECUTIVE_OBSERVATIONS,
    restartBudget: WATCHDOG_RESTART_BUDGET,
  });
  let checking = false;

  const check = async () => {
    const child = activeIndexerChild;
    if (!child || child.exitCode !== null || checking) return;

    checking = true;
    try {
      const rows = await sql`
        SELECT
          chain_id,
          latest_processed_block,
          latest_fetched_block_number,
          num_events_processed,
          to_jsonb(chain_metadata)->>'end_block' AS end_block
        FROM ${sql(schema)}.${sql("chain_metadata")} AS chain_metadata
      `;
      const heads = await observeLiveHeads({
        rows,
        env,
        timeoutMs: WATCHDOG_RPC_TIMEOUT_MS,
        concurrency: WATCHDOG_RPC_CONCURRENCY,
      });
      const observations = rows.map((row) => {
        const head = heads.get(Number(row.chain_id));
        if (!Number.isSafeInteger(head?.head)) {
          // Never include RPC URLs or provider errors in logs: URLs commonly
          // contain credentials/API keys. An unavailable source is unknown,
          // not evidence of an indexer failure.
          watchdogLog("warn", {
            chain: Number(row.chain_id),
            head: null,
            source: head?.source ?? "rpc",
            lag: null,
            reason: head?.reason ?? "unknown_head",
          });
        }
        return {
          ...row,
          liveHead: head?.head,
          headSource: head?.source,
        };
      });

      for (const stalled of tracker.observe(observations)) {
        watchdogLog(WATCHDOG_MODE === "restart" ? "error" : "warn", {
          mode: WATCHDOG_MODE,
          chain: stalled.chainId,
          head: stalled.head,
          target: stalled.target,
          source: stalled.source,
          lag: stalled.lag,
          reason: stalled.reason,
          processed: stalled.processed,
          fetched: stalled.fetched,
          events: stalled.events,
          stalledForMs: stalled.stalledFor,
          restartBudgetRemaining: stalled.restartBudgetRemaining,
        });
        if (WATCHDOG_MODE !== "restart") continue;
        if (!tracker.consumeRestartBudget()) {
          watchdogLog("warn", {
            mode: WATCHDOG_MODE,
            chain: stalled.chainId,
            head: stalled.head,
            source: stalled.source,
            lag: stalled.lag,
            reason: "restart_budget_exhausted",
          });
          continue;
        }

        // This intentionally terminates only the detached pnpm/envio process
        // group. No reset, migration, truncate, or checkpoint mutation occurs.
        watchdogRestartRequested = true;
        terminateIndexerProcessGroup(child);
        return;
      }
    } catch (error) {
      // Database maintenance and short connection failures must never take the
      // indexer down. A successful later pass resumes the same observations.
      watchdogLog("warn", {
        mode: WATCHDOG_MODE,
        reason: "chain_metadata_unavailable",
      });
    } finally {
      checking = false;
    }
  };

  watchdogLog("log", {
    mode: WATCHDOG_MODE,
    reason: "enabled",
    timeoutMs: WATCHDOG_TIMEOUT_MS,
    minBlockLag: WATCHDOG_MIN_BLOCK_LAG,
    startupGraceMs: WATCHDOG_STARTUP_GRACE_MS,
    cooldownMs: WATCHDOG_COOLDOWN_MS,
    consecutiveObservations: WATCHDOG_CONSECUTIVE_OBSERVATIONS,
    restartBudget: WATCHDOG_RESTART_BUDGET,
  });
  setInterval(check, WATCHDOG_INTERVAL_MS).unref();
};

await runPnpmOrExit(["envio", "local", "db-migrate", "up"]);

// Reconcile the readonly inherited role in the background for the whole life of
// the indexer — it survives the initial track and metadata rebuilds.
startReadonlyRoleReconciler();
startChainProgressWatchdog();

await runPnpmOrExit(["envio", "start"]);
