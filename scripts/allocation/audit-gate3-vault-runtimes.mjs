import {
  createPublicClient,
  decodeEventLog,
  encodeEventTopics,
  http,
  keccak256,
  parseAbiItem,
} from "viem";
import { mainnet } from "viem/chains";
import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const failSanitized = (error) => {
  const chain = [];
  let current = error;
  while (current && !chain.includes(current)) {
    chain.push(current);
    current = typeof current === "object" && "cause" in current ? current.cause : undefined;
  }
  const withStatus = chain.find((item) => typeof item === "object" && item && "status" in item);
  const withCode = chain.find((item) => typeof item === "object" && item && "code" in item);
  const withDetails = chain.find((item) => typeof item === "object" && item && "details" in item);
  const status = withStatus ? `, HTTP ${withStatus.status}` : "";
  const code = withCode ? `, code ${withCode.code}` : "";
  const kind = error instanceof Error ? error.name : "UnknownError";
  const rawDetails = withDetails ? String(withDetails.details) : error instanceof Error ? error.message : "";
  const scrubbedDetails = rawDetails.replace(/https?:\/\/\S+/gi, "[URL suppressed]");
  const details = scrubbedDetails ? `: ${scrubbedDetails.slice(0, 200)}` : "";
  console.error(`Gate 3 vault runtime audit: FAILED (${kind}${status}${code}; URL suppressed)${details}`);
  process.exit(1);
};
process.on("uncaughtException", failSanitized);
process.on("unhandledRejection", failSanitized);

const rpcUrl = process.env.ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM;
if (!rpcUrl) {
  console.log("Gate 3 vault runtime audit: NOT RUN (ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM is unset)");
  process.exit(0);
}

const auditBlock = 25_835_600n;
const auditBlockHash = "0x3f7c6998176cc2af40681d187424a4e0b76dc782df150bd408fa65863c6b3dec";
const discoveryStartBlock = 16_000_000n;
const maxLogRange = 10_000n;
const useBlockscoutDiscovery = process.argv.includes("--blockscout");
const supportedOnly = process.argv.includes("--supported-only");
const useLatestBytecode = process.argv.includes("--latest-bytecode");
const outputArgumentIndex = process.argv.indexOf("--output");
const outputPath = outputArgumentIndex === -1 ? undefined : process.argv[outputArgumentIndex + 1];
if (outputArgumentIndex !== -1 && !outputPath) throw new Error("--output requires a file path");
const blockscoutApiUrl = "https://eth.blockscout.com/api";
const registries = [
  "0x0377b4daDDA86C89A0091772B79ba67d0E5F7198",
  "0xff31A1B020c868F6eA3f61Eb953344920EeCA3af",
  "0xd40ecF29e001c76Dcc4cC0D9cd50520CE845B038",
];
const vaultFactories = [
  "0xE9E8C89c8Fc7E8b8F23425688eb68987231178e5",
  "0x444045c5C13C246e117eD36437303cac8E250aB0",
  "0x5577EdcB8A856582297CdBbB07055E6a6E38eb5f",
  "0x770D0d1Fb036483Ed4AbB6d53c1C88fb277D812F",
];
const configuredFactoryVersions = new Map([
  [lowercase("0xE9E8C89c8Fc7E8b8F23425688eb68987231178e5"), "3.0.1"],
  [lowercase("0x444045c5C13C246e117eD36437303cac8E250aB0"), "3.0.2"],
  [lowercase("0x5577EdcB8A856582297CdBbB07055E6a6E38eb5f"), "3.0.3"],
  [lowercase("0x770D0d1Fb036483Ed4AbB6d53c1C88fb277D812F"), "3.0.4"],
]);
const roleManagerFactory = "0xca12459a931643BF28388c67639b3F352fe9e5Ce";
const directRoleManagers = ["0xb3bd6B2E61753C311EFbCF0111f75D29706D9a41"];

