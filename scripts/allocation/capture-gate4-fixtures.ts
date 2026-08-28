import { readFileSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbi,
  type Hex,
} from "viem";
import { mainnet } from "viem/chains";
import { readVaultAccountingFromArchive } from "../../src/allocation/Effects.js";
import { resolveAllocationEnvironment } from "../../src/allocation/environment.js";
import {
  NORMALIZATION_VERSION,
  allocationEventId,
  serializers,
  topLevelInputSelector,
  type Serializer,
} from "../../src/allocation/normalization.js";

const { ethereumRpcUrl: rpcUrl } = resolveAllocationEnvironment();
if (!rpcUrl) {
  console.log("Gate 4 fixture capture: NOT RUN (ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM is unset)");
  process.exit(0);
}

const vaultAbi = parseAbi([
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
  "event DebtUpdated(address indexed strategy, uint256 currentDebt, uint256 newDebt)",
  "event StrategyReported(address indexed strategy, uint256 gain, uint256 loss, uint256 currentDebt, uint256 protocolFees, uint256 totalFees, uint256 totalRefunds)",
  "event StrategyChanged(address indexed strategy, uint256 indexed changeType)",
  "event UpdatedMaxDebtForStrategy(address indexed sender, address indexed strategy, uint256 newDebt)",
  "event DebtPurchased(address indexed strategy, uint256 amount)",
  "function strategies(address) view returns (uint256 activation, uint256 lastReport, uint256 currentDebt, uint256 maxDebt)",
]);

type VaultEventName = keyof typeof serializers.vault;
type Candidate = {
  id: string;
  label: string;
  vaultAddress: `0x${string}`;
  blockNumber: number;
  strategyDiscoveryStartBlock: number;
  strategies: `0x${string}`[];
  requirements: string[];
  expectedEventNames: VaultEventName[];
  outsideAllocatorTargetEvidence?: {
    allocatorAddress: `0x${string}`;
    strategyAddress: `0x${string}`;
    fromBlock: number;
    throughBlock: number;
    eventSignatures: Hex[];
    matchingEventCount: number;
  };
};

const candidates: Candidate[] = [
  {
    id: "yvweth-1-multi-strategy-debt-update",
    label: "yvWETH-1 multi-strategy allocation block",
    vaultAddress: "0xc56413869c6cdf96496f2b1ef801fedbdfa7ddb0",
    blockNumber: 21_589_454,
    strategyDiscoveryStartBlock: 19_419_991,
    strategies: [
      "0x23ee3d14f09946a084350cc6a7153fc6eb918817",
      "0x365cc9c28df1663fa37c565a3ac1addc3a219e15",
      "0xc7bae383738274ea8c3292d53afbb3b42b348df0",
    ],
    requirements: ["yvWETH-1", "multiple-strategies", "multiple-relevant-events", "same-transaction-ordering", "withdraw", "idle-change"],
    expectedEventNames: ["DebtUpdated", "DebtUpdated", "DebtUpdated", "Withdraw"],
  },
  {
    id: "yvusdc-1-outside-optimizer-loss-report",
    label: "yvUSDC-1 outside-optimizer loss report",
    vaultAddress: "0xbe53a109b494e5c9f97b9cd39fe969be68bf6204",
    blockNumber: 24_896_762,
    strategyDiscoveryStartBlock: 19_419_991,
    strategies: ["0x39c0aec5738ed939876245224afc7e09c8480a52"],
    requirements: ["yvUSDC-1", "outside-optimizer-strategy", "loss-sensitive-report"],
    expectedEventNames: ["StrategyReported"],
    outsideAllocatorTargetEvidence: {
      allocatorAddress: "0x1e9eb053228b1156831759401de0e115356b8671",
      strategyAddress: "0x39c0aec5738ed939876245224afc7e09c8480a52",
      fromBlock: 22_484_709,
      throughBlock: 24_896_762,
      eventSignatures: [
        "0x28d465e4d5dcdcee5fb93eccf31e0bcf5d3f6fea174eb791749dc2b51a76f881",
        "0x7f2bbad10e91f21c5aaf78550279b42e2863496b6c7e73b661ec891b730c33fb",
      ],
      matchingEventCount: 0,
    },
  },
  {
    id: "yvusdc-1-deposit-idle-change",
    label: "yvUSDC-1 deposit and idle change",
    vaultAddress: "0xbe53a109b494e5c9f97b9cd39fe969be68bf6204",
    blockNumber: 19_441_994,
    strategyDiscoveryStartBlock: 19_419_991,
    strategies: [],
    requirements: ["yvUSDC-1", "deposit", "idle-change"],
    expectedEventNames: ["Deposit"],
  },
];

