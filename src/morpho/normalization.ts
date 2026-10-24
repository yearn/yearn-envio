/** Indexing and provenance only. Lifecycle rules and delivery live in monitoring. */
export interface GovernanceOccurrence {
  chainId: number;
  srcAddress: string;
  block: { number: number; timestamp: number; hash: string };
  transaction: { hash: string };
  logIndex: number;
  params: Record<string, unknown>;
}

export function normalizeMorphoEvent(event: GovernanceOccurrence, vaultVersion: number, eventName: string) {
  return {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    vaultAddress: event.srcAddress.toLowerCase(),
    vaultVersion,
    eventName,
    chainId: event.chainId,
    blockNumber: event.block.number,
    blockHash: event.block.hash.toLowerCase(),
    blockTimestamp: event.block.timestamp,
    logIndex: event.logIndex,
    transactionHash: event.transaction.hash.toLowerCase(),
    argsJson: JSON.stringify(event.params, (_, value) => typeof value === "bigint" ? value.toString() : value),
  };
}
