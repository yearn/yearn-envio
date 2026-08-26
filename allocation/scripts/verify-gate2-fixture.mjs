import { readFileSync } from "node:fs";
import { createPublicClient, http, keccak256, padHex } from "viem";
import { mainnet } from "viem/chains";

const rpcUrl = process.env.ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM;
if (!rpcUrl) {
  console.log("Gate 2 Ethereum RPC fixture verification: NOT RUN (ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM is unset)");
  process.exit(0);
}

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/ethereum/gate2.json", import.meta.url), "utf8"),
);
const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
const requiredAllocatorTopics = new Set([
  "0x28d465e4d5dcdcee5fb93eccf31e0bcf5d3f6fea174eb791749dc2b51a76f881",
  "0x7f2bbad10e91f21c5aaf78550279b42e2863496b6c7e73b661ec891b730c33fb",
  "0x465c356447ab4144076254f033e216e3ba04a16610457682ed579a7fdaebd776",
  "0x5f56bee8cffbe9a78652a74a60705edede02af10b0bbb888ca44b79a0d42ce80",
]);

const fail = (message) => {
  throw new Error(message);
};
const equal = (actual, expected, label) => {
  if (actual !== expected) fail(`${label}: expected ${expected}, received ${actual}`);
};
const lower = (value) => value.toLowerCase();

const auditBlock = await client.getBlock({ blockNumber: BigInt(fixture.auditBlock.number) });
equal(lower(auditBlock.hash), fixture.auditBlock.hash, "audit block hash");

const runtimeChecks = [
  ...fixture.inventory.factories.map(({ address, runtimeCodeHash }) => ({ address, runtimeCodeHash })),
  ...fixture.inventory.roleManagerRuntimeFamilies.flatMap((family) => [
    ...family.addresses.map((address) => ({ address, runtimeCodeHash: family.runtimeCodeHash })),
    ...(family.implementationAddress
      ? [{ address: family.implementationAddress, runtimeCodeHash: family.implementationRuntimeCodeHash }]
      : []),
  ]),
  ...fixture.inventory.allocatorRuntimeFamilies.flatMap((family) => [
    ...family.addresses.map((address) => ({ address, runtimeCodeHash: family.runtimeCodeHash })),
    { address: family.implementationAddress, runtimeCodeHash: family.implementationRuntimeCodeHash },
  ]),
];

for (const { address, runtimeCodeHash } of runtimeChecks) {
  const bytecode = await client.getBytecode({
    address,
    blockNumber: BigInt(fixture.auditBlock.number),
  });
  if (!bytecode) fail(`missing runtime bytecode for ${address}`);
  equal(keccak256(bytecode), runtimeCodeHash, `runtime code hash for ${address}`);
}

const receipts = new Map();
const retry = async (operation, attempts = 5) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 200));
    }
  }
  throw lastError;
};
const receiptFor = async (hash) => {
  if (!receipts.has(hash)) {
    receipts.set(hash, await retry(() => client.getTransactionReceipt({ hash })));
  }
  return receipts.get(hash);
};

for (const event of fixture.historicalReplay) {
  const receipt = await receiptFor(event.transaction.hash);
  equal(Number(receipt.blockNumber), event.block.number, `block number for ${event.transaction.hash}`);
  equal(lower(receipt.blockHash), event.block.hash, `block hash for ${event.transaction.hash}`);
  equal(receipt.transactionIndex, event.transaction.transactionIndex, `transaction index for ${event.transaction.hash}`);
  const log = receipt.logs.find(({ logIndex }) => logIndex === event.logIndex);
  if (!log) fail(`missing log ${event.logIndex} in ${event.transaction.hash}`);
  equal(lower(log.address), event.srcAddress, `source address for ${event.transaction.hash}:${event.logIndex}`);
  equal(lower(log.data), event.raw.data, `data for ${event.transaction.hash}:${event.logIndex}`);
  equal(
    JSON.stringify(log.topics.map(lower)),
    JSON.stringify(event.raw.topics),
    `topics for ${event.transaction.hash}:${event.logIndex}`,
  );
}

const deploymentsByBlock = Map.groupBy(fixture.vaultBoundDeployments, ([blockNumber]) => blockNumber);
for (const [blockNumber, deployments] of deploymentsByBlock) {
  for (const [expectedBlock, blockHash, transactionHash, logIndex, allocator, vault] of deployments) {
    const receipt = await receiptFor(transactionHash);
    const registration = receipt.logs.find((log) => log.logIndex === logIndex);
    if (!registration) fail(`missing NewDebtAllocator log ${transactionHash}:${logIndex}`);
    equal(Number(receipt.blockNumber), expectedBlock, `deployment block for ${allocator}`);
    equal(lower(receipt.blockHash), blockHash, `deployment block hash for ${allocator}`);
    equal(lower(registration.address), fixture.inventory.factories[1].address, `deployment factory for ${allocator}`);
    equal(lower(registration.topics[1]), padHex(allocator, { size: 32 }), `deployment allocator for ${allocator}`);
    equal(lower(registration.topics[2]), padHex(vault, { size: 32 }), `deployment vault for ${allocator}`);
    const precedingRequiredLog = receipt.logs.find((log) =>
      lower(log.address) === allocator &&
      requiredAllocatorTopics.has(lower(log.topics[0])) &&
      log.logIndex < logIndex
    );
    if (precedingRequiredLog) {
      fail(`required allocator event precedes registration for ${allocator} at block ${blockNumber}`);
    }
  }
}

console.log(
  `Gate 2 Ethereum RPC fixture verification: PASS (${runtimeChecks.length} runtimes, ${fixture.vaultBoundDeployments.length} deployments, ${fixture.historicalReplay.length} replay events)`,
);
