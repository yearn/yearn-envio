# Yearn vault allocation indexer

This directory is a separately deployable Envio project for the producer side of
[yearn-envio issue #52](https://github.com/yearn/yearn-envio/issues/52). Its database and failure domain are intentionally independent from the primary multichain indexer in the repository root.

## Current implementation status

The initial slice implements the Ethereum Gate 1 foundation:

- Dynamic discovery from the configured V3 registries, vault factories, RoleManager factory, RoleManager, and debt allocator factory.
- The 23 required allocation source events with explicit normalization-version-1 serializers.
- Lowercase machine keys, deterministic event IDs and JSON, top-level transaction envelope fields, and exact input selectors.
- The no-`originalAllocator` Ethereum debt allocator factory variant and immutable deployment binding needed to associate allocator events with a vault.
- Golden tests for every serializer.

The initial pinned source evidence is recorded in [`ABI_AUDIT.md`](ABI_AUDIT.md).

This is not yet a certified allocation-history producer. In particular:

- RoleManager assignment history, conflict/unresolved entities, and the same-block allocator-registration audit remain Gate 2 work.
- Archive-RPC accounting checkpoints and the vault mutation audit remain Gate 3 work.
- Coverage manifests, committed historical fixtures, deployed parity, monitoring, and blue-green certification remain Gate 4 work.
- `safeForTimeline` coverage does not exist and must not be inferred from these rows.

## Local commands

Run from this directory:

```bash
corepack pnpm install
corepack pnpm codegen
corepack pnpm build
corepack pnpm test
```

The allocation project generates its type metadata under `allocation/.envio/`; it does not use or modify the primary project's generated types or schema.

## Deployment boundary

Deploy this directory as its own Envio project and database. Do not point it at the primary indexer's database. Gate 3 will require a dedicated `ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM` secret; the variable is documented in `.env.example`, but it is not consumed until checkpoint Effects are implemented.

The current Ethereum start block is deliberately broad. It is not a historical-completeness claim. Gate 4 must replace that operational starting point with evidence-backed coverage ranges and an immutable coverage revision before Kong consumes the data.
