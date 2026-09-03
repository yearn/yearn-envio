import { indexer, type Entity } from "envio";
import {
  NORMALIZATION_VERSION,
  allocationEventId,
  lowerAddress,
  serializers,
  topLevelInputSelector,
  type Serializer,
} from "./normalization.js";

const ALLOCATION_CHAIN_ID = 1;
const SHARED_ALLOCATOR_IMPLEMENTATION = "0xa47eb754d44339b5dedcf4d804428708857e7899";
const SHARED_ALLOCATOR_IMPLEMENTATION_CODE_HASH =
  "0x633feca48437476cbe24af9ab15fdfcc340d52c48889c21d0ddf2b4f000c13a7";

type AllocationScope = "vault" | "allocator";

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

type RatioFields = {
  strategy: string;
  newTargetRatio: bigint;
  newMaxRatio: bigint;
  newTotalDebtRatio: bigint;
};

type NormalizationContext = {
  AllocationSourceEvent: { set: (entity: Entity<"AllocationSourceEvent">) => void };
  UnresolvedAllocationSourceEvent: {
    getWhere: (filter: {
      chainId: { _eq: number };
      sourceAddress: { _eq: string };
      resolved: { _eq: boolean };
    }) => Promise<Entity<"UnresolvedAllocationSourceEvent">[]>;
    set: (entity: Entity<"UnresolvedAllocationSourceEvent">) => void;
  };
};

const normalizedId = (event: EventEnvelope): string =>
  allocationEventId(event.chainId, event.transaction.hash, event.logIndex);

const envelope = <T>(event: EventEnvelope, eventSerializer: Serializer<T>, params: T) => ({
  id: normalizedId(event),
  chainId: event.chainId,
  sourceAddress: lowerAddress(event.srcAddress),
  sourceType: eventSerializer.sourceType,
  eventName: eventSerializer.eventName,
  signature: eventSerializer.signature,
  normalizationVersion: NORMALIZATION_VERSION,
  abiVariant: eventSerializer.abiVariant,
  blockNumber: event.block.number,
  blockTimestamp: BigInt(event.block.timestamp),
  blockHash: lowerAddress(event.block.hash),
  transactionHash: lowerAddress(event.transaction.hash),
  transactionIndex: event.transaction.transactionIndex,
  logIndex: event.logIndex,
  topLevelTransactionFrom: event.transaction.from
    ? lowerAddress(event.transaction.from)
    : undefined,
  topLevelTransactionTo: event.transaction.to ? lowerAddress(event.transaction.to) : undefined,
  topLevelInputSelector: topLevelInputSelector(event.transaction.input) ?? undefined,
  strategyAddress: eventSerializer.strategyAddress(params) ?? undefined,
  argsJson: eventSerializer.serialize(params),
});

const ratioFields = (params: RatioFields) => ({
  newTargetRatio: params.newTargetRatio,
  newMaxRatio: params.newMaxRatio,
  newTotalDebtRatio: params.newTotalDebtRatio,
});

const writeNormalized = <T>(
  event: EventEnvelope,
  context: NormalizationContext,
  vaultAddress: string | null,
  scope: AllocationScope,
  eventSerializer: Serializer<T>,
  params: T,
  associationEvidence: string,
  ratios?: RatioFields,
): void => {
  context.AllocationSourceEvent.set({
    ...envelope(event, eventSerializer, params),
    vaultAddress: vaultAddress ? lowerAddress(vaultAddress) : undefined,
    scope,
    associationEvidence,
    newTargetRatio: ratios?.newTargetRatio,
    newMaxRatio: ratios?.newMaxRatio,
    newTotalDebtRatio: ratios?.newTotalDebtRatio,
  });
};

const writeUnresolved = <T>(
  event: EventEnvelope,
  context: NormalizationContext,
  eventSerializer: Serializer<T>,
  params: T,
  reason: string,
  ratios?: RatioFields,
): void => {
  context.UnresolvedAllocationSourceEvent.set({
    ...envelope(event, eventSerializer, params),
    reason,
    newTargetRatio: ratios?.newTargetRatio,
    newMaxRatio: ratios?.newMaxRatio,
    newTotalDebtRatio: ratios?.newTotalDebtRatio,
    resolved: false,
    resolvedAllocationSourceEventId: undefined,
  });
};

