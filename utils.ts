import { AmplifyDataService, ModelHook, BaseModel } from "./types";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUser } from "aws-amplify/auth";
import { useCallback } from "react";
import { debugLog, debugWarn } from "./config";

type MmkvLike = {
  set: (key: string, value: any) => void;
  getString: (key: string) => string | undefined;
};

function createMmkvStorage(id: string): MmkvLike {
  // Support both react-native-mmkv v3 (class MMKV) and v4 (createMMKV factory)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mmkv: any = require("react-native-mmkv");
  if (typeof mmkv.createMMKV === "function") {
    return mmkv.createMMKV({ id }) as MmkvLike;
  }
  if (typeof mmkv.MMKV === "function") {
    return new mmkv.MMKV({ id }) as MmkvLike;
  }
  throw new Error("react-native-mmkv is not available in this runtime");
}

// Create MMKV storage instance
const storage = createMmkvStorage("mmkv.amplify-query");

// Key for managing app URL
const APP_URL_KEY = "amplify_query_app_url";

/**
 * Set the base URL for the app
 * @param url Base URL for the app
 */
export function setAppUrl(url: string): void {
  storage.set(APP_URL_KEY, url);
}

/**
 * Get the base URL for the app
 * @returns Configured app URL or empty string
 */
export function getAppUrl(): string {
  return storage.getString(APP_URL_KEY) || "";
}

/**
 * Utility functions
 */
export const Utils = {
  /**
   * Get the ID of the currently logged-in user.
   */
  getUserId: async (): Promise<string> => {
    try {
      const user = await getCurrentUser();
      return user.userId;
    } catch (e) {
      console.error("Failed to get user ID:", e);
      throw new Error("Could not retrieve user authentication information.");
    }
  },

  /**
   * Timestamp formatting function
   */
  formatTimestamp: (date: Date = new Date()): string => {
    return date.toISOString();
  },

  /**
   * Extract YYYY-MM-DD format from date string
   */
  getDateString: (dateStr: string | undefined): string => {
    if (!dateStr) return "";
    return dateStr.split("T")[0];
  },

  /**
   * Utility function to remove the owner field and print a warning
   * @param data Data object to process
   * @param operation Operation being performed (create or update)
   * @returns Data object with owner field removed
   */
  removeOwnerField: <T extends Record<string, any>>(
    data: T,
    operation: "create" | "update" | "upsert"
  ): Omit<T, "owner"> => {
    const { owner, ...dataWithoutOwner } = data;
    if (owner) {
      debugWarn(
        `The owner field exists. This field is added automatically and will be excluded from the ${operation} operation.`
      );
    }
    return dataWithoutOwner;
  },
};

/**
 * Authentication related utilities
 */
export const AuthService = {
  /**
   * Get information about the currently logged-in user.
   */
  getCurrentUserInfo: async (): Promise<{
    userId: string;
    username: string;
  }> => {
    try {
      const user = await getCurrentUser();
      return {
        userId: user.userId,
        username: user.username,
      };
    } catch (e) {
      console.error("Error getting current user info:", e);
      throw new Error("Could not retrieve user authentication information.");
    }
  },
};

/**
 * Utility to create a relational query hook.
 * Creates a hook to query related items based on a specific foreign key.
 *
 * @param service Base service object
 * @param relationName Name of the relation (e.g., Daily, User)
 * @param queryName API query name (e.g., listMissionsByDaily)
 * @param idParamName ID parameter name (e.g., dailyId, userId)
 * @returns Relational query hook function
 */
export function createRelationalHook<
  T extends BaseModel,
  R extends BaseModel = any
>(
  service: AmplifyDataService<T>,
  relationName: string,
  queryName: string,
  idParamName = `${relationName.toLowerCase()}Id`
): (id: string) => ModelHook<T> {
  return (id: string) => {
    // Create query key - set dedicated cache key for specific relation ID
    const queryKey = [
      service.modelName,
      relationName,
      id, // Explicitly include relation ID in query key for cache separation
      "query",
      queryName,
      JSON.stringify({ [idParamName]: id }),
    ];

    // Get only CRUD methods from existing hook
    const baseHook = service.useHook({
      initialFetchOptions: { fetch: false },
    });

    // Execute query to fetch actual data
    const {
      data = [],
      isLoading,
      error,
      refetch,
    } = useQuery<T[], Error, T[]>({
      queryKey,
      queryFn: () => service.customList(queryName, { [idParamName]: id }),
      enabled: !!id, // Enable query only when ID exists
      // Configure caching for optimized data per relation ID
      staleTime: 1000 * 30, // Keep fresh for 30 seconds
      gcTime: 1000 * 60 * 5, // Keep in cache for 5 minutes
    });

    // Custom CRUD methods specific to the ID
    const createItem = useCallback(
      async (data: Partial<T>): Promise<T | null> => {
        try {
          // Add relation ID field
          const dataWithRelation = {
            ...data,
            [idParamName]: id,
          } as Partial<T>;

          // Auto-update cache per relation ID after creation
          const result = await service.create(dataWithRelation);

          // Force refresh list per relation ID
          await refetch();
          return result;
        } catch (error) {
          console.error(
            `🍬 ${service.modelName} relational create error:`,
            error
          );
          throw error;
        }
      },
      [service, id, refetch]
    );

    // Integrate data and loading state from useQuery, methods from baseHook
    return {
      items: data,
      isLoading,
      error,
      getItem: baseHook.getItem,
      refresh: async () => {
        debugLog(`🍬 ${service.modelName} relational refresh called`, id);
        // Always fetch from server (no cache) for refresh
        const result = await service.customList(
          queryName,
          { [idParamName]: id },
          { forceRefresh: true, throwOnError: true }
        );
        return result || [];
      },
      create: createItem, // ID-specific method
      update: baseHook.update,
      delete: baseHook.delete,
      customList: baseHook.customList,
    };
  };
}
