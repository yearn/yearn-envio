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
const transaction = { hash: `0x${"cd".repeat(32)}`, from: caller, to: caller, transactionIndex: 3 };
const v1 = [
  { contract: "MorphoVaultV1", event: "SetCurator", params: { newCurator: caller } },
  { contract: "MorphoVaultV1", event: "OwnershipTransferred", params: { previousOwner: caller, newOwner: caller } },
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
      const chainBlock = { ...block, number: Math.max(...coverage.filter(v => v.chainId === chainId).map(v => v.deploymentBlock)) + 1 };
      const events = vaults.flatMap(srcAddress => fixtures.map(fixture => ({ ...fixture, srcAddress, block: chainBlock, transaction })))
        .map((e, logIndex) => ({ ...e, logIndex }));
      const indexer = createTestIndexer();
      await indexer.process({ chains: { [chainId]: { simulate: events } } });
      const rows = await indexer.MorphoGovernanceEvent.getAll();
      expect(rows).toHaveLength(events.length);
      for (const e of events) {
        const row = rows.find(r => r.id === `${chainId}_${chainBlock.number}_${e.logIndex}`)!;
        expect(row).toMatchObject({
          vaultAddress: getAddress(e.srcAddress),
          vaultVersion: version,
          eventName: e.event,
          chainId,
          blockNumber: chainBlock.number,
          blockHash: block.hash,
          logIndex: e.logIndex,
          transactionHash: transaction.hash,
          transactionIndex: transaction.transactionIndex,
          transactionFrom: getAddress(transaction.from),
        });
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
