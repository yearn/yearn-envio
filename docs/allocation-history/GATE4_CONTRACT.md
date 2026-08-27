# Gate 4 coverage and query contract

Gate 4 is in progress. This document defines the consumer contract before any coverage revision can be certified. No `safeForTimeline = true` row exists, and deployed-candidate parity has not run.

The current checked-in draft revision accounts for all 321 vaults discovered through Ethereum block 25,835,600: 243 official-factory vaults produce candidate coverage rows and 78 custom registry/RoleManager implementations are explicit exclusions. All 243 rows remain unsafe, with event-history, allocator-history, and deployed-candidate parity gaps recorded.

## Coverage authority

`VaultAllocationCoverage` is revision scoped. Its ID is `${coverageRevision}:${chainId}:${vaultLower}`. A checked-in manifest will be authoritative; the database entity and human-readable coverage matrix must be deterministic projections of that same file.

Manifest validation is fail closed:

- addresses and hashes must be lowercase fixed-width values;
- the producer commit must be a full lowercase Git SHA;
- ranges cannot be inverted or duplicated within a revision;
- `safeForTimeline` requires every completeness flag, no known gaps, and a non-null earliest safe block;
- parsed JSON requires exact boolean, array, string, address, hash, and block-range types; truthy string flags are rejected;
- a safe row's earliest safe block must equal its published coverage start and remain within the validated vault range;
- a safe row is rejected when an unresolved `VaultAccountingCheckpointFailure` exists inside its published range;
- a new certification must use a new immutable `coverageRevision` rather than changing an accepted revision in place.

The manifest additionally carries the evidence needed to generate the human matrix: exact registry/factory/RoleManager discovery records and block hashes, deployment and discovery blocks, first required event, allocator-history start, API version, runtime hash, earliest safe block, and explicit gaps. The draft inventory covers the directly configured legacy RoleManager plus all 33 factory-created RoleManagers.

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

The candidate endpoint and its authentication mode belong to the Gate 4 deployment record. Coverage publication and parity reuse the shared `ENVIO_GRAPHQL_URL` endpoint and optional `ENVIO_PASSWORD` bearer token. Historical reads reuse `ENVIO_RPC_URL_ETHEREUM`, which must be archive-capable. Publication dry-runs unless `--publish` is explicit, verifies an already-published revision byte-for-byte, and refuses partial or conflicting immutable revisions. The validation harnesses never print credential values.

Hasura/transport errors abort the page. Malformed cursors, unsupported cursor versions, scope/revision mismatches, and page sizes outside 1–2,000 are caller errors. No error path returns an empty page as a successful restart.

## Unresolved checkpoint failures

Before a range is certified or consumed, query for unresolved archive-read failures:

```graphql
query UnresolvedCheckpointFailures(
  $chainId: Int!
  $vaultAddress: String!
  $coverageStartBlock: Int!
  $validatedThroughBlock: Int!
) {
  VaultAccountingCheckpointFailure(
    where: {
      chainId: { _eq: $chainId }
      vaultAddress: { _eq: $vaultAddress }
      blockNumber: { _gte: $coverageStartBlock, _lte: $validatedThroughBlock }
      resolved: { _eq: false }
    }
    order_by: [{ blockNumber: asc }]
  ) {
    id
    blockNumber
    expectedBlockHash
    reason
    sourceEventIds
  }
}
```

The result must be empty for a safe range. Failure reasons are stable categories and never contain an RPC URL or provider response. A later successful replay preserves the failure record with `resolved = true` and links it to the checkpoint.

## Exact Ethereum parity fixtures

`fixtures/allocation/ethereum/gate4-parity.json` pins three canonical blocks and their exact normalized events, transaction envelopes, block-end vault accounting, and full lifecycle-seen strategy debt state:

- yvWETH-1 multi-strategy debt updates plus a same-transaction Withdraw;
- yvUSDC-1 loss-sensitive report for a positive-debt strategy with no allocator target event in the audited range;
- yvUSDC-1 Deposit whose block-end assets are entirely idle.

The fixture also embeds the exact expected source event, assignment, and unbound-deployment provenance for the committed yvUSDC-1 `UpdateDebtAllocator` change in `gate2.json`. `allocation:parity:gate4` compares the full normalized event envelope, checkpoint, assignment, provenance, and unresolved-failure rows with the candidate shared deployment; exercises the documented initial and continuation queries, including a same-transaction yvWETH page boundary; then independently repeats the accounting read through the archive RPC. It reports `NOT RUN` when either credential set is absent and never prints their values.

## Combined shared-deployment validation

Run Gate 4 in the normal shared multichain instance. A separate Ethereum-only Envio deployment is not required. The first live replay with an unusable Ethereum RPC already proved that sanitized allocation failures do not stop shared indexing, so retain that incident as failure-isolation evidence instead of deliberately breaking the RPC again.

The corrected fresh replay must prove Ethereum checkpoint recovery and allocation parity while the existing whole-indexer monitor verifies every configured chain and legacy entity in the same observation window.

## Remaining acceptance work

- Replace the complete draft Ethereum manifest with a certified immutable revision after parity; deterministic entity/matrix generation and guarded publication are implemented.
- Run the implemented credentialed parity harness against a deployed candidate; local runs remain `NOT RUN` without candidate configuration.
- Prove full replay equals incremental continuation at the same cutoff.
- Record replay/database/cache/GraphQL metrics plus allocation and whole-indexer monitoring from the same shared run.
- Complete the shared-deployment candidate replay, cutover, and backout runbook.
