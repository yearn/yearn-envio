import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";
import { serializers } from "../../src/allocation/normalization.js";

const SHARED_FACTORY = "0x03D43dF6FF894C848fC6F1A0a7E8a539Ef9A4C18" as const;
const VAULT_BOUND_FACTORY = "0xfCF8c7C43dedd567083B422d6770F23B78D15BDe" as const;
const SHARED_ALLOCATOR = "0x1e9eb053228b1156831759401de0e115356b8671" as const;
const VAULT_BOUND_ALLOCATOR = "0x3333333333333333333333333333333333333333" as const;
const VAULT = "0xBe53A109B494E5c9f97b9Cd39Fe969BE68BF6204" as const;
const SECOND_VAULT = "0x310B7Ea7475A0B449cfd73bE81522F1B88eFAFaa" as const;
const STRATEGY = "0xf766c7293f4e0265ddfa8369f78a808df8ac70c1" as const;
const GOVERNANCE = "0x16388463d60ffe0661cf7f1f31a7d658ac790ff7" as const;
const SENDER = "0x1b5f15dcb82d25f91c65b53cee151e8b9fbdd271" as const;
const ROLE_MANAGER = "0xb3bd6B2E61753C311EFbCF0111f75D29706D9a41" as const;

const hash = (character: string): `0x${string}` => `0x${character.repeat(64)}`;

const block = (number: number, character: string) => ({
  number,
  timestamp: 1_729_197_971,
  hash: hash(character),
});

const transaction = (transactionIndex: number, character: string) => ({
  hash: hash(character),
  transactionIndex,
  from: SENDER,
  to: GOVERNANCE,
  input: "0x6a76120200000000",
});

const ratioParams = {
  vault: VAULT,
  strategy: STRATEGY,
  newTargetRatio: 2_870n,
  newMaxRatio: 3_444n,
  newTotalDebtRatio: 2_870n,
};

