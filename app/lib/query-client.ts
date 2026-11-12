import { QueryClient } from "@tanstack/react-query";

let client: QueryClient | null = null;

/** Shared across admin islands so invalidateQueries crosses island boundaries. */
export function getQueryClient() {
  if (!client) {
    client = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 5_000,
          retry: 1,
          refetchOnWindowFocus: false,
        },
      },
    });
  }
  return client;
}
