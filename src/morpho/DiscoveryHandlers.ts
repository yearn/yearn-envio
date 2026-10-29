import { indexer } from "envio";
import { getAddress } from "viem";
import { advanceSync, factoryEvent, scope } from "./curation.js";

// Register all factory-created vaults. Filtering only initial owners would miss
// vaults adopted by Yearn later. Downstream discovery owns attribution policy.
indexer.contractRegister({ contract: "MorphoVaultV1Factory", event: "CreateMetaMorpho" }, async ({ event, context }) => {
  context.chain.MorphoVaultV1.add(getAddress(event.params.metaMorpho));
});
indexer.contractRegister({ contract: "MorphoVaultV2Factory", event: "CreateVaultV2" }, async ({ event, context }) => {
  context.chain.MorphoVaultV2.add(getAddress(event.params.newVaultV2));
});

indexer.onEvent({ contract: "MorphoVaultV1Factory", event: "CreateMetaMorpho" }, async ({ event, context }) => {
  const row = factoryEvent(event, 1);
  context.CurationFactoryEvent.set(row);
  context.CurationVault.set({ id: `${event.chainId}:${row.vaultAddress.toLowerCase()}`, chainId: event.chainId,
    address: row.vaultAddress, vaultVersion: 1, createdBlock: event.block.number });
});
indexer.onEvent({ contract: "MorphoVaultV2Factory", event: "CreateVaultV2" }, async ({ event, context }) => {
  const row = factoryEvent(event, 2);
  context.CurationFactoryEvent.set(row);
  context.CurationVault.set({ id: `${event.chainId}:${row.vaultAddress.toLowerCase()}`, chainId: event.chainId,
    address: row.vaultAddress, vaultVersion: 2, createdBlock: event.block.number });
});

indexer.onBlock({ name: "curation-coverage-v1", where: ({ chain }) => {
  const entry = scope.chains.find(c => c.chainId === chain.id);
  return entry ? { block: { number: { _gte: entry.startBlock, _every: scope.stride } } } : false;
}}, async ({ block, context }) => {
  const chainId = context.chain.id;
  const previous = await context.CurationIndexingState.get(String(chainId));
  const next = advanceSync(chainId, block.number, previous);
  if (next) context.CurationIndexingState.set(next);
});
