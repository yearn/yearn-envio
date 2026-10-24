import { indexer } from "envio";
import { MORPHO_V1_EVENTS, MORPHO_V2_EVENTS } from "./events.js";
import { normalizeMorphoEvent } from "./normalization.js";

for (const event of MORPHO_V1_EVENTS) {
  indexer.onEvent({ contract: "MorphoVaultV1", event }, async ({ event: e, context }) => {
    context.MorphoGovernanceEvent.set(normalizeMorphoEvent(e, 1, event));
  });
}

for (const event of MORPHO_V2_EVENTS) {
  indexer.onEvent({ contract: "MorphoVaultV2", event }, async ({ event: e, context }) => {
    context.MorphoGovernanceEvent.set(normalizeMorphoEvent(e, 2, event));
  });
}
