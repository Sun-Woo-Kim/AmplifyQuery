import { QueryClient, QueryClientConfig } from "@tanstack/react-query";
import { debugLog } from "./config";
import { createStorage, StorageLike } from "./storage";

// Default configuration values
type ConfigOptions = {
  isCachingEnabled?: boolean;
  queryClientConfig?: QueryClientConfig;
  storage?: {
    storageId?: string; // Renamed from mmkvId for platform-agnostic naming
    cacheKey?: string;
    maxAge?: number; // Maximum cache age in milliseconds
  };
};

// Default configuration
const config: ConfigOptions = {
  // Check for both Expo and generic environment variables
  isCachingEnabled:
    typeof process !== "undefined" &&
    process.env &&
    (process.env.EXPO_PUBLIC_DISABLE_STORAGE_CACHE === "true" ||
      process.env.DISABLE_STORAGE_CACHE === "true")
      ? false
      : true,
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
    storageId: "amplify-query.cache",
    cacheKey: "REACT_QUERY_OFFLINE_CACHE",
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  },
};

let storageInstance: StorageLike | null = null;

function getOrCreateStorage(id: string): StorageLike {
  if (storageInstance) return storageInstance;
  storageInstance = createStorage(id);
  return storageInstance;
}

// Function to create storage persister
function createStoragePersister() {
  // Initialize or reuse storage instance
  const storageId = config.storage?.storageId || "amplify-query.cache";
  const storage = getOrCreateStorage(storageId);

  // Check cache key
  const cacheKey = config.storage?.cacheKey || "REACT_QUERY_OFFLINE_CACHE";

  return {
    persistClient: (client: any) => {
      try {
        // Convert object to JSON string
        const clientStr = JSON.stringify(client);
        storage.set(cacheKey, clientStr);
      } catch (error) {
        console.error("Error saving cache:", error);
      }
    },
    restoreClient: () => {
      try {
        const clientStr = storage.getString(cacheKey);
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
        // Try remove() first, then delete(), then clearAll()
        if (typeof storage.remove === "function") {
          storage.remove(cacheKey);
        } else if (typeof storage.delete === "function") {
          storage.delete(cacheKey);
        } else if (typeof storage.clearAll === "function") {
          // As a last resort, clear all
          storage.clearAll();
        }
      } catch (error) {
        console.error("Error removing cache:", error);
      }
    },
  };
}

function setupPersistenceFor(client: QueryClient) {
  if (!config.isCachingEnabled) {
    debugLog("🏃‍♀️ React Query offline cache is disabled via flag.");
    return;
  }

  debugLog("🏃‍♀️ React Query offline cache is enabled with persistent storage.");

  // Create new persister if config changed
  const storagePersister = createStoragePersister();

  try {
    // Lazy-load persistQueryClient to avoid hard dependency resolution at build time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { persistQueryClient } = require("@tanstack/react-query-persist-client");

    persistQueryClient({
      queryClient: client,
      persister: storagePersister as any,
      // Additional options
      maxAge: config.storage?.maxAge || 1000 * 60 * 60 * 24 * 7, // Default 7 days
      dehydrateOptions: {
        shouldDehydrateQuery: (query: any) => {
          // Only persist successful queries to reduce hydration cancellation noise
          if (query.state?.status !== "success") return false;
          // Avoid persisting mutation-like or transient keys if needed later
          return true;
        },
      },
    });
  } catch (e) {
    console.error("Error setting up React Query persistence:", e);
  }
}

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

  // Best-effort: also enable persistence on the external client if configured.
  setupPersistenceFor(queryClient);
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
  }

  // Apply caching config
  setupPersistenceFor(queryClient);
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
