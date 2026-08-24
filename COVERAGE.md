# Kong Event Coverage

This file is the contract for Kong's typed-table replacement for `evmlog`.
All event entities in `schema.graphql` include `transactionIndex: Int!`, and
handlers populate it from `event.transaction.transactionIndex`.

## Chain Coverage

Configured chains include Kong's current Yearn chains:

| Chain | Status |
| --- | --- |
| 1 Ethereum | Configured |
| 10 Optimism | Configured |
| 100 Gnosis | Configured |
| 137 Polygon | Configured |
| 146 Sonic | Configured |
| 8453 Base | Configured |
| 42161 Arbitrum | Configured |
| 80094 Berachain | Configured |
| 747474 Katana | Configured |

## Hook Coverage

| Kong abiPath | Event | Envio contract | Envio entity/table | Status |
| --- | --- | --- | --- | --- |
| `yearn/event/transfer` | `Transfer(address,address,uint256)` | `YearnV3Vault` / `YearnV2Vault` / `YearnGauge` | `Transfer` | Covered |
| `yearn/governance/votingEscrow` | `VestingEscrowCreated(address,address,address,address,uint256,uint256,uint256,uint256,bool)` | `VotingEscrowFactory` | `VotingEscrowCreated` | Covered |
| `yearn/2/registry` | `NewVault(address,uint256,address,string)` | `YearnV2Registry` | `V2RegistryNewVault` | Covered |
| `yearn/2/registry` | `NewExperimentalVault(address,address,address,string)` | `YearnV2Registry` | `V2RegistryNewExperimentalVault` | Covered |
| `yearn/2/registry2` | `NewVault(address,uint256,uint256,address,string)` | `YearnV2Registry2` | `V2Registry2NewVault` | Covered |
| `yearn/2/strategy` | `Harvested(uint256,uint256,uint256,uint256)` | `YearnV2Strategy` | `V2StrategyHarvested` | Covered |
| `yearn/2/vault/StrategyAdded` | `StrategyAdded(address,uint256,uint256,uint256,uint256)` | `YearnV2Vault` | `V2StrategyAdded` | Covered |
| `yearn/2/vault/StrategyAdded` | `StrategyMigrated(address,address)` | `YearnV2Vault` | `V2StrategyMigrated` | Covered |
| `yearn/2/vault/StrategyRevoked` | `StrategyRevoked(address)` | `YearnV2Vault` | `V2StrategyRevoked` | Covered |
| `yearn/2/vault/StrategyReported` | `StrategyReported(address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)` | `YearnV2Vault` | `V2StrategyReported` | Covered |
| `yearn/2/vault/StrategyReported` | `StrategyReported(address,uint256,uint256,uint256,uint256,uint256,uint256,uint256)` | `YearnV2Vault` | `V2StrategyReported` (`StrategyReportedLegacy`) | Covered |
| `yearn/3/registry` | `NewEndorsedVault(address,address,uint256,uint256)` | `YearnV3Registry` | `V3RegistryNewEndorsedVault` | Covered |
| `yearn/3/registry2` | `NewEndorsedVault(address,address,uint256,uint256)` | `YearnV3Registry` | `V3RegistryNewEndorsedVault` | Covered |
| `yearn/3/registry3` | `NewEndorsedVault(address,address,uint256,uint256)` | `YearnV3Registry` | `V3RegistryNewEndorsedVault` | Covered |
| `yearn/3/strategy` | `Reported(uint256,uint256,uint256,uint256)` | `YearnV3Strategy` | `V3StrategyReported` | Covered |
| `yearn/3/vaultFactory` | `NewVault(address,address)` | `YearnV3VaultFactory` | `V3VaultFactoryNewVault` | Covered |
| `yearn/3/roleManager` | `AddedNewVault(address,address,uint256)` | `YearnV3RoleManager` | `V3RoleManagerAddedNewVault` | Covered |
| `yearn/3/roleManagerFactory` | `NewProject(bytes32,address)` | `YearnV3RoleManagerFactory` | `V3RoleManagerFactoryNewProject` | Covered |
| `yearn/3/debtManagerFactory` | `NewDebtAllocator(address,address)` | `DebtAllocatorFactory` | `NewDebtAllocator` | Covered |
| `yearn/3/vault/StrategyChanged` | `StrategyChanged(address,uint256)` | `YearnV3Vault` | `StrategyChanged` | Covered |
| `yearn/3/vault/StrategyReported` | `StrategyReported(address,uint256,uint256,uint256,uint256,uint256,uint256)` | `YearnV3Vault` | `StrategyReported` | Covered |
| `yearn/staking/registry/juiced` | `StakingPoolAdded(address,address)` | `YearnStakingRegistry` | `StakingPoolAdded` | Covered |
| `yearn/staking/registry/v3` | `StakingPoolAdded(address,address)` | `YearnStakingRegistry` | `StakingPoolAdded` | Covered |
| `yearn/staking/registry/opboost` | `StakingPoolAdded(address,address)` | `YearnStakingRegistryIndexed` | `StakingPoolAdded` | Covered |
| `yearn/staking/registry/veyfi` | `Register(address,uint256)` | `YearnVeyfiRegistry` | `VeyfiGaugeRegistered` | Covered |

