import { QueryClient, QueryClientConfig } from "@tanstack/react-query";
import { debugLog } from "./config";

// Default configuration values
type ConfigOptions = {
  queryClientConfig?: QueryClientConfig;
};

// Default configuration
const config: ConfigOptions = {
  queryClientConfig: {
    defaultOptions: {
      queries: {
        // Default cache settings - increased from defaults
        staleTime: 5 * 60 * 1000, // Data remains "fresh" for 5 minutes
        gcTime: 30 * 60 * 1000, // Inactive query cache kept for 30 minutes (formerly cacheTime)
        retry: 1, // Retry only once on failure
        refetchOnWindowFocus: false, // Disable refetch on window focus (important for mobile)
        refetchOnReconnect: true, // Refetch on network reconnect
      },
      mutations: {
        retry: 1, // Retry only once on failure
        onError: (error) => {
          console.error("Mutation error:", error);
        },
      },
    },
  },
};

/**
 * TanStack Query client
 */
export let queryClient = new QueryClient(config.queryClientConfig);
let internalQueryClient: QueryClient = queryClient;
let isExternalClientAttached = false;

/**
 * Get the current query client instance
 * @returns The QueryClient instance
 */
export function getQueryClient(): QueryClient {
  return queryClient;
}

/**
 * Attach an external QueryClient (e.g. app-level QueryClientProvider client).
 *
 * Why:
 * - `useHook` uses the app's QueryClient from context.
 * - Direct service calls (e.g. `AmplifyService.Model.create()`) historically updated ONLY the internal singleton client,
 *   so hook caches would not update.
 *
 * Attaching lets BOTH direct service calls and hooks operate on the same QueryClient.
 */
export function attachQueryClient(externalClient: QueryClient) {
  if (!externalClient) return;
  if (queryClient === externalClient) return;
  queryClient = externalClient;
  isExternalClientAttached = true;
  
  debugLog("🔗 External QueryClient attached to AmplifyQuery");
}

/**
 * Detach and revert to the internal QueryClient.
 * (Mostly useful for tests or advanced setups.)
 */
export function detachQueryClient() {
  if (!isExternalClientAttached) return;
  queryClient = internalQueryClient;
  isExternalClientAttached = false;
}

/**
 * AmplifyQuery configuration
 * @param options Configuration options
 */
export function configure(options: ConfigOptions = {}) {
  // Backup previous config
  const prevConfig = { ...config };

  // Apply new config
  Object.assign(config, options);

  // Recreate client if QueryClient config changed
  if (
    options.queryClientConfig &&
    JSON.stringify(options.queryClientConfig) !==
      JSON.stringify(prevConfig.queryClientConfig)
  ) {
    internalQueryClient = new QueryClient(config.queryClientConfig);
    // Only swap the exported client if we aren't bound to an external one.
    if (!isExternalClientAttached) {
      queryClient = internalQueryClient;
    }
    
    debugLog("⚙️ AmplifyQuery configuration updated");
  }
}

/**
 * Create query keys from model names
 * @param modelNames Array of model names
 * @returns Object of query keys per model
 */
export function createQueryKeys(modelNames: string[]) {
  const queryKeys: Record<string, string[]> = {};

  modelNames.forEach((modelName) => {
    queryKeys[modelName] = [modelName];
  });

  return queryKeys;
}

/**
 * Invalidate all queries for a model
 * @param modelName Model name
 */
export function invalidateModel(modelName: string) {
  queryClient.invalidateQueries({ queryKey: [modelName] });
}

/**
 * Invalidate a model item with a specific ID
 * @param modelName Model name
 * @param id Item ID
 */
export function invalidateModelItem(modelName: string, id: string) {
  // New item key
  queryClient.invalidateQueries({ queryKey: [modelName, "item", id] });
  // Backward cleanup (in case legacy keys exist)
  queryClient.removeQueries({ queryKey: [modelName, id], exact: true });
}

/**
 * Invalidate model items with a specific field value
 * @param modelName Model name
 * @param field Field name
 * @param value Field value
 */
export function invalidateModelByField(
  modelName: string,
  field: string,
  value: any
) {
  queryClient.invalidateQueries({ queryKey: [modelName, "by", field, value] });
}

/**
 * Invalidate all query caches (full app reset)
 */
export function invalidateAll() {
  queryClient.invalidateQueries();
}

/**
 * Ensure important changes are synced to server before app closes
 */
export async function ensureMutationsFlushed() {
  return queryClient.isMutating()
    ? new Promise((resolve) => {
        const unsubscribe = queryClient.getMutationCache().subscribe(() => {
          if (!queryClient.isMutating()) {
            unsubscribe();
            resolve(true);
          }
        });
      })
    : Promise.resolve(true);
}
