import { indexer, type Entity } from "envio";
import {
  NORMALIZATION_VERSION,
  allocationEventId,
  lowerAddress,
  serializers,
  topLevelInputSelector,
  type Serializer,
} from "./normalization.js";
import {
  assertImmutableDeployment,
  deploymentConflictsWithAssignment,
  mergePendingEvent,
  parsePendingEvents,
  recognizeImplementation,
  type PendingAllocatorEvent,
} from "./gate2.js";

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

type Gate2Context = EntityContext & {
  DebtAllocatorDeployment: {
    get: (id: string) => Promise<Entity<"DebtAllocatorDeployment"> | undefined>;
    set: (entity: Entity<"DebtAllocatorDeployment">) => void;
  };
  VaultDebtAllocatorAssignment: { set: (entity: Entity<"VaultDebtAllocatorAssignment">) => void };
  VaultRoleManagerMembership: {
    get: (id: string) => Promise<Entity<"VaultRoleManagerMembership"> | undefined>;
    set: (entity: Entity<"VaultRoleManagerMembership">) => void;
  };
  DebtAllocatorAssignmentConflict: { set: (entity: Entity<"DebtAllocatorAssignmentConflict">) => void };
  DebtAllocatorPendingEventBuffer: {
    get: (id: string) => Promise<Entity<"DebtAllocatorPendingEventBuffer"> | undefined>;
    set: (entity: Entity<"DebtAllocatorPendingEventBuffer">) => void;
  };
};

const normalizedId = (event: EventEnvelope): string =>
  allocationEventId(event.chainId, event.transaction.hash, event.logIndex);

const normalizedEventWithoutVault = <T>(
  event: EventEnvelope,
  eventSerializer: Serializer<T>,
  params: T,
): Omit<Entity<"AllocationSourceEvent">, "vaultAddress"> => ({
    id: normalizedId(event),
    chainId: event.chainId,
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

const writeNormalizedEvent = <T>(
  event: EventEnvelope,
  context: EntityContext,
  vaultAddress: string,
  eventSerializer: Serializer<T>,
  params: T,
): void => {
  context.AllocationSourceEvent.set({
    ...normalizedEventWithoutVault(event, eventSerializer, params),
    vaultAddress: lowerAddress(vaultAddress),
  });
};

const membershipId = (chainId: number, roleManagerAddress: string, vaultAddress: string): string =>
  `${chainId}:${lowerAddress(roleManagerAddress)}:${lowerAddress(vaultAddress)}`;

const writeAssignment = async (
  event: EventEnvelope & { params: { vault: string; debtAllocator: string } },
  context: Gate2Context,
  assignmentType: "initial" | "updated",
): Promise<void> => {
  const sourceEventId = normalizedId(event);
  const vaultAddress = lowerAddress(event.params.vault);
  const allocatorAddress = lowerAddress(event.params.debtAllocator);
  const roleManagerAddress = lowerAddress(event.srcAddress);
  const deploymentId = `${event.chainId}:${allocatorAddress}`;
  const deployment = await context.DebtAllocatorDeployment.get(deploymentId);

  context.VaultDebtAllocatorAssignment.set({
    id: sourceEventId,
    chainId: event.chainId,
    vaultAddress,
    allocatorAddress,
    roleManagerAddress,
    assignmentType,
    implementationRecognition: recognizeImplementation(deployment),
    blockNumber: event.block.number,
    blockTimestamp: BigInt(event.block.timestamp),
    blockHash: lowerAddress(event.block.hash),
    transactionHash: lowerAddress(event.transaction.hash),
    transactionIndex: event.transaction.transactionIndex,
    logIndex: event.logIndex,
    sourceEventId,
  });

  const currentMembershipId = membershipId(event.chainId, roleManagerAddress, vaultAddress);
  const currentMembership = await context.VaultRoleManagerMembership.get(currentMembershipId);
  context.VaultRoleManagerMembership.set({
    id: currentMembershipId,
    chainId: event.chainId,
    vaultAddress,
    roleManagerAddress,
    allocatorAddress,
    active: assignmentType === "initial" ? true : currentMembership?.active ?? true,
    updatedBlock: event.block.number,
    updatedTimestamp: BigInt(event.block.timestamp),
    updatedTransactionHash: lowerAddress(event.transaction.hash),
    updatedEventId: sourceEventId,
  });

  if (deploymentConflictsWithAssignment(deployment, vaultAddress)) {
    context.DebtAllocatorAssignmentConflict.set({
      id: sourceEventId,
      chainId: event.chainId,
      vaultAddress,
      allocatorAddress,
      deploymentVaultAddress: deployment!.vaultAddress,
      roleManagerAddress,
      deploymentId,
      sourceEventId,
      reason: "factoryVaultMismatch",
    });
  }
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
  await writeAssignment(event, context, "initial");
});

indexer.onEvent({ contract: "YearnV3RoleManager", event: "RemovedVault" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.params.vault, serializers.roleManager.RemovedVault, event.params);
  const vaultAddress = lowerAddress(event.params.vault);
  const roleManagerAddress = lowerAddress(event.srcAddress);
  const currentMembershipId = membershipId(event.chainId, roleManagerAddress, vaultAddress);
  const currentMembership = await context.VaultRoleManagerMembership.get(currentMembershipId);
  context.VaultRoleManagerMembership.set({
    id: currentMembershipId,
    chainId: event.chainId,
    vaultAddress,
    roleManagerAddress,
    allocatorAddress: currentMembership?.allocatorAddress,
    active: false,
    updatedBlock: event.block.number,
    updatedTimestamp: BigInt(event.block.timestamp),
    updatedTransactionHash: lowerAddress(event.transaction.hash),
    updatedEventId: normalizedId(event),
  });
});

