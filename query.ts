import { MMKV } from "react-native-mmkv";
import { QueryClient, QueryClientConfig } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";

// Default configuration values
type ConfigOptions = {
  isCachingEnabled?: boolean;
  queryClientConfig?: QueryClientConfig;
  storage?: {
    mmkvId?: string;
    cacheKey?: string;
    maxAge?: number; // Maximum cache age in milliseconds
  };
};

// Default configuration
const config: ConfigOptions = {
  isCachingEnabled: process.env.EXPO_PUBLIC_DISABLE_STORAGE_CACHE !== "true",
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
  storage: {
    mmkvId: "mmkv.amplify-query.cache",
    cacheKey: "REACT_QUERY_OFFLINE_CACHE",
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  },
};

// MMKV instance
let storageInstance: MMKV; // Renamed from 'storage' to avoid conflict with ConfigOptions.storage

// Function to create MMKV persister
function createMmkvPersister() {
  // Initialize or reuse MMKV instance
  if (!storageInstance) {
    storageInstance = new MMKV({
      id: config.storage?.mmkvId || "mmkv.amplify-query.cache",
    });
  }

  // Check cache key
  const cacheKey = config.storage?.cacheKey || "REACT_QUERY_OFFLINE_CACHE";

  return {
    persistClient: (client: any) => {
      try {
        // Convert object to JSON string
        const clientStr = JSON.stringify(client);
        storageInstance.set(cacheKey, clientStr);
      } catch (error) {
        console.error("Error saving cache:", error);
      }
    },
    restoreClient: () => {
      try {
        const clientStr = storageInstance.getString(cacheKey);
        if (!clientStr) return null;

        // Convert string back to object
        return JSON.parse(clientStr);
      } catch (error) {
        console.error("Error restoring cache:", error);
        return null;
      }
    },
    removeClient: () => {
      try {
        storageInstance.delete(cacheKey);
      } catch (error) {
        console.error("Error removing cache:", error);
      }
    },
  };
}

/**
 * TanStack Query client
 */
export let queryClient = new QueryClient(config.queryClientConfig);

/**
 * Get the current query client instance
 * @returns The QueryClient instance
 */
export function getQueryClient(): QueryClient {
  return queryClient;
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
    queryClient = new QueryClient(config.queryClientConfig);
  }

  // Apply caching config
  if (config.isCachingEnabled) {
    console.log("🏃‍♀️ React Query offline cache is enabled with MMKV.");

    // Create new persister if config changed
    const mmkvPersister = createMmkvPersister();

    persistQueryClient({
      queryClient,
      persister: mmkvPersister as any,
      // Additional options
      maxAge: config.storage?.maxAge || 1000 * 60 * 60 * 24 * 7, // Default 7 days
      dehydrateOptions: {
        shouldDehydrateQuery: (query: any) => {
          // Filter for queries not to cache (implement if needed)
          return true;
        },
      },
    });
  } else {
    console.log("🏃‍♀️ React Query offline cache is disabled via flag.");
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
  queryClient.invalidateQueries({ queryKey: [modelName, id] });
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
