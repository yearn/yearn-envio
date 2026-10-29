import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";
import { advanceSync, scope } from "../src/morpho/curation.js";

const factory = "0x4501125508079a99ebbebce205dec9593c2b5857" as const;
const vault = "0x1111111111111111111111111111111111111111" as const;
const owner = "0x518C21DC88D9780c0A1Be566433c571461A70149" as const;
const adapter = "0x2222222222222222222222222222222222222222" as const;
const block = { number: 50000000, timestamp: 1792800000, hash: `0x${"ab".repeat(32)}` as const };
const transaction = { hash: `0x${"cd".repeat(32)}` as const, from: owner, to: factory, transactionIndex: 2 };

describe("curation discovery", () => {
  it("indexes creation and dynamically registers a previously unlisted vault's same-block adapter", async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { 8453: { endBlock: block.number, simulate: [
      { contract: "MorphoVaultV2Factory", event: "CreateVaultV2", srcAddress: factory, block, transaction,
        logIndex: 1, params: { owner, asset: adapter, salt: `0x${"00".repeat(32)}`, newVaultV2: vault } },
      { contract: "MorphoVaultV2", event: "AddAdapter", srcAddress: vault, block, transaction,
        logIndex: 2, params: { account: adapter } },
    ] } } });
    expect(await indexer.CurationFactoryEvent.getAll()).toMatchObject([
      { vaultAddress: vault, vaultVersion: 2, blockNumber: block.number, factoryAddress: expect.any(String) },
    ]);
    expect(await indexer.CurationVault.getAll()).toMatchObject([
      { id: `8453:${vault}`, address: vault, createdBlock: block.number },
    ]);
    expect(await indexer.MorphoGovernanceEvent.getAll()).toMatchObject([
      { vaultAddress: vault, eventName: "AddAdapter", argsJson: JSON.stringify({ account: adapter }) },
    ]);
    expect(await indexer.CurationIndexingState.getAll()).toMatchObject([
      { chainId: 8453, scopeHash: scope.scopeHash },
    ]);
  });

  it("preserves V1 factory ABI values and indexes a newly registered vault's curator change", async () => {
    const indexer = createTestIndexer();
    const creationBlock = { ...block, number: 26244425 };
    await indexer.process({ chains: { 1: { simulate: [
      { contract: "MorphoVaultV1Factory", event: "CreateMetaMorpho", srcAddress: "0xa9c3d3a366466fa809d1ae982fb2c46e5fc41101",
        block: creationBlock, transaction, logIndex: 1,
        params: { metaMorpho: vault, caller: owner, initialOwner: owner, initialTimelock: 2n ** 100n,
          asset: adapter, name: "Yearn candidate", symbol: "yc", salt: `0x${"00".repeat(32)}` } },
      { contract: "MorphoVaultV1", event: "SetCurator", srcAddress: vault,
        block: creationBlock, transaction, logIndex: 2, params: { newCurator: owner } },
    ] } } });
    const rows = await indexer.CurationFactoryEvent.getAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ vaultVersion: 1, vaultAddress: vault });
    expect(JSON.parse(rows[0]!.argsJson).initialTimelock).toBe((2n ** 100n).toString());
    expect(await indexer.MorphoGovernanceEvent.getAll()).toMatchObject([{ vaultAddress: vault, eventName: "SetCurator" }]);
  });

  it("attests only contiguous block checkpoints for the exact contract/event scope", () => {
    const chain = scope.chains.find(c => c.chainId === 8453)!;
    expect(advanceSync(8453, chain.startBlock + scope.stride)).toBeUndefined();
    const first = advanceSync(8453, chain.startBlock)!;
    expect(first).toMatchObject({ fromBlock: chain.startBlock, throughBlock: chain.startBlock });
    const next = advanceSync(8453, chain.startBlock + scope.stride, first)!;
    expect(next.throughBlock).toBe(chain.startBlock + scope.stride);
    expect(advanceSync(8453, next.throughBlock + 2 * scope.stride, next)).toBeUndefined();
    expect(advanceSync(8453, next.throughBlock + scope.stride, { ...next, scopeHash: "old" })).toBeUndefined();
    const { scopeHash, ...payload } = scope;
    expect(createHash("sha256").update(JSON.stringify(payload)).digest("hex")).toBe(scopeHash);
  });

  it("declares every attested contract with a sufficiently early configured start", () => {
    const config = readFileSync(new URL("../config.yaml", import.meta.url), "utf8");
    for (const entry of scope.contracts) {
      const section = config.split(new RegExp(`^  - id: ${entry.chainId}[^\\n]*\\n`, "m"))[1]!.split(/^  - id: /m)[0]!;
      const name = `MorphoVaultV${entry.family.includes("v1") ? 1 : 2}${entry.family.endsWith("factory") ? "Factory" : ""}`;
      const contract = section.split(`      - name: ${name}\n`)[1]!.split("      - name: ")[0]!;
      expect(contract.toLowerCase()).toContain(entry.address);
      expect(Number(contract.match(/start_block: (\d+)/)![1])).toBeLessThanOrEqual(entry.startBlock);
      expect(Number(section.match(/start_block: (\d+)/)![1])).toBeLessThanOrEqual(entry.startBlock);
    }
  });
});
