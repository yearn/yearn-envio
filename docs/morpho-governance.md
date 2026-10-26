# Morpho governance stream

Related: yearn/monitoring#437 and #446. This indexer change can deploy independently of the monitoring consumer. It sends no alerts.

`MorphoGovernanceEvent` stores one event occurrence at `<chainId>_<blockNumber>_<logIndex>`, with block hash, transaction hash, original ABI event name, vault generation, and ABI-named `argsJson`. Big integers are decimal strings and booleans remain JSON booleans. Native Envio reorg rollback removes/replaces occurrences; monitoring detects removed/changed/restored rows through bounded reconciliation.

Every vault in monitoring's explicit config is listed in `docs/morpho-coverage.json`. Deployment blocks were retrieved read-only from `https://api.morpho.org/graphql` (`vaults` / `vaultV2s`, `creationBlockNumber`) on 2026-10-24. Chain/contract start blocks are the earliest configured deployment for that generation. Revalidate the manifest whenever the monitoring allowlist changes. Vaults with an `excluded` reason (currently Ethereum V2 Yearn USDC and Yearn OG WETH V2: deposits too low to monitor) stay in the manifest but are commented out of `config.yaml`.

Indexed events: V1 `SubmitCap`, `SubmitMarketRemoval`, `SubmitTimelock`; V2 `Submit`, `Accept`, `SetOwner`, `SetCurator`, `AddAdapter`, `RemoveAdapter`. Each vault's contract `start_block` in `config.yaml` must be at or below its manifest `deploymentBlock`; `test/morpho-governance.test.ts` enforces this and that `config.yaml` addresses match the manifest exactly. Market risk and adapter-internal timelocks are excluded.

V2 also indexes `BurnShares(bytes32 indexed marketId, uint256 supplyShares)` from market adapters.
The event is emitted by `MorphoMarketV1AdapterV2`, as defined in its
[upstream interface](https://github.com/morpho-org/vault-v2/blob/21a03f6093f52a5f7b80e7690f8ed273d3088950/src/adapters/interfaces/IMorphoMarketV1AdapterV2.sol).
The existing `AddAdapter` event registers adapter addresses on all five V2 chains and stores their
vault association in `MorphoVaultV2Adapter`. Burn occurrences use the parent `vaultAddress`,
`vaultVersion: 2`, and the emitting `adapterAddress`; `argsJson` retains `marketId` and decimal-string
`supplyShares`. Vault-emitted occurrences leave `adapterAddress` unset. Associations and burn
tracking remain after `RemoveAdapter`, so subsequent burns remain observable. Reindex from vault
deployment when deploying this schema to discover existing adapters and backfill burns.

Set `ENVIO_RPC_URL_HYPEREVM` and `ENVIO_RPC_URL_ROBINHOOD` (Envio only injects `ENVIO_`-prefixed variables) to archive-capable RPC endpoints before deployment. These two chains use explicit RPC ingestion; source availability and production indexing latency must be observed before promising the five-second consumer target. Existing chains retain their current sources.

Run `pnpm codegen`, `pnpm build`, and `pnpm exec vitest run test/morpho-governance.test.ts`. Deploy, backfill all five chains to their live heads, and verify both HTTP and WebSocket entity access before starting the monitoring consumer in observation mode. Historical backfill must never send alerts. Consumer shadow/production cutover and hosting selection require a separate measured observation report; this change does not authorize or perform that cutover.
