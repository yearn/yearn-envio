import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  createArchiveReadDependencies,
  readVaultAccountingFromArchive,
} from "../../src/allocation/Effects.js";
import {
  CanonicalBlockMismatchError,
  accountingIdentityHolds,
  readCanonicalVaultAccounting,
} from "../../src/allocation/checkpoints.js";

const rpcUrl = process.env.ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM;
if (!rpcUrl) {
  console.log("Gate 3 checkpoint RPC verification: NOT RUN (ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM is unset)");
  process.exit(0);
}

const fixture = JSON.parse(
  readFileSync(new URL("../../fixtures/allocation/ethereum/gate3-checkpoints.json", import.meta.url), "utf8"),
) as {
  chainId: number;
  cases: Array<{
    vaultAddress: string;
    blockNumber: number;
    blockHash: string;
    expected: {
      totalAssets: string;
      totalDebt: string;
      totalIdle: string;
      accountingIdentityHolds: boolean;
    };
  }>;
};

try {
  for (const checkpoint of fixture.cases) {
    const expected = {
      totalAssets: BigInt(checkpoint.expected.totalAssets),
      totalDebt: BigInt(checkpoint.expected.totalDebt),
      totalIdle: BigInt(checkpoint.expected.totalIdle),
    };
    const pinned = await readVaultAccountingFromArchive(
      fixture.chainId,
      checkpoint.vaultAddress,
      checkpoint.blockNumber,
      checkpoint.blockHash,
    );
    assert.deepEqual(pinned, { ...expected, canonicalBlockVerified: true });
    assert.equal(accountingIdentityHolds(pinned), checkpoint.expected.accountingIdentityHolds);

    const liveDependencies = createArchiveReadDependencies(fixture.chainId);
    const fallback = await readCanonicalVaultAccounting(
      {
        ...liveDependencies,
        readHashPinned: async () => {
          throw new Error("invalid argument blockHash object unsupported");
        },
        isHashPinnedUnsupportedError: () => true,
      },
      checkpoint.vaultAddress,
      checkpoint.blockNumber,
      checkpoint.blockHash,
    );
    assert.deepEqual(fallback, { ...expected, canonicalBlockVerified: true });

    await assert.rejects(
      readCanonicalVaultAccounting(
        liveDependencies,
        checkpoint.vaultAddress,
        checkpoint.blockNumber,
        `0x${"0".repeat(64)}`,
      ),
      CanonicalBlockMismatchError,
    );
  }
  console.log(
    `Gate 3 checkpoint RPC verification: PASS (${fixture.cases.length} fixed checkpoints, EIP-1898 + fallback + mismatch)`,
  );
} catch {
  console.error("Gate 3 checkpoint RPC verification: FAILED (archive RPC details and URL suppressed)");
  process.exit(1);
}
