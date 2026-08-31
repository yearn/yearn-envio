import { indexer, type EffectCaller, type Entity } from "envio";
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
  assertImmutableUnboundDeployment,
  deploymentConflictsWithAssignment,
  mergePendingEvent,
  parsePendingEvents,
  recognizeImplementation,
  type PendingAllocatorEvent,
} from "./gate2.js";
import {
  accountingIdentityHolds,
  archiveRpcFailureReason,
  checkpointId,
  checkpointSourceEventIds,
  mergeCheckpointTriggers,
  parseCheckpointTriggers,
} from "./checkpoints.js";
import { vaultAccountingAtBlock } from "./Effects.js";

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

type CheckpointContext = {
  effect: EffectCaller;
  VaultAccountingCheckpoint: {
    set: (entity: Entity<"VaultAccountingCheckpoint">) => void;
  };
  VaultAccountingCheckpointTriggerSet: {
    get: (id: string) => Promise<Entity<"VaultAccountingCheckpointTriggerSet"> | undefined>;
    set: (entity: Entity<"VaultAccountingCheckpointTriggerSet">) => void;
  };
  VaultAccountingCheckpointFailure: {
    get: (id: string) => Promise<Entity<"VaultAccountingCheckpointFailure"> | undefined>;
    set: (entity: Entity<"VaultAccountingCheckpointFailure">) => void;
  };
  VaultAccountingSupport: {
    get: (id: string) => Promise<Entity<"VaultAccountingSupport"> | undefined>;
  };
};

const ALLOCATION_CHAIN_ID = 1;

