import { readFileSync } from "node:fs";
import { createTestIndexer } from "envio";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import manifest from "../docs/morpho-coverage.json";
import { MORPHO_V1_EVENTS, MORPHO_V2_EVENTS } from "../src/morpho/events.js";
import { normalizeMorphoEvent } from "../src/morpho/normalization.js";

const caller = "0x1111111111111111111111111111111111111111";
const marketId = `0x${"ab".repeat(32)}`;
const block = { number: 100000000, timestamp: 1792800000, hash: `0x${"ab".repeat(32)}` };
const transaction = {
  hash: `0x${"cd".repeat(32)}`, from: caller, to: caller, transactionIndex: 3,
} as const;
const v1 = [
  { contract: "MorphoVaultV1", event: "SubmitCap", params: { caller, id: marketId, cap: 9999999999999999999999999999n } },
  { contract: "MorphoVaultV1", event: "SubmitMarketRemoval", params: { caller, id: marketId } },
  { contract: "MorphoVaultV1", event: "SubmitTimelock", params: { newTimelock: 9999999999999999999999999999n } },
] as const;
const v2 = [
  { contract: "MorphoVaultV2", event: "Submit", params: { selector: "0xabababab", data: "0x12345678", executableAt: 9999999999999999999999999999n } },
  { contract: "MorphoVaultV2", event: "Accept", params: { selector: "0xabababab", data: "0x12345678" } },
  { contract: "MorphoVaultV2", event: "SetOwner", params: { newOwner: caller } },
  { contract: "MorphoVaultV2", event: "SetCurator", params: { newCurator: caller } },
  { contract: "MorphoVaultV2", event: "AddAdapter", params: { account: caller } },
  { contract: "MorphoVaultV2", event: "RemoveAdapter", params: { account: caller } },
] as const;

// Vaults marked `excluded` in the manifest are intentionally commented out of config.yaml.
const coverage = manifest.filter(v => !("excluded" in v));

type ConfiguredContract = { chainId: number; vaultVersion: number; startBlock?: number; addresses: string[] };

// Reads the per-chain MorphoVaultV1/V2 entries (start_block + address list) from config.yaml.
function morphoContractsFromConfig(): ConfiguredContract[] {
  const contracts: ConfiguredContract[] = [];
  let chainId: number | undefined;
  let current: ConfiguredContract | undefined;
  for (const line of readFileSync(new URL("../config.yaml", import.meta.url), "utf8").split("\n")) {
    const chain = line.match(/^  - id: (\d+)/);
    if (chain) {
      chainId = Number(chain[1]);
      current = undefined;
      continue;
    }
    const contract = line.match(/^      - name: (\S+)/);
    if (contract) {
      const version = contract[1]!.match(/^MorphoVaultV([12])$/);
      current = chainId !== undefined && version ? { chainId, vaultVersion: Number(version[1]), addresses: [] } : undefined;
      if (current) contracts.push(current);
      continue;
    }
    if (!current) continue;
    const startBlock = line.match(/^        start_block: (\d+)/);
    if (startBlock) current.startBlock = Number(startBlock[1]);
    const address = line.match(/^          - "(0x[0-9a-fA-F]{40})"/);
    if (address) current.addresses.push(address[1]!.toLowerCase());
  }
  return contracts;
}

