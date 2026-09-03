import { toEventSelector } from "viem";

export const NORMALIZATION_VERSION = 2;

export type SourceType = "roleManager" | "debtAllocatorFactory" | "debtAllocator";

export type Serializer<T> = {
  readonly sourceType: SourceType;
  readonly eventName: string;
  readonly signature: `0x${string}`;
  readonly abiVariant: string;
  readonly strategyAddress: (params: T) => string | null;
  readonly serialize: (params: T) => string;
};

const lowerHex = (value: string): string => value.toLowerCase();
const decimal = (value: bigint | number | string): string => value.toString(10);
const signature = (event: string): `0x${string}` =>
  toEventSelector(event).toLowerCase() as `0x${string}`;

const serializer = <T>(
  sourceType: SourceType,
  eventName: string,
  event: string,
  abiVariant: string,
  serialize: (params: T) => string,
  strategyAddress: (params: T) => string | null = () => null,
): Serializer<T> => ({
  sourceType,
  eventName,
  signature: signature(event),
  abiVariant,
  strategyAddress,
  serialize,
});

type StrategyRatioParams = {
  strategy: string;
  newTargetRatio: bigint;
  newMaxRatio: bigint;
  newTotalDebtRatio: bigint;
};

type SharedStrategyRatioParams = StrategyRatioParams & { vault: string };

const serializeStrategyRatio = ({
  strategy,
  newTargetRatio,
  newMaxRatio,
  newTotalDebtRatio,
}: StrategyRatioParams): string =>
  JSON.stringify({
    strategy: lowerHex(strategy),
    newTargetRatio: decimal(newTargetRatio),
    newMaxRatio: decimal(newMaxRatio),
    newTotalDebtRatio: decimal(newTotalDebtRatio),
  });

export const serializers = {
  roleManager: {
    AddedNewVault: serializer<{
      vault: string;
      debtAllocator: string;
      category: bigint;
    }>(
      "roleManager",
      "AddedNewVault",
      "AddedNewVault(address,address,uint256)",
      "role-manager-v1-initial-assignment",
      ({ vault, debtAllocator, category }) =>
        JSON.stringify({
          vault: lowerHex(vault),
          debtAllocator: lowerHex(debtAllocator),
          category: decimal(category),
        }),
    ),
    UpdateDebtAllocator: serializer<{ vault: string; debtAllocator: string }>(
      "roleManager",
      "UpdateDebtAllocator",
      "UpdateDebtAllocator(address,address)",
      "role-manager-v1-updated-assignment",
      ({ vault, debtAllocator }) =>
        JSON.stringify({ vault: lowerHex(vault), debtAllocator: lowerHex(debtAllocator) }),
    ),
  },
  debtAllocatorFactory: {
    NewVaultBoundDebtAllocator: serializer<{ allocator: string; vault: string }>(
      "debtAllocatorFactory",
      "NewDebtAllocator",
      "NewDebtAllocator(address,address)",
      "generic-v1-vault-bound-factory",
      ({ allocator, vault }) =>
        JSON.stringify({ allocator: lowerHex(allocator), vault: lowerHex(vault) }),
    ),
    NewSharedDebtAllocator: serializer<{ allocator: string; governance: string }>(
      "debtAllocatorFactory",
      "NewDebtAllocator",
      "NewDebtAllocator(address,address)",
      "shared-v1-governance-bound-factory",
      ({ allocator, governance }) =>
        JSON.stringify({ allocator: lowerHex(allocator), governance: lowerHex(governance) }),
    ),
  },
  debtAllocator: {
    UpdateStrategyDebtRatios: serializer<StrategyRatioParams>(
      "debtAllocator",
      "UpdateStrategyDebtRatios",
      "UpdateStrategyDebtRatios(address,uint256,uint256,uint256)",
      "generic-v0-vault-bound-plural",
      serializeStrategyRatio,
      ({ strategy }) => lowerHex(strategy),
    ),
    UpdateStrategyDebtRatio: serializer<StrategyRatioParams>(
      "debtAllocator",
      "UpdateStrategyDebtRatio",
      "UpdateStrategyDebtRatio(address,uint256,uint256,uint256)",
      "generic-v1-vault-bound-singular",
      serializeStrategyRatio,
      ({ strategy }) => lowerHex(strategy),
    ),
    SharedUpdateStrategyDebtRatio: serializer<SharedStrategyRatioParams>(
      "debtAllocator",
      "UpdateStrategyDebtRatio",
      "UpdateStrategyDebtRatio(address,address,uint256,uint256,uint256)",
      "shared-v1-vault-scoped-singular",
      ({ vault, ...params }) =>
        JSON.stringify({ vault: lowerHex(vault), ...JSON.parse(serializeStrategyRatio(params)) }),
      ({ strategy }) => lowerHex(strategy),
    ),
    UpdateKeeper: serializer<{ keeper: string; allowed: boolean }>(
      "debtAllocator",
      "UpdateKeeper",
      "UpdateKeeper(address,bool)",
      "generic-v1-vault-bound",
      ({ keeper, allowed }) => JSON.stringify({ keeper: lowerHex(keeper), allowed }),
    ),
    SharedUpdateKeeper: serializer<{ keeper: string; allowed: boolean }>(
      "debtAllocator",
      "UpdateKeeper",
      "UpdateKeeper(address,bool)",
      "shared-v1-unscoped",
      ({ keeper, allowed }) => JSON.stringify({ keeper: lowerHex(keeper), allowed }),
    ),
    GovernanceTransferred: serializer<{
      previousGovernance: string;
      newGovernance: string;
    }>(
      "debtAllocator",
      "GovernanceTransferred",
      "GovernanceTransferred(address,address)",
      "generic-v1-vault-bound",
      ({ previousGovernance, newGovernance }) =>
        JSON.stringify({
          previousGovernance: lowerHex(previousGovernance),
          newGovernance: lowerHex(newGovernance),
        }),
    ),
    SharedGovernanceTransferred: serializer<{
      previousGovernance: string;
      newGovernance: string;
    }>(
      "debtAllocator",
      "GovernanceTransferred",
      "GovernanceTransferred(address,address)",
      "shared-v1-unscoped",
      ({ previousGovernance, newGovernance }) =>
        JSON.stringify({
          previousGovernance: lowerHex(previousGovernance),
          newGovernance: lowerHex(newGovernance),
        }),
    ),
  },
} as const;

export const allocationEventId = (
  chainId: number,
  transactionHash: string,
  logIndex: number,
): string => `${chainId}:${lowerHex(transactionHash)}:${logIndex}`;

export const topLevelInputSelector = (input: string | null | undefined): string | null => {
  if (!input || !/^0x[0-9a-fA-F]{8}/.test(input)) return null;
  return input.slice(0, 10).toLowerCase();
};

export const lowerAddress = (value: string): `0x${string}` =>
  lowerHex(value) as `0x${string}`;