function lowercase(value) {
  return value.toLowerCase();
}

const events = {
  NewEndorsedVault: parseAbiItem(
    "event NewEndorsedVault(address indexed vault, address indexed asset, uint256 releaseVersion, uint256 vaultType)",
  ),
  NewVault: parseAbiItem("event NewVault(address indexed vault_address, address indexed asset)"),
  NewProject: parseAbiItem("event NewProject(bytes32 indexed projectId, address indexed roleManager)"),
  AddedNewVault: parseAbiItem(
    "event AddedNewVault(address indexed vault, address indexed debtAllocator, uint256 category)",
  ),
};

const client = createPublicClient({
  chain: mainnet,
  transport: http(rpcUrl, { batch: false, retryCount: 3, retryDelay: 500, timeout: 20_000 }),
});
const lower = (value) => value.toLowerCase();
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let nextRpcCallAt = 0;
const rpcCall = async (operation) => {
  for (let attempt = 1; ; attempt += 1) {
    const delay = Math.max(0, nextRpcCallAt - Date.now());
    if (delay) await sleep(delay);
    nextRpcCallAt = Date.now() + 500;
    try {
      return await operation();
    } catch (error) {
      const chain = [];
      let current = error;
      while (current && !chain.includes(current)) {
        chain.push(current);
        current = typeof current === "object" && "cause" in current ? current.cause : undefined;
      }
      const withCode = chain.find((item) => typeof item === "object" && item && "code" in item);
      const withStatus = chain.find((item) => typeof item === "object" && item && "status" in item);
      const code = withCode?.code;
      const status = withStatus?.status;
      if (attempt >= 5 || (code !== -32029 && status !== 429)) throw error;
      await sleep(attempt * 2_000);
    }
  }
};

const factoryAbi = [
  { type: "function", name: "apiVersion", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "api_version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "vault_original", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];

const inspectVaultFactories = async (blockNumber = auditBlock) => {
  const inspected = [];
  for (const factoryAddress of vaultFactories) {
  const block = blockNumber === null ? {} : { blockNumber };
    let apiVersion;
    for (const functionName of ["apiVersion", "api_version"]) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          apiVersion = await rpcCall(() =>
            client.readContract({ address: factoryAddress, abi: factoryAbi, functionName, ...block }),
          );
          break;
        } catch {
          if (attempt < 3) await sleep(500 * attempt);
        }
      }
      if (apiVersion) break;
      // Older factory releases used the snake_case getter.
    }
    if (!apiVersion) throw new Error(`Cannot resolve API version for configured factory ${factoryAddress}`);
    let originalAddress;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        originalAddress = await rpcCall(() => client.readContract({
          address: factoryAddress,
          abi: factoryAbi,
          functionName: "vault_original",
          ...block,
        }));
        break;
      } catch {
        if (attempt < 3) await sleep(500 * attempt);
      }
    }
    if (!originalAddress && apiVersion !== "3.0.1") {
      throw new Error(`Cannot resolve vault original for configured factory ${factoryAddress}`);
    }
    const factoryCode = await rpcCall(() => client.getCode({ address: factoryAddress, ...block }));
    const originalCode = originalAddress
      ? await rpcCall(() => client.getCode({ address: originalAddress, ...block }))
      : undefined;
    if (!factoryCode || (originalAddress && !originalCode)) {
      throw new Error("Configured vault factory or original has no runtime bytecode");
    }
    inspected.push({
    factoryAddress: lower(factoryAddress),
    factoryRuntimeCodeHash: keccak256(factoryCode),
    apiVersion,
      originalAddress: originalAddress ? lower(originalAddress) : null,
      originalRuntimeCodeHash: originalCode ? keccak256(originalCode) : null,
    });
  }
  return inspected;
};

if (process.argv.includes("--factories-only") || process.argv.includes("--factories-latest")) {
  const blockNumber = process.argv.includes("--factories-latest") ? null : auditBlock;
  console.log(JSON.stringify(await inspectVaultFactories(blockNumber), null, 2));
  process.exit(0);
}

