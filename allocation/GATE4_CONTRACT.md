# Gate 4 coverage and query contract

Gate 4 is in progress. This document defines the consumer contract before any coverage revision can be certified. No `safeForTimeline = true` row exists, and deployed-candidate parity has not run.

## Coverage authority

`VaultAllocationCoverage` is revision scoped. Its ID is `${coverageRevision}:${chainId}:${vaultLower}`. A checked-in manifest will be authoritative; the database entity and human-readable coverage matrix must be deterministic projections of that same file.

Manifest validation is fail closed:

- addresses and hashes must be lowercase fixed-width values;
- the producer commit must be a full lowercase Git SHA;
- ranges cannot be inverted or duplicated within a revision;
- `safeForTimeline` requires every completeness flag, no known gaps, and a non-null earliest safe block;
- a new certification must use a new immutable `coverageRevision` rather than changing an accepted revision in place.

The manifest additionally carries the evidence needed to generate the human matrix: deployment and discovery blocks, first required event, allocator-history start, API version, runtime hash, earliest safe block, and explicit gaps.

## Event pagination

Scope every request by exact `chainId` and lowercase `vaultAddress`. Before executing a continuation, validate that the structured cursor has version 1 and belongs to the same chain, vault, and `coverageRevision`. A mismatch is an error; it never silently restarts pagination.

Initial page:

```graphql
query AllocationEventsInitialPage(
  $chainId: Int!
  $vaultAddress: String!
  $limit: Int!
) {
  AllocationSourceEvent(
    where: {
      chainId: { _eq: $chainId }
      vaultAddress: { _eq: $vaultAddress }
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
    normalizationVersion
    abiVariant
    blockNumber
    blockTimestamp
    blockHash
    transactionHash
    transactionIndex
    logIndex
    topLevelTransactionFrom
    topLevelTransactionTo
    topLevelInputSelector
    strategyAddress
    argsJson
  }
}
```

Continuation page:

```graphql
query AllocationEventsContinuationPage(
  $chainId: Int!
  $vaultAddress: String!
  $limit: Int!
  $blockNumber: Int!
  $transactionIndex: Int!
  $logIndex: Int!
  $id: String!
) {
  AllocationSourceEvent(
    where: {
      chainId: { _eq: $chainId }
      vaultAddress: { _eq: $vaultAddress }
      _or: [
        { blockNumber: { _gt: $blockNumber } }
        {
          blockNumber: { _eq: $blockNumber }
          transactionIndex: { _gt: $transactionIndex }
        }
        {
          blockNumber: { _eq: $blockNumber }
          transactionIndex: { _eq: $transactionIndex }
          logIndex: { _gt: $logIndex }
        }
        {
          blockNumber: { _eq: $blockNumber }
          transactionIndex: { _eq: $transactionIndex }
          logIndex: { _eq: $logIndex }
          id: { _gt: $id }
        }
      ]
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
    normalizationVersion
    abiVariant
    blockNumber
    blockTimestamp
    blockHash
    transactionHash
    transactionIndex
    logIndex
    topLevelTransactionFrom
    topLevelTransactionTo
    topLevelInputSelector
    strategyAddress
    argsJson
  }
}
```

Default page size is 500; maximum is 2,000. The cursor payload is:

```json
{
  "v": 1,
  "chainId": 1,
  "vaultAddress": "0x0000000000000000000000000000000000000000",
  "coverageRevision": "ethereum-example-revision",
  "blockNumber": 123,
  "transactionIndex": 4,
  "logIndex": 17,
  "id": "1:0x0000000000000000000000000000000000000000000000000000000000000000:17"
}
```

## Latest checkpoint at a target block

```graphql
query LatestVaultAccountingCheckpoint(
  $chainId: Int!
  $vaultAddress: String!
  $targetBlock: Int!
) {
  VaultAccountingCheckpoint(
    where: {
      chainId: { _eq: $chainId }
      vaultAddress: { _eq: $vaultAddress }
      blockNumber: { _lte: $targetBlock }
    }
    order_by: [{ blockNumber: desc }]
    limit: 1
  ) {
    id
    chainId
    vaultAddress
    blockNumber
    blockTimestamp
    blockHash
    totalAssets
    totalDebt
    totalIdle
    accountingIdentityHolds
    canonicalBlockVerified
    source
    sourceEventIds
  }
}
```

## Endpoint, authentication, and errors

The candidate endpoint and its authentication mode belong to the Gate 4 deployment record; they are not known locally yet. The parity harness must accept them only through dedicated environment variables and must never print their values.

Hasura/transport errors abort the page. Malformed cursors, unsupported cursor versions, scope/revision mismatches, and page sizes outside 1–2,000 are caller errors. No error path returns an empty page as a successful restart.

## Remaining acceptance work

- Build the complete versioned Ethereum manifest and deterministic entity/matrix publication.
- Commit all required exact yvWETH/yvUSDC and loss-sensitive fixtures.
- Run credentialed parity against a deployed candidate.
- Prove full replay equals incremental continuation at the same cutoff.
- Record replay/database/cache/GraphQL metrics and monitoring.
- Complete the blue-green deployment and backout runbook.