type Gate2Context = EntityContext & {
  DebtAllocatorDeployment: {
    get: (id: string) => Promise<Entity<"DebtAllocatorDeployment"> | undefined>;
    set: (entity: Entity<"DebtAllocatorDeployment">) => void;
  };
  DebtAllocatorUnboundDeployment: {
    get: (id: string) => Promise<Entity<"DebtAllocatorUnboundDeployment"> | undefined>;
    set: (entity: Entity<"DebtAllocatorUnboundDeployment">) => void;
  };
  VaultDebtAllocatorAssignment: {
    getWhere: (filter: {
      chainId: { _eq: number };
      allocatorAddress: { _eq: string };
    }) => Promise<Entity<"VaultDebtAllocatorAssignment">[]>;
    set: (entity: Entity<"VaultDebtAllocatorAssignment">) => void;
  };
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

export const writeAccountingCheckpoint = async (
  event: EventEnvelope,
  context: CheckpointContext,
): Promise<void> => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  const vaultAddress = lowerAddress(event.srcAddress);
  const support = await context.VaultAccountingSupport.get(`${event.chainId}:${vaultAddress}`);
  if (!support) return;
  const id = checkpointId(event.chainId, vaultAddress, event.block.number);
  const existing = await context.VaultAccountingCheckpointTriggerSet.get(id);
  const triggers = mergeCheckpointTriggers(parseCheckpointTriggers(existing?.triggersJson), {
    id: normalizedId(event),
    transactionIndex: event.transaction.transactionIndex,
    logIndex: event.logIndex,
  });
  context.VaultAccountingCheckpointTriggerSet.set({ id, triggersJson: JSON.stringify(triggers) });
  const sourceEventIds = checkpointSourceEventIds(triggers);
  let totals;
  try {
    totals = await context.effect(vaultAccountingAtBlock, {
      vaultAddress,
      blockNumber: event.block.number,
      expectedBlockHash: lowerAddress(event.block.hash),
    });
  } catch (error) {
    context.VaultAccountingCheckpointFailure.set({
      id,
      chainId: event.chainId,
      vaultAddress,
      blockNumber: event.block.number,
      blockTimestamp: BigInt(event.block.timestamp),
      expectedBlockHash: lowerAddress(event.block.hash),
      reason: archiveRpcFailureReason(error),
      message: error instanceof Error ? error.message : String(error),
      sourceEventIds,
      resolved: false,
      resolvedCheckpointId: undefined,
    });
    return;
  }

  context.VaultAccountingCheckpoint.set({
    id,
    chainId: event.chainId,
    vaultAddress,
    blockNumber: event.block.number,
    blockTimestamp: BigInt(event.block.timestamp),
    blockHash: lowerAddress(event.block.hash),
    totalAssets: totals.totalAssets,
    totalDebt: totals.totalDebt,
    totalIdle: totals.totalIdle,
    accountingIdentityHolds: accountingIdentityHolds(totals),
    canonicalBlockVerified: totals.canonicalBlockVerified,
    source: "archive-rpc-effect",
    sourceEventIds,
  });

  const previousFailure = await context.VaultAccountingCheckpointFailure.get(id);
  if (previousFailure && !previousFailure.resolved) {
    context.VaultAccountingCheckpointFailure.set({
      ...previousFailure,
      sourceEventIds,
      resolved: true,
      resolvedCheckpointId: id,
    });
  }
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
  const unboundDeployment = await context.DebtAllocatorUnboundDeployment.get(deploymentId);

  context.VaultDebtAllocatorAssignment.set({
    id: sourceEventId,
    chainId: event.chainId,
    vaultAddress,
    allocatorAddress,
    roleManagerAddress,
    assignmentType,
    implementationRecognition: recognizeImplementation(deployment, unboundDeployment),
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

const vaultFactoryVersions: Record<string, string> = {
  "0xe9e8c89c8fc7e8b8f23425688eb68987231178e5": "3.0.1",
  "0x444045c5c13c246e117ed36437303cac8e250ab0": "3.0.2",
  "0x5577edcb8a856582297cdbbb07055e6a6e38eb5f": "3.0.3",
  "0x770d0d1fb036483ed4abb6d53c1c88fb277d812f": "3.0.4",
};

indexer.onEvent({ contract: "YearnV3VaultFactory", event: "NewVault" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  const factoryAddress = lowerAddress(event.srcAddress);
  const vaultAddress = lowerAddress(event.params.vault_address);
  const apiVersion = vaultFactoryVersions[factoryAddress];
  if (!apiVersion) throw new Error(`Unrecognized configured vault factory ${factoryAddress}`);
  context.VaultAccountingSupport.set({
    id: `${event.chainId}:${vaultAddress}`,
    chainId: event.chainId,
    vaultAddress,
    factoryAddress,
    apiVersion,
    sourceEventId: normalizedId(event),
  });
});

indexer.onEvent({ contract: "DebtAllocatorFactoryNoVault", event: "NewDebtAllocator" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  const eventId = normalizedId(event);
  const allocatorAddress = lowerAddress(event.params.allocator);
  const deploymentId = `${event.chainId}:${allocatorAddress}`;
  const proposedDeployment: Entity<"DebtAllocatorUnboundDeployment"> = {
    id: deploymentId,
    chainId: event.chainId,
    allocatorAddress,
    factoryAddress: lowerAddress(event.srcAddress),
    governanceAddress: lowerAddress(event.params.governance),
    implementationRecognition: "other",
    abiVariant: serializers.debtAllocatorFactory.NewDebtAllocatorWithoutVault.abiVariant!,
    createdBlock: event.block.number,
    createdTimestamp: BigInt(event.block.timestamp),
    createdTransactionHash: lowerAddress(event.transaction.hash),
    createdEventId: eventId,
  };
  const existingDeployment = await context.DebtAllocatorUnboundDeployment.get(deploymentId);
  assertImmutableUnboundDeployment(existingDeployment, proposedDeployment);
  if (!existingDeployment) context.DebtAllocatorUnboundDeployment.set(proposedDeployment);

  const earlierAssignments = await context.VaultDebtAllocatorAssignment.getWhere({
    chainId: { _eq: event.chainId },
    allocatorAddress: { _eq: allocatorAddress },
  });
  for (const assignment of earlierAssignments) {
    context.VaultDebtAllocatorAssignment.set({
      ...assignment,
      implementationRecognition: "other",
    });
  }
});

indexer.onEvent({ contract: "YearnV3Vault", event: "Deposit" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.Deposit, event.params);
  await writeAccountingCheckpoint(event, context);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "Withdraw" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.Withdraw, event.params);
  await writeAccountingCheckpoint(event, context);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "DebtUpdated" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.DebtUpdated, {
    strategy: event.params.strategy,
    currentDebt: event.params.current_debt,
    newDebt: event.params.new_debt,
  });
  await writeAccountingCheckpoint(event, context);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "StrategyReported" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.StrategyReported, {
    strategy: event.params.strategy,
    gain: event.params.gain,
    loss: event.params.loss,
    currentDebt: event.params.current_debt,
    protocolFees: event.params.protocol_fees,
    totalFees: event.params.total_fees,
    totalRefunds: event.params.total_refunds,
  });
  await writeAccountingCheckpoint(event, context);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "StrategyChanged" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.StrategyChanged, {
    strategy: event.params.strategy,
    changeType: event.params.change_type,
  });
});