const topic = (event) => encodeEventTopics({ abi: [event] })[0];

const getBlockscoutLogs = async (addresses, eventDefinitions) => {
  const logs = [];
  for (const address of addresses) {
    for (const event of eventDefinitions) {
      const query = new URL(blockscoutApiUrl);
      query.search = new URLSearchParams({
        module: "logs",
        action: "getLogs",
        fromBlock: discoveryStartBlock.toString(),
        toBlock: auditBlock.toString(),
        address,
        topic0: topic(event),
      }).toString();
      const response = await fetch(query);
      if (!response.ok) throw new Error(`Blockscout discovery failed with HTTP ${response.status}`);
      const body = await response.json();
      if (body.message === "No logs found") continue;
      if (body.message !== "OK" || !Array.isArray(body.result)) {
        throw new Error("Blockscout discovery returned an invalid response");
      }
      logs.push(...body.result.map((log) => ({
        ...log,
        topics: log.topics.filter(Boolean),
      })));
    }
  }
  return logs;
};

const getRpcLogs = async (addresses, eventDefinitions) => {
  const logs = [];
  for (let fromBlock = discoveryStartBlock; fromBlock <= auditBlock; fromBlock += maxLogRange) {
    const toBlock = fromBlock + maxLogRange - 1n > auditBlock ? auditBlock : fromBlock + maxLogRange - 1n;
    const page = await client.request({
      method: "eth_getLogs",
      params: [{
        address: addresses,
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
        topics: [eventDefinitions.map(topic)],
      }],
    });
    logs.push(...page);
  }
  return logs;
};

const getLogs = useBlockscoutDiscovery ? getBlockscoutLogs : getRpcLogs;

const staticEventDefinitions = supportedOnly
  ? [events.NewVault]
  : [events.NewEndorsedVault, events.NewVault, events.NewProject];
const staticAddresses = supportedOnly
  ? vaultFactories
  : [...registries, ...vaultFactories, roleManagerFactory];
const staticLogs = await getLogs(staticAddresses, staticEventDefinitions);
const roleManagers = new Set(directRoleManagers.map(lower));
const vaults = new Set();
const officialFactoryVaults = new Set();
const vaultApiVersions = new Map();
const vaultDiscovery = new Map();
const discoveryCounts = { NewEndorsedVault: 0, NewVault: 0, AddedNewVault: 0 };

const recordVaultDiscovery = (vaultAddress, log, source, factoryAddress) => {
  const address = lower(vaultAddress);
  const blockNumber = Number(BigInt(log.blockNumber));
  const existing = vaultDiscovery.get(address);
  const sources = new Set(existing?.sources ?? []);
  sources.add(source);
  const discoverySources = new Map(
    (existing?.discoverySources ?? []).map((record) => [
      `${record.sourceType}:${record.sourceAddress}:${record.blockNumber}`,
      record,
    ]),
  );
  const sourceRecord = {
    sourceType: source,
    sourceAddress: lower(log.address),
    blockNumber,
    blockHash: log.blockHash ? lower(log.blockHash) : null,
  };
  discoverySources.set(`${sourceRecord.sourceType}:${sourceRecord.sourceAddress}:${sourceRecord.blockNumber}`, sourceRecord);
  const isEarlierDiscovery = existing === undefined || blockNumber < existing.discoveryBlock;
  vaultDiscovery.set(address, {
    discoveryBlock: Math.min(existing?.discoveryBlock ?? blockNumber, blockNumber),
    discoveryBlockHash: isEarlierDiscovery && log.blockHash ? lower(log.blockHash) : existing?.discoveryBlockHash ?? null,
    deploymentBlock: source === "officialFactory" ? blockNumber : existing?.deploymentBlock ?? null,
    deploymentBlockHash: source === "officialFactory" && log.blockHash ? lower(log.blockHash) : existing?.deploymentBlockHash ?? null,
    factoryAddress: factoryAddress ? lower(factoryAddress) : existing?.factoryAddress ?? null,
    sources: [...sources].sort(),
    discoverySources: [...discoverySources.values()].sort((left, right) =>
      left.blockNumber - right.blockNumber ||
      left.sourceType.localeCompare(right.sourceType) ||
      left.sourceAddress.localeCompare(right.sourceAddress)
    ),
  });
};

