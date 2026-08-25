# Initial Ethereum ABI audit

This note records the source evidence used by the first allocation-indexer slice. It is not the complete Gate 2 same-block audit or the Gate 3 vault-mutation audit.

## RoleManager

Source: `yearn/vault-periphery` commit `358d074ce333f149b5046b4e949c196881523d22`, `src/managers/RoleManager.sol`.

The configured RoleManager release declares:

```solidity
event AddedNewVault(address indexed vault, address indexed debtAllocator, uint256 category);
event RemovedVault(address indexed vault);
event UpdateDebtAllocator(address indexed vault, address indexed debtAllocator);
```

The two `UpdateDebtAllocator` parameters are both indexed. The allocation config preserves that layout and labels normalized rows `yearn-v3-role-manager-v1`.

## Generic debt allocator factory

Source: the same pinned `yearn/vault-periphery` commit, `src/debtAllocators/Generic/GenericDebtAllocatorFactory.sol`.

The configured Generic factory declares:

```solidity
event NewDebtAllocator(address indexed allocator, address indexed vault);
```

This event does not emit `originalAllocator`. The normalized row and immutable deployment binding therefore leave `originalAllocatorAddress` absent and identify the variant as `generic-v1-no-original-allocator`; the value is not inferred.

## Remaining evidence gates

Before Gate 2 can pass, the deployed Ethereum RoleManagers and factory address must be tied to runtime bytecode/code-hash families. Allocator logs that precede same-block factory registration are now handled through a deterministic persisted buffer and reconciled when the deployment event arrives; committed historical fixtures are still required to validate that path against Ethereum data. Before Gate 3 can pass, every supported Vault V3 release/code hash needs a mutation-path audit proving the checkpoint trigger invariant.
