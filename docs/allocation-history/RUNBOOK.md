# Allocation History replay and rollout runbook

This runbook adds Allocation History to the existing Yearn Envio deployment. It does not create a second permanent Envio project or database.

## Preconditions

- Pin the candidate commit.
- Install the root lockfile and pass root codegen, build, tests, and coverage drift.
- Review the shared `config.yaml` change and use fresh candidate storage. Do not try to resume the initialized production database with the changed event configuration.
- Configure `ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM` with a dedicated archive-capable endpoint.
- Supply candidate GraphQL access only through `ENVIO_ALLOCATION_GRAPHQL_URL` and `ENVIO_ALLOCATION_GRAPHQL_TOKEN`.
- Keep every draft coverage row at `safeForTimeline = false` during replay.
- Keep the current production deployment revision available as the rollback target.

## Build and preflight

Run from the repository root:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm codegen
corepack pnpm build
corepack pnpm test
corepack pnpm allocation:coverage:check
corepack pnpm allocation:coverage:publish
corepack pnpm allocation:parity:gate4
corepack pnpm allocation:monitor:gate4
```

Without candidate credentials, the final three allocation commands must report `DRY RUN`, `NOT RUN`, and `NOT RUN`. These statuses confirm safe local behavior; they do not accept Gate 4.

## Candidate replay

1. Deploy a candidate revision of the existing Envio project with fresh candidate storage while the current production revision and database remain available. Envio cannot resume an initialized database when its persisted event configuration changes.
2. Configure the dedicated Ethereum archive RPC. Do not enable allocation archive reads for other chains.
3. Replay the candidate from the configured historical start.
4. Keep all draft coverage rows unsafe.
5. Record Effect calls, retries, unresolved failures, elapsed time, database growth, cache growth, and process restarts.
6. Confirm that forced archive failures write `VaultAccountingCheckpointFailure` rows and do not stop unrelated indexing.
7. Run `allocation:monitor:gate4` repeatedly. It checks sync readiness, coverage rows, the semantic canary, and the absence of unresolved failures separately.
8. Run `allocation:coverage:publish -- --publish` only after the candidate schema exists and the generated rows pass the drift check. The publisher refuses any safe range containing an unresolved failure.
9. Run `allocation:parity:gate4`. It must pass the exact yvWETH/yvUSDC blocks, assignment/provenance rows, cursor pages, direct archive reads, and checkpoint-failure checks.
10. Replay a fresh candidate to the same cutoff and compare its ordered allocation entities with a fresh incremental continuation.
11. Measure the documented initial and continuation GraphQL queries at page sizes 500 and 2,000, plus latest-checkpoint lookup latency.

## Certification

1. Generate a new immutable coverage revision. Never edit a deployed revision in place.
2. Fill every start block, cutoff hash, first required event, allocator-history start, and earliest safe block from replay evidence.
3. Query unresolved `VaultAccountingCheckpointFailure` rows for every proposed safe range. The result must be empty.
4. Remove a known gap only when its named evidence passes for that vault and range.
5. Set `safeForTimeline = true` only when every completeness flag is true and no gaps remain.
6. Regenerate the entity JSON and Markdown matrix, run the drift check, publish, and rerun parity and monitoring.
7. Give Kong only the certified revision and exact GraphQL/authentication contract.

## Failure and recovery

- Archive timeout or rate limit: the Effect exhausts its bounded retries, disables caching for the failed result, and throws to the allocation handler. The handler writes a sanitized unresolved failure and continues the shared indexer. Never insert zero or partial accounting rows.
- Missing archive configuration: affected checkpoint attempts produce a sanitized gap. Other chains and non-allocation handlers continue.
- Canonical mismatch: write no checkpoint, keep the gap unresolved, and investigate the provider/HyperSync fork association. Do not classify this as transport noise.
- Later successful replay: persist the checkpoint and mark the matching failure row resolved.
- Coverage conflict: do not change an immutable revision. Fix forward with a new candidate and revision.
- Parity mismatch: keep every row unsafe and compare normalized rows, hashes, checkpoint totals, and source event IDs.
- Process crash unrelated to caught archive failures: verify supervision, GraphQL reachability, chain metadata, and semantic canaries independently.

## Cutover and backout

1. Cut over to the accepted candidate so that one shared Envio server and its replayed database remain active.
2. If needed, stop Kong from consuming the new revision and return it to the previous certified revision.
3. Restore the previous shared Envio deployment revision.
4. Preserve failed candidate logs and data for diagnosis.
5. Confirm previous-revision readiness and semantic canaries before declaring backout complete.
6. Fix forward in a new candidate revision.

## Acceptance record

Record the candidate commit and deployment revision, cutoff block/hash, replay duration, request/error/cache rates, resolved and unresolved gap counts, database/cache size, GraphQL latency, parity output, monitor output, certification timestamp, and rollback target.

Never include private endpoints, credentials, or Tailscale URLs in the record, issue, or pull request.
