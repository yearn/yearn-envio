import { getAddress } from "viem";

export const addr = (a: string | undefined): string | undefined =>
  a ? getAddress(a) : undefined;

export const eventId = (event: {
  chainId: number;
  block: { number: number };
  logIndex: number;
}): string => `${event.chainId}_${event.block.number}_${event.logIndex}`;

export const eventCore = (event: any) => ({
  id: eventId(event),
  chainId: event.chainId,
  blockNumber: event.block.number,
  blockTimestamp: event.block.timestamp,
  blockHash: event.block.hash,
  transactionHash: event.transaction.hash,
  transactionIndex: event.transaction.transactionIndex,
  transactionFrom: addr(event.transaction.from),
  logIndex: event.logIndex,
});
