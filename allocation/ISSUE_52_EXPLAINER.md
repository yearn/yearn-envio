# Issue 52 and pull request 55, explained simply

This document explains:

1. The goals of [yearn-envio issue #52](https://github.com/yearn/yearn-envio/issues/52).
2. How [pull request #55](https://github.com/yearn/yearn-envio/pull/55) implements those goals.
3. What is complete now.
4. What still needs live deployment testing.

The language is intentionally simple. A glossary is included at the end.

## Short overview

Yearn wants to show how money inside a Vault moved between strategies over time.

The current Envio indexer already reads many Yearn events. Issue #52 adds the source data needed for allocation history to that same indexer.

The final architecture has:

- one Envio project;
- one configuration;
- one GraphQL schema;
- one database;
- one active Envio server.

The server can read events from many contracts and chains. The new Allocation History work is enabled only for Ethereum at first.

## What problem are we solving?

A Yearn Vault can place assets into several strategies. Its allocation changes when:

- a strategy receives more debt;
- a strategy returns debt;
- a user deposits or withdraws assets;
- a strategy reports profit or loss;
- a strategy is added or removed;
- a debt allocator changes its target ratios; or
- the Vault's idle-asset policy changes.

A list of current debts is not enough. We need a trustworthy history of the events and accounting values at the time they happened.

Issue #52 asks Envio to produce those historical facts. Kong will use the facts to build a finished timeline for applications.

## What Envio produces

Envio produces four groups of data.

### 1. Normalized allocation events

Different contracts use different event formats. Envio converts the required events into one stable format.

Each normalized event contains:

- chain and Vault addresses;
- block number, timestamp, and block hash;
- transaction hash and event position;
- top-level transaction sender, receiver, and input selector;
- event name and source type;
- strategy address when the event has one; and
- deterministic JSON arguments.

“Deterministic” means that replaying the same blockchain data produces the same output.

### 2. Debt allocator history

Envio records two different facts separately:

- which Vault a factory connected to a new debt allocator; and
- which debt allocator a RoleManager assigned to a Vault at a point in time.

These facts can disagree. The implementation keeps both facts and records a conflict. It does not overwrite one fact with the other.

### 3. Historical Vault accounting

At important blocks, Envio reads:

- `totalAssets`;
- `totalDebt`; and
- `totalIdle`.

The values are read from an archive RPC at the exact historical block. Envio verifies the block hash before it saves a checkpoint.

### 4. Coverage evidence

Envio records which historical ranges were actually validated.

The important field is `safeForTimeline`.

- `false` means Kong must not treat the range as complete.
- `true` means every required check passed for that exact range.

The current draft contains zero safe rows. This is intentional. Live candidate testing is still required.

## What Kong does

Kong uses Envio's facts to build the final product response.

Kong is responsible for:

- rebuilding per-strategy allocation states;
- grouping events into user-friendly changes;
- classifying actors and intent;
- adding Vault and strategy names;
- matching allocation changes with proposals;
- calculating percentages; and
- serving a cached API response.

This separation is important. Envio records replayable source facts. Kong decides whether those facts are sufficient to publish a complete timeline.

## How the single-server design works

The repository used to contain a second Envio project under `allocation/`. That design was changed after review.

Pull request #55 now extends the existing project:

```text
HyperSync contract events
          |
          v
root config.yaml
          |
          v
root EventHandlers entrypoint
     |                 |
     v                 v
existing entities   Allocation History entities
     |                 |
     +--------+--------+
              |
              v
       one Envio database
              |
              v
       one GraphQL endpoint
```

The important files are:

- [`config.yaml`](../config.yaml): existing and allocation events are configured together.
- [`schema.graphql`](../schema.graphql): allocation entities are added to the existing schema.
- [`src/EventHandlers.ts`](../src/EventHandlers.ts): the existing handler entrypoint loads the allocation handlers.
- [`src/allocation/`](../src/allocation/): normalization, allocator logic, checkpoints, archive Effects, and coverage validation.
- [`allocation/`](./): evidence, fixtures, tests, coverage files, and operational tools.

There is no nested package, second generated-code project, or second permanent server.

## Why Allocation History is Ethereum-only at first

The shared Envio server processes several chains. However, issue #52 requires Ethereum first.

Every Allocation History handler checks the chain ID. It does nothing when the chain is not Ethereum.

This means:

- existing multichain entities keep working;
- allocation archive reads do not run on other chains;
- the dedicated Ethereum archive variable is not required by unrelated chains; and
- Sonic remains outside the Allocation History scope.

## What happens when the archive RPC fails?

An archive RPC can be unavailable, rate limited, pruned, or connected to the wrong block history.

The implementation never turns a failed read into zero values. It also does not save a partial or unverified checkpoint.

After the retry limit is reached:

1. The Effect marks the failed result as not cacheable.
2. The allocation handler catches the error.
3. No accounting checkpoint is written.
4. A `VaultAccountingCheckpointFailure` row records a safe error category.
5. The row does not contain the RPC URL or provider response.
6. The shared Envio server continues processing other events.
7. The affected range cannot become `safeForTimeline`.

If a later replay succeeds, Envio writes the checkpoint and marks the failure row as resolved.

This gives us both safety properties:

- bad accounting data is not published; and
- an archive provider problem does not stop the whole Yearn indexer.

## The four delivery gates

Issue #52 divides the work into four gates.

### Gate 1: normalized event contract

Goal: store every required allocation-related event in a stable format.

Pull request #55 implements:

- explicit serializers for all required events and supported ABI variants;
- lowercase address and hash keys;
- deterministic IDs and argument JSON;
- top-level transaction metadata; and
- golden tests for the exact output.

Status: implemented and unit tested.

### Gate 2: allocator provenance and assignments

Goal: record allocator factory history and RoleManager assignment history without mixing them together.

Pull request #55 implements:

- immutable factory deployment records;
- initial and updated assignment records;
- active RoleManager membership state;
- known, unknown, and unbound implementation recognition;
- visible conflicts; and
- same-block event buffering and reconciliation.

Status: locally accepted with exact Ethereum fixtures.

### Gate 3: historical accounting checkpoints

Goal: read exact historical Vault totals at blocks where accounting changes.

Pull request #55 implements:

- checkpoint triggers after deposits, withdrawals, debt updates, and strategy reports;
- one deterministic checkpoint per Vault and block;
- archive reads pinned to the expected block hash when supported;
- a verified block-number fallback;
- bounded retry, timeout, cache, and rate-limit behavior;
- an audit of four official Vault V3 releases; and
- non-fatal, queryable failure records.

Status: locally accepted. The live candidate must still prove provider behavior and replay performance.

### Gate 4: coverage, parity, and rollout

Goal: prove which ranges are safe for Kong to consume.

Pull request #55 implements the local prerequisites:

- a machine-readable coverage manifest;
- a generated human-readable matrix;
- strict cursor and GraphQL query contracts;
- exact yvWETH and yvUSDC fixtures;
- a credentialed candidate parity tool;
- a candidate monitor;
- guarded coverage publication; and
- a shared-deployment replay and rollback runbook.

The monitor and publisher now reject certification when an unresolved checkpoint failure exists.

Status: not accepted. No candidate revision has completed the live deployment checks.

## What has been verified locally?

The merged root project successfully completes:

- Envio code generation;
- TypeScript build;
- allocation unit and handler tests;
- deterministic fixture replay tests;
- coverage drift validation; and
- dry-run coverage publication with zero writes.

The pull request test record includes the complete root suite. The live candidate must still pass parity and monitoring checks before Gate 4 can be accepted.

Local tests prove code behavior. They do not prove historical completeness.

## What this pull request does not do

Pull request #55 does not:

- build Kong's finished allocation timeline;
- add a public Kong API route;
- change Yearn frontend applications;
- calculate display percentages;
- decode internal Safe or router calls;
- add Sonic Allocation History;
- certify any current coverage row as safe; or
- perform the production cutover.

## What still needs to happen?

Before Gate 4 can be accepted:

1. Deploy a candidate revision of the existing Envio project.
2. Replay Ethereum Allocation History with a dedicated archive RPC.
3. Confirm that forced archive failures do not stop unrelated indexing.
4. Confirm that unresolved failure rows are visible and block certification.
5. Run exact yvWETH and yvUSDC candidate parity.
6. Compare a full replay with a fresh incremental continuation at the same cutoff.
7. Measure archive calls, errors, replay time, database growth, cache growth, and GraphQL latency.
8. Create a new immutable coverage revision from the evidence.
9. Set `safeForTimeline = true` only for ranges that pass every check.
10. Cut over to the candidate so that one shared Envio server remains active.

Until these steps pass, Kong must not treat the draft as complete history.

## Glossary

### ABI

A description of a smart contract's functions and events. Two events with the same name can have different ABI layouts.

### Allocation

How a Vault's assets are divided between strategies and idle assets.

### Archive RPC

An Ethereum service that can read contract state at old blocks.

### Checkpoint

A saved record of Vault accounting values at a specific block.

### Coverage revision

An immutable version of the evidence that says which historical ranges were validated.

### Debt allocator

A contract that helps decide target debt amounts for strategies.

### Effect

Envio's controlled method for calling an external service, such as an archive RPC, during indexing.

### Envio

The system that reads blockchain events and stores queryable entities.

### Gate

A group of requirements that must pass before the next delivery stage is accepted.

### HyperSync

Envio's service for retrieving blockchain events efficiently.

### Kong

Yearn's API service. It will turn Envio's source facts into the final allocation timeline.

### Normalization

Converting different event formats into one stable data format.

### Replay

Processing historical blockchain data again from an earlier block.

### `safeForTimeline`

A coverage flag. It is true only when the exact Vault and block range passed every required validation.

## Conclusion

Issue #52 asks Envio to provide trustworthy source data for historical Vault allocations.

Pull request #55 adds that data to the existing Envio server. It preserves the current multichain indexer, limits Allocation History to Ethereum, and records archive failures without bringing down unrelated indexing.

The implementation and local validation tools are ready for candidate deployment. The feature is not certified until the live Gate 4 replay, parity, monitoring, and coverage steps pass.