const resolvePendingVaultBoundEvents = async (
  event: EventEnvelope,
  context: NormalizationContext,
  allocatorAddress: string,
  vaultAddress: string,
): Promise<void> => {
  const unresolvedEvents = await context.UnresolvedAllocationSourceEvent.getWhere({
    chainId: { _eq: event.chainId },
    sourceAddress: { _eq: lowerAddress(allocatorAddress) },
    resolved: { _eq: false },
  });

  for (const unresolved of unresolvedEvents) {
    if (!unresolved.abiVariant.startsWith("generic-")) continue;
    context.AllocationSourceEvent.set({
      id: unresolved.id,
      chainId: unresolved.chainId,
      vaultAddress: lowerAddress(vaultAddress),
      scope: "vault",
      sourceAddress: unresolved.sourceAddress,
      sourceType: unresolved.sourceType,
      eventName: unresolved.eventName,
      signature: unresolved.signature,
      normalizationVersion: unresolved.normalizationVersion,
      abiVariant: unresolved.abiVariant,
      associationEvidence: "vault-bound-factory-event-late-reconciliation",
      blockNumber: unresolved.blockNumber,
      blockTimestamp: unresolved.blockTimestamp,
      blockHash: unresolved.blockHash,
      transactionHash: unresolved.transactionHash,
      transactionIndex: unresolved.transactionIndex,
      logIndex: unresolved.logIndex,
      topLevelTransactionFrom: unresolved.topLevelTransactionFrom,
      topLevelTransactionTo: unresolved.topLevelTransactionTo,
      topLevelInputSelector: unresolved.topLevelInputSelector,
      strategyAddress: unresolved.strategyAddress,
      newTargetRatio: unresolved.newTargetRatio,
      newMaxRatio: unresolved.newMaxRatio,
      newTotalDebtRatio: unresolved.newTotalDebtRatio,
      argsJson: unresolved.argsJson,
    });
    context.UnresolvedAllocationSourceEvent.set({
      ...unresolved,
      resolved: true,
      resolvedAllocationSourceEventId: unresolved.id,
    });
  }
};

const writeVaultBoundAllocatorEvent = async <T>(
  event: EventEnvelope,
  context: NormalizationContext & {
    DebtAllocatorDeployment: {
      get: (id: string) => Promise<Entity<"DebtAllocatorDeployment"> | undefined>;
    };
    SharedDebtAllocatorDeployment: {
      get: (id: string) => Promise<Entity<"SharedDebtAllocatorDeployment"> | undefined>;
    };
  },
  eventSerializer: Serializer<T>,
  params: T,
  ratios?: RatioFields,
): Promise<void> => {
  const deploymentId = `${event.chainId}:${lowerAddress(event.srcAddress)}`;
  const sharedDeployment = await context.SharedDebtAllocatorDeployment.get(deploymentId);
  // RoleManager discovery also registers allocator addresses against the legacy
  // vault-bound ABI. Shared/global events have identical topics, so leave them
  // exclusively to the shared handler instead of producing a competing row.
  if (sharedDeployment) return;
  const deployment = await context.DebtAllocatorDeployment.get(deploymentId);
  if (!deployment) {
    writeUnresolved(
      event,
      context,
      eventSerializer,
      params,
      "missingVaultBoundFactoryEvidence",
      ratios,
    );
    return;
  }
  writeNormalized(
    event,
    context,
    deployment.vaultAddress,
    "vault",
    eventSerializer,
    params,
    "vault-bound-factory-event",
    ratios,
  );
};

const rawEventCore = (event: EventEnvelope) => ({
  id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
  chainId: event.chainId,
  blockNumber: event.block.number,
  blockTimestamp: event.block.timestamp,
  blockHash: event.block.hash,
  transactionHash: event.transaction.hash,
  transactionIndex: event.transaction.transactionIndex,
  transactionFrom: event.transaction.from ? lowerAddress(event.transaction.from) : undefined,
  logIndex: event.logIndex,
});

indexer.contractRegister(
  { contract: "SharedDebtAllocatorFactory", event: "NewDebtAllocator" },
  async ({ event, context }) => {
    if (event.chainId !== ALLOCATION_CHAIN_ID) return;
    context.chain.SharedDebtAllocator.add(lowerAddress(event.params.allocator));
  },
);

