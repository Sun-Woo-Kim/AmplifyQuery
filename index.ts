import { setClient, getClient } from "./client";
import {
  configure as configureQuery,
  queryClient,
  getQueryClient,
  createQueryKeys,
  invalidateModel,
  invalidateModelItem,
  invalidateModelByField,
  invalidateAll,
  ensureMutationsFlushed,
} from "./query";
import { createAmplifyService } from "./service";
import { createSingletonService, getModelIds } from "./singleton";
import { AmplifyDataService, AmplifyQueryConfig, BaseModel } from "./types";
import {
  AuthService as AuthServiceUtil,
  StorageService as StorageServiceUtil,
  Utils as UtilsHelper,
  createRelationalHook,
  setAppUrl,
  getAppUrl,
} from "./utils";
import {
  setModelOwnerQueryMap,
  setDefaultAuthMode,
  getModelOwnerQueryMap,
  getDefaultAuthMode,
  resetConfig,
  setSingletonAutoCreate,
} from "./config";

/**
 * Initialization function for the AmplifyQuery library.
 *
 * This function must be called before using the library.
 *
 * @example
 * ```typescript
 * import { generateClient } from 'aws-amplify/api';
 * import { AmplifyQuery } from 'amplifyquery';
 *
 * // Create Amplify client and initialize AmplifyQuery
 * const client = generateClient();
 * AmplifyQuery.configure({
 *   client,
 *   // Additional caching options, etc.
 *   isCachingEnabled: true,
 *   storage: {
 *     mmkvId: "custom.cache",
 *     maxAge: 1000 * 60 * 60 * 24 // 1 day
 *   }
 * });
 * ```
 */
export function configure(config: AmplifyQueryConfig): void {
  // Configure Amplify client
  if (config.client) {
    setClient(config.client);
  }

  // Set global model owner query mapping
  if (config.modelOwnerQueryMap) {
    setModelOwnerQueryMap(config.modelOwnerQueryMap);
  }

  // Set default auth mode
  if (config.defaultAuthMode) {
    setDefaultAuthMode(config.defaultAuthMode);
  }

  // Set singleton auto-create
  if (config.singletonAutoCreate) {
    setSingletonAutoCreate(config.singletonAutoCreate);
  }

  // Apply React Query settings
  configureQuery({
    isCachingEnabled: config.isCachingEnabled,
    queryClientConfig: config.queryClientConfig,
    storage: config.storage,
  });

  console.log("🔌 AmplifyQuery initialized successfully.");
}

// Re-export types
export * from "./types";

// Export query client
export {
  queryClient,
  getQueryClient,
  invalidateModel,
  invalidateModelItem,
  invalidateModelByField,
  invalidateAll,
  ensureMutationsFlushed,
  createQueryKeys,
};

// Export client functions
export { getClient };

// Export provider
export * from "./provider";

// Re-export utility services
export const Utils = UtilsHelper;
export const Storage = StorageServiceUtil;
export const Auth = AuthServiceUtil;
export { setAppUrl, getAppUrl };

/**
 * Main object for the AmplifyQuery library.
 */
export const AmplifyQuery = {
  configure,
  createQueryKeys,
  createAmplifyService,
  createSingletonService,
  createRelationalHook,
  Utils: UtilsHelper,
  Storage: StorageServiceUtil,
  Auth: AuthServiceUtil,
  getModelIds,
  getQueryClient,
  // Global configuration functions
  setModelOwnerQueryMap,
  getModelOwnerQueryMap,
  setDefaultAuthMode,
  getDefaultAuthMode,
  resetConfig,
};
