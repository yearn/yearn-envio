import { indexer, type Entity } from "envio";
import {
  NORMALIZATION_VERSION,
  allocationEventId,
  lowerAddress,
  serializers,
  topLevelInputSelector,
  type Serializer,
} from "./normalization.js";

type EventEnvelope = {
  chainId: number;
  srcAddress: string;
  block: { number: number; timestamp: number; hash: string };
  transaction: {
    hash: string;
    transactionIndex: number;
    from?: string;
    to?: string | null;
    input?: string | null;
  };
  logIndex: number;
};

type EntityContext = {
  AllocationSourceEvent: { set: (entity: Entity<"AllocationSourceEvent">) => void };
};

const normalizedId = (event: EventEnvelope): string =>
  allocationEventId(event.chainId, event.transaction.hash, event.logIndex);

const writeNormalizedEvent = <T>(
  event: EventEnvelope,
  context: EntityContext,
  vaultAddress: string,
  eventSerializer: Serializer<T>,
  params: T,
): void => {
  context.AllocationSourceEvent.set({
    id: normalizedId(event),
    chainId: event.chainId,
    vaultAddress: lowerAddress(vaultAddress),
    sourceAddress: lowerAddress(event.srcAddress),
    sourceType: eventSerializer.sourceType,
    eventName: eventSerializer.eventName,
    signature: eventSerializer.signature,
    normalizationVersion: NORMALIZATION_VERSION,
    abiVariant: eventSerializer.abiVariant ?? undefined,
    blockNumber: event.block.number,
    blockTimestamp: BigInt(event.block.timestamp),
    blockHash: lowerAddress(event.block.hash),
    transactionHash: lowerAddress(event.transaction.hash),
    transactionIndex: event.transaction.transactionIndex,
    logIndex: event.logIndex,
    topLevelTransactionFrom: event.transaction.from ? lowerAddress(event.transaction.from) : undefined,
    topLevelTransactionTo: event.transaction.to ? lowerAddress(event.transaction.to) : undefined,
    topLevelInputSelector: topLevelInputSelector(event.transaction.input) ?? undefined,
    strategyAddress: eventSerializer.strategyAddress(params) ?? undefined,
    argsJson: eventSerializer.serialize(params),
  });
};

indexer.contractRegister({ contract: "YearnV3Registry", event: "NewEndorsedVault" }, async ({ event, context }) => {
  context.chain.YearnV3Vault.add(lowerAddress(event.params.vault));
});

indexer.contractRegister({ contract: "YearnV3VaultFactory", event: "NewVault" }, async ({ event, context }) => {
  context.chain.YearnV3Vault.add(lowerAddress(event.params.vault_address));
});

indexer.contractRegister({ contract: "YearnV3RoleManagerFactory", event: "NewProject" }, async ({ event, context }) => {
  context.chain.YearnV3RoleManager.add(lowerAddress(event.params.roleManager));
});

indexer.contractRegister({ contract: "YearnV3RoleManager", event: "AddedNewVault" }, async ({ event, context }) => {
  context.chain.YearnV3Vault.add(lowerAddress(event.params.vault));
});

indexer.contractRegister({ contract: "DebtAllocatorFactory", event: "NewDebtAllocator" }, async ({ event, context }) => {
  context.chain.DebtAllocator.add(lowerAddress(event.params.allocator));
});

indexer.onEvent({ contract: "YearnV3Vault", event: "Deposit" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.Deposit, event.params);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "Withdraw" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.Withdraw, event.params);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "DebtUpdated" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.DebtUpdated, event.params);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "StrategyReported" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.StrategyReported, event.params);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "StrategyChanged" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.StrategyChanged, event.params);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "UpdatedMaxDebtForStrategy" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.UpdatedMaxDebtForStrategy, event.params);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "DebtPurchased" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.DebtPurchased, event.params);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "UpdateDefaultQueue" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.UpdateDefaultQueue, event.params);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "UpdateUseDefaultQueue" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.UpdateUseDefaultQueue, event.params);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "UpdateMinimumTotalIdle" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.UpdateMinimumTotalIdle, event.params);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "UpdateAutoAllocate" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.UpdateAutoAllocate, event.params);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "Shutdown" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.Shutdown, event.params);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "RoleSet" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.RoleSet, event.params);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "RoleStatusChanged" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.RoleStatusChanged, event.params);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "UpdateRoleManager" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.UpdateRoleManager, event.params);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "UpdateAccountant" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.UpdateAccountant, event.params);
});

indexer.onEvent({ contract: "YearnV3RoleManager", event: "AddedNewVault" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.params.vault, serializers.roleManager.AddedNewVault, event.params);
});

indexer.onEvent({ contract: "YearnV3RoleManager", event: "RemovedVault" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.params.vault, serializers.roleManager.RemovedVault, event.params);
});

indexer.onEvent({ contract: "YearnV3RoleManager", event: "UpdateDebtAllocator" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.params.vault, serializers.roleManager.UpdateDebtAllocator, event.params);
});

indexer.onEvent({ contract: "DebtAllocatorFactory", event: "NewDebtAllocator" }, async ({ event, context }) => {
  const eventId = normalizedId(event);
  const allocatorAddress = lowerAddress(event.params.allocator);
  const vaultAddress = lowerAddress(event.params.vault);

  context.DebtAllocatorDeployment.set({
    id: `${event.chainId}:${allocatorAddress}`,
    chainId: event.chainId,
    allocatorAddress,
    vaultAddress,
    factoryAddress: lowerAddress(event.srcAddress),
    originalAllocatorAddress: undefined,
    abiVariant: serializers.debtAllocatorFactory.NewDebtAllocator.abiVariant ?? undefined,
    createdBlock: event.block.number,
    createdTimestamp: BigInt(event.block.timestamp),
    createdTransactionHash: lowerAddress(event.transaction.hash),
    createdEventId: eventId,
  });
  writeNormalizedEvent(event, context, vaultAddress, serializers.debtAllocatorFactory.NewDebtAllocator, event.params);
});

const writeAllocatorEvent = async <T>(
  event: EventEnvelope,
  context: EntityContext & {
    DebtAllocatorDeployment: { get: (id: string) => Promise<Entity<"DebtAllocatorDeployment"> | undefined> };
  },
  eventSerializer: Serializer<T>,
  params: T,
): Promise<void> => {
  const allocatorAddress = lowerAddress(event.srcAddress);
  const deployment = await context.DebtAllocatorDeployment.get(`${event.chainId}:${allocatorAddress}`);
  if (!deployment) {
    throw new Error(`Unresolved debt allocator deployment on chain ${event.chainId}: ${allocatorAddress}`);
  }
  writeNormalizedEvent(event, context, deployment.vaultAddress, eventSerializer, params);
};

indexer.onEvent({ contract: "DebtAllocator", event: "UpdateStrategyDebtRatios" }, async ({ event, context }) => {
  await writeAllocatorEvent(event, context, serializers.debtAllocator.UpdateStrategyDebtRatios, event.params);
});

indexer.onEvent({ contract: "DebtAllocator", event: "UpdateKeeper" }, async ({ event, context }) => {
  await writeAllocatorEvent(event, context, serializers.debtAllocator.UpdateKeeper, event.params);
});

indexer.onEvent({ contract: "DebtAllocator", event: "GovernanceTransferred" }, async ({ event, context }) => {
  await writeAllocatorEvent(event, context, serializers.debtAllocator.GovernanceTransferred, event.params);
});
