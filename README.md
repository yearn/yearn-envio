## Yearn V3 Vault Indexer (and Timelocks too)

This repository contains an Envio indexer for Yearn V3 vaults and a fee calculator script to analyze depositor positions. Timelock contracts have also been added to reduce dependency on Tenderly alert monitoring (and reduce Tenderly RPC consumption/costs).

*Please refer to the [documentation website](https://docs.envio.dev) for a thorough guide on all [Envio](https://envio.dev) indexer features*

### Debugging

1. Start docker desktop
2. Run `ps auxf | grep docker-proxy` and then `sudo kill 1234` to manually kill the processes with docker-proxy
3. Stop and remove the current docker containers
```
docker stop generated-graphql-engine-1 generated-envio-postgres-1
docker rm generated-graphql-engine-1 generated-envio-postgres-1
```
4. Now run envio with `pnpm dev`

### Pre-requisites

- [Node.js (use v18 or newer)](https://nodejs.org/en/download/current)
- [pnpm (use v8 or newer)](https://pnpm.io/installation)
- [Docker desktop](https://www.docker.com/products/docker-desktop/)

### Setup

```bash
# Install dependencies
pnpm install
```

### Run the Indexer

```bash
pnpm dev
```

Visit http://localhost:8080 to see the GraphQL Playground, local password is `testing`.

### Environment Variables

Copy `.env.example` to `.env` and fill in values as needed:

- `ENVIO_GRAPHQL_URL`, `ENVIO_PASSWORD`
- `ENVIO_PG_SSL_MODE=false` for local Docker or Render internal Postgres
- `HASURA_GRAPHQL_ROLE=admin`
- `ENVIO_THROTTLE_CHAIN_METADATA_INTERVAL_MILLIS=500`
- `ENVIO_THROTTLE_PRUNE_STALE_DATA_INTERVAL_MILLIS=30000`
- `ENVIO_THROTTLE_LIVE_METRICS_BENCHMARK_INTERVAL_MILLIS=1000`
- `ENVIO_THROTTLE_JSON_FILE_BENCHMARK_INTERVAL_MILLIS=500`
- `RPC_URL` (global override), or chain-specific `RPC_URL_ETHEREUM`, `RPC_URL_BASE`, `RPC_URL_ARBITRUM`, `RPC_URL_POLYGON`

### Render

`render.yaml` now sets the Envio runtime vars that recent Envio versions require in production mode. The indexer also derives `HASURA_GRAPHQL_ENDPOINT` from `HASURA_SERVICE_HOST` and `HASURA_SERVICE_PORT`, so you should not need a manual post-deploy override in Render anymore. The only secrets you still need to provide in the Render dashboard are:

The indexer start script derives `ENVIO_PG_*` from Render's `ENVIO_DATABASE_URL`, runs `envio local db-migrate up`, then runs `envio start` in the same environment. This keeps Envio's entity and history tables in sync with `schema.graphql` before rollback/reorg handling can touch them.

The start script has no automatic database-reset path. Persisted-config
incompatibilities, missing-chain rows, watchdog restarts, database failures,
and all other startup errors fail closed and preserve PostgreSQL for
investigation.

The indexer is pinned to Envio 3.3, which includes upstream multichain and
factory-indexer scheduler/stability improvements.

On Render, the same start script monitors `chain_metadata` while Envio runs.
It gets an independent `eth_blockNumber` head through the corresponding
`ENVIO_RPC_URL_<CHAIN>` variable, so `chain_metadata.block_height` is never
mistaken for a live chain head. If a chain is materially behind that head and
its processed block, fetched block, and event count all remain unchanged, the
watchdog emits structured diagnostics with the chain, head, source, lag, and
reason. Render defaults to `ENVIO_STALL_WATCHDOG_MODE=observe`; set the mode to
`restart` only after reviewing those diagnostics. Restart mode terminates only
the indexer child process group, so Render resumes from the existing database
checkpoint without resetting or modifying it. `off` disables the watchdog.

The interval, timeout, minimum lag, startup grace, cooldown, required
consecutive observations, restart budget, RPC timeout, and RPC concurrency are
configured by `ENVIO_STALL_WATCHDOG_INTERVAL_MILLIS`,
`ENVIO_STALL_WATCHDOG_TIMEOUT_MILLIS`,
`ENVIO_STALL_WATCHDOG_MIN_BLOCK_LAG`,
`ENVIO_STALL_WATCHDOG_STARTUP_GRACE_MILLIS`,
`ENVIO_STALL_WATCHDOG_COOLDOWN_MILLIS`,
`ENVIO_STALL_WATCHDOG_CONSECUTIVE_OBSERVATIONS`,
`ENVIO_STALL_WATCHDOG_RESTART_BUDGET`,
`ENVIO_STALL_WATCHDOG_RPC_TIMEOUT_MILLIS`, and
`ENVIO_STALL_WATCHDOG_RPC_CONCURRENCY`.

- `ENVIO_API_TOKEN`
- `HASURA_GRAPHQL_ADMIN_SECRET`
- `HASURA_GRAPHQL_JWT_SECRET`

For `HASURA_GRAPHQL_JWT_SECRET`, use a JSON value that pins all JWT-authenticated traffic to the `readonly` Hasura role:

```json
{"type":"HS256","key":"<random-secret>","claims_namespace":"https://hasura.io/jwt/claims","claims_format":"json","claims_map":{"x-hasura-default-role":{"value":"readonly"},"x-hasura-allowed-roles":{"value":["readonly"]}}}
```

Generate the `key` value with:

```bash
openssl rand -base64 32
```

Keep this value in Render as a secret env var and do not commit it to the repository.

### Generate Hasura JWTs

This repo includes a helper that reads `HASURA_GRAPHQL_JWT_SECRET` and generates a signed JWT. It always emits Hasura claims with the `readonly` role.

```bash
HASURA_GRAPHQL_JWT_SECRET='{"type":"HS256","key":"<random-secret>","claims_namespace":"https://hasura.io/jwt/claims","claims_format":"json","claims_map":{"x-hasura-default-role":{"value":"readonly"},"x-hasura-allowed-roles":{"value":["readonly"]}}}' \
pnpm jwt:generate --sub user-123 --ttl 3600 --user-id user-123
```

### Calculate Depositor Fees

Once the indexer is running, use the Python calculator to analyze any depositor:

```bash
python3 scripts/calc_depositor_fees.py <depositor-address>
```

**Example:**
```bash
python3 scripts/calc_depositor_fees.py 0x93A62dA5a14C80f265DAbC077fCEE437B1a0Efde
```

The script now validates that the performance fee stays constant across the depositor's entire history and that the management fee remains zero. It samples five even-spaced blocks between the first and last event, checks the fee configuration via the accountant contract, and stops with a clear error if anything changed so you can trust the rest of the calculation.

**Output includes:**
- Complete list of deposits, withdrawals, and transfers
- Current position (shares and value)
- Total profit/loss to date
- Estimated fees paid
- Complete event timeline
- Debugging information for fee calculation verification

**Environment Variables:**
- `ENVIO_GRAPHQL_URL` - GraphQL endpoint (default: `http://localhost:8080/v1/graphql`)
- `ENVIO_PASSWORD` - GraphQL password (default: `testing`)
- `RPC_URL` - Ethereum RPC endpoint for current state queries (default: `https://eth.merkle.io`)

### Generate files from `config.yaml` or `schema.graphql`

```bash
pnpm codegen
```