describe("Morpho governance config", () => {
  const configured = morphoContractsFromConfig();

  it("handler event lists match config.yaml", () => {
    const config = readFileSync(new URL("../config.yaml", import.meta.url), "utf8");
    const events = (name: string) => {
      const section = config.slice(config.indexOf(`  - name: ${name}\n    handler:`)).split(/\n  - name: /)[0]!;
      return [...section.matchAll(/- event: "(\w+)\(/g)].map(m => m[1]).sort();
    };
    expect(events("MorphoVaultV1")).toEqual([...MORPHO_V1_EVENTS].sort());
    expect(events("MorphoVaultV2")).toEqual([...MORPHO_V2_EVENTS].sort());
  });

  it("indexes exactly the vaults in the coverage manifest", () => {
    const key = (chainId: number, vaultVersion: number, address: string) => `${chainId}:V${vaultVersion}:${address.toLowerCase()}`;
    const fromConfig = configured.flatMap(c => c.addresses.map(a => key(c.chainId, c.vaultVersion, a))).sort();
    const fromManifest = coverage.map(v => key(v.chainId, v.vaultVersion, v.vaultAddress)).sort();
    expect(fromConfig).toEqual(fromManifest);
  });

  it.each(configured.map(c => [`${c.chainId} V${c.vaultVersion}`, c] as const))("chain %s start_block is at or below every vault deployment", (_, c) => {
    expect(c.startBlock).toBeTypeOf("number");
    for (const vault of coverage.filter(v => v.chainId === c.chainId && v.vaultVersion === c.vaultVersion)) {
      expect(c.startBlock, vault.name).toBeLessThanOrEqual(vault.deploymentBlock);
    }
  });
});

describe("Morpho governance coverage", () => {
  for (const version of [1, 2]) {
    const chains = [...new Set(coverage.filter(v => v.vaultVersion === version).map(v => v.chainId))];
    it.each(chains)(`indexes every V${version} governance signature for every vault on chain %i`, async chainId => {
      const vaults = coverage.filter(v => v.chainId === chainId && v.vaultVersion === version).map(v => v.vaultAddress);
      const fixtures = version === 1 ? v1 : v2;
      const events = vaults.flatMap(srcAddress => fixtures.map(fixture => ({ ...fixture, srcAddress, block, transaction })))
        .map((e, logIndex) => ({ ...e, logIndex }));
      const indexer = createTestIndexer();
      await indexer.process({ chains: { [chainId]: { simulate: events } } });
      const rows = await indexer.MorphoGovernanceEvent.getAll();
      expect(rows).toHaveLength(events.length);
      for (const e of events) {
        const row = rows.find(r => r.id === `${chainId}_${block.number}_${e.logIndex}`)!;
        expect(row).toMatchObject({
          vaultAddress: getAddress(e.srcAddress),
          vaultVersion: version,
          eventName: e.event,
          chainId,
          blockNumber: block.number,
          blockHash: block.hash,
          logIndex: e.logIndex,
          transactionHash: transaction.hash,
          transactionIndex: transaction.transactionIndex,
          transactionFrom: getAddress(transaction.from),
        });
        expect(row.adapterAddress).toBeUndefined();
        expect(JSON.parse(row.argsJson)).toEqual(JSON.parse(JSON.stringify(e.params, (_, value) => typeof value === "bigint" ? value.toString() : value)));
      }
    });
  }

  it("preserves bool false and arbitrarily large integers without policy", () => {
    const input = { chainId: 1, srcAddress: caller, block, transaction, logIndex: 1, params: { enabled: false, cap: 2n ** 200n } };
    const row = normalizeMorphoEvent(input, 2, "SetCurator");
    expect(JSON.parse(row.argsJson)).toEqual({ enabled: false, cap: (2n ** 200n).toString() });
    expect(normalizeMorphoEvent(input, 2, "SetCurator")).toEqual(row);
  });
});

const adapter = "0x2222222222222222222222222222222222222222";
const otherAdapter = "0x3333333333333333333333333333333333333333";
const chains = [...new Set(coverage.filter((v) => v.vaultVersion === 2).map((v) => v.chainId))];
const addAdapter = (srcAddress: string, account = adapter, logIndex = 0) => ({
  contract: "MorphoVaultV2" as const,
  event: "AddAdapter" as const,
  srcAddress: getAddress(srcAddress),
  params: { account: getAddress(account) },
  block,
  transaction,
  logIndex,
});
const burn = (supplyShares: bigint, srcAddress = adapter, logIndex = 1) => ({
  contract: "MorphoMarketV1AdapterV2" as const,
  event: "BurnShares" as const,
  srcAddress: getAddress(srcAddress),
  params: { marketId, supplyShares },
  block,
  transaction,
  logIndex,
});

describe("Morpho V2 adapter burns", () => {
  it.each(chains)(
    "discovers adapters and indexes same-block burns on chain %i",
    async (chainId) => {
      const vault = coverage.find((v) => v.chainId === chainId && v.vaultVersion === 2)!;
      const indexer = createTestIndexer();
      const supplyShares = 2n ** 256n - 1n;
      const result = await indexer.process({
        chains: { [chainId]: { simulate: [addAdapter(vault.vaultAddress), burn(supplyShares)] } },
      });

      expect(result.changes.flatMap((change) => change.addresses?.sets ?? [])).toContainEqual({
        contract: "MorphoMarketV1AdapterV2",
        address: adapter,
      });
      expect(await indexer.MorphoVaultV2Adapter.getAll()).toEqual([
        {
          id: `${chainId}_${adapter}`,
          chainId,
          adapterAddress: adapter,
          vaultAddress: getAddress(vault.vaultAddress),
        },
      ]);
      expect(await indexer.MorphoGovernanceEvent.get(`${chainId}_${block.number}_1`)).toEqual({
        id: `${chainId}_${block.number}_1`,
        vaultAddress: getAddress(vault.vaultAddress),
        adapterAddress: adapter,
        vaultVersion: 2,
        eventName: "BurnShares",
        chainId,
        blockNumber: block.number,
        blockTimestamp: block.timestamp,
        blockHash: block.hash,
        logIndex: 1,
        transactionHash: transaction.hash,
        transactionIndex: transaction.transactionIndex,
        transactionFrom: getAddress(transaction.from),
        argsJson: JSON.stringify({ marketId, supplyShares: supplyShares.toString() }),
      });
    },
  );

  it("keeps adapter associations across blocks, removal, and re-addition", async () => {
    const vault = coverage.find((v) => v.chainId === 1 && v.vaultVersion === 2)!;
    const indexer = createTestIndexer();
    const nextBlock = { ...block, number: block.number + 1 };
    await indexer.process({
      chains: {
        1: {
          simulate: [
            addAdapter(vault.vaultAddress),
            { ...addAdapter(vault.vaultAddress), event: "RemoveAdapter", block: nextBlock },
            { ...burn(0n), block: nextBlock },
            { ...addAdapter(vault.vaultAddress, adapter, 2), block: nextBlock },
            { ...burn(1n, adapter, 3), block: nextBlock },
          ],
        },
      },
    });

    expect(await indexer.MorphoVaultV2Adapter.getAll()).toHaveLength(1);
    const rows = (await indexer.MorphoGovernanceEvent.getAll()).filter(
      (row) => row.eventName === "BurnShares",
    );
    expect(rows.map((row) => JSON.parse(row.argsJson).supplyShares)).toEqual(["0", "1"]);
    expect(rows.every((row) => row.vaultAddress === getAddress(vault.vaultAddress))).toBe(true);
  });
});

describe("Morpho V2 adapter associations", () => {
  it("keeps different adapters and parent vaults separate", async () => {
    const vaults = coverage.filter((v) => v.chainId === 8453 && v.vaultVersion === 2);
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        8453: {
          simulate: [
            addAdapter(vaults[0]!.vaultAddress),
            addAdapter(vaults[1]!.vaultAddress, otherAdapter, 1),
            burn(11n, adapter, 2),
            burn(22n, otherAdapter, 3),
          ],
        },
      },
    });

    const rows = (await indexer.MorphoGovernanceEvent.getAll()).filter(
      (row) => row.eventName === "BurnShares",
    );
    expect(rows.map((row) => [row.vaultAddress, row.adapterAddress])).toEqual([
      [getAddress(vaults[0]!.vaultAddress), adapter],
      [getAddress(vaults[1]!.vaultAddress), otherAdapter],
    ]);
  });

  it("keeps identical adapter addresses separate across chains", async () => {
    const indexer = createTestIndexer();
    for (const chainId of [1, 8453] as const) {
      const vault = coverage.find((v) => v.chainId === chainId && v.vaultVersion === 2)!;
      await indexer.process({
        chains: { [chainId]: { simulate: [addAdapter(vault.vaultAddress), burn(1n)] } },
      });
    }
    expect(await indexer.MorphoVaultV2Adapter.getAll()).toHaveLength(2);
    const rows = (await indexer.MorphoGovernanceEvent.getAll()).filter(
      (row) => row.eventName === "BurnShares",
    );
    expect(rows.map((row) => row.chainId)).toEqual([1, 8453]);
    expect(new Set(rows.map((row) => row.vaultAddress)).size).toBe(2);
  });

  it("does not index burns from undiscovered adapters", async () => {
    const indexer = createTestIndexer();
    await expect(indexer.process({ chains: { 1: { simulate: [burn(1n)] } } })).rejects.toThrow(
      "never reached a handler",
    );
    expect(await indexer.MorphoGovernanceEvent.getAll()).toEqual([]);
  });
});
