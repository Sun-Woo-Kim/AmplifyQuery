import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryClient } from "./query";

interface AmplifyQueryProviderProps {
  children: React.ReactNode;
}

/**
 * TanStack Query Provider for AmplifyQuery
 *
 * This component provides the QueryClient to the entire application.
 * Use this at the root of your application to enable React Query.
 *
 * @example
 * ```tsx
 * import { AmplifyQueryProvider } from 'amplifyquery/provider';
 *
 * function App() {
 *   return (
 *     <AmplifyQueryProvider>
 *       <YourApp />
 *     </AmplifyQueryProvider>
 *   );
 * }
 * ```
 */
export function AmplifyQueryProvider({
  children,
}: AmplifyQueryProviderProps): React.ReactElement {
  // Get the shared query client instance
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

/**
 * Creates a custom QueryClient provider with configuration options
 *
 * @param customQueryClient Optional custom QueryClient instance
 * @returns A provider component with the custom client
 *
 * @example
 * ```tsx
 * import { createCustomQueryProvider } from 'amplifyquery/provider';
 * import { QueryClient } from '@tanstack/react-query';
 *
 * // Create a custom client with specific options
 * const customClient = new QueryClient({
 *   defaultOptions: {
 *     queries: {
 *       staleTime: 1000 * 60 * 5,
 *     },
 *   },
 * });
 *
 * // Create a provider with this client
 * const CustomProvider = createCustomQueryProvider(customClient);
 *
 * function App() {
 *   return (
 *     <CustomProvider>
 *       <YourApp />
 *     </CustomProvider>
 *   );
 * }
 * ```
 */
export function createCustomQueryProvider(customQueryClient?: QueryClient) {
  return ({ children }: AmplifyQueryProviderProps): React.ReactElement => {
    // Use custom client or get the default one
    const client = customQueryClient || getQueryClient();

    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}
