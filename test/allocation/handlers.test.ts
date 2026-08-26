import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";

const ROLE_MANAGER = "0xb3bd6B2E61753C311EFbCF0111f75D29706D9a41" as const;
const ROLE_MANAGER_LOWER = ROLE_MANAGER.toLowerCase();
const FACTORY = "0xfCF8c7C43dedd567083B422d6770F23B78D15BDe" as const;
const ALLOCATOR = "0x3333333333333333333333333333333333333333" as const;
const NEXT_ALLOCATOR = "0x5555555555555555555555555555555555555555" as const;
const VAULT_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const VAULT_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const KEEPER = "0x4444444444444444444444444444444444444444" as const;

const hash = (character: string): `0x${string}` => `0x${character.repeat(64)}`;

const block = (number: number, character: string) => ({
  number,
  timestamp: 1_700_000_000 + number,
  hash: hash(character),
});

const transaction = (transactionIndex: number, character: string) => ({
  hash: hash(character),
  transactionIndex,
  from: ROLE_MANAGER,
  to: FACTORY,
  input: "0x12345678",
});

describe("Gate 2 Envio handlers", () => {
  it("replays initial and updated assignments, then closes membership without deleting history", async () => {
    const testIndexer = createTestIndexer();
    await testIndexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "YearnV3RoleManager",
              event: "AddedNewVault",
              srcAddress: ROLE_MANAGER,
              logIndex: 1,
              block: block(100, "1"),
              transaction: transaction(0, "2"),
              params: { vault: VAULT_A, debtAllocator: ALLOCATOR, category: 0n },
            },
            {
              contract: "YearnV3RoleManager",
              event: "UpdateDebtAllocator",
              srcAddress: ROLE_MANAGER,
              logIndex: 2,
              block: block(101, "3"),
              transaction: transaction(0, "4"),
              params: { vault: VAULT_A, debtAllocator: NEXT_ALLOCATOR },
            },
            {
              contract: "YearnV3RoleManager",
              event: "RemovedVault",
              srcAddress: ROLE_MANAGER,
              logIndex: 3,
              block: block(102, "5"),
              transaction: transaction(0, "6"),
              params: { vault: VAULT_A },
            },
          ],
        },
      },
    });

    expect((await testIndexer.VaultDebtAllocatorAssignment.getAll()).map((assignment) => ({
      assignmentType: assignment.assignmentType,
      allocatorAddress: assignment.allocatorAddress,
      implementationRecognition: assignment.implementationRecognition,
    }))).toEqual([
      { assignmentType: "initial", allocatorAddress: ALLOCATOR, implementationRecognition: "unknown" },
      { assignmentType: "updated", allocatorAddress: NEXT_ALLOCATOR, implementationRecognition: "unknown" },
    ]);
    expect(await testIndexer.VaultRoleManagerMembership.getAll()).toEqual([
      expect.objectContaining({
        vaultAddress: VAULT_A,
        roleManagerAddress: ROLE_MANAGER_LOWER,
        allocatorAddress: NEXT_ALLOCATOR,
        active: false,
      }),
    ]);
  });

  it("keeps deployment and assignment facts separate and exposes a conflict", async () => {
    const testIndexer = createTestIndexer();
    await testIndexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "DebtAllocatorFactory",
              event: "NewDebtAllocator",
              srcAddress: FACTORY,
              logIndex: 1,
              block: block(100, "7"),
              transaction: transaction(0, "8"),
              params: { allocator: ALLOCATOR, vault: VAULT_A },
            },
            {
              contract: "YearnV3RoleManager",
              event: "AddedNewVault",
              srcAddress: ROLE_MANAGER,
              logIndex: 2,
              block: block(101, "9"),
              transaction: transaction(0, "a"),
              params: { vault: VAULT_B, debtAllocator: ALLOCATOR, category: 0n },
            },
          ],
        },
      },
    });

    expect(await testIndexer.DebtAllocatorDeployment.getAll()).toEqual([
      expect.objectContaining({ allocatorAddress: ALLOCATOR, vaultAddress: VAULT_A }),
    ]);
    expect(await testIndexer.VaultDebtAllocatorAssignment.getAll()).toEqual([
      expect.objectContaining({
        allocatorAddress: ALLOCATOR,
        vaultAddress: VAULT_B,
        implementationRecognition: "knownGenericAllocator",
      }),
    ]);
    expect(await testIndexer.DebtAllocatorAssignmentConflict.getAll()).toEqual([
      expect.objectContaining({
        allocatorAddress: ALLOCATOR,
        vaultAddress: VAULT_B,
        deploymentVaultAddress: VAULT_A,
        reason: "factoryVaultMismatch",
      }),
    ]);
  });

  it("reconciles recognition and conflict when assignment precedes deployment", async () => {
    const testIndexer = createTestIndexer();
    await testIndexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "YearnV3RoleManager",
              event: "AddedNewVault",
              srcAddress: ROLE_MANAGER,
              logIndex: 1,
              block: block(100, "b"),
              transaction: transaction(0, "c"),
              params: { vault: VAULT_B, debtAllocator: ALLOCATOR, category: 0n },
            },
            {
              contract: "DebtAllocatorFactory",
              event: "NewDebtAllocator",
              srcAddress: FACTORY,
              logIndex: 2,
              block: block(100, "b"),
              transaction: transaction(1, "d"),
              params: { allocator: ALLOCATOR, vault: VAULT_A },
            },
          ],
        },
      },
    });

    expect(await testIndexer.VaultDebtAllocatorAssignment.getAll()).toEqual([
      expect.objectContaining({ implementationRecognition: "knownGenericAllocator" }),
    ]);
    expect(await testIndexer.DebtAllocatorAssignmentConflict.getAll()).toHaveLength(1);
  });

  it("reconciles allocator events that precede same-block factory registration", async () => {
    const testIndexer = createTestIndexer();
    await testIndexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "DebtAllocator",
              event: "UpdateKeeper",
              srcAddress: ALLOCATOR,
              logIndex: 1,
              block: block(100, "e"),
              transaction: transaction(0, "f"),
              params: { keeper: KEEPER, allowed: true },
            },
            {
              contract: "DebtAllocatorFactory",
              event: "NewDebtAllocator",
              srcAddress: FACTORY,
              logIndex: 2,
              block: block(100, "e"),
              transaction: transaction(1, "0"),
              params: { allocator: ALLOCATOR, vault: VAULT_A },
            },
          ],
        },
      },
    });

    const keeperEvents = await testIndexer.AllocationSourceEvent.getWhere({ eventName: { _eq: "UpdateKeeper" } });
    expect(keeperEvents).toEqual([
      expect.objectContaining({
        vaultAddress: VAULT_A,
        sourceAddress: ALLOCATOR,
        argsJson: `{"keeper":"${KEEPER}","allowed":true}`,
      }),
    ]);
    const pendingBuffers = await testIndexer.DebtAllocatorPendingEventBuffer.getAll();
    expect(pendingBuffers).toEqual([
      expect.objectContaining({
        allocatorAddress: ALLOCATOR,
        eventCount: 1,
        resolved: true,
        resolvedDeploymentId: `1:${ALLOCATOR}`,
      }),
    ]);
  });
});