describe("shared debt allocator normalization", () => {
  it("pins the exact shared and vault-bound event signatures", () => {
    expect(serializers.debtAllocator.SharedUpdateStrategyDebtRatio.signature).toBe(
      "0x2a89fa60115b9af6e21a6c6aa32d141e9cfbf77472d27fbf2e7a5a8c2efaf995",
    );
    expect(serializers.debtAllocator.UpdateStrategyDebtRatio.signature).toBe(
      "0x28d465e4d5dcdcee5fb93eccf31e0bcf5d3f6fea174eb791749dc2b51a76f881",
    );
    expect(serializers.debtAllocator.UpdateStrategyDebtRatios.signature).toBe(
      "0x7f2bbad10e91f21c5aaf78550279b42e2863496b6c7e73b661ec891b730c33fb",
    );
  });

  it("normalizes the vault directly from the shared allocator log", async () => {
    const testIndexer = createTestIndexer();
    await testIndexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "SharedDebtAllocatorFactory",
              event: "NewDebtAllocator",
              srcAddress: SHARED_FACTORY,
              logIndex: 1,
              block: block(20_986_032, "1"),
              transaction: transaction(0, "2"),
              params: { allocator: SHARED_ALLOCATOR, governance: GOVERNANCE },
            },
            {
              contract: "AssignedDebtAllocator",
              event: "SharedUpdateStrategyDebtRatio",
              srcAddress: SHARED_ALLOCATOR,
              logIndex: 411,
              block: block(20_987_762, "3"),
              transaction: transaction(163, "4"),
              params: ratioParams,
            },
          ],
        },
      },
    });

    expect(await testIndexer.SharedDebtAllocatorDeployment.getAll()).toEqual([
      expect.objectContaining({
        allocatorAddress: SHARED_ALLOCATOR,
        governanceAddress: GOVERNANCE,
        abiVariant: "shared-v1-governance-bound-factory",
      }),
    ]);
    expect(await testIndexer.SharedUpdateStrategyDebtRatio.getAll()).toEqual([
      expect.objectContaining({
        vault: VAULT.toLowerCase(),
        strategy: STRATEGY,
        newTargetRatio: 2_870n,
        newMaxRatio: 3_444n,
        newTotalDebtRatio: 2_870n,
      }),
    ]);
    expect(await testIndexer.AllocationSourceEvent.getAll()).toEqual([
      expect.objectContaining({
        vaultAddress: VAULT.toLowerCase(),
        scope: "vault",
        sourceAddress: SHARED_ALLOCATOR,
        eventName: "UpdateStrategyDebtRatio",
        abiVariant: "shared-v1-vault-scoped-singular",
        associationEvidence: "event-indexed-vault",
        strategyAddress: STRATEGY,
        topLevelTransactionFrom: SENDER,
        topLevelTransactionTo: GOVERNANCE,
        topLevelInputSelector: "0x6a761202",
        newTargetRatio: 2_870n,
        newMaxRatio: 3_444n,
        newTotalDebtRatio: 2_870n,
      }),
    ]);
  });

  it("keeps shared control events allocator-scoped without vault fan-out", async () => {
    const testIndexer = createTestIndexer();
    await testIndexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "SharedDebtAllocatorFactory",
              event: "NewDebtAllocator",
              srcAddress: SHARED_FACTORY,
              logIndex: 1,
              block: block(20_986_032, "5"),
              transaction: transaction(0, "6"),
              params: { allocator: SHARED_ALLOCATOR, governance: GOVERNANCE },
            },
            {
              contract: "YearnV3RoleManager",
              event: "AddedNewVault",
              srcAddress: ROLE_MANAGER,
              logIndex: 2,
              block: block(20_986_033, "6"),
              transaction: transaction(0, "7"),
              params: { vault: VAULT, debtAllocator: SHARED_ALLOCATOR, category: 0n },
            },
            {
              contract: "YearnV3RoleManager",
              event: "AddedNewVault",
              srcAddress: ROLE_MANAGER,
              logIndex: 3,
              block: block(20_986_034, "7"),
              transaction: transaction(0, "8"),
              params: { vault: SECOND_VAULT, debtAllocator: SHARED_ALLOCATOR, category: 0n },
            },
            {
              contract: "AssignedDebtAllocator",
              event: "UpdateKeeper",
              srcAddress: SHARED_ALLOCATOR,
              logIndex: 4,
              block: block(20_987_763, "7"),
              transaction: transaction(0, "9"),
              params: { keeper: SENDER, allowed: true },
            },
            {
              contract: "AssignedDebtAllocator",
              event: "GovernanceTransferred",
              srcAddress: SHARED_ALLOCATOR,
              logIndex: 5,
              block: block(20_987_764, "8"),
              transaction: transaction(0, "a"),
              params: { previousGovernance: GOVERNANCE, newGovernance: SENDER },
            },
          ],
        },
      },
    });

    const sharedControlEvents = (await testIndexer.AllocationSourceEvent.getAll()).filter(
      ({ sourceAddress }) => sourceAddress === SHARED_ALLOCATOR,
    );
    expect(sharedControlEvents).toHaveLength(2);
    expect(sharedControlEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventName: "UpdateKeeper",
          scope: "allocator",
          vaultAddress: undefined,
          associationEvidence: "event-source-allocator",
        }),
        expect.objectContaining({
          eventName: "GovernanceTransferred",
          scope: "allocator",
          vaultAddress: undefined,
          associationEvidence: "event-source-allocator",
        }),
      ]),
    );
    expect(await testIndexer.UnresolvedAllocationSourceEvent.getAll()).toEqual([]);
  });

  it("preserves vault-bound singular behavior and late reconciliation", async () => {
    const testIndexer = createTestIndexer();
    const params = {
      strategy: STRATEGY,
      newTargetRatio: 1n,
      newMaxRatio: 2n,
      newTotalDebtRatio: 3n,
    };
    await testIndexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "AssignedDebtAllocator",
              event: "UpdateStrategyDebtRatio",
              srcAddress: VAULT_BOUND_ALLOCATOR,
              logIndex: 1,
              block: block(100, "9"),
              transaction: transaction(0, "a"),
              params,
            },
            {
              contract: "DebtAllocatorFactory",
              event: "NewDebtAllocator",
              srcAddress: VAULT_BOUND_FACTORY,
              logIndex: 2,
              block: block(100, "9"),
              transaction: transaction(1, "b"),
              params: { allocator: VAULT_BOUND_ALLOCATOR, vault: VAULT },
            },
          ],
        },
      },
    });

    expect(await testIndexer.AllocationSourceEvent.getWhere({
      eventName: { _eq: "UpdateStrategyDebtRatio" },
    })).toEqual([
      expect.objectContaining({
        vaultAddress: VAULT.toLowerCase(),
        scope: "vault",
        abiVariant: "generic-v1-vault-bound-singular",
        associationEvidence: "vault-bound-factory-event-late-reconciliation",
      }),
    ]);
    expect(await testIndexer.UnresolvedAllocationSourceEvent.getAll()).toEqual([
      expect.objectContaining({ resolved: true }),
    ]);
  });

  it("preserves plural, keeper, and governance normalization for vault-bound allocators", async () => {
    const testIndexer = createTestIndexer();
    await testIndexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "DebtAllocatorFactory",
              event: "NewDebtAllocator",
              srcAddress: VAULT_BOUND_FACTORY,
              logIndex: 1,
              block: block(100, "c"),
              transaction: transaction(0, "d"),
              params: { allocator: VAULT_BOUND_ALLOCATOR, vault: VAULT },
            },
            {
              contract: "AssignedDebtAllocator",
              event: "UpdateStrategyDebtRatios",
              srcAddress: VAULT_BOUND_ALLOCATOR,
              logIndex: 2,
              block: block(101, "e"),
              transaction: transaction(0, "f"),
              params: {
                strategy: STRATEGY,
                newTargetRatio: 1n,
                newMaxRatio: 2n,
                newTotalDebtRatio: 3n,
              },
            },
            {
              contract: "AssignedDebtAllocator",
              event: "UpdateKeeper",
              srcAddress: VAULT_BOUND_ALLOCATOR,
              logIndex: 3,
              block: block(102, "1"),
              transaction: transaction(0, "2"),
              params: { keeper: SENDER, allowed: true },
            },
            {
              contract: "AssignedDebtAllocator",
              event: "GovernanceTransferred",
              srcAddress: VAULT_BOUND_ALLOCATOR,
              logIndex: 4,
              block: block(103, "3"),
              transaction: transaction(0, "4"),
              params: { previousGovernance: GOVERNANCE, newGovernance: SENDER },
            },
          ],
        },
      },
    });

    const events = await testIndexer.AllocationSourceEvent.getAll();
    expect(events.map(({ eventName }) => eventName)).toEqual([
      "NewDebtAllocator",
      "UpdateStrategyDebtRatios",
      "UpdateKeeper",
      "GovernanceTransferred",
    ]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ abiVariant: "generic-v0-vault-bound-plural", scope: "vault" }),
        expect.objectContaining({
          eventName: "UpdateKeeper",
          scope: "vault",
          vaultAddress: VAULT.toLowerCase(),
        }),
        expect.objectContaining({
          eventName: "GovernanceTransferred",
          vaultAddress: VAULT.toLowerCase(),
        }),
      ]),
    );
    expect(await testIndexer.UnresolvedAllocationSourceEvent.getAll()).toEqual([]);
  });
});
