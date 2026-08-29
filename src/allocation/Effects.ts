import { S, createEffect, type EffectContext } from "envio";
import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  type Hex,
} from "viem";
import { mainnet } from "viem/chains";
import {
  readCanonicalVaultAccounting,
  errorChain,
  sanitizeArchiveRpcError,
  withTransientRpcRetry,
  type CanonicalReadDependencies,
  type VaultAccountingTotals,
} from "./checkpoints.js";
import { resolveAllocationEnvironment } from "./environment.js";

const accountingAbi = [
  {
    type: "function",
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalDebt",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalIdle",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

type AccountingFunction = "totalAssets" | "totalDebt" | "totalIdle";

const hashPinnedUnsupported = (error: unknown): boolean => {
  const message = errorChain(error)
    .map((item) => (item instanceof Error ? item.message : String(item)))
    .join(" ")
    .toLowerCase();
  return (
    message.includes("cannot unmarshal object") ||
    message.includes("expected a string") ||
    (message.includes("invalid argument") && message.includes("blockhash")) ||
    (message.includes("invalid params") && message.includes("block"))
  );
};

export const archiveRpcUrl = (
  chainId: number,
  environment: NodeJS.ProcessEnv = process.env,
): string => {
  if (chainId !== 1) throw new Error(`No allocation archive RPC configured for chain ${chainId}`);
  const url = resolveAllocationEnvironment(environment).ethereumRpcUrl;
  if (!url) throw new Error("ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM is required");
  return url;
};

const makeArchiveClient = (chainId: number) =>
  createPublicClient({
    chain: chainId === 1 ? mainnet : undefined,
    transport: http(archiveRpcUrl(chainId), {
      batch: true,
      retryCount: 0,
      timeout: 20_000,
    }),
  });

const decodeAccountingResult = (functionName: AccountingFunction, value: Hex): bigint =>
  decodeFunctionResult({ abi: accountingAbi, functionName, data: value });

const accountingTotals = (results: readonly bigint[]): VaultAccountingTotals => {
  const [totalAssets, totalDebt, totalIdle] = results;
  if (totalAssets === undefined || totalDebt === undefined || totalIdle === undefined) {
    throw new Error("Archive RPC returned an incomplete vault accounting result");
  }
  return { totalAssets, totalDebt, totalIdle };
};

export const readVaultAccountingFromArchive = async (
  chainId: number,
  vaultAddress: string,
  blockNumber: number,
  expectedBlockHash: string,
): Promise<VaultAccountingTotals & { canonicalBlockVerified: true }> => {
  try {
    return await readCanonicalVaultAccounting(
      createArchiveReadDependencies(chainId),
      vaultAddress,
      blockNumber,
      expectedBlockHash,
    );
  } catch (error) {
    throw sanitizeArchiveRpcError(error);
  }
};

export const createArchiveReadDependencies = (chainId: number): CanonicalReadDependencies => {
  const client = makeArchiveClient(chainId);
  const functions = ["totalAssets", "totalDebt", "totalIdle"] as const;
  return {
    getBlockHash: async (number) => {
      const block = await client.getBlock({ blockNumber: BigInt(number), includeTransactions: false });
      if (!block.hash) throw new Error(`Block ${number} has no canonical hash`);
      return block.hash;
    },
    readHashPinned: async (address, blockHash) => {
      const results = await Promise.all(
        functions.map(async (functionName) => {
          const data = encodeFunctionData({ abi: accountingAbi, functionName });
          const result = await client.request({
            method: "eth_call",
            params: [{ to: address, data }, { blockHash, requireCanonical: true }],
          } as never);
          return decodeAccountingResult(functionName, result as Hex);
        }),
      );
      return accountingTotals(results);
    },
    readAtBlockNumber: async (address, number) => {
      const results = await Promise.all(
        functions.map((functionName) =>
          client.readContract({
            address: address as `0x${string}`,
            abi: accountingAbi,
            functionName,
            blockNumber: BigInt(number),
          }),
        ),
      );
      return accountingTotals(results);
    },
    isHashPinnedUnsupportedError: hashPinnedUnsupported,
  };
};

export const executeVaultAccountingRead = async (
  context: Pick<EffectContext, "cache" | "chain">,
  input: { vaultAddress: string; blockNumber: number; expectedBlockHash: string },
  read = readVaultAccountingFromArchive,
): Promise<VaultAccountingTotals & { canonicalBlockVerified: true }> => {
  try {
    return await withTransientRpcRetry(() =>
      read(context.chain.id, input.vaultAddress, input.blockNumber, input.expectedBlockHash),
    );
  } catch (error) {
    context.cache = false;
    throw error;
  }
};

export const vaultAccountingAtBlock = createEffect(
  {
    name: "vaultAccountingAtBlock",
    input: {
      vaultAddress: S.string,
      blockNumber: S.int32,
      expectedBlockHash: S.string,
    },
    output: {
      totalAssets: S.bigint,
      totalDebt: S.bigint,
      totalIdle: S.bigint,
      canonicalBlockVerified: S.boolean,
    },
    cache: true,
    crossChain: false,
    rateLimit: false,
  },
  ({ input, context }) => executeVaultAccountingRead(context, input),
);