`StrategyChanged(address indexed strategy, uint256 indexed change_type)` and
Kong's `StrategyChanged(address indexed strategy, uint256 change_type)` both
resolve to selector
`0xde8ff765a5c5dad48d27bc9faa99836fb81f3b07c9dc62cfe005475d6b83a2ca`.
Indexing affects topic placement, not topic0.

## ABI Event Audit

These ABI event surfaces are fully indexed by typed Envio entities:

| Kong abiPath | Envio coverage |
| --- | --- |
| `erc4626` | `Deposit`, `Withdraw` |
| `yearn/2/vault` | Full ABI event surface, including `Approval`, queue, fee, sweep, strategy update, and governance events |
| `yearn/3/vault` | Full ABI event surface, including `Approval` |
| `yearn/governance/votingEscrow` | Full ABI event surface |
| `yearn/3/debtAllocator` | Full ABI event surface |
| `yearn/staking/registry/juiced` | Full ABI event surface |
| `yearn/staking/registry/v3` | Full ABI event surface |
| `yearn/staking/registry/opboost` | Full ABI event surface |
| `yearn/staking/registry/veyfi` | Full ABI event surface |
| `yearn/2/tradeHandler` | Full ABI event surface |

These ABI events are still RPC-only from Kong's perspective. They are not
currently emitted to typed Envio tables and must be called out before Kong runs
an evmlog-equivalence backfill that requires every ABI-declared log:

| Kong abiPath | RPC-only events |
| --- | --- |
| `yearn/2/strategy` | `Cloned`, `EmergencyExitEnabled`, `ForcedHarvestTrigger`, `SetDoHealthCheck`, `SetHealthCheck`, `UpdatedBaseFeeOracle`, `UpdatedCreditThreshold`, `UpdatedKeeper`, `UpdatedMaxReportDelay`, `UpdatedMetadataURI`, `UpdatedMinReportDelay`, `UpdatedRewards`, `UpdatedStrategist` |
| `yearn/3/strategy` | `NewTokenizedStrategy`, `StrategyShutdown`, `UpdateKeeper`, `UpdatePendingManagement`, `UpdatePerformanceFee`, `UpdatePerformanceFeeRecipient` |
| `yearn/2/registry` | `NewRelease`, `NewGovernance`, `VaultTagged` |
| `yearn/2/registry2` | `ApprovedVaultEndorser`, `ApprovedVaultOwnerUpdated`, `OwnershipTransferred`, `ReleaseRegistryUpdated` |
| `yearn/3/registry` | `RemovedVault` |
| `yearn/3/registry2` | `NewRelease`, `UpdatePendingGovernance` |
| `yearn/3/registry3` | `RemovedVault`, `UpdateEndorser`, `UpdateTagger`, `VaultTagged` |
| `yearn/3/vaultFactory` | `UpdateProtocolFeeBps`, `UpdateProtocolFeeRecipient`, `UpdateCustomProtocolFee`, `RemovedCustomProtocolFee`, `FactoryShutdown` |
| `yearn/3/roleManager` | `UpdateDebtAllocator`, `UpdateDefaultProfitMaxUnlock`, `UpdatePendingGovernance`, `UpdatePositionHolder`, `UpdatePositionRoles` |
| `yearn/3/roleManagerFactory` | `NewRoleManager` |
| `yearn/3/accountant` | `DistributeRewards`, `NewFeeManager`, `RemovedCustomFeeConfig`, `SetFutureFeeManager`, `UpdateCustomFeeConfig`, `UpdateDefaultFeeConfig`, `UpdateFeeRecipient`, `UpdateMaxLoss`, `UpdateRefund`, `UpdateVaultManager` |

The RPC-only list was produced by comparing the Kong ABI files under
`packages/ingest/abis/**/abi.ts` to `apps/indexer/config.yaml` by event
selector.

RPC-only gaps were called out on Kong issue #402:
https://github.com/yearn/kong/issues/402#issuecomment-4416633584
