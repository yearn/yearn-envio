import { indexer } from "envio";
import { getAddress } from "viem";
import { MORPHO_V1_EVENTS, MORPHO_V2_EVENTS } from "./events.js";
import { normalizeMorphoEvent } from "./normalization.js";

indexer.contractRegister(
  { contract: "MorphoVaultV2", event: "AddAdapter" },
  async ({ event, context }) => {
    context.chain.MorphoMarketV1AdapterV2.add(event.params.account);
  },
);

for (const event of MORPHO_V1_EVENTS) {
  indexer.onEvent({ contract: "MorphoVaultV1", event }, async ({ event: e, context }) => {
    context.MorphoGovernanceEvent.set(normalizeMorphoEvent(e, 1, event));
  });
}

for (const event of MORPHO_V2_EVENTS) {
  indexer.onEvent({ contract: "MorphoVaultV2", event }, async ({ event: e, context }) => {
    if (e.eventName === "AddAdapter") {
      const adapterAddress = getAddress(e.params.account);
      context.MorphoVaultV2Adapter.set({
        id: `${e.chainId}_${adapterAddress}`,
        chainId: e.chainId,
        adapterAddress,
        vaultAddress: getAddress(e.srcAddress),
      });
    }
    context.MorphoGovernanceEvent.set(normalizeMorphoEvent(e, 2, event));
  });
}

indexer.onEvent(
  { contract: "MorphoMarketV1AdapterV2", event: "BurnShares" },
  async ({ event, context }) => {
    const adapterAddress = getAddress(event.srcAddress);
    const adapter = await context.MorphoVaultV2Adapter.getOrThrow(
      `${event.chainId}_${adapterAddress}`,
      `Missing parent vault for adapter ${adapterAddress} on chain ${event.chainId}; ` +
        "reindex from the parent vault deployment to process AddAdapter first.",
    );
    context.MorphoGovernanceEvent.set({
      ...normalizeMorphoEvent(event, 2, "BurnShares"),
      vaultAddress: adapter.vaultAddress,
      adapterAddress,
    });
  },
);
