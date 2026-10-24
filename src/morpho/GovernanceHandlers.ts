import { indexer } from "envio";
import { normalizeMorphoEvent } from "./normalization.js";

indexer.onEvent({ contract: "MorphoVaultV1", event: "RevokePendingCap" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 1, "RevokePendingCap"));
});

indexer.onEvent({ contract: "MorphoVaultV1", event: "RevokePendingGuardian" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 1, "RevokePendingGuardian"));
});

indexer.onEvent({ contract: "MorphoVaultV1", event: "RevokePendingMarketRemoval" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 1, "RevokePendingMarketRemoval"));
});

indexer.onEvent({ contract: "MorphoVaultV1", event: "RevokePendingTimelock" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 1, "RevokePendingTimelock"));
});

indexer.onEvent({ contract: "MorphoVaultV1", event: "SetCap" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 1, "SetCap"));
});

indexer.onEvent({ contract: "MorphoVaultV1", event: "SetGuardian" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 1, "SetGuardian"));
});

indexer.onEvent({ contract: "MorphoVaultV1", event: "SetTimelock" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 1, "SetTimelock"));
});

indexer.onEvent({ contract: "MorphoVaultV1", event: "SetWithdrawQueue" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 1, "SetWithdrawQueue"));
});

indexer.onEvent({ contract: "MorphoVaultV1", event: "SubmitCap" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 1, "SubmitCap"));
});

indexer.onEvent({ contract: "MorphoVaultV1", event: "SubmitGuardian" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 1, "SubmitGuardian"));
});

indexer.onEvent({ contract: "MorphoVaultV1", event: "SubmitMarketRemoval" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 1, "SubmitMarketRemoval"));
});

indexer.onEvent({ contract: "MorphoVaultV1", event: "SubmitTimelock" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 1, "SubmitTimelock"));
});

indexer.onEvent({ contract: "MorphoVaultV2", event: "Submit" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 2, "Submit"));
});

indexer.onEvent({ contract: "MorphoVaultV2", event: "Accept" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 2, "Accept"));
});

indexer.onEvent({ contract: "MorphoVaultV2", event: "Revoke" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 2, "Revoke"));
});

indexer.onEvent({ contract: "MorphoVaultV2", event: "SetOwner" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 2, "SetOwner"));
});

indexer.onEvent({ contract: "MorphoVaultV2", event: "SetCurator" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 2, "SetCurator"));
});

indexer.onEvent({ contract: "MorphoVaultV2", event: "SetIsSentinel" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 2, "SetIsSentinel"));
});

indexer.onEvent({ contract: "MorphoVaultV2", event: "SetIsAllocator" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 2, "SetIsAllocator"));
});

indexer.onEvent({ contract: "MorphoVaultV2", event: "AddAdapter" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 2, "AddAdapter"));
});

indexer.onEvent({ contract: "MorphoVaultV2", event: "RemoveAdapter" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 2, "RemoveAdapter"));
});

indexer.onEvent({ contract: "MorphoVaultV2", event: "Constructor" }, async ({ event, context }) => {
  context.MorphoGovernanceEvent.set(normalizeMorphoEvent(event, 2, "Constructor"));
});
