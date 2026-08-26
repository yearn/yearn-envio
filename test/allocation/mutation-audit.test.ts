import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const audit = JSON.parse(
  readFileSync(new URL("../../fixtures/allocation/ethereum/gate3-source-audit.json", import.meta.url), "utf8"),
) as {
  supportedReleases: Array<{ apiVersion: string; sourceBlob: string }>;
  mutationPaths: Array<{
    name: string;
    writes: string[];
    terminalTriggers: string[];
    additionalTriggers?: string[];
  }>;
};
const runtimes = JSON.parse(
  readFileSync(new URL("../../fixtures/allocation/ethereum/gate3-runtimes.json", import.meta.url), "utf8"),
) as {
  officialFactoryVaultCount: number;
  versions: Array<{ apiVersion: string; vaultCount: number; runtimeCodeHashes: string[] }>;
};

const configuredVersions = ["3.0.1", "3.0.2", "3.0.3", "3.0.4"];
const checkpointTriggers = new Set(["Deposit", "Withdraw", "DebtUpdated", "StrategyReported"]);

describe("Gate 3 official Vault V3 mutation audit", () => {
  it("pins source blobs for every configured official factory release", () => {
    expect([...new Set(audit.supportedReleases.map(({ apiVersion }) => apiVersion))].sort()).toEqual(
      configuredVersions,
    );
    for (const release of audit.supportedReleases) {
      expect(release.sourceBlob).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("covers every pinned official runtime family with an audited source release", () => {
    expect(runtimes.versions.map(({ apiVersion }) => apiVersion)).toEqual(configuredVersions);
    expect(runtimes.versions.reduce((sum, { vaultCount }) => sum + vaultCount, 0)).toBe(
      runtimes.officialFactoryVaultCount,
    );
    expect(runtimes.versions.flatMap(({ runtimeCodeHashes }) => runtimeCodeHashes)).toHaveLength(26);
    for (const version of runtimes.versions) {
      expect(audit.supportedReleases.some(({ apiVersion }) => apiVersion === version.apiVersion)).toBe(true);
      expect(version.runtimeCodeHashes.every((hash) => /^0x[0-9a-f]{64}$/.test(hash))).toBe(true);
    }
  });

  it("maps every accounting mutation path to a configured terminal trigger", () => {
    expect(audit.mutationPaths.map(({ name }) => name)).toEqual([
      "deposit-or-mint",
      "withdraw-or-redeem",
      "forced-strategy-revocation",
      "strategy-debt-update",
      "strategy-report",
      "debt-purchase",
    ]);
    for (const path of audit.mutationPaths) {
      expect(path.writes.length).toBeGreaterThan(0);
      expect(path.writes.every((field) => field === "total_idle" || field === "total_debt")).toBe(true);
      expect(path.terminalTriggers.length).toBeGreaterThan(0);
      expect(path.terminalTriggers.every((trigger) => checkpointTriggers.has(trigger))).toBe(true);
      expect((path.additionalTriggers ?? []).every((trigger) => checkpointTriggers.has(trigger))).toBe(true);
    }
  });
});
