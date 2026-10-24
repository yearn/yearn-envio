import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";
import coverage from "../docs/morpho-coverage.json";
import { normalizeMorphoEvent } from "../src/morpho/normalization.js";

const block = { number: 100000000, timestamp: 1792800000, hash: `0x${"ab".repeat(32)}` };
const transaction = { hash: `0x${"cd".repeat(32)}`, from: "0x1111111111111111111111111111111111111111", to: "0x1111111111111111111111111111111111111111", transactionIndex: 0 };
const v1 = [
  { contract: "MorphoVaultV1", event: "RevokePendingCap", params: { caller: "0x1111111111111111111111111111111111111111", id: "0xabababababababababababababababababababababababababababababababab" }, block, transaction, logIndex: 0 },
  { contract: "MorphoVaultV1", event: "RevokePendingGuardian", params: { caller: "0x1111111111111111111111111111111111111111" }, block, transaction, logIndex: 1 },
  { contract: "MorphoVaultV1", event: "RevokePendingMarketRemoval", params: { caller: "0x1111111111111111111111111111111111111111", id: "0xabababababababababababababababababababababababababababababababab" }, block, transaction, logIndex: 2 },
  { contract: "MorphoVaultV1", event: "RevokePendingTimelock", params: { caller: "0x1111111111111111111111111111111111111111" }, block, transaction, logIndex: 3 },
  { contract: "MorphoVaultV1", event: "SetCap", params: { caller: "0x1111111111111111111111111111111111111111", id: "0xabababababababababababababababababababababababababababababababab", cap: 9999999999999999999999999999n }, block, transaction, logIndex: 4 },
  { contract: "MorphoVaultV1", event: "SetGuardian", params: { caller: "0x1111111111111111111111111111111111111111", guardian: "0x1111111111111111111111111111111111111111" }, block, transaction, logIndex: 5 },
  { contract: "MorphoVaultV1", event: "SetTimelock", params: { caller: "0x1111111111111111111111111111111111111111", newTimelock: 9999999999999999999999999999n }, block, transaction, logIndex: 6 },
  { contract: "MorphoVaultV1", event: "SetWithdrawQueue", params: { caller: "0x1111111111111111111111111111111111111111", newWithdrawQueue: ["0xabababababababababababababababababababababababababababababababab"] }, block, transaction, logIndex: 7 },
  { contract: "MorphoVaultV1", event: "SubmitCap", params: { caller: "0x1111111111111111111111111111111111111111", id: "0xabababababababababababababababababababababababababababababababab", cap: 9999999999999999999999999999n }, block, transaction, logIndex: 8 },
  { contract: "MorphoVaultV1", event: "SubmitGuardian", params: { newGuardian: "0x1111111111111111111111111111111111111111" }, block, transaction, logIndex: 9 },
  { contract: "MorphoVaultV1", event: "SubmitMarketRemoval", params: { caller: "0x1111111111111111111111111111111111111111", id: "0xabababababababababababababababababababababababababababababababab" }, block, transaction, logIndex: 10 },
  { contract: "MorphoVaultV1", event: "SubmitTimelock", params: { newTimelock: 9999999999999999999999999999n }, block, transaction, logIndex: 11 },
] as const;
const v2 = [
  { contract: "MorphoVaultV2", event: "Constructor", params: { owner: "0x1111111111111111111111111111111111111111", asset: "0x1111111111111111111111111111111111111111" }, block, transaction, logIndex: 0 },
  { contract: "MorphoVaultV2", event: "Submit", params: { selector: "0xabababab", data: "0x12345678", executableAt: 9999999999999999999999999999n }, block, transaction, logIndex: 1 },
  { contract: "MorphoVaultV2", event: "Accept", params: { selector: "0xabababab", data: "0x12345678" }, block, transaction, logIndex: 2 },
  { contract: "MorphoVaultV2", event: "Revoke", params: { sender: "0x1111111111111111111111111111111111111111", selector: "0xabababab", data: "0x12345678" }, block, transaction, logIndex: 3 },
  { contract: "MorphoVaultV2", event: "SetOwner", params: { newOwner: "0x1111111111111111111111111111111111111111" }, block, transaction, logIndex: 4 },
  { contract: "MorphoVaultV2", event: "SetCurator", params: { newCurator: "0x1111111111111111111111111111111111111111" }, block, transaction, logIndex: 5 },
  { contract: "MorphoVaultV2", event: "SetIsSentinel", params: { account: "0x1111111111111111111111111111111111111111", newIsSentinel: false }, block, transaction, logIndex: 6 },
  { contract: "MorphoVaultV2", event: "SetIsAllocator", params: { account: "0x1111111111111111111111111111111111111111", newIsAllocator: false }, block, transaction, logIndex: 7 },
  { contract: "MorphoVaultV2", event: "AddAdapter", params: { account: "0x1111111111111111111111111111111111111111" }, block, transaction, logIndex: 8 },
  { contract: "MorphoVaultV2", event: "RemoveAdapter", params: { account: "0x1111111111111111111111111111111111111111" }, block, transaction, logIndex: 9 },
] as const;

describe("Morpho governance coverage", () => {
  for (const version of [1, 2]) {
    const chains = [...new Set(coverage.filter(v => v.vaultVersion === version).map(v => v.chainId))];
    it.each(chains)(`indexes every V${version} governance signature on chain %i`, async chainId => {
      const srcAddress = coverage.find(v => v.chainId === chainId && v.vaultVersion === version)!.vaultAddress;
      const fixtures = version === 1 ? v1 : v2;
      const indexer = createTestIndexer();
      await indexer.process({chains: {[chainId]: {simulate: fixtures.map(e => ({...e, srcAddress}))}}});
      const rows = await indexer.MorphoGovernanceEvent.getAll();
      expect(rows).toHaveLength(fixtures.length);
      for (const fixture of fixtures) {
        const row = rows.find(r => r.id === `${chainId}_${block.number}_${fixture.logIndex}`)!;
        expect(row).toMatchObject({vaultAddress: srcAddress.toLowerCase(), vaultVersion: version, chainId, blockNumber: block.number, blockHash: block.hash, logIndex: fixture.logIndex, eventName: fixture.event, transactionHash: transaction.hash});
        expect(JSON.parse(row.argsJson)).toEqual(JSON.parse(JSON.stringify(fixture.params, (_, value) => typeof value === "bigint" ? value.toString() : value)));
      }
    });
  }

  it("preserves bool false and arbitrarily large integers without policy", () => {
    const input = {chainId: 1, srcAddress: "0xABC", block, transaction, logIndex: 1, params: {enabled: false, cap: 2n ** 200n}};
    const row = normalizeMorphoEvent(input, 2, "SetIsAllocator");
    expect(JSON.parse(row.argsJson)).toEqual({enabled: false, cap: (2n ** 200n).toString()});
    expect(normalizeMorphoEvent(input, 2, "SetIsAllocator")).toEqual(row);
    expect(normalizeMorphoEvent({...input, block: {...block, hash: "0xFF"}}, 2, "SetIsAllocator").blockHash).toBe("0xff");
  });
});
