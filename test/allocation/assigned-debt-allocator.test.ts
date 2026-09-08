import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";

const managers = {
  1: "0xb3bd6B2E61753C311EFbCF0111f75D29706D9a41",
  8453: "0xea3481244024E2321cc13AcAa80df1050f1fD456",
  747474: "0x2297d2486070655c3a162b02c64248A2f9dBC9a4",
} as const;
const vault = "0x1111111111111111111111111111111111111111" as const;
const secondVault = "0x2222222222222222222222222222222222222222" as const;
const allocator = "0x3333333333333333333333333333333333333333" as const;
const replacement = "0x4444444444444444444444444444444444444444" as const;
const zero = "0x0000000000000000000000000000000000000000" as const;
const factory = "0x03D43dF6FF894C848fC6F1A0a7E8a539Ef9A4C18" as const;
const hash = (n: number): `0x${string}` => `0x${n.toString(16).padStart(64, "0")}`;
const coordinates = (n: number) => ({
  logIndex: n,
  block: { number: n, timestamp: 1_700_000_000 + n, hash: hash(n) },
  transaction: { hash: hash(n + 1000), transactionIndex: 0, from: vault, to: allocator, input: "0x" },
});
const ratios = { strategy: vault, newTargetRatio: 0n, newMaxRatio: 0n, newTotalDebtRatio: 0n };

describe("arbitrary assigned allocator discovery", () => {
  it("captures Role Manager migration and membership removal evidence", async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { 1: { simulate: [
      { ...coordinates(300), contract: "YearnV3RoleManager", event: "AddedNewVault", srcAddress: managers[1], params: { vault, debtAllocator: allocator, category: 0n } },
      { ...coordinates(301), contract: "YearnV3Vault", event: "UpdateRoleManager", srcAddress: vault, params: { role_manager: replacement } },
      { ...coordinates(302), contract: "YearnV3RoleManager", event: "AddedNewVault", srcAddress: replacement, params: { vault, debtAllocator: secondVault, category: 0n } },
      { ...coordinates(303), contract: "YearnV3RoleManager", event: "RemovedVault", srcAddress: replacement, params: { vault } },
    ] } } });
    const events = await indexer.AllocationSourceEvent.getAll();
    expect(events.map((row) => row.eventName)).toEqual(["AddedNewVault", "UpdateRoleManager", "AddedNewVault", "RemovedVault"]);
    expect(events[1]).toEqual(expect.objectContaining({ sourceType: "vault", sourceAddress: vault, scope: "vault" }));
    expect((await indexer.VaultDebtAllocatorAssignment.getAll()).map((row) => row.roleManagerAddress)).toEqual([managers[1].toLowerCase(), replacement]);
  });
  for (const chainId of [1, 8453, 747474] as const) {
    it(`captures initial and replacement allocator shapes on chain ${chainId}`, async () => {
      const indexer = createTestIndexer();
      await indexer.process({ chains: { [chainId]: { simulate: [
        { ...coordinates(100), contract: "YearnV3RoleManager", event: "AddedNewVault", srcAddress: managers[chainId], params: { vault, debtAllocator: allocator, category: 0n } },
        { ...coordinates(101), contract: "AssignedDebtAllocator", event: "SharedUpdateStrategyDebtRatio", srcAddress: allocator, params: { ...ratios, vault: secondVault } },
        { ...coordinates(102), contract: "YearnV3RoleManager", event: "UpdateDebtAllocator", srcAddress: managers[chainId], params: { vault, debtAllocator: replacement } },
        { ...coordinates(103), contract: "AssignedDebtAllocator", event: "UpdateStrategyDebtRatio", srcAddress: replacement, params: ratios },
        { ...coordinates(104), contract: "AssignedDebtAllocator", event: "UpdateKeeper", srcAddress: replacement, params: { keeper: vault, allowed: true } },
        { ...coordinates(105), contract: "YearnV3RoleManager", event: "UpdateDebtAllocator", srcAddress: managers[chainId], params: { vault, debtAllocator: zero } },
      ] } } });
      const assignments = await indexer.VaultDebtAllocatorAssignment.getAll();
      expect(assignments.map((row) => row.allocatorAddress)).toEqual([allocator, replacement, zero]);
      expect(assignments.every((row) => row.chainId === chainId)).toBe(true);
      expect(await indexer.SharedUpdateStrategyDebtRatio.getAll()).toEqual([
        expect.objectContaining({ vault: secondVault, allocatorAddress: allocator, newTargetRatio: 0n }),
      ]);
      const unresolved = await indexer.UnresolvedAllocationSourceEvent.getAll();
      expect(unresolved).toHaveLength(2);
      expect(unresolved.map((row) => row.reason)).toEqual(["missingVaultBoundFactoryEvidence", "unknownAllocatorFamily"]);
      expect(await indexer.DebtAllocatorDeployment.getAll()).toEqual([]);
      expect(await indexer.SharedDebtAllocatorDeployment.getAll()).toEqual([]);
    });

    it(`retains broad discovery across calls and late shared provenance on chain ${chainId}`, async () => {
      const indexer = createTestIndexer();
      await indexer.process({ chains: { [chainId]: { simulate: [
        { ...coordinates(200), contract: "YearnV3RoleManager", event: "UpdateDebtAllocator", srcAddress: managers[chainId], params: { vault, debtAllocator: allocator } },
        { ...coordinates(201), contract: "AssignedDebtAllocator", event: "UpdateKeeper", srcAddress: allocator, params: { keeper: secondVault, allowed: true } },
      ] } } });
      expect(await indexer.UnresolvedAllocationSourceEvent.getAll()).toEqual([
        expect.objectContaining({ reason: "unknownAllocatorFamily", resolved: false }),
      ]);
      await indexer.process({ chains: { [chainId]: { simulate: [
        { ...coordinates(202), contract: "SharedDebtAllocatorFactory", event: "NewDebtAllocator", srcAddress: factory, params: { allocator, governance: secondVault } },
        { ...coordinates(203), contract: "YearnV3RoleManager", event: "AddedNewVault", srcAddress: managers[chainId], params: { vault: secondVault, debtAllocator: allocator, category: 0n } },
        { ...coordinates(204), contract: "AssignedDebtAllocator", event: "SharedUpdateStrategyDebtRatio", srcAddress: allocator, params: { ...ratios, vault: secondVault } },
        { ...coordinates(205), contract: "AssignedDebtAllocator", event: "GovernanceTransferred", srcAddress: allocator, params: { previousGovernance: vault, newGovernance: secondVault } },
      ] } } });
      const controls = (await indexer.AllocationSourceEvent.getAll()).filter((row) => row.eventName === "UpdateKeeper" || row.eventName === "GovernanceTransferred");
      expect(controls).toHaveLength(2);
      expect(controls.every((row) => row.scope === "allocator" && row.vaultAddress === undefined)).toBe(true);
      expect(await indexer.UnresolvedAllocationSourceEvent.getAll()).toEqual([expect.objectContaining({ resolved: true })]);
      expect(await indexer.SharedUpdateStrategyDebtRatio.getAll()).toHaveLength(1);
    });
  }
});