for (const log of staticLogs) {
  const definition = staticEventDefinitions.find((event) => topic(event) === log.topics[0]);
  if (!definition) throw new Error(`Unknown discovery topic ${log.topics[0]}`);
  const decoded = decodeEventLog({ abi: [definition], data: log.data, topics: log.topics });
  if (decoded.eventName === "NewProject") {
    roleManagers.add(lower(decoded.args.roleManager));
  } else if (decoded.eventName === "NewVault") {
    discoveryCounts.NewVault += 1;
    const vaultAddress = lower(decoded.args.vault_address);
    vaults.add(vaultAddress);
    officialFactoryVaults.add(vaultAddress);
    recordVaultDiscovery(vaultAddress, log, "officialFactory", log.address);
    const version = configuredFactoryVersions.get(lower(log.address));
    if (version) vaultApiVersions.set(vaultAddress, version);
  } else {
    discoveryCounts.NewEndorsedVault += 1;
    const vaultAddress = lower(decoded.args.vault);
    vaults.add(vaultAddress);
    recordVaultDiscovery(vaultAddress, log, "registry", null);
  }
}

const roleManagerLogs = supportedOnly ? [] : await getLogs([...roleManagers], [events.AddedNewVault]);
for (const log of roleManagerLogs) {
  const decoded = decodeEventLog({ abi: [events.AddedNewVault], data: log.data, topics: log.topics });
  discoveryCounts.AddedNewVault += 1;
  const vaultAddress = lower(decoded.args.vault);
  vaults.add(vaultAddress);
  recordVaultDiscovery(vaultAddress, log, "roleManager", null);
}

const runtimeFamilies = new Map();
const vaultInventory = [];
for (const vaultAddress of [...vaults].sort()) {
  const block = useLatestBytecode ? {} : { blockNumber: auditBlock };
  const bytecode = await rpcCall(() => client.getCode({ address: vaultAddress, ...block }));
  if (!bytecode) throw new Error(`No runtime bytecode for discovered vault ${vaultAddress}`);
  const runtimeCodeHash = keccak256(bytecode);
  const implementationMatch = bytecode.match(/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i);
  const implementationAddress = implementationMatch ? `0x${implementationMatch[1]}`.toLowerCase() : undefined;
  const familyKey = `${runtimeCodeHash}:${implementationAddress ?? "direct"}`;
  const family = runtimeFamilies.get(familyKey) ?? {
    runtimeCodeHash,
    implementationAddress,
    implementationRuntimeCodeHash: undefined,
    apiVersion: vaultApiVersions.get(vaultAddress),
    vaultCount: 0,
    officialFactoryVaultCount: 0,
    representativeVault: vaultAddress,
  };
  family.apiVersion ??= vaultApiVersions.get(vaultAddress);
  family.vaultCount += 1;
  if (officialFactoryVaults.has(vaultAddress)) family.officialFactoryVaultCount += 1;
  runtimeFamilies.set(familyKey, family);
  vaultInventory.push({
    vaultAddress,
    ...vaultDiscovery.get(vaultAddress),
    officialFactory: officialFactoryVaults.has(vaultAddress),
    apiVersion: vaultApiVersions.get(vaultAddress) ?? null,
    runtimeCodeHash,
    implementationAddress: implementationAddress ?? null,
    familyKey,
  });
}

