import { AmplifyDataService, ModelHook, BaseModel } from "./types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "aws-amplify/auth";
import { useCallback, useEffect } from "react";
import { getClient } from "./client";
import { debugLog, debugWarn } from "./config";

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

  /**
   * Parse JSON-ish value safely.
   * - string: tries JSON.parse
   * - object/array: returns as-is
   * - otherwise: null
   */
  parseJsonDoc: <T = unknown>(value: unknown): T | null => {
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as T;
      } catch (_error) {
        return null;
      }
    }
    if (value !== null && typeof value === "object") {
      return value as T;
    }
    return null;
  },

  /**
   * Stringify JSON-ish value safely.
   * - valid JSON string: returns as-is
   * - invalid string: JSON.stringify(string)
   * - others: JSON.stringify(value ?? null)
   */
  stringifyJsonDoc: (value: unknown): string => {
    if (typeof value === "string") {
      try {
        JSON.parse(value);
        return value;
      } catch (_error) {
        return JSON.stringify(value);
      }
    }
    return JSON.stringify(value ?? null);
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
export interface RelationalHookOptions {
  initialFetchOptions?: {
    fetch?: boolean;
    filter?: Record<string, any>;
  };
  realtime?: {
    enabled?: boolean;
    observeOptions?: Record<string, any>;
    events?: Array<"create" | "update" | "delete">;
  };
}

export function createRelationalHook<
  T extends BaseModel,
  R extends BaseModel = any
>(
  service: AmplifyDataService<T>,
  relationName: string,
  queryName: string,
  idParamName = `${relationName.toLowerCase()}Id`
): (id: string, options?: RelationalHookOptions) => ModelHook<T> {
  return (id: string, options?: RelationalHookOptions) => {
    // Create query key - set dedicated cache key for specific relation ID
    const queryKey = [
      service.modelName,
      relationName,
      id, // Explicitly include relation ID in query key for cache separation
      "query",
      queryName,
      JSON.stringify({ [idParamName]: id }),
    ];

    const hookQueryClient = useQueryClient();

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

    // Realtime subscriptions (onCreate/onUpdate/onDelete → invalidate query cache)
    const realtimeEnabled = options?.realtime?.enabled === true;
    const realtimeEvents = options?.realtime?.events ?? ["create", "update", "delete"];
    // Stable string key for useEffect dependency (avoids re-subscribing on every render)
    const queryKeyStr = JSON.stringify(queryKey);

    useEffect(() => {
      if (!realtimeEnabled || !id) return;

      let client: any;
      try {
        client = getClient();
      } catch {
        return;
      }
      const model = (client.models as any)?.[service.modelName];
      if (!model) return;

      const observeOptions = {
        ...(options?.realtime?.observeOptions || {}),
      } as Record<string, any>;

      // If no explicit filter, use the relation ID filter
      if (observeOptions.filter === undefined) {
        observeOptions.filter = { [idParamName]: { eq: id } };
      }

      const stableQueryKey = JSON.parse(queryKeyStr);
      const invalidate = () => {
        hookQueryClient.invalidateQueries({
          queryKey: stableQueryKey,
          refetchType: "active",
        });
      };

      const subscriptions = [
        realtimeEvents.includes("create") && model.onCreate
          ? model.onCreate(observeOptions).subscribe({
              next: invalidate,
              error: (err: any) =>
                console.error(`🍬 ${service.modelName} relational onCreate error:`, err),
            })
          : null,
        realtimeEvents.includes("update") && model.onUpdate
          ? model.onUpdate(observeOptions).subscribe({
              next: invalidate,
              error: (err: any) =>
                console.error(`🍬 ${service.modelName} relational onUpdate error:`, err),
            })
          : null,
        realtimeEvents.includes("delete") && model.onDelete
          ? model.onDelete(observeOptions).subscribe({
              next: invalidate,
              error: (err: any) =>
                console.error(`🍬 ${service.modelName} relational onDelete error:`, err),
            })
          : null,
      ].filter(Boolean);

      return () => {
        subscriptions.forEach((sub: any) => sub?.unsubscribe?.());
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [realtimeEnabled, id, service.modelName, hookQueryClient, queryKeyStr]);

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
