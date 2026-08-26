import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  coverageEntityRows,
  coverageMarkdown,
  validateCoverageManifest,
  type CoverageManifest,
} from "../src/gate4.js";

const coverageUrl = new URL("../coverage/", import.meta.url);
const manifest = validateCoverageManifest(
  JSON.parse(readFileSync(new URL("ethereum.json", coverageUrl), "utf8")) as CoverageManifest,
);
const inventory = JSON.parse(readFileSync(new URL("ethereum.inventory.json", coverageUrl), "utf8")) as {
  auditBlock: { number: number; hash: string };
  discoveredVaultCount: number;
  officialFactoryVaultCount: number;
  vaults: Array<{
    vaultAddress: string;
    deploymentBlock: number | null;
    officialFactory: boolean;
    apiVersion: string;
    runtimeCodeHash: string;
  }>;
};

describe("Gate 4 checked-in Ethereum coverage authority", () => {
  it("accounts for every discovered vault as included or explicitly excluded", () => {
    expect(inventory.discoveredVaultCount).toBe(321);
    expect(inventory.officialFactoryVaultCount).toBe(243);
    expect(manifest.entries).toHaveLength(243);
    expect(manifest.exclusions).toHaveLength(78);
    expect(manifest.entries.every(({ safeForTimeline }) => !safeForTimeline)).toBe(true);
    expect(new Set([
      ...manifest.entries.map(({ vaultAddress }) => vaultAddress),
      ...manifest.exclusions.map(({ vaultAddress }) => vaultAddress),
    ]).size).toBe(inventory.discoveredVaultCount);
  });

  it("preserves pinned inventory provenance in every included and excluded row", () => {
    const byVault = new Map(inventory.vaults.map((vault) => [vault.vaultAddress, vault]));
    for (const entry of manifest.entries) {
      const vault = byVault.get(entry.vaultAddress)!;
      expect(vault.officialFactory).toBe(true);
      expect(entry.vaultDeploymentBlock).toBe(vault.deploymentBlock);
      expect(entry.apiVersion).toBe(vault.apiVersion);
      expect(entry.runtimeCodeHash).toBe(vault.runtimeCodeHash);
      expect(entry.validatedThroughBlock).toBe(inventory.auditBlock.number);
      expect(entry.validatedThroughBlockHash).toBe(inventory.auditBlock.hash);
      expect(entry.knownGaps.length).toBeGreaterThan(0);
    }
    for (const exclusion of manifest.exclusions) {
      const vault = byVault.get(exclusion.vaultAddress)!;
      expect(vault.officialFactory).toBe(false);
      expect(exclusion.apiVersion).toBe(vault.apiVersion);
      expect(exclusion.runtimeCodeHash).toBe(vault.runtimeCodeHash);
    }
  });

  it("keeps generated entity rows and the human matrix byte-for-byte current", () => {
    const entities = JSON.parse(readFileSync(new URL("ethereum.entities.json", coverageUrl), "utf8")) as {
      manifestVersion: number;
      coverageRevision: string;
      rows: unknown[];
    };
    expect(entities).toEqual({
      manifestVersion: manifest.manifestVersion,
      coverageRevision: manifest.coverageRevision,
      rows: coverageEntityRows(manifest),
    });
    expect(readFileSync(new URL("ethereum.generated.md", coverageUrl), "utf8")).toBe(
      coverageMarkdown(manifest),
    );
  });
});
