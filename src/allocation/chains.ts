export const ALLOCATION_CHAIN_IDS = [1, 8453, 747474] as const;

export const isAllocationChain = (chainId: number): boolean =>
  ALLOCATION_CHAIN_IDS.some((supported) => supported === chainId);

export const isNonzeroAddress = (address: string): boolean =>
  !/^0x0{40}$/i.test(address);
