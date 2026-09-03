# Shared debt allocator ABI audit

This audit identifies the exact Ethereum shared allocator event added to Envio. The evidence is
also machine-readable in
[`fixtures/allocation/ethereum/shared-debt-allocator.json`](../../fixtures/allocation/ethereum/shared-debt-allocator.json).

## Verified contract source

The official Yearn `vault-periphery` source at commit
[`358d074ce333f149b5046b4e949c196881523d22`](https://github.com/yearn/vault-periphery/tree/358d074ce333f149b5046b4e949c196881523d22)
defines two different allocators:

- [`GenericDebtAllocator.sol`](https://github.com/yearn/vault-periphery/blob/358d074ce333f149b5046b4e949c196881523d22/src/debtAllocators/Generic/GenericDebtAllocator.sol)
  is vault-bound and emits `UpdateStrategyDebtRatio(strategy,target,max,total)`.
- [`DebtAllocator.sol`](https://github.com/yearn/vault-periphery/blob/358d074ce333f149b5046b4e949c196881523d22/src/debtAllocators/DebtAllocator.sol)
  can serve several vaults and emits:

```solidity
event UpdateStrategyDebtRatio(
    address indexed vault,
    address indexed strategy,
    uint256 newTargetRatio,
    uint256 newMaxRatio,
    uint256 newTotalDebtRatio
);
```

The exact deployed implementation at
[`0xa47eb754d44339b5dedcf4d804428708857e7899`](https://eth.blockscout.com/address/0xa47eb754d44339b5dedcf4d804428708857e7899?tab=contract)
is source-verified and exposes the same ABI. Its runtime is 8,194 bytes with keccak256
`0x633feca48437476cbe24af9ab15fdfcc340d52c48889c21d0ddf2b4f000c13a7`.

The shared factory is
[`0x03d43df6ff894c848fc6f1a0a7e8a539ef9a4c18`](https://eth.blockscout.com/address/0x03d43df6ff894c848fc6f1a0a7e8a539ef9a4c18).
Its 502-byte runtime has keccak256
`0x9ff9ccb36ff3fe0e00aabc87fddb2e07689673abd587fbf24922d24a9a5cc71e`,
and `original()` returns the implementation above. Its deployment event is:

```solidity
event NewDebtAllocator(address indexed allocator, address indexed governance);
```

The `governance` field is deliberately stored as governance. It is never interpreted as a vault.

## Event selector and real logs

The canonical event signature is:

```text
UpdateStrategyDebtRatio(address,address,uint256,uint256,uint256)
```

Its topic is:

```text
0x2a89fa60115b9af6e21a6c6aa32d141e9cfbf77472d27fbf2e7a5a8c2efaf995
```

Representative decoded Ethereum logs are pinned for all three current consumers:

| Vault | Transaction | Block | Log | Strategy | Target / max / total |
| --- | --- | ---: | ---: | --- | --- |
| yvUSDC-1 | [`0x3aa99e…30b2d`](https://eth.blockscout.com/tx/0x3aa99e65b765359bb210eddaf0e9262ac3829e0a730c6f173d5073021d230b2d) | 20,987,762 | 411 | `0xf766c7…c70c1` | 2870 / 3444 / 2870 |
| yvUSDT-1 | [`0x3aa99e…30b2d`](https://eth.blockscout.com/tx/0x3aa99e65b765359bb210eddaf0e9262ac3829e0a730c6f173d5073021d230b2d) | 20,987,762 | 485 | `0xe5baf8…d66df` | 7599 / 9118 / 7599 |
| yvUSD | [`0x7b7ea8…23450`](https://eth.blockscout.com/tx/0x7b7ea85e2673a420dcad88b1eed991c49e1867cbceaa67ba0c88820ec9423450) | 24,327,154 | 522 | `0xbc65ad…545fe` | 500 / 700 / 500 |

The first transaction's top-level envelope is sender
`0x1b5f15dcb82d25f91c65b53cee151e8b9fbdd271`, target
`0x16388463d60ffe0661cf7f1f31a7d658ac790ff7`, and selector `0x6a761202`.
These are transaction fields, not inferred from internal calls.

## Association rule

For the shared variant, the indexed `vault` parameter is canonical association evidence. The
handler does not consult the factory's governance argument, does not assign the event to every
Role Manager membership, and does not infer from strategy reuse.

For vault-bound variants, the immutable factory `vault` remains the association evidence. If a
vault-bound allocator event arrives before its deployment record, it is stored as unresolved and
only normalized after the vault-bound factory event is indexed. Shared unscoped events remain
unresolved because no later assignment can make their original log vault-specific.
