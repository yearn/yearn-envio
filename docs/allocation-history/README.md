# Allocation policy event history

This module makes Ethereum allocator policy changes queryable without reconstructing the
application transaction from historical contract state. It intentionally covers event
normalization and association only; it does not restore the archive-RPC accounting checkpoint
subsystem reverted from `main` in `6e89373`.

## Supported allocator variants

| Variant | Factory association | Ratio event | Vault association |
| --- | --- | --- | --- |
| Legacy vault-bound | `NewDebtAllocator(allocator,vault)` | plural `UpdateStrategyDebtRatios(strategy,...)` | immutable factory `vault` |
| Current vault-bound | `NewDebtAllocator(allocator,vault)` | singular `UpdateStrategyDebtRatio(strategy,...)` | immutable factory `vault` |
| Shared | `NewDebtAllocator(allocator,governance)` | singular `UpdateStrategyDebtRatio(vault,strategy,...)` | indexed `vault` in the ratio event |

The shared factory's second address is governance, not a vault. The handler stores it as
deployment evidence and never uses it as a vault association.

Shared `UpdateKeeper` and `GovernanceTransferred` events do not carry a vault. They are written
to `UnresolvedAllocationSourceEvent` with reason `sharedAllocatorEventHasNoVault`; they are not
copied to every vault assigned to the allocator.

See [ABI_AUDIT.md](ABI_AUDIT.md) for source, bytecode, and real-log evidence.

## GraphQL contract for Kong

`AllocationSourceEvent` contains the canonical lowercase vault, allocator, strategy, event
signature and ABI variant; explicit target/max/total ratios; block and log coordinates; and the
top-level transaction sender, target, and selector.

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

Continue pagination from the full tuple
`(blockNumber, transactionIndex, logIndex, id)`. A transaction hash alone is not a cursor because
one policy transaction can emit many ratio events.

## Coverage and certification

`VaultAllocationEventCoverage` is observational and fail-closed. During indexing it records the
first/last observed block and count for the shared event family, but leaves all certification
flags and `safeForTimeline` false. A broad configured start block or a ready Envio deployment is
not a completeness claim.

The committed evidence snapshot contains 4,020 historical logs through block `25,898,430` for:

- yvUSDC-1: 1,759 logs
- yvUSDT-1: 2,122 logs
- yvUSD: 139 logs

Those counts are external evidence, not deployed Envio certification. `safeForTimeline` may only
become true after a fresh deployed replay verifies the complete range, a fresh-versus-incremental
comparison matches, GraphQL pagination returns every row once, and the range has zero unresolved
events.

## Local validation

Run from the repository root:

```bash
npm run codegen
npm run build
npm run allocation:test
npm run allocation:coverage:check
npm test
npm run check:config -- --base-ref origin/main
```

The coverage check validates the real-log fixture and the fail-closed certification invariant. It
does not turn missing deployment evidence into a pass.