indexer.onEvent({ contract: "YearnV3RoleManager", event: "UpdateDebtAllocator" }, async ({ event, context }) => {
  writeNormalizedEvent(event, context, event.params.vault, serializers.roleManager.UpdateDebtAllocator, event.params);
  await writeAssignment(event, context, "updated");
});

indexer.onEvent({ contract: "DebtAllocatorFactory", event: "NewDebtAllocator" }, async ({ event, context }) => {
  const eventId = normalizedId(event);
  const allocatorAddress = lowerAddress(event.params.allocator);
  const vaultAddress = lowerAddress(event.params.vault);
  const deploymentId = `${event.chainId}:${allocatorAddress}`;
  const proposedDeployment: Entity<"DebtAllocatorDeployment"> = {
    id: deploymentId,
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
  };
  const existingDeployment = await context.DebtAllocatorDeployment.get(deploymentId);
  assertImmutableDeployment(existingDeployment, proposedDeployment);
  if (!existingDeployment) context.DebtAllocatorDeployment.set(proposedDeployment);
  writeNormalizedEvent(event, context, vaultAddress, serializers.debtAllocatorFactory.NewDebtAllocator, event.params);

  const earlierAssignments = await context.VaultDebtAllocatorAssignment.getWhere({
    chainId: { _eq: event.chainId },
    allocatorAddress: { _eq: allocatorAddress },
  });
  for (const assignment of earlierAssignments) {
    context.VaultDebtAllocatorAssignment.set({
      ...assignment,
      implementationRecognition: "knownGenericAllocator",
    });
    if (deploymentConflictsWithAssignment(proposedDeployment, assignment.vaultAddress)) {
      context.DebtAllocatorAssignmentConflict.set({
        id: assignment.sourceEventId,
        chainId: event.chainId,
        vaultAddress: assignment.vaultAddress,
        allocatorAddress,
        deploymentVaultAddress: vaultAddress,
        roleManagerAddress: assignment.roleManagerAddress,
        deploymentId,
        sourceEventId: assignment.sourceEventId,
        reason: "factoryVaultMismatch",
      });
    }
  }

  const pendingBuffer = await context.DebtAllocatorPendingEventBuffer.get(deploymentId);
  if (pendingBuffer && !pendingBuffer.resolved) {
    for (const pendingEvent of parsePendingEvents(pendingBuffer.eventsJson)) {
      context.AllocationSourceEvent.set({
        ...pendingEvent,
        chainId: event.chainId,
        vaultAddress,
        sourceType: "debtAllocator",
        blockTimestamp: BigInt(pendingEvent.blockTimestamp),
        abiVariant: pendingEvent.abiVariant,
        topLevelTransactionFrom: pendingEvent.topLevelTransactionFrom,
        topLevelTransactionTo: pendingEvent.topLevelTransactionTo,
        topLevelInputSelector: pendingEvent.topLevelInputSelector,
        strategyAddress: pendingEvent.strategyAddress,
      });
    }
    context.DebtAllocatorPendingEventBuffer.set({
      ...pendingBuffer,
      resolved: true,
      resolvedDeploymentId: deploymentId,
      lastUpdatedBlock: event.block.number,
    });
  }
});

const pendingAllocatorEvent = <T>(
  event: EventEnvelope,
  eventSerializer: Serializer<T>,
  params: T,
): PendingAllocatorEvent => {
  const normalized = normalizedEventWithoutVault(event, eventSerializer, params);
  return { ...normalized, blockTimestamp: normalized.blockTimestamp.toString() };
};

const writeAllocatorEvent = async <T>(
  event: EventEnvelope,
  context: Gate2Context,
  eventSerializer: Serializer<T>,
  params: T,
): Promise<void> => {
  const allocatorAddress = lowerAddress(event.srcAddress);
  const deploymentId = `${event.chainId}:${allocatorAddress}`;
  const deployment = await context.DebtAllocatorDeployment.get(deploymentId);
  if (deployment) {
    writeNormalizedEvent(event, context, deployment.vaultAddress, eventSerializer, params);
    return;
  }

  const pendingBuffer = await context.DebtAllocatorPendingEventBuffer.get(deploymentId);
  const eventsJson = mergePendingEvent(
    pendingBuffer?.eventsJson,
    pendingAllocatorEvent(event, eventSerializer, params),
  );
  context.DebtAllocatorPendingEventBuffer.set({
    id: deploymentId,
    chainId: event.chainId,
    allocatorAddress,
    eventsJson,
    eventCount: parsePendingEvents(eventsJson).length,
    resolved: false,
    resolvedDeploymentId: undefined,
    lastUpdatedBlock: event.block.number,
  });
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
