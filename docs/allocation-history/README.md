# Yearn Vault Allocation History

This directory contains the documentation and acceptance evidence for [yearn-envio issue #52](https://github.com/yearn/yearn-envio/issues/52). The implementation and its support files use the repository's shared root-level structure.

Allocation History is part of the existing Envio project. It does not have a separate package, configuration, schema, database, or permanent server.

For a non-technical overview in simple English, see [`ISSUE_52_EXPLAINER.md`](ISSUE_52_EXPLAINER.md).

## Architecture

The shared project uses:

- root [`config.yaml`](../../config.yaml);
- root [`schema.graphql`](../../schema.graphql);
- root [`src/EventHandlers.ts`](../../src/EventHandlers.ts) as the handler entrypoint;
- allocation helpers under [`src/allocation/`](../../src/allocation/);
- focused tests under [`test/allocation/`](../../test/allocation/);
- operational tools under [`scripts/allocation/`](../../scripts/allocation/);
- exact evidence under [`fixtures/allocation/`](../../fixtures/allocation/) and [`coverage/allocation/`](../../coverage/allocation/);
- one generated-code pass and one database/Hasura deployment.

The existing indexer processes several chains. Allocation History is enabled only for Ethereum. Every allocation handler and archive read has an explicit Ethereum guard.

Historical vault totals come from the dedicated `ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM` variable. The URL is never written to logs or entities.

If an archive read fails after its retry budget:

1. No checkpoint is written.
2. A sanitized `VaultAccountingCheckpointFailure` row records the gap.
3. `safeForTimeline` stays false for the affected range.
4. The shared indexer continues processing unrelated events.
5. A later successful replay marks the failure row as resolved.

## Current implementation status

The local implementation includes:

- The 23 required allocation source events with explicit normalization-version-1 serializers.
- Lowercase machine keys, deterministic IDs and JSON, transaction envelope fields, and exact input selectors.
- Immutable debt-allocator deployment provenance.
- Initial and updated RoleManager assignment history.
- Explicit unknown, unbound, and conflict states.
- Deterministic same-block allocator-event reconciliation.
- Exact Ethereum handler fixtures and full-versus-incremental replay equivalence.
- One accounting checkpoint per supported vault and block after `Deposit`, `Withdraw`, `DebtUpdated`, or `StrategyReported`.
- Canonical EIP-1898 archive reads, a verified block-number fallback, rate limiting, timeouts, and transient-only retry.
- Non-fatal, queryable archive failure records.
- An official-factory accounting support boundary for four audited Vault V3 releases.
- A 243-vault draft coverage inventory and 78 explicit custom-runtime exclusions.
- Candidate parity, monitoring, coverage publication, and rollout tools.

Evidence and contracts:

- [`ABI_AUDIT.md`](ABI_AUDIT.md)
- [`GATE2_EVIDENCE.md`](GATE2_EVIDENCE.md)
- [`GATE3_EVIDENCE.md`](GATE3_EVIDENCE.md)
- [`GATE4_CONTRACT.md`](GATE4_CONTRACT.md)
- [`GATE4_EVIDENCE.md`](GATE4_EVIDENCE.md)
- [`RUNBOOK.md`](RUNBOOK.md)

This is not yet a certified allocation-history producer. Deployed-candidate replay, credentialed parity, monitoring, full-versus-incremental comparison, and certification have not run. The draft has zero `safeForTimeline` rows.

## Local commands

Run every command from the repository root:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm codegen
corepack pnpm build
corepack pnpm test
corepack pnpm allocation:test
corepack pnpm allocation:coverage:check
corepack pnpm allocation:coverage:publish
corepack pnpm allocation:parity:gate4
corepack pnpm allocation:monitor:gate4
```

RPC validation commands:

```bash
ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM=<archive-rpc> corepack pnpm allocation:verify:gate2:rpc
ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM=<archive-rpc> corepack pnpm allocation:audit:gate3:runtimes -- --blockscout --supported-only --verify-fixture
ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM=<archive-rpc> corepack pnpm allocation:verify:gate3:rpc
ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM=<archive-rpc> corepack pnpm allocation:benchmark:gate3:rpc
```

The RPC and candidate tools report `NOT RUN` when their required variables are missing. A skipped command is not a pass.

Coverage publication is a dry run unless `-- --publish` is explicit. Coverage validation and publication require the recorded producer commit to be an ancestor of the checked-out branch, validate generated-file freshness, and refuse safe coverage for a range with unresolved checkpoint failures.

## Deployment boundary

Deploy a candidate revision of the existing Envio project with fresh candidate storage. Envio cannot resume an initialized database after persisted event configuration changes. A temporary candidate may run beside the current production revision during replay and validation, but the final architecture has one Envio project, replayed database, and active server.

The broad configured start block is not a completeness claim. Kong must consume only an immutable coverage revision whose rows are explicitly certified with `safeForTimeline = true`.
