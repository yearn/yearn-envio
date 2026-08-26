# Allocation indexer replay and rollout runbook

This runbook applies only to the separate Ethereum allocation project and database. It never replaces, resets, or shares a failure domain with the primary Yearn Envio deployment.

## Preconditions

- The candidate commit is pinned and its lockfile installation, codegen, build, tests, coverage drift check, and root compatibility checks pass.
- `ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM` points to a dedicated archive-capable endpoint.
- Candidate GraphQL URL/token are supplied only through `ENVIO_ALLOCATION_GRAPHQL_URL` and `ENVIO_ALLOCATION_GRAPHQL_TOKEN`.
- The checked-in coverage revision has zero `safeForTimeline` rows during replay.
- The previous allocation deployment/database and coverage revision remain available as the backout target.

## Build and preflight

From `allocation/`:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm codegen
corepack pnpm build
corepack pnpm test
corepack pnpm coverage:check
corepack pnpm coverage:publish
corepack pnpm parity:gate4
corepack pnpm monitor:gate4
```

The final three commands must respectively report `DRY RUN`, `NOT RUN`, and `NOT RUN` before candidate credentials are configured. A skip is not a pass.

## Blue-green replay

1. Create a new allocation-only Envio project and empty database. Do not point it at the primary database or the previous allocation database.
2. Configure Ethereum and the dedicated archive RPC secret. Keep the draft coverage revision unsafe.
3. Deploy the candidate alongside the previous allocation deployment.
4. Replay from the configured start and record Effect calls, Effect errors/retries, elapsed time, database growth, Effect-cache growth, and process restarts.
5. Run `monitor:gate4` repeatedly. Sync readiness, exact coverage-row publication, the semantic canary, latest event, and latest checkpoint are separate signals.
6. Run `coverage:publish -- --publish` only after the candidate schema exists and the checked-in generated rows pass `coverage:check`. Publication is atomic for one immutable revision and refuses conflicting existing rows.
7. Run `parity:gate4` against the candidate. It must pass all exact yvWETH/yvUSDC event/checkpoint blocks, assignment/provenance rows, initial/continuation cursor pages, and direct archive reads.
8. Replay a fresh database to the same cutoff and compare its ordered events, checkpoints, assignments, and coverage rows with an incremental continuation at that cutoff.
9. Measure the documented initial and continuation GraphQL queries at page sizes 500 and 2,000, plus latest-checkpoint lookup latency.

## Certification

1. Generate a new immutable coverage revision; never edit a deployed revision in place.
2. Fill first required event, allocator-history start, earliest safe block, and every validated cutoff hash from replay evidence.
3. Remove a known gap only when its named evidence passes for that vault/range.
4. Set `safeForTimeline = true` only where every completeness flag is true and no gaps remain.
5. Regenerate the entity JSON and Markdown matrix, run `coverage:check`, publish the new revision, then rerun parity and monitoring.
6. Give Kong only the certified revision and exact GraphQL/authentication contract. Kong must reject cursors from any other revision.

## Failure and recovery

- Archive timeout/rate limit: the handler fails closed and the deployment may halt. Preserve the database, correct provider capacity/configuration, and resume/replay; never insert zero or partial accounting rows.
- Canonical mismatch: stop and investigate provider/HyperSync fork association. Do not retry as transport noise or certify the affected range.
- Coverage conflict/partial rows: do not mutate the immutable revision. Remove the failed green candidate database and replay a clean candidate with a new revision if necessary.
- Parity mismatch: keep all rows unsafe, retain the raw candidate database for diagnosis, and compare normalized rows, block hashes, checkpoint totals, and source event IDs before retrying.
- Process crash: verify the supervised process, GraphQL reachability, chain metadata progress, Effect errors, and the fixed semantic canary independently.

## Backout

1. Stop Kong from consuming the candidate revision, or keep it pinned to the previous certified revision.
2. Route consumers back to the previous allocation GraphQL deployment without changing the primary Envio deployment.
3. Preserve the failed candidate database and logs for diagnosis; do not reuse it as a clean replay target.
4. Confirm previous-revision parity, readiness, and semantic canary before declaring backout complete.
5. Fix forward in a new green deployment and immutable coverage revision.

## Acceptance record

Record candidate commit/revision, deployment identifiers, cutoff block/hash, replay duration, request/error/cache rates, database/cache size, GraphQL latency, parity output, monitor output, certification timestamp, and backout target. Private endpoints and credentials must never appear in the record, GitHub issue, or pull request.