class FixtureCaptureError extends Error {
  override name = "FixtureCaptureError";
}

const client = createPublicClient({
  chain: mainnet,
  transport: http(rpcUrl, { batch: true, retryCount: 3, retryDelay: 500, timeout: 20_000 }),
});
const signatureToName = new Map(
  Object.entries(serializers.vault).map(([name, serializer]) => [serializer.signature, name as VaultEventName]),
);

const eventSerializer = (name: VaultEventName): Serializer<Record<string, unknown>> =>
  serializers.vault[name] as unknown as Serializer<Record<string, unknown>>;

const getBlockscoutLogs = async (
  address: string,
  fromBlock: number,
  toBlock: number,
  topic0?: string,
  topic1?: string,
) => {
  const url = new URL("https://eth.blockscout.com/api");
  url.search = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    fromBlock: String(fromBlock),
    toBlock: String(toBlock),
    address,
    ...(topic0 ? { topic0 } : {}),
    ...(topic1 ? { topic1, topic0_1_opr: "and" } : {}),
  }).toString();
  const response = await fetch(url);
  if (!response.ok) throw new FixtureCaptureError(`Blockscout log lookup failed with HTTP ${response.status}`);
  const body = await response.json() as {
    message: string;
    result: Array<{
      data: Hex;
      logIndex: Hex;
      topics: Array<Hex | null>;
      transactionHash: Hex;
      transactionIndex: Hex;
    }>;
  };
  if (body.message === "No logs found") return [];
  if (body.message !== "OK" || !Array.isArray(body.result)) {
    throw new FixtureCaptureError("Blockscout log lookup returned invalid data");
  }
  return body.result.map((log) => ({
    data: log.data,
    logIndex: Number(BigInt(log.logIndex)),
    topics: log.topics.filter((topic): topic is Hex => topic !== null),
    transactionHash: log.transactionHash,
    transactionIndex: Number(BigInt(log.transactionIndex)),
  }));
};

