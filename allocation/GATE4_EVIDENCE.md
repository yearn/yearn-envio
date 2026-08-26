# Gate 4 evidence and acceptance status

Gate 4 is **not accepted** as of 2026-08-26. The local coverage, query, fixture, parity-tooling, monitoring, and runbook prerequisites are complete; deployed-candidate replay and certification have not run.

## Implemented locally

- `VaultAllocationCoverage` and fail-closed immutable manifest validation.
- Exact initial/continuation event queries, latest-checkpoint query, strict revision-scoped cursor validation, and same-transaction page-boundary reconstruction.
- Complete draft Ethereum discovery authority through block 25,835,600 (`0x3f7c…3dec`): 243 official-factory candidate rows, 78 explicit custom-runtime exclusions, 34 RoleManagers, 134 `AddedNewVault` events, and zero `safeForTimeline` rows.
- Deterministic entity JSON and Markdown matrix generated from the same manifest, with drift checking.
- Guarded GraphQL publication: dry-run by default, stale-output rejection, exact existing-revision verification, and one atomic insert for a new immutable revision.
- Read-only candidate parity harness, readiness monitor, and blue-green/recovery/backout runbook.

## Exact Ethereum fixtures

`fixtures/ethereum/gate4-parity.json` was captured from canonical archive state and raw Blockscout logs:

| Case | Block | Evidence |
| --- | ---: | --- |
| yvWETH-1 multi-strategy update/withdraw | 21,589,454 | Four ordered normalized events; seven lifecycle-seen strategies; two positive debts; strategy debt sum equals `totalDebt` |
| yvUSDC-1 outside-optimizer loss report | 24,896,762 | Positive-debt strategy, loss `1`, zero matching singular/plural allocator target logs through the block, full 15-strategy debt reconciliation |
| yvUSDC-1 deposit/idle change | 19,441,994 | Exact Deposit; `totalAssets = totalIdle = 3015874599`; `totalDebt = 0` |

The fixture references the exact yvUSDC-1 `UpdateDebtAllocator` change already pinned in `gate2.json` at block 20,987,762.

The capture command re-reads canonical block hashes, transaction envelopes, block-end accounting, and every lifecycle-seen strategy state. It fails if ordered events drift, strategy debts do not sum to `totalDebt`, or allocator-target evidence changes.

## Validation

- Allocation codegen and TypeScript build: pass.
- Allocation suite: 80/80 tests pass across 11 files.
- Coverage output drift check: pass for 243 rows.
- Coverage publisher: `DRY RUN` with zero writes.
- Gate 3 official runtime regression: pass for 243 vaults, 26 runtime families, and four releases.
- Root TypeScript build: pass.
- Root Vitest: 18/18 pass.
- Root configuration compatibility against `origin/main`: pass.
- Monitoring tests: 8/8 pass with loopback access.
- `git diff --check`: pass.

## Not run and remaining blockers

- `parity:gate4`: **NOT RUN** because no allocation candidate GraphQL endpoint/token is configured.
- `monitor:gate4`: **NOT RUN** for the same deployment/configuration reason.
- No allocation database/indexer candidate has been deployed or replayed.
- Full replay versus fresh incremental continuation at the same cutoff has not been compared.
- Effect/cache/database growth, replay duration, GraphQL latency, and failure/recovery observations have not been recorded from a candidate.
- The draft coverage revision has not been published and must remain unsafe.
- No certified immutable revision exists, and Kong must not consume the draft as complete history.

Gate 4 can be accepted only after the blue-green candidate completes the runbook, credentialed parity and monitoring pass, operational evidence is recorded, and eligible coverage is published in a new immutable revision.
