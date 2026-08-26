# Gate 3 accounting checkpoint evidence

Gate 3 is accepted locally as of 2026-08-26. Gate 4 coverage certification and deployment remain separate.

The allocation suite passes 61/61 tests; Envio code generation and the allocation TypeScript build pass.

## Checkpoint mechanics

- `VaultAccountingCheckpoint` uses `${chainId}:${vaultLower}:${blockNumber}` and records canonical block metadata, exact vault totals, the unchanged accounting-identity result, and source event IDs.
- `Deposit`, `Withdraw`, `DebtUpdated`, and `StrategyReported` trigger accounting reads. Same-vault, same-block triggers merge into one checkpoint, deduplicated and sorted by `(transactionIndex, logIndex, id)`.
- The Effect cache identity includes lowercase vault, block number, and expected block hash. It is chain scoped, cache enabled, and limited to five calls per second.
- Each request has a 20-second timeout. At most three total attempts are made for transient failures with full-jitter exponential delay capped at two seconds.
- Contract reverts, unavailable historical state, and canonical hash mismatches are not retried. Final failures disable Effect caching and abort the handler, so no checkpoint persists.
- Reads prefer EIP-1898 hash-pinned `eth_call`. Providers rejecting the block-hash object fall back to block-number reads followed by a second canonical-hash verification.
- Transport errors are sanitized before leaving the reader. Tests prove RPC URLs, request bodies, and causes are not retained.

## Explicit support boundary

The configured discovery sources exposed 321 unique vault addresses through block 25,835,600. Of those, 243 were created by the four configured official Yearn Vault V3 factories; 78 were registry/RoleManager-discovered custom implementations.

Normalized allocation events remain available for every discovered vault. Accounting checkpoints are emitted only when `VaultAccountingSupport` proves official-factory provenance. This prevents custom bytecode that merely advertises a Yearn API version from being certified without source evidence.

The pinned runtime fixture covers all 243 supported vaults:

| API release | Supported vaults | Runtime families | Source tag |
| --- | ---: | ---: | --- |
| 3.0.1 | 44 | 23 | `v3.0.1` |
| 3.0.2 | 72 | 1 | `v3.0.2` / identical `v3.0.2-1` Vault blob |
| 3.0.3 | 1 | 1 | `v3.0.3` |
| 3.0.4 | 126 | 1 | `v3.0.4` |

`audit:gate3:runtimes -- --blockscout --supported-only --verify-fixture` re-discovered all official deployments and verified their bytecode at the pinned audit block. Result: `PASS (243 vaults, 26 runtime families, 4 releases)`.

## Mutation-path audit

Official source commits and Vault source blob IDs are pinned in `fixtures/ethereum/gate3-source-audit.json`. Every assignment to `total_idle` or `total_debt` in those blobs belongs to one of six paths:

| Mutation path | Terminal checkpoint trigger |
| --- | --- |
| deposit or mint | `Deposit` |
| withdraw or redeem | `Withdraw` (and zero or more `DebtUpdated`) |
| forced strategy revocation | `StrategyReported` |
| strategy debt update | `DebtUpdated` |
| strategy report | `StrategyReported` |
| debt purchase | `DebtUpdated` |

Initialization leaves both totals at zero. Direct asset transfers do not mutate either stored total until a covered report path accounts for them. No uncovered accounting mutation path was found in any supported source blob.

## Fixed-block archive evidence

`fixtures/ethereum/gate3-checkpoints.json` pins an official v3.0.2 vault Deposit at block 19,441,994 and its canonical hash. The production reader returned:

- `totalAssets`: `3015874599`
- `totalDebt`: `0`
- `totalIdle`: `3015874599`
- canonical block verified: `true`
- accounting identity: `true`

`verify:gate3:rpc` passed the real EIP-1898 read, the forced production block-number fallback with the second hash lookup, and a deliberate canonical mismatch. The endpoint value was neither printed nor committed.

## Replay benchmark

`fixtures/ethereum/gate3-benchmark.json` pins 12 unique historical Deposit blocks and four duplicate logical requests. At the configured five-calls-per-second ceiling:

- logical requests: 16
- unique archive reads: 12
- cache hits: 4 (25%)
- errors: 0 (0%)
- elapsed: 2.531 seconds
- observed unique reads/sec: 4.742
- latency: p50 348.9 ms, p95/max 383.9 ms

Capacity projections at the hard five-calls-per-second ceiling are 5.56 hours per 100,000 unique checkpoints, 27.78 hours per 500,000, and 55.56 hours per 1,000,000. These are capacity projections, not claims about the eventual Gate 4 certified historical row count.

## Gate boundary

Gate 3 proves canonical accounting checkpoint mechanics for the explicit official-factory support set. It does not establish historical coverage ranges, an immutable coverage revision, deployed parity, monitoring, blue-green readiness, or `safeForTimeline`; those remain Gate 4.
