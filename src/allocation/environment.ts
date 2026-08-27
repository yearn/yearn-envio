export type AllocationEnvironment = {
  graphqlUrl: string | undefined;
  graphqlToken: string | undefined;
  ethereumRpcUrl: string | undefined;
};

export const resolveAllocationEnvironment = (
  environment: NodeJS.ProcessEnv = process.env,
): AllocationEnvironment => ({
  graphqlUrl: environment.ENVIO_GRAPHQL_URL,
  graphqlToken: environment.ENVIO_PASSWORD,
  ethereumRpcUrl: environment.ENVIO_RPC_URL_ETHEREUM,
});
