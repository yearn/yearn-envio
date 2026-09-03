# Allocation event evidence

This module decodes and normalizes Ethereum allocator events for downstream consumers. Envio
provides indexed event evidence only. It does not reconstruct allocation state, certify a
complete timeline, or restore the checkpoint and Gate 4 system reverted from `main` in
`6e89373`.

## Supported allocator variants

| Variant | Factory association | Ratio event | Vault association |
| --- | --- | --- | --- |
| Legacy vault-bound | `NewDebtAllocator(allocator,vault)` | plural `UpdateStrategyDebtRatios(strategy,...)` | immutable factory `vault` |
| Current vault-bound | `NewDebtAllocator(allocator,vault)` | singular `UpdateStrategyDebtRatio(strategy,...)` | immutable factory `vault` |
| Shared | `NewDebtAllocator(allocator,governance)` | singular `UpdateStrategyDebtRatio(vault,strategy,...)` | indexed `vault` in the ratio event |

The shared factory's second address is governance, not a vault. The handler stores it as
deployment evidence and never uses it as a vault association.

Shared `UpdateKeeper` and `GovernanceTransferred` events do not carry a vault. They are written
once as allocator-scoped `AllocationSourceEvent` rows with `vaultAddress: null`; they are not
copied to every vault assigned to the allocator.

See [ABI_AUDIT.md](ABI_AUDIT.md) for source, bytecode, and real-log evidence.

## GraphQL contract for Kong

`AllocationSourceEvent` contains an explicit `scope`:

- `vault` events have a canonical lowercase `vaultAddress`.
- `allocator` events have `vaultAddress: null` and are queried by lowercase `sourceAddress`.

Every row includes the source, event signature and ABI variant, block and log coordinates, and
the top-level transaction sender, target, and selector. Ratio events also include the strategy
and explicit target, maximum, and total ratios.

### Vault-scoped ratio events

A deterministic ascending query is:

```graphql
query AllocationPolicyApplications(
  $chainId: Int!
  $vault: String!
  $fromBlock: Int!
  $throughBlock: Int!
  $limit: Int!
) {
  AllocationSourceEvent(
    where: {
      chainId: { _eq: $chainId }
      scope: { _eq: "vault" }
      vaultAddress: { _eq: $vault }
      blockNumber: { _gte: $fromBlock, _lte: $throughBlock }
      eventName: { _eq: "UpdateStrategyDebtRatio" }
    }
    order_by: [
      { blockNumber: asc }
      { transactionIndex: asc }
      { logIndex: asc }
      { id: asc }
    ]
    limit: $limit
  ) {
    id
    chainId
    vaultAddress
    scope
    sourceAddress
    sourceType
    eventName
    signature
    abiVariant
    associationEvidence
    strategyAddress
    newTargetRatio
    newMaxRatio
    newTotalDebtRatio
    blockNumber
    blockTimestamp
    transactionHash
    transactionIndex
    logIndex
    topLevelTransactionFrom
    topLevelTransactionTo
    topLevelInputSelector
  }
}
```

### Allocator-scoped control events

```graphql
query AllocatorControlEvents(
  $chainId: Int!
  $allocator: String!
  $fromBlock: Int!
  $throughBlock: Int!
  $limit: Int!
) {
  AllocationSourceEvent(
    where: {
      chainId: { _eq: $chainId }
      scope: { _eq: "allocator" }
      sourceAddress: { _eq: $allocator }
      blockNumber: { _gte: $fromBlock, _lte: $throughBlock }
      eventName: { _in: ["UpdateKeeper", "GovernanceTransferred"] }
    }
    order_by: [
      { blockNumber: asc }
      { transactionIndex: asc }
      { logIndex: asc }
      { id: asc }
    ]
    limit: $limit
  ) {
    id
    chainId
    scope
    vaultAddress
    sourceAddress
    eventName
    signature
    abiVariant
    associationEvidence
    blockNumber
    blockTimestamp
    transactionHash
    transactionIndex
    logIndex
    topLevelTransactionFrom
    topLevelTransactionTo
    topLevelInputSelector
    argsJson
  }
}
```

Kong should traverse the complete ordered result set using
`(blockNumber, transactionIndex, logIndex, id)`. A transaction hash alone is not a sufficient
cursor because one transaction can emit several allocator events.

## Envio and Kong responsibilities

Envio owns contract discovery, ABI decoding, canonical event association when the log or factory
establishes it, lowercase query keys, and normalized event storage. Events that require missing
canonical evidence remain in `UnresolvedAllocationSourceEvent`.

Kong owns:

- Complete GraphQL cursor traversal
- Archive-RPC historical state reads
- Before and after snapshots
- Transaction traces and actor enrichment
- Allocation grouping and classification
- DOA policy matching
- Accounting reconciliation
- Materialized-run certification
- GraphQL and REST presentation

## Historical fixture evidence

The committed fixture records an external count snapshot of 4,020 historical logs through block
`25,898,430` for:

- yvUSDC-1: 1,759 logs
- yvUSDT-1: 2,122 logs
- yvUSD: 139 logs

These counts document the source evidence used to select representative fixtures. They are not a
claim that an Envio deployment has replayed every log or that a Kong materialization is certified.

## Deployment validation

Before Kong consumes the new entities, run a fresh Envio replay and confirm operationally that:

- The shared factory is discovered and every emitted allocator is dynamically registered.
- Historical ratio events exist for yvUSDC-1, yvUSDT-1, and yvUSD.
- GraphQL cursor traversal returns each expected row once.
- Allocator-scoped keeper and governance events are queryable.
- No allocator-scoped event is incorrectly associated with a vault.

Record those results as deployment evidence. Do not publish Envio timeline-certification state.

## Local validation

Run from the repository root:

```bash
npm run codegen
npm run build
npm run allocation:test
npm run allocation:fixture:check
npm test
npm run check:config -- --base-ref origin/main
```

The fixture check validates exact ABI decoding, normalized field values, deterministic ordering,
unique IDs, and integrity of the historical evidence snapshot. It does not exercise a deployed
GraphQL endpoint or certify historical completeness.
