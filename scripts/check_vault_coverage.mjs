// Detects V3 vaults that a running indexer started tracking late.
//
// Every vault created by YearnV3VaultFactory should be indexed from its
// deployment block, because `indexer.contractRegister` on
// `YearnV3VaultFactory.NewVault` registers it at that block. When that
// registration does not take effect, the factory `NewVault` row is still
// written but the vault's own events only start at whatever later event
// re-registered it (registry endorsement, role manager AddedNewVault, ...).
// The gap is silent: queries return rows, just not the earliest ones.
//
// This script compares, per vault, the factory deployment block against the
// first block for which the indexer holds any vault-sourced entity, and
// reports vaults whose first tracked block is more than --max-lag after
// deployment.
//
// Usage:
//   node scripts/check_vault_coverage.mjs \
//     [--url <graphql endpoint>] [--chain 1] [--max-lag 5000] [--json]
//
// Env: ENVIO_GRAPHQL_URL, ENVIO_PASSWORD (bearer token, optional).
// Exits 1 when at least one vault exceeds the lag threshold.

const args = process.argv.slice(2);

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}

const endpoint =
  flag("url", process.env.ENVIO_GRAPHQL_URL) ??
  "http://localhost:8080/v1/graphql";
const chainId = Number(flag("chain", "1"));
const maxLag = Number(flag("max-lag", "5000"));
const asJson = args.includes("--json");

// Entities written directly from a vault-sourced event. If a vault is tracked
// from block N, the earliest row across these is the first vault event at or
// after N.
const VAULT_ENTITIES = [
  "Transfer",
  "Deposit",
  "Withdraw",
  "RoleSet",
  "StrategyChanged",
  "StrategyReported",
  "DebtUpdated",
];

async function gql(query) {
  const headers = { "Content-Type": "application/json" };
  if (process.env.ENVIO_PASSWORD) {
    headers.Authorization = `Bearer ${process.env.ENVIO_PASSWORD}`;
  }
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(`${endpoint} responded ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  if (body.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

const deployments = (
  await gql(`{
    V3VaultFactoryNewVault(
      where: { chainId: { _eq: ${chainId} } }
      order_by: { blockNumber: asc }
    ) { vault_address blockNumber factoryAddress }
  }`)
).V3VaultFactoryNewVault;

if (deployments.length === 0) {
  console.error(`No V3VaultFactoryNewVault rows for chain ${chainId}.`);
  process.exit(1);
}

// One aliased sub-query per vault per entity, batched to keep requests sane.
const firstSeen = new Map();
const BATCH = 20;

for (let start = 0; start < deployments.length; start += BATCH) {
  const batch = deployments.slice(start, start + BATCH);
  const selections = batch.flatMap((row, offset) =>
    VAULT_ENTITIES.map(
      (entity) =>
        `v${start + offset}_${entity}: ${entity}(` +
        `where: { chainId: { _eq: ${chainId} }, ` +
        `vaultAddress: { _eq: "${row.vault_address}" } }, ` +
        `order_by: { blockNumber: asc }, limit: 1) { blockNumber }`,
    ),
  );
  const data = await gql(`{ ${selections.join("\n")} }`);
  batch.forEach((row, offset) => {
    const blocks = VAULT_ENTITIES.map(
      (entity) => data[`v${start + offset}_${entity}`]?.[0]?.blockNumber,
    ).filter((block) => typeof block === "number");
    if (blocks.length > 0) {
      firstSeen.set(row.vault_address, Math.min(...blocks));
    }
  });
}

const late = [];
let untracked = 0;

for (const row of deployments) {
  const first = firstSeen.get(row.vault_address);
  // No rows at all is normal for a vault that never saw activity, so it is
  // reported as a count rather than a failure.
  if (first === undefined) {
    untracked += 1;
    continue;
  }
  const lag = first - row.blockNumber;
  if (lag > maxLag) {
    late.push({
      vault: row.vault_address,
      factory: row.factoryAddress,
      deployedAtBlock: row.blockNumber,
      firstTrackedBlock: first,
      lagBlocks: lag,
    });
  }
}

late.sort((a, b) => b.lagBlocks - a.lagBlocks);

if (asJson) {
  console.log(
    JSON.stringify(
      { chainId, maxLag, checked: deployments.length, untracked, late },
      null,
      2,
    ),
  );
} else {
  console.log(
    `chain ${chainId}: checked ${deployments.length} factory-deployed vaults ` +
      `(${untracked} with no indexed events), max-lag ${maxLag} blocks`,
  );
  if (late.length === 0) {
    console.log("All tracked vaults are indexed from their deployment block.");
  } else {
    console.log(`\n${late.length} vault(s) tracked late:\n`);
    console.log(
      ["deployed", "firstSeen", "lag", "vault"]
        .map((h, i) => (i < 3 ? h.padStart(10) : h))
        .join("  "),
    );
    for (const row of late) {
      console.log(
        [
          String(row.deployedAtBlock).padStart(10),
          String(row.firstTrackedBlock).padStart(10),
          String(row.lagBlocks).padStart(10),
          row.vault,
        ].join("  "),
      );
    }
    console.log(
      "\nA large lag means the vault's early events were never indexed. " +
        "Confirm against an explorer, then pin the vault under the chain's " +
        "`YearnV3Vault` address list in config.yaml and resync.",
    );
  }
}

process.exit(late.length > 0 ? 1 : 0);
