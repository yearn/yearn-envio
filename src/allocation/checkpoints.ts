import { ContractFunctionRevertedError, HttpRequestError, TimeoutError } from "viem";

export type CheckpointTrigger = {
  id: string;
  transactionIndex: number;
  logIndex: number;
};

export type VaultAccountingTotals = {
  totalAssets: bigint;
  totalDebt: bigint;
  totalIdle: bigint;
};

export class CanonicalBlockMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`Canonical block hash mismatch: expected ${expected.toLowerCase()}, received ${actual.toLowerCase()}`);
    this.name = "CanonicalBlockMismatchError";
  }
}

export class UnsupportedHistoricalStateError extends Error {
  constructor(message = "Archive RPC does not support the requested historical state") {
    super(message);
    this.name = "UnsupportedHistoricalStateError";
  }
}

export class TransientArchiveRpcError extends Error {
  constructor() {
    super("Transient archive RPC request failed");
    this.name = "TransientArchiveRpcError";
  }
}

export const checkpointId = (chainId: number, vaultAddress: string, blockNumber: number): string =>
  `${chainId}:${vaultAddress.toLowerCase()}:${blockNumber}`;

export const parseCheckpointTriggers = (value: string | undefined): CheckpointTrigger[] => {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("Invalid checkpoint trigger set");
  return parsed as CheckpointTrigger[];
};

export const mergeCheckpointTriggers = (
  existing: CheckpointTrigger[],
  incoming: CheckpointTrigger,
): CheckpointTrigger[] => {
  const byId = new Map(existing.map((trigger) => [trigger.id, trigger]));
  byId.set(incoming.id, incoming);
  return [...byId.values()].sort(
    (left, right) =>
      left.transactionIndex - right.transactionIndex ||
      left.logIndex - right.logIndex ||
      left.id.localeCompare(right.id),
  );
};

export const checkpointSourceEventIds = (triggers: CheckpointTrigger[]): string[] =>
  triggers.map(({ id }) => id);

export const errorChain = (error: unknown): unknown[] => {
  const errors: unknown[] = [];
  let current = error;
  while (current && !errors.includes(current)) {
    errors.push(current);
    current = typeof current === "object" && "cause" in current ? current.cause : undefined;
  }
  return errors;
};

const errorMessage = (error: unknown): string =>
  errorChain(error)
    .map((item) => (item instanceof Error ? item.message : String(item)))
    .join(" ")
    .toLowerCase();

export const isUnsupportedHistoricalState = (error: unknown): boolean => {
  const message = errorMessage(error);
  return (
    message.includes("missing trie node") ||
    message.includes("historical state") ||
    message.includes("state is not available") ||
    message.includes("pruned")
  );
};

export const isTransientRpcError = (error: unknown): boolean => {
  if (error instanceof TransientArchiveRpcError) return true;
  if (errorChain(error).some((item) => item instanceof ContractFunctionRevertedError)) return false;
  if (error instanceof CanonicalBlockMismatchError || isUnsupportedHistoricalState(error)) return false;
  if (errorChain(error).some((item) => item instanceof HttpRequestError || item instanceof TimeoutError)) return true;
  const message = errorMessage(error);
  return (
    /\b(408|425|429|500|502|503|504)\b/.test(message) ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("network") ||
    message.includes("connection reset") ||
    message.includes("socket hang up") ||
    message.includes("rate limit") ||
    message.includes("rps limit") ||
    message.includes("exceeds defined limit") ||
    message.includes("too many requests")
  );
};

export const sanitizeArchiveRpcError = (error: unknown): Error => {
  if (error instanceof CanonicalBlockMismatchError) return error;
  if (errorChain(error).some((item) => item instanceof ContractFunctionRevertedError)) {
    return new Error("Archive RPC contract read reverted");
  }
  if (isUnsupportedHistoricalState(error)) return new UnsupportedHistoricalStateError();
  if (isTransientRpcError(error)) return new TransientArchiveRpcError();
  return new Error(`Archive RPC request failed: ${redactedErrorDetail(error)}`);
};

export const redactedErrorDetail = (error: unknown): string =>
  errorMessage(error)
    .replace(/https?:\/\/\S+/g, "<rpc-url>")
    .slice(0, 500);

export type ArchiveRpcFailureReason =
  | "archiveRpcRequestFailed"
  | "canonicalBlockMismatch"
  | "contractReadReverted"
  | "historicalStateUnavailable"
  | "transientRetryExhausted";

export const archiveRpcFailureReason = (error: unknown): ArchiveRpcFailureReason => {
  const sanitized = sanitizeArchiveRpcError(error);
  if (sanitized instanceof CanonicalBlockMismatchError) return "canonicalBlockMismatch";
  if (sanitized instanceof UnsupportedHistoricalStateError) return "historicalStateUnavailable";
  if (sanitized instanceof TransientArchiveRpcError) return "transientRetryExhausted";
  if (sanitized.message === "Archive RPC contract read reverted") return "contractReadReverted";
  return "archiveRpcRequestFailed";
};

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export const withTransientRpcRetry = async <T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> => {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 2_000;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (isUnsupportedHistoricalState(error)) {
        throw new UnsupportedHistoricalStateError(errorMessage(error));
      }
      if (attempt >= attempts || !isTransientRpcError(error)) throw error;
      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await sleep(Math.floor(random() * ceiling));
    }
  }
};

export type CanonicalReadDependencies = {
  getBlockHash: (blockNumber: number) => Promise<string>;
  readHashPinned: (vaultAddress: string, blockHash: string) => Promise<VaultAccountingTotals>;
  readAtBlockNumber: (vaultAddress: string, blockNumber: number) => Promise<VaultAccountingTotals>;
  isHashPinnedUnsupportedError: (error: unknown) => boolean;
};

export const readCanonicalVaultAccounting = async (
  dependencies: CanonicalReadDependencies,
  vaultAddress: string,
  blockNumber: number,
  expectedBlockHash: string,
): Promise<VaultAccountingTotals & { canonicalBlockVerified: true }> => {
  const expected = expectedBlockHash.toLowerCase();
  const before = (await dependencies.getBlockHash(blockNumber)).toLowerCase();
  if (before !== expected) throw new CanonicalBlockMismatchError(expected, before);

  try {
    const totals = await dependencies.readHashPinned(vaultAddress, expected);
    return { ...totals, canonicalBlockVerified: true };
  } catch (error) {
    if (!dependencies.isHashPinnedUnsupportedError(error)) throw error;
  }

  const totals = await dependencies.readAtBlockNumber(vaultAddress, blockNumber);
  const after = (await dependencies.getBlockHash(blockNumber)).toLowerCase();
  if (after !== expected) throw new CanonicalBlockMismatchError(expected, after);
  return { ...totals, canonicalBlockVerified: true };
};

export const accountingIdentityHolds = ({ totalAssets, totalDebt, totalIdle }: VaultAccountingTotals): boolean =>
  totalAssets === totalDebt + totalIdle;
