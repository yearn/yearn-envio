export type DeploymentFact = {
  readonly id: string;
  readonly vaultAddress: string;
};

type ImmutableDeploymentFact = DeploymentFact &
  Partial<{
    readonly allocatorAddress: string;
    readonly factoryAddress: string;
    readonly originalAllocatorAddress: string;
    readonly abiVariant: string;
    readonly createdBlock: number;
    readonly createdTimestamp: bigint;
    readonly createdTransactionHash: string;
    readonly createdEventId: string;
  }>;

export type ImplementationRecognition = "knownGenericAllocator" | "other" | "unknown";

export type PendingAllocatorEvent = {
  readonly id: string;
  readonly sourceAddress: string;
  readonly eventName: string;
  readonly signature: string;
  readonly normalizationVersion: number;
  readonly abiVariant?: string;
  readonly blockNumber: number;
  readonly blockTimestamp: string;
  readonly blockHash: string;
  readonly transactionHash: string;
  readonly transactionIndex: number;
  readonly logIndex: number;
  readonly topLevelTransactionFrom?: string;
  readonly topLevelTransactionTo?: string;
  readonly topLevelInputSelector?: string;
  readonly strategyAddress?: string;
  readonly argsJson: string;
};

export const recognizeImplementation = (
  deployment: DeploymentFact | undefined,
): ImplementationRecognition => (deployment ? "knownGenericAllocator" : "unknown");

export const deploymentConflictsWithAssignment = (
  deployment: DeploymentFact | undefined,
  assignedVaultAddress: string,
): boolean => deployment !== undefined && deployment.vaultAddress !== assignedVaultAddress;

const pendingEventOrder = (left: PendingAllocatorEvent, right: PendingAllocatorEvent): number =>
  left.blockNumber - right.blockNumber ||
  left.transactionIndex - right.transactionIndex ||
  left.logIndex - right.logIndex ||
  left.id.localeCompare(right.id);

export const parsePendingEvents = (eventsJson: string): PendingAllocatorEvent[] => {
  const parsed: unknown = JSON.parse(eventsJson);
  if (!Array.isArray(parsed)) throw new Error("Debt allocator pending event buffer must contain an array");
  return parsed as PendingAllocatorEvent[];
};

export const mergePendingEvent = (
  eventsJson: string | undefined,
  pendingEvent: PendingAllocatorEvent,
): string => {
  const events = eventsJson ? parsePendingEvents(eventsJson) : [];
  const byId = new Map(events.map((event) => [event.id, event]));
  byId.set(pendingEvent.id, pendingEvent);
  return JSON.stringify([...byId.values()].sort(pendingEventOrder));
};

export const assertImmutableDeployment = (
  existing: ImmutableDeploymentFact | undefined,
  proposed: ImmutableDeploymentFact,
): void => {
  if (!existing) return;
  const fields = [
    "id",
    "vaultAddress",
    "allocatorAddress",
    "factoryAddress",
    "originalAllocatorAddress",
    "abiVariant",
    "createdBlock",
    "createdTimestamp",
    "createdTransactionHash",
    "createdEventId",
  ] as const;
  if (fields.some((field) => !Object.is(existing[field], proposed[field]))) {
    throw new Error(`Conflicting immutable debt allocator deployment ${proposed.id}`);
  }
};