try {
  const cases = [];
  for (const candidate of candidates) {
    console.log(`Capturing ${candidate.id}`);
    const blockNumber = BigInt(candidate.blockNumber);
    const block = await client.getBlock({ blockNumber });
    if (!block.hash) throw new FixtureCaptureError(`Block ${candidate.blockNumber} has no hash`);
    const rawLogs = await getBlockscoutLogs(
      candidate.vaultAddress,
      candidate.blockNumber,
      candidate.blockNumber,
    );
    console.log(`  block and ${rawLogs.length} raw logs loaded`);
    const relevantLogs = rawLogs
      .filter((log) => log.topics[0] && signatureToName.has(log.topics[0].toLowerCase()))
      .sort((left, right) =>
        left.transactionIndex - right.transactionIndex || left.logIndex - right.logIndex,
      );
    const transactionCache = new Map<string, Awaited<ReturnType<typeof client.getTransaction>>>();
    const events = [];
    for (const log of relevantLogs) {
      const eventName = signatureToName.get(log.topics[0]!.toLowerCase())!;
      const decoded = decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics, strict: true });
      const transactionHash = log.transactionHash;
      let transaction = transactionCache.get(transactionHash);
      if (!transaction) {
        transaction = await client.getTransaction({ hash: transactionHash });
        transactionCache.set(transactionHash, transaction);
      }
      const serializer = eventSerializer(eventName);
      events.push({
        id: allocationEventId(1, transactionHash, log.logIndex),
        chainId: 1,
        vaultAddress: candidate.vaultAddress,
        sourceAddress: candidate.vaultAddress,
        sourceType: serializer.sourceType,
        eventName,
        signature: log.topics[0]!.toLowerCase(),
        normalizationVersion: NORMALIZATION_VERSION,
        abiVariant: serializer.abiVariant,
        blockNumber: candidate.blockNumber,
        blockTimestamp: Number(block.timestamp),
        blockHash: block.hash.toLowerCase(),
        transactionHash: transactionHash.toLowerCase(),
        transactionIndex: log.transactionIndex,
        logIndex: log.logIndex,
        topLevelTransactionFrom: transaction.from.toLowerCase(),
        topLevelTransactionTo: transaction.to?.toLowerCase() ?? null,
        topLevelInputSelector: topLevelInputSelector(transaction.input),
        strategyAddress: serializer.strategyAddress(decoded.args as Record<string, unknown>),
        argsJson: serializer.serialize(decoded.args as Record<string, unknown>),
        raw: { topics: log.topics.map((topic) => topic?.toLowerCase() ?? null), data: log.data.toLowerCase() },
      });
    }
    const observedNames = events.map(({ eventName }) => eventName);
    if (JSON.stringify(observedNames) !== JSON.stringify(candidate.expectedEventNames)) {
      throw new FixtureCaptureError(`${candidate.id} event mismatch: ${observedNames.join(",")}`);
    }
    console.log(`  ${events.length} normalized events loaded`);

    const totals = await readVaultAccountingFromArchive(
      1,
      candidate.vaultAddress,
      candidate.blockNumber,
      block.hash,
    );
    console.log("  accounting loaded");
    const lifecycleLogs = await getBlockscoutLogs(
      candidate.vaultAddress,
      candidate.strategyDiscoveryStartBlock,
      candidate.blockNumber,
      serializers.vault.StrategyChanged.signature,
    );
    const strategyAddresses = [...new Set([
      ...candidate.strategies,
      ...lifecycleLogs.flatMap((log) => log.topics[1] ? [`0x${log.topics[1].slice(-40)}` as `0x${string}`] : []),
    ])].sort();
    const strategyStates = await Promise.all(strategyAddresses.map(async (strategyAddress) => {
      const [activation, lastReport, currentDebt, maxDebt] = await client.readContract({
        address: candidate.vaultAddress,
        abi: vaultAbi,
        functionName: "strategies",
        args: [strategyAddress],
        blockNumber,
      });
      return {
        strategyAddress,
        activation: activation.toString(),
        lastReport: lastReport.toString(),
        currentDebt: currentDebt.toString(),
        maxDebt: maxDebt.toString(),
      };
    }));
    console.log(`  ${strategyStates.length} strategy states loaded`);
    const strategyDebtSum = strategyStates.reduce((sum, state) => sum + BigInt(state.currentDebt), 0n);
    if (strategyDebtSum !== totals.totalDebt) {
      throw new FixtureCaptureError(`${candidate.id} strategy debt sum does not match totalDebt`);
    }
    let outsideAllocatorTargetEvidence = candidate.outsideAllocatorTargetEvidence ?? null;
    if (outsideAllocatorTargetEvidence) {
      const strategyTopic = `0x${outsideAllocatorTargetEvidence.strategyAddress.slice(2).padStart(64, "0")}`;
      const targetLogs = (await Promise.all(outsideAllocatorTargetEvidence.eventSignatures.map((eventSignature) =>
        getBlockscoutLogs(
          outsideAllocatorTargetEvidence!.allocatorAddress,
          outsideAllocatorTargetEvidence!.fromBlock,
          outsideAllocatorTargetEvidence!.throughBlock,
          eventSignature,
          strategyTopic,
        )
      ))).flat();
      if (targetLogs.length !== outsideAllocatorTargetEvidence.matchingEventCount) {
        throw new FixtureCaptureError(`${candidate.id} allocator-target evidence changed`);
      }
      outsideAllocatorTargetEvidence = {
        ...outsideAllocatorTargetEvidence,
        matchingEventCount: targetLogs.length,
      };
    }

    cases.push({
      id: candidate.id,
      label: candidate.label,
      chainId: 1,
      vaultAddress: candidate.vaultAddress,
      blockNumber: candidate.blockNumber,
      blockHash: block.hash.toLowerCase(),
      blockTimestamp: Number(block.timestamp),
      requirements: candidate.requirements,
      events,
      accounting: {
        totalAssets: totals.totalAssets.toString(),
        totalDebt: totals.totalDebt.toString(),
        totalIdle: totals.totalIdle.toString(),
        accountingIdentityHolds: totals.totalAssets === totals.totalDebt + totals.totalIdle,
        canonicalBlockVerified: totals.canonicalBlockVerified,
      },
      strategyStates,
      strategyDebtSum: strategyDebtSum.toString(),
      strategyDebtMatchesTotalDebt: true,
      outsideAllocatorTargetEvidence,
    });
  }

  const gate2 = JSON.parse(
    readFileSync(new URL("../../fixtures/allocation/ethereum/gate2.json", import.meta.url), "utf8"),
  ) as {
    historicalReplay: Array<{
      event: string;
      srcAddress: string;
      logIndex: number;
      block: { number: number; timestamp: number; hash: string };
      transaction: {
        hash: string;
        transactionIndex: number;
        from: string;
        to: string | null;
        input: string | null;
      };
      params: Record<string, string>;
    }>;
  };
  const assignmentEvent = gate2.historicalReplay.find(({ event }) => event === "UpdateDebtAllocator");
  if (!assignmentEvent) throw new FixtureCaptureError("Gate 2 fixture lacks UpdateDebtAllocator");
  const allocatorAddress = assignmentEvent.params.debtAllocator;
  const vaultAddress = assignmentEvent.params.vault;
  if (!allocatorAddress || !vaultAddress) throw new FixtureCaptureError("Gate 2 assignment fixture is incomplete");
  const unboundEvent = gate2.historicalReplay.find((event) =>
    event.event === "NewDebtAllocator" &&
    event.params.allocator === allocatorAddress &&
    event.params.governance !== undefined
  );
  if (!unboundEvent) throw new FixtureCaptureError("Gate 2 fixture lacks assignment allocator provenance");
  const governanceAddress = unboundEvent.params.governance;
  if (!governanceAddress) throw new FixtureCaptureError("Gate 2 unbound deployment fixture is incomplete");
  const assignmentSourceEventId = allocationEventId(1, assignmentEvent.transaction.hash, assignmentEvent.logIndex);
  const unboundDeploymentId = `1:${allocatorAddress}`;
  const assignmentSerializer = serializers.roleManager.UpdateDebtAllocator;
  const unboundSerializer = serializers.debtAllocatorFactory.NewDebtAllocatorWithoutVault;

  const fixture = {
    schemaVersion: 1,
    chainId: 1,
    cases,
    assignmentChangeReference: {
      fixture: "gate2.json",
      vaultAddress: "0xbe53a109b494e5c9f97b9cd39fe969be68bf6204",
      blockNumber: 20_987_762,
      blockHash: "0xfd1d7c1bb8ebb7e6c370831640155cb98471814fd84100c4ee8eeecf11268ae3",
      sourceEventId: assignmentSourceEventId,
      allocatorAddress,
      expected: {
        sourceEvent: {
          id: assignmentSourceEventId,
          chainId: 1,
          vaultAddress,
          sourceAddress: assignmentEvent.srcAddress,
          sourceType: assignmentSerializer.sourceType,
          eventName: assignmentSerializer.eventName,
          signature: assignmentSerializer.signature,
          normalizationVersion: NORMALIZATION_VERSION,
          abiVariant: assignmentSerializer.abiVariant,
          blockNumber: assignmentEvent.block.number,
          blockTimestamp: assignmentEvent.block.timestamp,
          blockHash: assignmentEvent.block.hash,
          transactionHash: assignmentEvent.transaction.hash,
          transactionIndex: assignmentEvent.transaction.transactionIndex,
          logIndex: assignmentEvent.logIndex,
          topLevelTransactionFrom: assignmentEvent.transaction.from,
          topLevelTransactionTo: assignmentEvent.transaction.to,
          topLevelInputSelector: topLevelInputSelector(assignmentEvent.transaction.input),
          strategyAddress: null,
          argsJson: assignmentSerializer.serialize({
            vault: vaultAddress,
            debtAllocator: allocatorAddress,
          }),
        },
        assignment: {
          id: assignmentSourceEventId,
          chainId: 1,
          vaultAddress,
          allocatorAddress,
          roleManagerAddress: assignmentEvent.srcAddress,
          assignmentType: "updated",
          implementationRecognition: "other",
          blockNumber: assignmentEvent.block.number,
          blockTimestamp: String(assignmentEvent.block.timestamp),
          blockHash: assignmentEvent.block.hash,
          transactionHash: assignmentEvent.transaction.hash,
          transactionIndex: assignmentEvent.transaction.transactionIndex,
          logIndex: assignmentEvent.logIndex,
          sourceEventId: assignmentSourceEventId,
        },
        unboundDeployment: {
          id: unboundDeploymentId,
          chainId: 1,
          allocatorAddress,
          factoryAddress: unboundEvent.srcAddress,
          governanceAddress,
          implementationRecognition: "other",
          abiVariant: unboundSerializer.abiVariant,
          createdBlock: unboundEvent.block.number,
          createdTimestamp: String(unboundEvent.block.timestamp),
          createdTransactionHash: unboundEvent.transaction.hash,
          createdEventId: allocationEventId(1, unboundEvent.transaction.hash, unboundEvent.logIndex),
        },
        boundDeploymentIds: [],
        conflictIds: [],
      },
    },
  };
  writeFileSync(
    new URL("../../fixtures/allocation/ethereum/gate4-parity.json", import.meta.url),
    `${JSON.stringify(fixture, null, 2)}\n`,
  );
  console.log(`Gate 4 fixture capture: PASS (${cases.length} blocks, ${cases.flatMap(({ events }) => events).length} events)`);
} catch (error) {
  const detail = error instanceof FixtureCaptureError ? `: ${error.message}` : "";
  console.error(`Gate 4 fixture capture: FAILED (archive RPC details and URL suppressed)${detail}`);
  process.exit(1);
}
