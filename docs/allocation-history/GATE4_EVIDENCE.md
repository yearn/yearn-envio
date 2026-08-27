# Gate 4 evidence and acceptance status

Gate 4 is **not accepted** as of 2026-08-27. The shared deployment is running and allocation events continue indexing. Its first replay used an unusable Ethereum RPC, so it produced sanitized unresolved failure rows and no accounting checkpoints. That run proves failure isolation for the shared indexer, but not checkpoint correctness, recovery, parity, or coverage certification.

## Implemented locally

- `VaultAllocationCoverage` and fail-closed immutable manifest validation.
- Exact initial/continuation event queries, latest-checkpoint query, strict revision-scoped cursor validation, and same-transaction page-boundary reconstruction.
- Complete draft Ethereum discovery authority through block 25,835,600 (`0x3f7c…3dec`): 243 official-factory candidate rows, 78 explicit custom-runtime exclusions, 34 RoleManagers, 134 `AddedNewVault` events, and zero `safeForTimeline` rows.
- Deterministic entity JSON and Markdown matrix generated from the same manifest, with drift checking.
- Guarded GraphQL publication: dry-run by default, stale-output rejection, exact existing-revision verification, and one atomic insert for a new immutable revision.
- Read-only candidate parity harness, readiness monitor, unresolved-failure certification guards, and shared-deployment recovery/backout runbook.

## Exact Ethereum fixtures

`fixtures/allocation/ethereum/gate4-parity.json` was captured from canonical archive state and raw Blockscout logs:

| Case | Block | Evidence |
| --- | ---: | --- |
| yvWETH-1 multi-strategy update/withdraw | 21,589,454 | Four ordered normalized events; seven lifecycle-seen strategies; two positive debts; strategy debt sum equals `totalDebt` |
| yvUSDC-1 outside-optimizer loss report | 24,896,762 | Positive-debt strategy, loss `1`, zero matching singular/plural allocator target logs through the block, full 15-strategy debt reconciliation |
| yvUSDC-1 deposit/idle change | 19,441,994 | Exact Deposit; `totalAssets = totalIdle = 3015874599`; `totalDebt = 0` |

The fixture references the exact yvUSDC-1 `UpdateDebtAllocator` change already pinned in `gate2.json` at block 20,987,762.

The capture command re-reads canonical block hashes, transaction envelopes, block-end accounting, and every lifecycle-seen strategy state. It fails if ordered events drift, strategy debts do not sum to `totalDebt`, or allocator-target evidence changes.

## Validation

- Allocation codegen and TypeScript build: pass.
- Allocation suite: 86/86 tests pass across 11 files.
- Coverage output drift and producer-ancestry check: pass for 243 rows.
- Coverage publisher: `DRY RUN` with zero writes.
- Gate 3 official runtime regression: pass for 243 vaults, 26 runtime families, and four releases.
- Root TypeScript build: pass.
- Root Vitest: 86/86 pass across 11 files.
- Persisted event-configuration changes require fresh candidate storage; in-place resume of the initialized production database remains incompatible.
- `git diff --check`: pass.

## Not run and remaining blockers

- `allocation:parity:gate4`: **NOT RUN** with the corrected shared RPC and GraphQL configuration.
- `allocation:monitor:gate4`: **NOT RUN** with the corrected shared RPC and GraphQL configuration.
- A healthy fresh replay with the archive-capable shared Ethereum RPC has not run.
- Full replay versus fresh incremental continuation at the same cutoff has not been compared.
- Effect/cache/database growth, replay duration, GraphQL latency, and failure/recovery observations have not been recorded from a candidate.
- The draft coverage revision has not been published and must remain unsafe.
- No certified immutable revision exists, and Kong must not consume the draft as complete history.

Gate 4 can be accepted only after the corrected shared deployment completes a fresh replay, credentialed parity and allocation monitoring pass alongside whole-indexer health checks, unresolved failure checks are empty, operational evidence is recorded, and eligible coverage is published in a new immutable revision.