indexer.onEvent({ contract: "YearnV3Vault", event: "UpdatedMaxDebtForStrategy" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.UpdatedMaxDebtForStrategy, {
    sender: event.params.sender,
    strategy: event.params.strategy,
    newDebt: event.params.new_debt,
  });
});

indexer.onEvent({ contract: "YearnV3Vault", event: "DebtPurchased" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.DebtPurchased, event.params);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "UpdateDefaultQueue" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.UpdateDefaultQueue, {
    newDefaultQueue: event.params.new_default_queue,
  });
});

indexer.onEvent({ contract: "YearnV3Vault", event: "UpdateUseDefaultQueue" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.UpdateUseDefaultQueue, {
    useDefaultQueue: event.params.use_default_queue,
  });
});

indexer.onEvent({ contract: "YearnV3Vault", event: "UpdateMinimumTotalIdle" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.UpdateMinimumTotalIdle, {
    minimumTotalIdle: event.params.minimum_total_idle,
  });
});

indexer.onEvent({ contract: "YearnV3Vault", event: "UpdateAutoAllocate" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.UpdateAutoAllocate, {
    autoAllocate: event.params.auto_allocate,
  });
});

indexer.onEvent({ contract: "YearnV3Vault", event: "Shutdown" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.Shutdown, undefined);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "RoleSet" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.RoleSet, event.params);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "RoleStatusChanged" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.RoleStatusChanged, event.params);
});

indexer.onEvent({ contract: "YearnV3Vault", event: "UpdateRoleManager" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.UpdateRoleManager, {
    roleManager: event.params.role_manager,
  });
});

indexer.onEvent({ contract: "YearnV3Vault", event: "UpdateAccountant" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  writeNormalizedEvent(event, context, event.srcAddress, serializers.vault.UpdateAccountant, event.params);
});

indexer.onEvent({ contract: "YearnV3RoleManager", event: "AddedNewVault" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  writeNormalizedEvent(event, context, event.params.vault, serializers.roleManager.AddedNewVault, event.params);
  await writeAssignment(event, context, "initial");
});

indexer.onEvent({ contract: "YearnV3RoleManager", event: "RemovedVault" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
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
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  writeNormalizedEvent(event, context, event.params.vault, serializers.roleManager.UpdateDebtAllocator, event.params);
  await writeAssignment(event, context, "updated");
});

indexer.onEvent({ contract: "DebtAllocatorFactory", event: "NewDebtAllocator" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
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
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  await writeAllocatorEvent(event, context, serializers.debtAllocator.UpdateStrategyDebtRatios, event.params);
});

indexer.onEvent({ contract: "DebtAllocator", event: "UpdateStrategyDebtRatio" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  await writeAllocatorEvent(event, context, serializers.debtAllocator.UpdateStrategyDebtRatio, event.params);
});

indexer.onEvent({ contract: "DebtAllocator", event: "UpdateKeeper" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  await writeAllocatorEvent(event, context, serializers.debtAllocator.UpdateKeeper, event.params);
});

indexer.onEvent({ contract: "DebtAllocator", event: "GovernanceTransferred" }, async ({ event, context }) => {
  if (event.chainId !== ALLOCATION_CHAIN_ID) return;
  await writeAllocatorEvent(event, context, serializers.debtAllocator.GovernanceTransferred, event.params);
});