indexer.onEvent(
  { contract: "SharedDebtAllocatorFactory", event: "NewDebtAllocator" },
  async ({ event, context }) => {
    if (event.chainId !== ALLOCATION_CHAIN_ID) return;
    const id = normalizedId(event);
    const allocatorAddress = lowerAddress(event.params.allocator);
    context.SharedNewDebtAllocator.set({
      ...rawEventCore(event),
      factoryAddress: lowerAddress(event.srcAddress),
      allocator: allocatorAddress,
      governance: lowerAddress(event.params.governance),
    });
    context.SharedDebtAllocatorDeployment.set({
      id: `${event.chainId}:${allocatorAddress}`,
      chainId: event.chainId,
      allocatorAddress,
      factoryAddress: lowerAddress(event.srcAddress),
      governanceAddress: lowerAddress(event.params.governance),
      implementationAddress: SHARED_ALLOCATOR_IMPLEMENTATION,
      implementationCodeHash: SHARED_ALLOCATOR_IMPLEMENTATION_CODE_HASH,
      abiVariant: serializers.debtAllocatorFactory.NewSharedDebtAllocator.abiVariant,
      createdBlock: event.block.number,
      createdTimestamp: BigInt(event.block.timestamp),
      createdTransactionHash: lowerAddress(event.transaction.hash),
      createdEventId: id,
    });
  },
);

indexer.onEvent(
  { contract: "SharedDebtAllocator", event: "UpdateStrategyDebtRatio" },
  async ({ event, context }) => {
    if (event.chainId !== ALLOCATION_CHAIN_ID) return;
    context.SharedUpdateStrategyDebtRatio.set({
      ...rawEventCore(event),
      allocatorAddress: lowerAddress(event.srcAddress),
      vault: lowerAddress(event.params.vault),
      strategy: lowerAddress(event.params.strategy),
      ...ratioFields(event.params),
    });
    writeNormalized(
      event,
      context,
      event.params.vault,
      "vault",
      serializers.debtAllocator.SharedUpdateStrategyDebtRatio,
      event.params,
      "event-indexed-vault",
      event.params,
    );
  },
);

indexer.onEvent(
  { contract: "SharedDebtAllocator", event: "UpdateKeeper" },
  async ({ event, context }) => {
    if (event.chainId !== ALLOCATION_CHAIN_ID) return;
    writeNormalized(
      event,
      context,
      null,
      "allocator",
      serializers.debtAllocator.SharedUpdateKeeper,
      event.params,
      "event-source-allocator",
    );
  },
);

indexer.onEvent(
  { contract: "SharedDebtAllocator", event: "GovernanceTransferred" },
  async ({ event, context }) => {
    if (event.chainId !== ALLOCATION_CHAIN_ID) return;
    writeNormalized(
      event,
      context,
      null,
      "allocator",
      serializers.debtAllocator.SharedGovernanceTransferred,
      event.params,
      "event-source-allocator",
    );
  },
);

indexer.onEvent(
  { contract: "YearnV3RoleManager", event: "AddedNewVault" },
  async ({ event, context }) => {
    if (event.chainId !== ALLOCATION_CHAIN_ID) return;
    const id = normalizedId(event);
    writeNormalized(
      event,
      context,
      event.params.vault,
      "vault",
      serializers.roleManager.AddedNewVault,
      event.params,
      "event-indexed-vault",
    );
    context.VaultDebtAllocatorAssignment.set({
      id,
      chainId: event.chainId,
      vaultAddress: lowerAddress(event.params.vault),
      allocatorAddress: lowerAddress(event.params.debtAllocator),
      roleManagerAddress: lowerAddress(event.srcAddress),
      assignmentType: "initial",
      blockNumber: event.block.number,
      blockTimestamp: BigInt(event.block.timestamp),
      blockHash: lowerAddress(event.block.hash),
      transactionHash: lowerAddress(event.transaction.hash),
      transactionIndex: event.transaction.transactionIndex,
      logIndex: event.logIndex,
      sourceEventId: id,
    });
  },
);

