import { getAddress } from "viem";
import { eventCore } from "../eventCore.js";
import scope from "./curation-scope.json";

export { scope };

export type SyncState = { id: string; chainId: number; scopeHash: string; fromBlock: number; throughBlock: number };

/** A late deployment or a gap must never certify unprocessed earlier blocks. */
export function advanceSync(chainId: number, block: number, previous?: SyncState): SyncState | undefined {
  const chain = scope.chains.find(c => c.chainId === chainId);
  if (!chain) return;
  if (previous && previous.scopeHash !== scope.scopeHash) return;
  if (block !== (previous ? previous.throughBlock + scope.stride : chain.startBlock)) return;
  return { id: String(chainId), chainId, scopeHash: scope.scopeHash, fromBlock: chain.startBlock, throughBlock: block };
}

export function factoryEvent(event: any, version: number) {
  const args = event.params;
  return {
    ...eventCore(event),
    factoryAddress: getAddress(event.srcAddress),
    vaultAddress: getAddress(version === 1 ? args.metaMorpho : args.newVaultV2),
    vaultVersion: version,
    argsJson: JSON.stringify(args, (_, value) => typeof value === "bigint" ? value.toString() : value),
  };
}
