import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { withTransientRpcRetry, sanitizeArchiveRpcError } from "../src/checkpoints.js";
import type {
  CoverageDiscoverySource,
  CoverageEntry,
  CoverageExclusion,
  CoverageManifest,
} from "../src/gate4.js";

type InventoryDiscoverySource = Omit<CoverageDiscoverySource, "blockHash"> & { blockHash: string | null };

type InventoryVault = {
  vaultAddress: string;
  discoveryBlock: number;
  deploymentBlock: number | null;
  officialFactory: boolean;
  apiVersion: string | null;
  runtimeCodeHash: string;
  discoverySources: InventoryDiscoverySource[];
};

type RuntimeInventory = {
  chainId: number;
  auditBlock: { number: number; hash: string };
  discoveredVaultCount: number;
  officialFactoryVaultCount: number;
  vaults: InventoryVault[];
};

const rpcUrl = process.env.ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM;
if (!rpcUrl) {
  console.log("Gate 4 draft manifest build: NOT RUN (ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM is unset)");
  process.exit(0);
}

const coverageDirectory = new URL("../coverage/", import.meta.url);
const inventory = JSON.parse(
  readFileSync(new URL("ethereum.inventory.json", coverageDirectory), "utf8"),
) as RuntimeInventory;
const current = JSON.parse(
  readFileSync(new URL("ethereum.json", coverageDirectory), "utf8"),
) as Pick<CoverageManifest, "manifestVersion" | "coverageRevision" | "producerCommit" | "validatedAt">;

const fail = (message: string): never => {
  throw new Error(message);
};

if (inventory.chainId !== 1) fail("Gate 4 draft builder only supports Ethereum");
if (inventory.vaults.length !== inventory.discoveredVaultCount) fail("Inventory vault count mismatch");
if (inventory.vaults.filter(({ officialFactory }) => officialFactory).length !== inventory.officialFactoryVaultCount) {
  fail("Official inventory count mismatch");
}

const client = createPublicClient({
  chain: mainnet,
  transport: http(rpcUrl, { batch: true, retryCount: 0, timeout: 20_000 }),
});
const blockHashes = new Map<number, string>();
let nextCallAt = 0;
const readBlockHash = async (blockNumber: number): Promise<string> => {
  const cached = blockHashes.get(blockNumber);
  if (cached) return cached;
  const delay = Math.max(0, nextCallAt - Date.now());
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  nextCallAt = Date.now() + 500;
  const block = await withTransientRpcRetry(() => client.getBlock({ blockNumber: BigInt(blockNumber) }));
  if (!block.hash) fail(`Block ${blockNumber} has no hash`);
  blockHashes.set(blockNumber, block.hash.toLowerCase());
  return block.hash.toLowerCase();
};

const resolveDiscoverySources = async (vault: InventoryVault): Promise<CoverageDiscoverySource[]> => {
  if (!Array.isArray(vault.discoverySources) || vault.discoverySources.length === 0) {
    fail(`Inventory lacks discovery sources for ${vault.vaultAddress}`);
  }
  const sources: CoverageDiscoverySource[] = [];
  for (const source of vault.discoverySources) {
    sources.push({
      ...source,
      blockHash: source.blockHash ?? await readBlockHash(source.blockNumber),
    });
  }
  return sources;
};

try {
  const auditHash = await readBlockHash(inventory.auditBlock.number);
  if (auditHash !== inventory.auditBlock.hash.toLowerCase()) fail("Pinned inventory audit hash is no longer canonical");

  const officialVaults = inventory.vaults
    .filter(({ officialFactory }) => officialFactory)
    .sort((left, right) => left.vaultAddress.localeCompare(right.vaultAddress));
  const entries: CoverageEntry[] = [];
  for (const vault of officialVaults) {
    if (vault.deploymentBlock === null || vault.apiVersion === null) fail(`Incomplete official inventory for ${vault.vaultAddress}`);
    entries.push({
      chainId: 1,
      vaultAddress: vault.vaultAddress,
      coverageStartBlock: vault.deploymentBlock,
      coverageStartBlockHash: await readBlockHash(vault.deploymentBlock),
      validatedThroughBlock: inventory.auditBlock.number,
      validatedThroughBlockHash: inventory.auditBlock.hash.toLowerCase(),
      vaultDiscoveryComplete: true,
      eventHistoryComplete: false,
      allocatorDeploymentHistoryComplete: false,
      allocatorAssignmentHistoryComplete: false,
      checkpointTriggerAuditComplete: true,
      safeForTimeline: false,
      knownGaps: [
        { code: "allocator-history-not-certified", detail: "Full allocator deployment and assignment history parity has not run" },
        { code: "candidate-parity-not-run", detail: "Credentialed parity against a deployed allocation candidate has not run" },
        { code: "event-history-not-certified", detail: "First required event and full event replay equivalence are not yet certified" },
      ],
      discoverySources: await resolveDiscoverySources(vault),
      vaultDeploymentBlock: vault.deploymentBlock,
      discoveryBlock: vault.discoveryBlock,
      firstRequiredEventBlock: null,
      allocatorHistoryStartBlock: null,
      apiVersion: vault.apiVersion,
      runtimeCodeHash: vault.runtimeCodeHash,
      earliestSafeTimelineBlock: null,
    });
  }

  const exclusions: CoverageExclusion[] = [];
  for (const vault of inventory.vaults
    .filter(({ officialFactory }) => !officialFactory)
    .sort((left, right) => left.vaultAddress.localeCompare(right.vaultAddress))) {
    if (vault.apiVersion === null) fail(`Custom inventory lacks API version for ${vault.vaultAddress}`);
    exclusions.push({
        chainId: 1,
        vaultAddress: vault.vaultAddress,
        discoveryBlock: vault.discoveryBlock,
        apiVersion: vault.apiVersion,
        runtimeCodeHash: vault.runtimeCodeHash,
        reason: "Custom registry or RoleManager implementation lacks official-factory provenance and release-specific mutation certification",
        discoverySources: await resolveDiscoverySources(vault),
      });
  }

  const manifest: CoverageManifest = { ...current, entries, exclusions };
  writeFileSync(new URL("ethereum.json", coverageDirectory), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Gate 4 draft manifest: PASS (${entries.length} included, ${exclusions.length} excluded, 0 safe)`);
} catch (error) {
  console.error(`Gate 4 draft manifest: FAILED (${sanitizeArchiveRpcError(error).message}; URL suppressed)`);
  process.exit(1);
}