indexer.onEvent(
  { contract: "YearnV3RoleManager", event: "UpdateDebtAllocator" },
  async ({ event, context }) => {
    if (event.chainId !== ALLOCATION_CHAIN_ID) return;
    const id = normalizedId(event);
    context.V3RoleManagerUpdateDebtAllocator.set({
      ...rawEventCore(event),
      roleManagerAddress: lowerAddress(event.srcAddress),
      vault: lowerAddress(event.params.vault),
      debtAllocator: lowerAddress(event.params.debtAllocator),
    });
    writeNormalized(
      event,
      context,
      event.params.vault,
      "vault",
      serializers.roleManager.UpdateDebtAllocator,
      event.params,
      "event-indexed-vault",
    );
    context.VaultDebtAllocatorAssignment.set({
      id,
      chainId: event.chainId,
      vaultAddress: lowerAddress(event.params.vault),
      allocatorAddress: lowerAddress(event.params.debtAllocator),
      roleManagerAddress: lowerAddress(event.srcAddress),
      assignmentType: "updated",
      blockNumber: event.block.number,
      blockTimestamp: BigInt(event.block.timestamp),
      blockHash: lowerAddress(event.block.hash),
      transactionHash: lowerAddress(event.transaction.hash),
      transactionIndex: event.transaction.transactionIndex,
      logIndex: event.logIndex,
      sourceEventId: id,
    });
  },
);

indexer.onEvent(
  { contract: "DebtAllocatorFactory", event: "NewDebtAllocator" },
  async ({ event, context }) => {
    if (event.chainId !== ALLOCATION_CHAIN_ID) return;
    const allocatorAddress = lowerAddress(event.params.allocator);
    const vaultAddress = lowerAddress(event.params.vault);
    const id = normalizedId(event);
    context.DebtAllocatorDeployment.set({
      id: `${event.chainId}:${allocatorAddress}`,
      chainId: event.chainId,
      allocatorAddress,
      vaultAddress,
      factoryAddress: lowerAddress(event.srcAddress),
      abiVariant: serializers.debtAllocatorFactory.NewVaultBoundDebtAllocator.abiVariant,
      createdBlock: event.block.number,
      createdTimestamp: BigInt(event.block.timestamp),
      createdTransactionHash: lowerAddress(event.transaction.hash),
      createdEventId: id,
    });
    writeNormalized(
      event,
      context,
      vaultAddress,
      "vault",
      serializers.debtAllocatorFactory.NewVaultBoundDebtAllocator,
      event.params,
      "factory-indexed-vault",
    );
    await resolvePendingVaultBoundEvents(event, context, allocatorAddress, vaultAddress);
  },
);

indexer.onEvent(
  { contract: "DebtAllocator", event: "UpdateStrategyDebtRatios" },
  async ({ event, context }) => {
    if (event.chainId !== ALLOCATION_CHAIN_ID) return;
    await writeVaultBoundAllocatorEvent(
      event,
      context,
      serializers.debtAllocator.UpdateStrategyDebtRatios,
      event.params,
      event.params,
    );
  },
);

indexer.onEvent(
  { contract: "DebtAllocator", event: "UpdateStrategyDebtRatio" },
  async ({ event, context }) => {
    if (event.chainId !== ALLOCATION_CHAIN_ID) return;
    context.UpdateStrategyDebtRatio.set({
      ...rawEventCore(event),
      allocatorAddress: lowerAddress(event.srcAddress),
      strategy: lowerAddress(event.params.strategy),
      ...ratioFields(event.params),
    });
    await writeVaultBoundAllocatorEvent(
      event,
      context,
      serializers.debtAllocator.UpdateStrategyDebtRatio,
      event.params,
      event.params,
    );
  },
);

indexer.onEvent(
  { contract: "DebtAllocator", event: "UpdateKeeper" },
  async ({ event, context }) => {
    if (event.chainId !== ALLOCATION_CHAIN_ID) return;
    await writeVaultBoundAllocatorEvent(
      event,
      context,
      serializers.debtAllocator.UpdateKeeper,
      event.params,
    );
  },
);

indexer.onEvent(
  { contract: "DebtAllocator", event: "GovernanceTransferred" },
  async ({ event, context }) => {
    if (event.chainId !== ALLOCATION_CHAIN_ID) return;
    await writeVaultBoundAllocatorEvent(
      event,
      context,
      serializers.debtAllocator.GovernanceTransferred,
      event.params,
    );
  },
);
