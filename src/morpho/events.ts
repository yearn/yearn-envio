// Must match the MorphoVaultV1 / MorphoVaultV2 event lists in config.yaml.
export const MORPHO_V1_EVENTS = ["SubmitMarketRemoval", "SubmitCap", "SubmitTimelock", "SetCurator", "OwnershipTransferred"] as const;
export const MORPHO_V2_EVENTS = ["Submit", "Accept", "SetOwner", "SetCurator", "AddAdapter", "RemoveAdapter"] as const;
