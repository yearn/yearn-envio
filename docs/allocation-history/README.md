# Allocation event evidence

This module decodes and normalizes Ethereum, Base, and Katana allocator events for downstream consumers. Envio
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

## Arbitrary assigned addresses

The vaults team confirmed that an initial or replacement allocator can be any address. Both
`AddedNewVault` and `UpdateDebtAllocator` register nonzero addresses using the synthetic
`AssignedDebtAllocator` discovery ABI. Factory discovery uses that same broad registration on
the three supported chains. The shared ratio overload has the alias `SharedUpdateStrategyDebtRatio`.
Registration does not establish a contract family, code existence, or interface support.

Zero-address assignments are stored but are not registered for logs. Unknown custom allocators
retain their assignment even if no understood event is emitted. Shared ratio logs carry their
own vault; unknown vault-bound ratios and ambiguous control events remain unresolved. Later
factory evidence can resolve controls without changing their source IDs or narrowing capture.
Kong must distinguish event-shape evidence from support for an allocator's RPC interface.

`RemovedVault` and vault `UpdateRoleManager` events are normalized for historical authority
resolution. This evidence does not make Envio responsible for selecting the active assignment.

## Chain discovery

| Chain | ID | Vault-bound factory | Shared factory | Discovery start |
| --- | ---: | --- | --- | ---: |
| Ethereum | 1 | `0xfCF8c7C43dedd567083B422d6770F23B78D15BDe` | `0x03D43dF6FF894C848fC6F1A0a7E8a539Ef9A4C18` | 0 |
| Base | 8453 | `0xfCF8c7C43dedd567083B422d6770F23B78D15BDe` | `0x03D43dF6FF894C848fC6F1A0a7E8a539Ef9A4C18` | 0 |
| Katana | 747474 | None configured | `0x03D43dF6FF894C848fC6F1A0a7E8a539Ef9A4C18` | 0 |

Existing per-chain Role Managers and the Role Manager factory also discover assignments. The
current factory bytecode observations are saved in `fixtures/allocation/chain-discovery.json`.
The shared factory runtime matches across all three chains. Katana has no code at the known
vault-bound factory address, so that source is not configured there. Ethereum implementation
metadata is not copied into other chains' deployment rows.

These are configured sources and point-in-time observations, not completed replay or coverage
certification. Full persisted replay, process restart, and GraphQL cursor traversal remain
operational activation checks on each chain. The continuation tests exercise the in-memory
test indexer across processing calls; they do not claim a database restart was tested.

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
