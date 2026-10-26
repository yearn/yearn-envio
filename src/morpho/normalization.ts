import { getAddress } from "viem";
import { eventCore } from "../eventCore.js";

/** Indexing and provenance only. Lifecycle rules and delivery live in monitoring. */
export function normalizeMorphoEvent(event: any, vaultVersion: number, eventName: string) {
  return {
    ...eventCore(event),
    vaultAddress: getAddress(event.srcAddress),
    adapterAddress: undefined,
    vaultVersion,
    eventName,
    argsJson: JSON.stringify(event.params, (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  };
}
