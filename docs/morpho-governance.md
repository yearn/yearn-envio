# Morpho governance stream

Related: yearn/monitoring#437 and #446. This indexer change can deploy independently of the monitoring consumer. It sends no alerts.

`MorphoGovernanceEvent` stores one event occurrence at `<chainId>_<blockNumber>_<logIndex>`, with block hash, transaction hash, original ABI event name, vault generation, and ABI-named `argsJson`. Big integers are decimal strings and booleans remain JSON booleans. Native Envio reorg rollback removes/replaces occurrences; monitoring detects removed/changed/restored rows through bounded reconciliation.

Every vault in monitoring's explicit config is listed in `docs/morpho-coverage.json`. Deployment blocks were retrieved read-only from `https://api.morpho.org/graphql` (`vaults` / `vaultV2s`, `creationBlockNumber`) on 2026-10-24. Chain/contract start blocks are the earliest configured deployment for that generation. Revalidate the manifest whenever the monitoring allowlist changes. Constructor / initial timelock events are required for a complete baseline. Market risk and adapter-internal timelocks are excluded.

Set `MORPHO_RPC_HYPEREVM` and `MORPHO_RPC_ROBINHOOD` to archive-capable RPC endpoints before deployment. These two chains use explicit RPC ingestion; source availability and production indexing latency must be observed before promising the five-second consumer target. Existing chains retain their current sources.

Run `pnpm codegen`, `pnpm build`, and `pnpm exec vitest run test/morpho-governance.test.ts`. Deploy, backfill all five chains to their live heads, and verify both HTTP and WebSocket entity access before starting the monitoring consumer in observation mode. Historical backfill must never send alerts. Consumer shadow/production cutover and hosting selection require a separate measured observation report; this change does not authorize or perform that cutover.
