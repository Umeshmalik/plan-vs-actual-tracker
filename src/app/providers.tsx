"use client";

/**
 * providers.tsx — the client boundary.
 *
 * TanStack Query owns MUTATIONS only. Reads stay in React Server Components,
 * straight from the domain layer: that is one hop instead of two, needs no
 * client cache to go stale, and keeps the "client is not the source of truth"
 * rule the assignment sets. After a mutation succeeds we call router.refresh()
 * and the server tree re-renders with the new numbers.
 */
import { useState } from "react";
import { QueryClient, QueryClientProvider, environmentManager } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: {
        // The API is not idempotent across the board (POST /api/actuals appends),
        // so a blind retry could double-post. Retries are opted into per call.
        retry: false,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  // On the server every request gets its own client so two users can never
  // share cache; in the browser one client survives re-renders.
  if (environmentManager.isServer()) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(getQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
