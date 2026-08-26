# Yearn vault allocation indexer

This directory is a separately deployable Envio project for the producer side of
[yearn-envio issue #52](https://github.com/yearn/yearn-envio/issues/52). Its database and failure domain are intentionally independent from the primary multichain indexer in the repository root.

## Current implementation status

The current local implementation includes the Ethereum Gate 1 foundation and locally accepted Gate 2 and Gate 3 implementations:

- Dynamic discovery from the configured V3 registries, vault factories, RoleManager factory, RoleManager, and debt allocator factory.
- The 23 required allocation source events with explicit normalization-version-1 serializers.
- Lowercase machine keys, deterministic event IDs and JSON, top-level transaction envelope fields, and exact input selectors.
- The no-`originalAllocator` Ethereum debt allocator factory variant and immutable deployment binding needed to associate allocator events with a vault.
- Golden tests for every serializer.
- Append-only initial and updated RoleManager assignment history, plus current membership closure on `RemovedVault`.
- Explicit implementation recognition and queryable deployment/assignment conflicts.
- Deterministic same-block buffering and reconciliation when an allocator event precedes its factory registration.
- Exact Ethereum handler fixtures, full-versus-incremental replay equivalence, and fixed-block runtime-family verification.
- Separate recognition for the deployed non-vault-bound allocator factory family; its RoleManager assignees are `other`, not known vault-bound Generic allocators.
- The deployed vault-bound `UpdateStrategyDebtRatio` ABI in addition to the plural issue-contract variant.
- One accounting checkpoint per vault/block after `Deposit`, `Withdraw`, `DebtUpdated`, or `StrategyReported`, with deterministic same-block trigger merging.
- A chain-scoped, cached Envio Effect for canonical archive reads of `totalAssets`, `totalDebt`, and `totalIdle`, rate limited to five calls per second.
- EIP-1898 hash-pinned reads when supported, block-number reads with a second canonical-hash check otherwise, and fail-closed transient-only retries.
- An explicit official-factory checkpoint support boundary: custom registry/RoleManager vault implementations retain normalized events but are not given unproven accounting certification.
- A pinned four-release, 243-vault, 26-runtime-family mutation audit, fixed-block archive evidence, and a representative replay benchmark.

The source audit is recorded in [`ABI_AUDIT.md`](ABI_AUDIT.md), Gate 2 evidence is in [`GATE2_EVIDENCE.md`](GATE2_EVIDENCE.md), Gate 3 evidence is in [`GATE3_EVIDENCE.md`](GATE3_EVIDENCE.md), the Gate 4 consumer contract is in [`GATE4_CONTRACT.md`](GATE4_CONTRACT.md), current Gate 4 acceptance status is in [`GATE4_EVIDENCE.md`](GATE4_EVIDENCE.md), and replay/rollout operations are in [`RUNBOOK.md`](RUNBOOK.md).

This is not yet a certified allocation-history producer. In particular:

- Coverage manifests, committed historical fixtures, deployed parity, monitoring, and blue-green certification remain Gate 4 work.
- `safeForTimeline` coverage does not exist and must not be inferred from these rows.

## Local commands

Run from this directory:

```bash
corepack pnpm install
corepack pnpm codegen
corepack pnpm build
corepack pnpm test
corepack pnpm coverage:check
corepack pnpm coverage:publish # dry run; add -- --publish only for an approved candidate
corepack pnpm parity:gate4 # reports NOT RUN without candidate GraphQL and archive configuration
corepack pnpm monitor:gate4 # reports NOT RUN without candidate GraphQL and archive configuration
ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM=<archive-rpc> corepack pnpm verify:gate2:rpc
ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM=<archive-rpc> corepack pnpm audit:gate3:runtimes -- --blockscout --supported-only --verify-fixture
ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM=<archive-rpc> corepack pnpm verify:gate3:rpc
ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM=<archive-rpc> corepack pnpm benchmark:gate3:rpc
```

The RPC tools exit successfully with an explicit `NOT RUN` status when the variable is unset. They never print the configured URL. Gate 3 checkpoint processing fails closed when the variable is unset; use a dedicated archive-capable endpoint.

Gate 4 coverage is generated from `coverage/ethereum.json`. The checked-in revision is a complete draft inventory with 243 official-factory entries, 78 explicit custom-runtime exclusions, and zero `safeForTimeline` rows. `coverage:publish` validates generated-row freshness and performs no write unless `--publish` is explicit.

The allocation project generates its type metadata under `allocation/.envio/`; it does not use or modify the primary project's generated types or schema.

## Deployment boundary

Deploy this directory as its own Envio project and database. Do not point it at the primary indexer's database. Gate 3 consumes the dedicated `ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM` secret documented in `.env.example`; the URL is never included in application error messages.

The current Ethereum start block is deliberately broad. It is not a historical-completeness claim. Gate 4 must replace that operational starting point with evidence-backed coverage ranges and an immutable coverage revision before Kong consumes the data.
