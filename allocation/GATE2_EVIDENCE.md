# Gate 2 Ethereum acceptance evidence

Gate 2 is accepted locally at Ethereum block `25835600`, hash `0x3f7c6998176cc2af40681d187424a4e0b76dc782df150bd408fa65863c6b3dec`. This does not claim Gate 3 accounting checkpoints, Gate 4 coverage certification, a deployed candidate, or `safeForTimeline` coverage.

The authoritative machine-readable evidence is [`fixtures/ethereum/gate2.json`](fixtures/ethereum/gate2.json). The read-only verifier is [`scripts/verify-gate2-fixture.mjs`](scripts/verify-gate2-fixture.mjs).

## Discovery inventory

The RoleManager factory emitted 33 `NewProject` events. Together with the directly configured RoleManager, the audit covers 34 RoleManagers and all of their explorer-visible logs through the pinned block:

| Event | Count |
| --- | ---: |
| `AddedNewVault` | 134 |
| `RemovedVault` | 41 |
| `UpdateDebtAllocator` | 12 |

Those assignments contain 40 unique allocator addresses. Twelve were emitted by the vault-bound factory and replay as `knownGenericAllocator`; 27 were emitted by the governance-bound factory and replay as `other`; the zero address remains `unknown`. This preserves the RoleManager fact without promoting an arbitrary assignee into the known vault-bound family.

## Runtime and ABI families

All hashes below are `keccak256` of runtime bytecode read at the pinned audit block.

| Family | Count | Runtime hash | Implementation |
| --- | ---: | --- | --- |
| Direct RoleManager | 1 | `0x227571be0c61a7b6b9923842d5a9ffbf6c33193ff14fc0003fb596a3ad35cf8a` | direct runtime |
| RoleManager EIP-1167 clones | 33 | `0x05263427c276f139b0dfd715ae0f8e55399b9159c3877636ce8922159c9ffa43` | `0xe28507bcc505673979ccac9b1024347e03211332` |
| Vault-bound allocator EIP-1167 clones | 12 | `0x0f3b67d4aae1b479291c85e2d081b26b8e19188a264f432b33f2666284db7779` | `0x1aaf7ad9550a8817d4cc4cdb917ff99b044960a0` |
| Governance-bound allocator EIP-1167 clones | 35 | `0x27b141c5bababcee75142d690608774d19618884ed89811d1d93bbd0d2498109` | `0xa47eb754d44339b5dedcf4d804428708857e7899` |

The verifier checks all 81 deployed RoleManager/allocator contracts, the three clone implementations, and the three factories: 87 runtime checks rather than one representative per family. Blockscout identifies the implementations and factories as verified contracts. The checked-in hashes and raw receipts remain the reproducible evidence; explorer labels are not trusted as handler input.

The vault-bound factory emits `(allocator, vault)` and produces immutable `DebtAllocatorDeployment` rows. The governance-bound factory emits `(allocator, governance)` under the same topic and produces `DebtAllocatorUnboundDeployment` rows. It cannot safely produce a vault binding, so the handler does not infer one.

The deployed vault-bound implementation emits singular `UpdateStrategyDebtRatio`, not the plural name in the issue contract. The singular decoder is pinned as `generic-v1-vault-bound-singular`. The audit found 826 singular logs and no plural logs across the 12 deployments. The plural decoder remains explicit for the issue-contract variant instead of being silently repurposed.

## Historical fixtures

The exact fixture pins raw topics/data, transaction envelopes, block hashes, decoded parameters, and expected entities for:

- Vault-bound factory deployment and initial RoleManager assignment in transaction `0xfc6be986a2e60849a91c397c5c4bd10d9b247f0e1fb30cdaf0ed1f7687ea648e`.
- Two target updates in transaction `0x8461def6387629f6a43c5bced3b3895f3f07e2e8c3825fe2ffb258e2be795976`.
- Governance-bound deployment in transaction `0x0224754db7f407f031b1df3ca312e14da5a967e565da4c63ba1daa0ba6ebb85e`.
- The Ethereum `UpdateDebtAllocator` replacement in transaction `0x3aa99e65b765359bb210eddaf0e9262ac3829e0a730c6f173d5073021d230b2d`.

The handler fixture proves that deployment and assignment remain independently queryable, both target events resolve to the original vault, the later assignment is `other`, and no conflict or unresolved row is fabricated.

## Same-block registration

The fixture lists all 12 vault-bound `NewDebtAllocator` logs across nine creation transactions. The RPC verifier checks the exact receipt and confirms that none of the required allocator topics precedes its allocator's registration log. The handler nevertheless persists unknown allocator events in `DebtAllocatorPendingEventBuffer` and deterministically reconciles them if registration arrives later, so the implementation does not rely solely on the historical ordering observation.

Focused simulated-handler tests separately prove:

- Allocator-event-before-registration reconciliation.
- Assignment-before-deployment recognition repair and conflict creation.
- The deferred association remains queryable in the pending buffer and resolves without emitting a zero-address vault.

## Replay and verification result

`createTestIndexer` loads successfully under Node 22 after marking the allocation package as ESM. The exact Ethereum fixture produces identical entity snapshots for a fresh full replay, a second fresh full replay, and an incremental continuation split after initial assignment.

Run locally:

```bash
corepack pnpm codegen
corepack pnpm build
corepack pnpm test
ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM=<archive-rpc> corepack pnpm verify:gate2:rpc
```

The verifier checks the pinned block hash, every listed runtime hash, every raw replay log, all 12 deployment receipts, and the same-block ordering invariant. When the RPC variable is absent it reports `NOT RUN`; it does not convert missing credentials into a pass.

## Acceptance mapping

| Gate 2 requirement | Evidence |
| --- | --- |
| Initial and updated assignments replay correctly | Exact handler fixture and assignment query assertions |
| Deployment and assignment independently queryable | Separate deployment, unbound deployment, assignment, and membership entities |
| Known allocator events resolve to the correct vault | Two real target-update logs resolve through the immutable vault-bound deployment |
| Unknown holders remain distinguishable | `knownGenericAllocator`, `other`, and `unknown` replay paths; zero address remains unknown |
| Conflicts and unresolved associations visible | Queryable conflict and pending-buffer entities with focused handler tests |
| Same-block behavior proven or reconciled | All 12 receipts audited plus deterministic deferred reconciliation test |

Gate 3 is the next delivery gate. No coverage row may be treated as `safeForTimeline` on the strength of this Gate 2 result.
