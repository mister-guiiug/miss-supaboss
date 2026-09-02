import { QueryClient } from '@tanstack/react-query';

function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
    },
  });
}

let client: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  client ??= createAppQueryClient();
  return client;
}