const versionAbis = [
  [{ type: "function", name: "apiVersion", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }],
  [{ type: "function", name: "api_version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }],
];

for (const family of runtimeFamilies.values()) {
  if (family.implementationAddress) {
    const implementationCode = await rpcCall(() => client.getCode({
      address: family.implementationAddress,
      ...(useLatestBytecode ? {} : { blockNumber: auditBlock }),
    }));
    if (!implementationCode) throw new Error(`No implementation bytecode for ${family.implementationAddress}`);
    family.implementationRuntimeCodeHash = keccak256(implementationCode);
  }
  for (const abi of versionAbis) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        family.apiVersion = await rpcCall(() => client.readContract({
          address: family.representativeVault,
          abi,
          functionName: abi[0].name,
          ...(useLatestBytecode ? {} : { blockNumber: auditBlock }),
        }));
        break;
      } catch {
        if (attempt < 3) await sleep(500 * attempt);
      }
    }
    if (family.apiVersion) break;
    // v3.0.0 used api_version(); later releases use apiVersion().
  }
  if (!family.apiVersion) throw new Error(`Cannot resolve API version for ${family.representativeVault}`);
}

for (const vault of vaultInventory) {
  vault.apiVersion ??= runtimeFamilies.get(vault.familyKey)?.apiVersion ?? null;
}

const output = {
  schemaVersion: 1,
  chainId: 1,
  auditBlock: { number: Number(auditBlock), hash: auditBlockHash },
  discoveryStartBlock: Number(discoveryStartBlock),
  discoveryCounts,
  roleManagerCount: roleManagers.size,
  discoveredVaultCount: vaults.size,
  officialFactoryVaultCount: officialFactoryVaults.size,
  discoveryAuthorities: {
    registries: registries.map(lower).sort(),
    vaultFactories: vaultFactories.map(lower).sort(),
    roleManagerFactory: lower(roleManagerFactory),
    directRoleManagers: directRoleManagers.map(lower).sort(),
    roleManagers: [...roleManagers].sort(),
  },
  vaultFactories: await inspectVaultFactories(useLatestBytecode ? null : auditBlock),
  vaults: vaultInventory.map(({ familyKey: _, ...vault }) => vault),
  runtimeFamilies: [...runtimeFamilies.values()]
    .filter((family) => !supportedOnly || family.officialFactoryVaultCount > 0)
    .sort((left, right) =>
      left.apiVersion.localeCompare(right.apiVersion) || left.runtimeCodeHash.localeCompare(right.runtimeCodeHash),
    ),
};

if (process.argv.includes("--verify-fixture")) {
  const fixture = JSON.parse(
    readFileSync(new URL("../../fixtures/allocation/ethereum/gate3-runtimes.json", import.meta.url), "utf8"),
  );
  const versions = [...new Set(output.runtimeFamilies.map(({ apiVersion }) => apiVersion))].sort().map(
    (apiVersion) => {
      const families = output.runtimeFamilies.filter((family) => family.apiVersion === apiVersion);
      return {
        apiVersion,
        vaultCount: families.reduce((sum, family) => sum + family.officialFactoryVaultCount, 0),
        runtimeCodeHashes: families.map(({ runtimeCodeHash }) => runtimeCodeHash).sort(),
      };
    },
  );
  const compact = {
    auditBlock: output.auditBlock,
    officialFactoryVaultCount: output.officialFactoryVaultCount,
    vaultFactories: output.vaultFactories,
    versions,
  };
  if (!isDeepStrictEqual(compact, fixture)) throw new Error("Gate 3 runtime fixture mismatch");
  console.log(
    `Gate 3 official runtime audit: PASS (${output.officialFactoryVaultCount} vaults, ${output.runtimeFamilies.length} runtime families, ${versions.length} releases)`,
  );
} else {
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  if (outputPath) {
    writeFileSync(outputPath, serialized);
    console.log(`Gate 3 vault runtime inventory: PASS (${output.vaults.length} vaults written)`);
  } else {
    console.log(serialized);
  }
}
