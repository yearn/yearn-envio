# Initial Ethereum ABI audit

This note records the source evidence used by the allocation indexer. The complete Gate 2 runtime and fixture audit is in [`GATE2_EVIDENCE.md`](GATE2_EVIDENCE.md). The accepted Gate 3 vault-mutation audit is in [`GATE3_EVIDENCE.md`](GATE3_EVIDENCE.md).

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

Ethereum also has a verified factory at `0x03d43df6ff894c848fc6f1a0a7e8a539ef9a4c18` whose same topic decodes as:

```solidity
event NewDebtAllocator(address indexed allocator, address indexed governance);
```

The second address is governance, not a vault. Those deployments are persisted separately as `DebtAllocatorUnboundDeployment` and recognized as `other`. They are never written into the immutable vault-bound deployment entity with a fabricated vault.

## Deployed allocator event name

The configured vault-bound implementation at `0x1aaf7ad9550a8817d4cc4cdb917ff99b044960a0` emits singular `UpdateStrategyDebtRatio(address,uint256,uint256,uint256)`. The issue contract names a plural `UpdateStrategyDebtRatios` event. The indexer retains the plural decoder for the stated contract and adds the singular deployed decoder as `generic-v1-vault-bound-singular`; 826 singular Ethereum logs and zero plural logs were observed across the 12 vault-bound deployments through the audit block.

## Evidence gates

Gate 2 runtime families, exact historical logs, same-block registration receipts, handler replay, and fixed-block RPC parity are committed and passing. Gate 3 pins the official Vault V3 source blobs and all 26 supported runtime families, proves the checkpoint trigger invariant, and excludes custom implementations from accounting certification unless separately audited.
