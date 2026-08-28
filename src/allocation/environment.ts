export type AllocationEnvironment = {
  graphqlUrl: string | undefined;
  ethereumRpcUrl: string | undefined;
};

export const resolveAllocationEnvironment = (
  environment: NodeJS.ProcessEnv = process.env,
): AllocationEnvironment => ({
  graphqlUrl: environment.ENVIO_GRAPHQL_URL,
  ethereumRpcUrl: environment.ENVIO_ALLOCATION_ARCHIVE_RPC_URL_ETHEREUM,
});
