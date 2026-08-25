import { toEventSelector } from "viem";

export const NORMALIZATION_VERSION = 1;

export type SourceType = "vault" | "roleManager" | "debtAllocatorFactory" | "debtAllocator";

export type Serializer<T> = {
  readonly sourceType: SourceType;
  readonly eventName: string;
  readonly signature: `0x${string}`;
  readonly abiVariant: string | null;
  readonly strategyAddress: (params: T) => string | null;
  readonly serialize: (params: T) => string;
};

const lowerHex = (value: string): string => value.toLowerCase();
const decimal = (value: bigint | number | string): string => value.toString(10);
const addressArray = (values: readonly string[]): string[] => values.map(lowerHex);
const signature = (event: string): `0x${string}` => toEventSelector(event).toLowerCase() as `0x${string}`;

const serializer = <T>(
  sourceType: SourceType,
  eventName: string,
  event: string,
  serialize: (params: T) => string,
  options: { abiVariant?: string; strategyAddress?: (params: T) => string | null } = {},
): Serializer<T> => ({
  sourceType,
  eventName,
  signature: signature(event),
  abiVariant: options.abiVariant ?? null,
  strategyAddress: options.strategyAddress ?? (() => null),
  serialize,
});

export const serializers = {
  vault: {
    Deposit: serializer<{ sender: string; owner: string; assets: bigint; shares: bigint }>(
      "vault",
      "Deposit",
      "Deposit(address,address,uint256,uint256)",
      ({ sender, owner, assets, shares }) =>
        JSON.stringify({ sender: lowerHex(sender), owner: lowerHex(owner), assets: decimal(assets), shares: decimal(shares) }),
    ),
    Withdraw: serializer<{ sender: string; receiver: string; owner: string; assets: bigint; shares: bigint }>(
      "vault",
      "Withdraw",
      "Withdraw(address,address,address,uint256,uint256)",
      ({ sender, receiver, owner, assets, shares }) =>
        JSON.stringify({
          sender: lowerHex(sender),
          receiver: lowerHex(receiver),
          owner: lowerHex(owner),
          assets: decimal(assets),
          shares: decimal(shares),
        }),
    ),
    DebtUpdated: serializer<{ strategy: string; currentDebt: bigint; newDebt: bigint }>(
      "vault",
      "DebtUpdated",
      "DebtUpdated(address,uint256,uint256)",
      ({ strategy, currentDebt, newDebt }) =>
        JSON.stringify({ strategy: lowerHex(strategy), currentDebt: decimal(currentDebt), newDebt: decimal(newDebt) }),
      { strategyAddress: ({ strategy }) => lowerHex(strategy) },
    ),
    StrategyReported: serializer<{
      strategy: string;
      gain: bigint;
      loss: bigint;
      currentDebt: bigint;
      protocolFees: bigint;
      totalFees: bigint;
      totalRefunds: bigint;
    }>(
      "vault",
      "StrategyReported",
      "StrategyReported(address,uint256,uint256,uint256,uint256,uint256,uint256)",
      ({ strategy, gain, loss, currentDebt, protocolFees, totalFees, totalRefunds }) =>
        JSON.stringify({
          strategy: lowerHex(strategy),
          gain: decimal(gain),
          loss: decimal(loss),
          currentDebt: decimal(currentDebt),
          protocolFees: decimal(protocolFees),
          totalFees: decimal(totalFees),
          totalRefunds: decimal(totalRefunds),
        }),
      { strategyAddress: ({ strategy }) => lowerHex(strategy) },
    ),
    StrategyChanged: serializer<{ strategy: string; changeType: bigint }>(
      "vault",
      "StrategyChanged",
      "StrategyChanged(address,uint256)",
      ({ strategy, changeType }) => JSON.stringify({ strategy: lowerHex(strategy), changeType: decimal(changeType) }),
      { strategyAddress: ({ strategy }) => lowerHex(strategy) },
    ),
    UpdatedMaxDebtForStrategy: serializer<{ sender: string; strategy: string; newDebt: bigint }>(
      "vault",
      "UpdatedMaxDebtForStrategy",
      "UpdatedMaxDebtForStrategy(address,address,uint256)",
      ({ sender, strategy, newDebt }) =>
        JSON.stringify({ sender: lowerHex(sender), strategy: lowerHex(strategy), newDebt: decimal(newDebt) }),
      { strategyAddress: ({ strategy }) => lowerHex(strategy) },
    ),
    DebtPurchased: serializer<{ strategy: string; amount: bigint }>(
      "vault",
      "DebtPurchased",
      "DebtPurchased(address,uint256)",
      ({ strategy, amount }) => JSON.stringify({ strategy: lowerHex(strategy), amount: decimal(amount) }),
      { strategyAddress: ({ strategy }) => lowerHex(strategy) },
    ),
    UpdateDefaultQueue: serializer<{ newDefaultQueue: readonly string[] }>(
      "vault",
      "UpdateDefaultQueue",
      "UpdateDefaultQueue(address[])",
      ({ newDefaultQueue }) => JSON.stringify({ newDefaultQueue: addressArray(newDefaultQueue) }),
    ),
    UpdateUseDefaultQueue: serializer<{ useDefaultQueue: boolean }>(
      "vault",
      "UpdateUseDefaultQueue",
      "UpdateUseDefaultQueue(bool)",
      ({ useDefaultQueue }) => JSON.stringify({ useDefaultQueue }),
    ),
    UpdateMinimumTotalIdle: serializer<{ minimumTotalIdle: bigint }>(
      "vault",
      "UpdateMinimumTotalIdle",
      "UpdateMinimumTotalIdle(uint256)",
      ({ minimumTotalIdle }) => JSON.stringify({ minimumTotalIdle: decimal(minimumTotalIdle) }),
    ),
    UpdateAutoAllocate: serializer<{ autoAllocate: boolean }>(
      "vault",
      "UpdateAutoAllocate",
      "UpdateAutoAllocate(bool)",
      ({ autoAllocate }) => JSON.stringify({ autoAllocate }),
    ),
    Shutdown: serializer<undefined>("vault", "Shutdown", "Shutdown()", () => "{}"),
    RoleSet: serializer<{ account: string; role: bigint }>(
      "vault",
      "RoleSet",
      "RoleSet(address,uint256)",
      ({ account, role }) => JSON.stringify({ account: lowerHex(account), role: decimal(role) }),
    ),
    RoleStatusChanged: serializer<{ role: bigint; status: bigint }>(
      "vault",
      "RoleStatusChanged",
      "RoleStatusChanged(uint256,uint256)",
      ({ role, status }) => JSON.stringify({ role: decimal(role), status: decimal(status) }),
    ),
    UpdateRoleManager: serializer<{ roleManager: string }>(
      "vault",
      "UpdateRoleManager",
      "UpdateRoleManager(address)",
      ({ roleManager }) => JSON.stringify({ roleManager: lowerHex(roleManager) }),
    ),
    UpdateAccountant: serializer<{ accountant: string }>(
      "vault",
      "UpdateAccountant",
      "UpdateAccountant(address)",
      ({ accountant }) => JSON.stringify({ accountant: lowerHex(accountant) }),
    ),
  },
  roleManager: {
    AddedNewVault: serializer<{ vault: string; debtAllocator: string; category: bigint }>(
      "roleManager",
      "AddedNewVault",
      "AddedNewVault(address,address,uint256)",
      ({ vault, debtAllocator, category }) =>
        JSON.stringify({ vault: lowerHex(vault), debtAllocator: lowerHex(debtAllocator), category: decimal(category) }),
      { abiVariant: "yearn-v3-role-manager-v1" },
    ),
    RemovedVault: serializer<{ vault: string }>(
      "roleManager",
      "RemovedVault",
      "RemovedVault(address)",
      ({ vault }) => JSON.stringify({ vault: lowerHex(vault) }),
      { abiVariant: "yearn-v3-role-manager-v1" },
    ),
    UpdateDebtAllocator: serializer<{ vault: string; debtAllocator: string }>(
      "roleManager",
      "UpdateDebtAllocator",
      "UpdateDebtAllocator(address,address)",
      ({ vault, debtAllocator }) => JSON.stringify({ vault: lowerHex(vault), debtAllocator: lowerHex(debtAllocator) }),
      { abiVariant: "yearn-v3-role-manager-v1" },
    ),
  },
  debtAllocatorFactory: {
    NewDebtAllocator: serializer<{ allocator: string; vault: string }>(
      "debtAllocatorFactory",
      "NewDebtAllocator",
      "NewDebtAllocator(address,address)",
      ({ allocator, vault }) => JSON.stringify({ allocator: lowerHex(allocator), vault: lowerHex(vault) }),
      { abiVariant: "generic-v1-no-original-allocator" },
    ),
  },
  debtAllocator: {
    UpdateStrategyDebtRatios: serializer<{
      strategy: string;
      newTargetRatio: bigint;
      newMaxRatio: bigint;
      newTotalDebtRatio: bigint;
    }>(
      "debtAllocator",
      "UpdateStrategyDebtRatios",
      "UpdateStrategyDebtRatios(address,uint256,uint256,uint256)",
      ({ strategy, newTargetRatio, newMaxRatio, newTotalDebtRatio }) =>
        JSON.stringify({
          strategy: lowerHex(strategy),
          newTargetRatio: decimal(newTargetRatio),
          newMaxRatio: decimal(newMaxRatio),
          newTotalDebtRatio: decimal(newTotalDebtRatio),
        }),
      { strategyAddress: ({ strategy }) => lowerHex(strategy) },
    ),
    UpdateKeeper: serializer<{ keeper: string; allowed: boolean }>(
      "debtAllocator",
      "UpdateKeeper",
      "UpdateKeeper(address,bool)",
      ({ keeper, allowed }) => JSON.stringify({ keeper: lowerHex(keeper), allowed }),
    ),
    GovernanceTransferred: serializer<{ previousGovernance: string; newGovernance: string }>(
      "debtAllocator",
      "GovernanceTransferred",
      "GovernanceTransferred(address,address)",
      ({ previousGovernance, newGovernance }) =>
        JSON.stringify({ previousGovernance: lowerHex(previousGovernance), newGovernance: lowerHex(newGovernance) }),
    ),
  },
} as const;

export const allocationEventId = (chainId: number, transactionHash: string, logIndex: number): string =>
  `${chainId}:${lowerHex(transactionHash)}:${logIndex}`;

export const topLevelInputSelector = (input: string | null | undefined): string | null => {
  if (!input || !/^0x[0-9a-fA-F]{8}/.test(input)) return null;
  return input.slice(0, 10).toLowerCase();
};

export const lowerAddress = (value: string): `0x${string}` => lowerHex(value) as `0x${string}`;
