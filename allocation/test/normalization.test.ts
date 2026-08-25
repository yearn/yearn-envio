import { describe, expect, it } from "vitest";
import { allocationEventId, serializers, topLevelInputSelector, type Serializer } from "../src/normalization.js";

const A = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const C = "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

type GoldenCase = readonly [name: string, serializer: Serializer<any>, params: unknown, expected: string];

const goldenCases: readonly GoldenCase[] = [
  ["vault Deposit", serializers.vault.Deposit, { sender: A, owner: B, assets: 12n, shares: 9n }, '{"sender":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","owner":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","assets":"12","shares":"9"}'],
  ["vault Withdraw", serializers.vault.Withdraw, { sender: A, receiver: B, owner: C, assets: 12n, shares: 9n }, '{"sender":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","receiver":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","owner":"0xcccccccccccccccccccccccccccccccccccccccc","assets":"12","shares":"9"}'],
  ["vault DebtUpdated", serializers.vault.DebtUpdated, { strategy: A, currentDebt: 2n, newDebt: 3n }, '{"strategy":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","currentDebt":"2","newDebt":"3"}'],
  ["vault StrategyReported", serializers.vault.StrategyReported, { strategy: A, gain: 1n, loss: 2n, currentDebt: 3n, protocolFees: 4n, totalFees: 5n, totalRefunds: 6n }, '{"strategy":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","gain":"1","loss":"2","currentDebt":"3","protocolFees":"4","totalFees":"5","totalRefunds":"6"}'],
  ["vault StrategyChanged", serializers.vault.StrategyChanged, { strategy: A, changeType: 2n }, '{"strategy":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","changeType":"2"}'],
  ["vault UpdatedMaxDebtForStrategy", serializers.vault.UpdatedMaxDebtForStrategy, { sender: A, strategy: B, newDebt: 7n }, '{"sender":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","strategy":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","newDebt":"7"}'],
  ["vault DebtPurchased", serializers.vault.DebtPurchased, { strategy: A, amount: 8n }, '{"strategy":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","amount":"8"}'],
  ["vault UpdateDefaultQueue", serializers.vault.UpdateDefaultQueue, { newDefaultQueue: [A, B] }, '{"newDefaultQueue":["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]}'],
  ["vault UpdateUseDefaultQueue", serializers.vault.UpdateUseDefaultQueue, { useDefaultQueue: true }, '{"useDefaultQueue":true}'],
  ["vault UpdateMinimumTotalIdle", serializers.vault.UpdateMinimumTotalIdle, { minimumTotalIdle: 10n }, '{"minimumTotalIdle":"10"}'],
  ["vault UpdateAutoAllocate", serializers.vault.UpdateAutoAllocate, { autoAllocate: false }, '{"autoAllocate":false}'],
  ["vault Shutdown", serializers.vault.Shutdown, undefined, '{}'],
  ["vault RoleSet", serializers.vault.RoleSet, { account: A, role: 4n }, '{"account":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","role":"4"}'],
  ["vault RoleStatusChanged", serializers.vault.RoleStatusChanged, { role: 4n, status: 1n }, '{"role":"4","status":"1"}'],
  ["vault UpdateRoleManager", serializers.vault.UpdateRoleManager, { roleManager: A }, '{"roleManager":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'],
  ["vault UpdateAccountant", serializers.vault.UpdateAccountant, { accountant: A }, '{"accountant":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'],
  ["role manager AddedNewVault", serializers.roleManager.AddedNewVault, { vault: A, debtAllocator: B, category: 2n }, '{"vault":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","debtAllocator":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","category":"2"}'],
  ["role manager RemovedVault", serializers.roleManager.RemovedVault, { vault: A }, '{"vault":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'],
  ["role manager UpdateDebtAllocator", serializers.roleManager.UpdateDebtAllocator, { vault: A, debtAllocator: B }, '{"vault":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","debtAllocator":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'],
  ["factory NewDebtAllocator", serializers.debtAllocatorFactory.NewDebtAllocator, { allocator: A, vault: B }, '{"allocator":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","vault":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'],
  ["allocator UpdateStrategyDebtRatios", serializers.debtAllocator.UpdateStrategyDebtRatios, { strategy: A, newTargetRatio: 1n, newMaxRatio: 2n, newTotalDebtRatio: 3n }, '{"strategy":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","newTargetRatio":"1","newMaxRatio":"2","newTotalDebtRatio":"3"}'],
  ["allocator UpdateKeeper", serializers.debtAllocator.UpdateKeeper, { keeper: A, allowed: true }, '{"keeper":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","allowed":true}'],
  ["allocator GovernanceTransferred", serializers.debtAllocator.GovernanceTransferred, { previousGovernance: A, newGovernance: B }, '{"previousGovernance":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","newGovernance":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'],
];

describe("normalization version 1 serializers", () => {
  it.each(goldenCases)("serializes %s deterministically", (_name, serializer, params, expected) => {
    expect(serializer.serialize(params)).toBe(expected);
    expect(serializer.signature).toMatch(/^0x[0-9a-f]{64}$/);
    expect(serializer.signature).toBe(serializer.signature.toLowerCase());
  });

  it("keeps every configured source event under an explicit serializer", () => {
    expect(goldenCases).toHaveLength(23);
  });
});

describe("normalized envelope helpers", () => {
  it("builds the specified lowercase event ID", () => {
    expect(allocationEventId(1, "0xABCDEF", 17)).toBe("1:0xabcdef:17");
  });

  it.each([
    [undefined, null],
    [null, null],
    ["0x", null],
    ["0x1234567", null],
    ["0xA9059CBB00000000", "0xa9059cbb"],
  ])("extracts the selector from %s", (input, expected) => {
    expect(topLevelInputSelector(input)).toBe(expected);
  });
});
