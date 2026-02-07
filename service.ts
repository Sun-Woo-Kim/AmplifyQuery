import { getClient } from "./client";
import {
  getOwnerQueryName,
  getDefaultAuthMode,
  debugLog,
  debugWarn,
  isDebugEnabled,
} from "./config";
import { queryClient, attachQueryClient } from "./query";
import {
  AmplifyDataService,
  AuthMode,
  AuthOptions,
  BaseModel,
  ItemHook,
  ModelHook,
} from "./types";
import { Utils } from "./utils";
import {
  useQuery,
  useMutation,
  useQueryClient,
  UseQueryOptions,
  QueryFunctionContext,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
import { getCurrentUser } from "aws-amplify/auth";
import { randomUUID } from "./uuid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// -------------------------------
// Query key helpers
// -------------------------------
function itemKey(modelName: string, id: string): QueryKey {
  return [modelName, "item", id];
}

function isItemKeyForModel(modelName: string, key: QueryKey): boolean {
  return Array.isArray(key) && key[0] === modelName && key[1] === "item";
}

function signatureForModelItem(item: any): string {
  const id = typeof item?.id === "string" ? item.id : "";
  const updatedAt = typeof item?.updatedAt === "string" ? item.updatedAt : "";
  const createdAt = typeof item?.createdAt === "string" ? item.createdAt : "";
  // Some list/customList queries may not include `updatedAt` depending on the selection set.
  // If we only compare by (id, updatedAt|createdAt), we can incorrectly treat real updates
  // (e.g. status changes) as "no-op" and skip cache updates.
  //
  // Use a cheap "version-ish" marker when available, otherwise include a shallow signature.
  const versionMarker =
    typeof item?._lastChangedAt === "number"
      ? String(item._lastChangedAt)
      : typeof item?._version === "number"
        ? String(item._version)
        : typeof item?.version === "number"
          ? String(item.version)
          : "";

  const shallowSig = (() => {
    if (!item || typeof item !== "object") return "";
    const keys = Object.keys(item).sort();
    const parts: string[] = [];
    for (const key of keys) {
      if (key === "__typename") continue;
      const v = (item as any)[key];
      if (v === null || v === undefined) {
        parts.push(`${key}=null`);
        continue;
      }
      const t = typeof v;
      if (t === "string" || t === "number" || t === "boolean") {
        parts.push(`${key}=${String(v)}`);
        continue;
      }
      if (Array.isArray(v)) {
        parts.push(`${key}=[${v.length}]`);
        continue;
      }
      // Object (nested) - avoid deep/large stringify, just mark presence
      parts.push(`${key}={}`);
    }
    // Keep it bounded to avoid huge signatures
    return parts.join("|").slice(0, 500);
  })();

  return `${id}::${updatedAt || ""}::${createdAt || ""}::${versionMarker}::${shallowSig}`;
}

function areItemArraysEquivalentById(a: any[], b: any[]): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const mapA = new Map<string, string>();
  for (const item of a) {
    const sig = signatureForModelItem(item);
    const [id, ts] = sig.split("::");
    if (!id) continue;
    mapA.set(id, ts || "");
  }
  for (const item of b) {
    const sig = signatureForModelItem(item);
    const [id, ts] = sig.split("::");
    if (!id) return false;
    if (mapA.get(id) !== (ts || "")) return false;
  }
  return true;
}

/**
 * Utility function to get owner value based on authentication mode
 * Sets owner value only in userPool auth mode, returns empty string for other auth modes
 *
 * @param authMode Current authentication mode
 * @returns Owner value and API call parameters based on auth mode
 */
async function getOwnerByAuthMode(authMode: AuthMode): Promise<{
  owner: string;
  authModeParams: { authMode: AuthMode };
}> {
  let owner = "";

  // Set owner value only in userPool auth mode
  if (authMode === "userPool") {
    try {
      const { username, userId } = await getCurrentUser();
      // Keep behavior consistent with old-AmplifyQuery:
      // owner = `${userId}::${username}`
      owner = `${userId}::${username}`;
      debugLog(`🍬 Auth identity resolved`, { authMode, username, userId, owner });
    } catch (error) {
      console.error("Error getting user authentication info:", error);
      // Continue even if error occurs (API call will fail)
    }
  }

  // Return with auth mode parameters
  return {
    owner,
    authModeParams: { authMode },
  };
}

/**
 * Find all related query keys
 * @param modelName Model name
 * @param queryClient TanStack QueryClient instance
 * @returns Array of related query keys (readonly unknown[] type)
 */
function findRelatedQueryKeys(
  modelName: string,
  queryClient: QueryClient
): QueryKey[] {
  // Extract only query keys from Query objects array
  return queryClient
    .getQueryCache()
    .findAll({
      predicate: (query: { queryKey: QueryKey }) => {
        const { queryKey } = query;
        // Find all query keys for the model, but EXCLUDE single-item keys
        // Examples kept: [model], [model, 'filter', ...], [model, 'query', ...], [model, Relation, id, ...]
        // Excluded: [model, 'item', id]
        return (
          Array.isArray(queryKey) &&
          queryKey[0] === modelName &&
          !isItemKeyForModel(modelName, queryKey) &&
          // Also exclude internal singleton key(s) like ["User", "currentId"]
          queryKey[1] !== "currentId"
        );
      },
    })
    .map((query: { queryKey: QueryKey }) => query.queryKey);
}

/**
 * Helper function to handle optimistic updates and cache updates for a single item
 * @param queryClient TanStack QueryClient instance
 * @param modelName Model name
 * @param relatedQueryKeys Array of related query keys to update
 * @param itemId ID of item to update
 * @param updateData Data to use for optimistic update (includes id)
 * @returns Previous cache data (for rollback) - using QueryKey as key
 */
async function performOptimisticUpdate<T extends BaseModel>(
  queryClient: QueryClient,
  modelName: string,
  relatedQueryKeys: QueryKey[],
  itemId: string,
  updateData: Partial<T> & { id: string }
): Promise<Map<QueryKey, any>> {
  const previousDataMap = new Map<QueryKey, any>();

  // 🔧 버그 수정: updateData의 ID와 요청한 ID가 일치하는지 검증
  const updateDataId = updateData?.id;
  if (
    !updateDataId ||
    typeof updateDataId !== "string" ||
    updateDataId !== itemId
  ) {
    console.warn(
      `🍬 ${modelName} performOptimisticUpdate: ID mismatch! Expected: ${itemId}, UpdateData ID: ${updateDataId}. Skipping optimistic update.`
    );
    return previousDataMap; // 빈 맵 반환으로 rollback 시 영향 없음
  }

  // 1. Update individual item cache
  const singleItemQueryKey: QueryKey = itemKey(modelName, itemId);
  const previousItemSingle = queryClient.getQueryData<T>(singleItemQueryKey);
  previousDataMap.set(singleItemQueryKey, previousItemSingle);

  // Merge with existing data if available, otherwise use updateData as optimistic data
  const optimisticData = previousItemSingle
    ? ({ ...previousItemSingle, ...updateData } as T)
    : (updateData as T); // updateData includes at least id here

  queryClient.setQueryData<T>(singleItemQueryKey, optimisticData);

  // 2. Update list queries
  relatedQueryKeys.forEach((queryKey) => {
    // Skip single-item keys (handled above)
    if (isItemKeyForModel(modelName, queryKey)) {
      return;
    }

    const previousItems = queryClient.getQueryData(queryKey);
    previousDataMap.set(queryKey, previousItems); // Backup previous data

    queryClient.setQueryData(queryKey, (oldData: any) => {
      // Safely handle if oldData is null, undefined or not an array
      const oldItems = Array.isArray(oldData) ? oldData : [];

      const hasItem = oldItems.some(
        (item: any) => item && (item as any).id === itemId
      );

      if (hasItem) {
        // Update if existing item found
        return oldItems.map((item: any) =>
          item && (item as any).id === itemId
            ? { ...item, ...updateData } // Apply optimistic update data
            : item
        );
      }

      // Only add created item to top-level list queries (e.g. [modelName])
      if (optimisticData && queryKey.length === 1) {
        return [...oldItems, optimisticData];
      }
      return oldItems; // No changes
    });
  });

  return previousDataMap;
}

/**
 * Handle cache updates after API call success
 * @param queryClient TanStack QueryClient instance
 * @param modelName Model name
 * @param relatedQueryKeys Array of related query keys to update
 * @param itemId ID of updated item
 * @param updatedItem Latest item data from API response
 */
function handleCacheUpdateOnSuccess<T extends BaseModel>(
  queryClient: QueryClient,
  modelName: string,
  relatedQueryKeys: QueryKey[],
  itemId: string,
  updatedItem: T
) {
  // 1. Update individual item cache
  const actualItemId = (updatedItem as any)?.id;
  // 🔧 버그 수정: 실제 아이템 ID와 요청한 ID가 일치하는지 검증
  if (
    actualItemId &&
    typeof actualItemId === "string" &&
    actualItemId === itemId
  ) {
    queryClient.setQueryData<T>(itemKey(modelName, itemId), updatedItem);
  } else {
    console.warn(
      `🍬 ${modelName} handleCacheUpdateOnSuccess: ID mismatch! Expected: ${itemId}, Actual: ${actualItemId}. Skipping cache update.`
    );
    return; // ID가 일치하지 않으면 캐시 업데이트 중단
  }

  // 2. Update list query cache (with relational filtering applied)
  relatedQueryKeys.forEach((queryKey) => {
    // Check if relational query - e.g. ["Mission", "Daily", "daily-id", ...]
    const isRelationalQuery =
      queryKey.length > 3 &&
      typeof queryKey[1] === "string" &&
      typeof queryKey[2] === "string";

    // Check if relational query - e.g. ["Mission", "Daily", "daily-id", ...]
    if (isRelationalQuery) {
      const relationName = queryKey[1] as string; // "Daily", "User" 등
      const relationId = queryKey[2] as string; // 실제 관계 ID
      const relationField = `${relationName.toLowerCase()}Id`; // "dailyId", "userId" 등

      // Check if updated item belongs to this relation ID
      const belongsToRelation =
        (updatedItem as any)[relationField] === relationId;

      if (!belongsToRelation) {
        // Skip cache update if item does not belong to this relation ID
        return;
      }
    }

    // Update query cache
    queryClient.setQueryData(queryKey, (oldData: any) => {
      const oldItems = Array.isArray(oldData) ? oldData : [];
      const hasItem = oldItems.some(
        (item: any) => item && (item as any).id === itemId
      );

      if (hasItem) {
        // Update if existing item found
        return oldItems.map((item: any) =>
          item && (item as any).id === itemId ? updatedItem : item
        );
      } else {
        // Add if successfully created (already filtered in relational queries)
        return [...oldItems, updatedItem];
      }
    });
  });
}

/**
 * Rollback cache on error
 * @param queryClient TanStack QueryClient instance
 * @param previousDataMap Map containing previous cache data
 */
function rollbackCache(
  queryClient: QueryClient,
  previousDataMap: Map<QueryKey, any>
) {
  previousDataMap.forEach((previousData, queryKey) => {
    queryClient.setQueryData(queryKey, previousData);
  });
}

function isOwnerNotInSchemaError(err: unknown): boolean {
  const msg =
    typeof (err as any)?.message === "string"
      ? (err as any).message
      : String(err);

  // Typical GraphQL validation/input errors mention the field and that it isn't defined.
  return (
    /owner/i.test(msg) &&
    /(not defined|does not exist|unknown|not a valid|not allowed|defined for input)/i.test(
      msg
    )
  );
}

/**
 * Create model-specific Amplify service
 * @param modelName Model name
 * @param defaultAuthMode Default authentication mode (optional, uses global config if not provided)
 * @returns AmplifyDataService instance for the model
 */
export function createAmplifyService<T extends BaseModel>(
  modelName: string,
  defaultAuthMode?: AuthMode
): AmplifyDataService<T> {
  // Track current authentication mode state - use global config if not provided
  let currentAuthMode: AuthMode = defaultAuthMode || getDefaultAuthMode();

  // Create service object
  const service: AmplifyDataService<T> = {
    // Add model name (needed for singleton services)
    modelName,

    // Set authentication mode method
    setAuthMode: (authMode: AuthMode): void => {
      currentAuthMode = authMode;
      debugLog(`🔐 ${modelName} service auth mode changed: ${authMode}`);
    },

    // Get current authentication mode
    getAuthMode: (): AuthMode => {
      return currentAuthMode;
    },

    // Set authentication mode chaining method
    withAuthMode: (authMode: AuthMode): AmplifyDataService<T> => {
      const clonedService = { ...service };
      clonedService.setAuthMode(authMode);
      return clonedService;
    },

    // Create item
    create: async (
      data: Partial<T>,
      options?: AuthOptions
    ): Promise<T | null> => {
      try {
        if (!data) {
          console.error(`🍬 ${modelName} creation error: data is null`);
          return null;
        }

        // Determine auth mode (use provided option if available)
        const authMode = options?.authMode || currentAuthMode;

        // Get parameters based on auth mode
        const { authModeParams } = await getOwnerByAuthMode(authMode);

        const dataWithoutOwner = Utils.removeOwnerField(data as any, "create");
        const cleanedData: Record<string, any> = {};
        Object.entries(dataWithoutOwner).forEach(([key, value]) => {
          if (value !== undefined) {
            cleanedData[key] = value;
          }
        });

        const newItem = {
          ...cleanedData,
          id: cleanedData.id || randomUUID(),
        } as T;

        // Extract relation fields (e.g., dailyId, userId)
        const relationFields = new Map<string, string>();
        for (const [key, value] of Object.entries(newItem as any)) {
          if (key.endsWith("Id") && typeof value === "string" && value) {
            // Relation field name and its value
            relationFields.set(key, value as string);
          }
        }

        // Find related query keys (all keys starting with model name)
        const relatedQueryKeys = findRelatedQueryKeys(modelName, queryClient);

        // Backup previous data for optimistic update
        const previousDataMap = new Map<QueryKey, any>();

        // Update individual item cache
        const singleItemQueryKey: QueryKey = itemKey(modelName, newItem.id);
        const previousItemSingle =
          queryClient.getQueryData<T>(singleItemQueryKey);
        previousDataMap.set(singleItemQueryKey, previousItemSingle);
        queryClient.setQueryData<T>(singleItemQueryKey, newItem);

        // Update list queries (with relation filtering)
        relatedQueryKeys.forEach((queryKey) => {
          // Check if it's a relational query (e.g., ["Mission", "Daily", "daily-id", ...])
          const isRelationalQuery =
            queryKey.length > 3 &&
            typeof queryKey[1] === "string" &&
            typeof queryKey[2] === "string";

          if (isRelationalQuery) {
            // For relational queries, only add to cache if it belongs to the relation
            const relationName = queryKey[1] as string; // "Daily", "User" etc.
            const relationId = queryKey[2] as string; // Actual relation ID value
            const relationField = `${relationName.toLowerCase()}Id`; // "dailyId", "userId" etc.

            // Check if new item belongs to this relation ID
            const belongsToRelation =
              (newItem as any)[relationField] === relationId;

            if (belongsToRelation) {
              // Only update cache if it belongs to this relation
              const data = queryClient.getQueryData(queryKey);
              if (data) {
                previousDataMap.set(queryKey, data);
              }

              queryClient.setQueryData(queryKey, (oldData: any) => {
                const oldItems = Array.isArray(oldData) ? oldData : [];
                return [...oldItems, newItem];
              });
            }
          } else if (queryKey.length < 3 && queryKey[1] !== "currentId") {
            // Regular list query (old-AmplifyQuery behavior: update all short list keys)
            // - [Model]
            // - [Model, ...] (length 2)
            // But avoid internal singleton keys like ["User","currentId"].
            const data = queryClient.getQueryData(queryKey);
            if (data) {
              previousDataMap.set(queryKey, data);
            }

            queryClient.setQueryData(queryKey, (oldData: any) => {
              const oldItems = Array.isArray(oldData) ? oldData : [];
              return [...oldItems, newItem];
            });
          }
        });

        try {
          // Attempt API call - apply auth mode
          debugLog(
            `🍬 ${modelName} creation attempt [Auth: ${authMode}]:`,
            newItem.id
          );

          // Some Amplify clients return `{ data, errors }` without throwing on errors.
          // If `data` is null/undefined, treat it as a failure and rollback.
          const res = await (getClient().models as any)[modelName].create(
            newItem,
            authModeParams
          );
          const createdItem = (res as any)?.data;
          const errors = (res as any)?.errors;

          if (createdItem) {
            // Update cache on API success
            queryClient.setQueryData<T>(singleItemQueryKey, createdItem);

            // Invalidate queries based on relation fields
            for (const [field, value] of relationFields) {
              // Extract relation name from field name (e.g., "dailyId" -> "Daily")
              const relationName = field
                .replace(/Id$/, "")
                .replace(/^./, (c) => c.toUpperCase());

              // Invalidate queries for this relation
              queryClient.invalidateQueries({
                queryKey: [modelName, relationName, value],
                refetchType: "active",
              });
            }

            // Invalidate all related queries
            queryClient.invalidateQueries({
              queryKey: [modelName],
              refetchType: "active",
            });

            debugLog(`🍬 ${modelName} creation successful:`, newItem.id);
            return createdItem;
          }

          // No data returned -> treat as error (don't silently keep optimistic item)
          console.error(
            `🍬 ${modelName} creation failed: empty response`,
            errors ? { errors } : undefined
          );
          rollbackCache(queryClient, previousDataMap);
          throw new Error(
            `🍬 ${modelName} create returned no data${errors ? " (has errors)" : ""}`
          );
        } catch (apiError) {
          // Rollback and log error on API failure
          console.error(
            `🍬 ${modelName} creation error, performing rollback:`,
            apiError
          );
          rollbackCache(queryClient, previousDataMap);
          // Re-throw error for caller to handle
          throw apiError;
        }
      } catch (error) {
        console.error(`🍬 ${modelName} final creation error:`, error);
        return null;
      }
    },

    // Batch create items
    createList: async (
      dataList: Partial<T>[],
      options?: AuthOptions
    ): Promise<(T | null)[]> => {
      try {
        if (!dataList || dataList.length === 0) {
          return [];
        }

        // Determine auth mode (use provided option if available)
        const authMode = options?.authMode || currentAuthMode;

        // Get parameters based on auth mode
        const { authModeParams } = await getOwnerByAuthMode(authMode);

        const preparedItems: T[] = dataList
          .map((data) => {
            if (!data) return null;
            const dataWithoutOwner = Utils.removeOwnerField(
              data as any,
              "create"
            );
            const cleanedData: Record<string, any> = {};
            Object.entries(dataWithoutOwner).forEach(([key, value]) => {
              if (value !== undefined) {
                cleanedData[key] = value;
              }
            });

            return {
              ...cleanedData,
              id: cleanedData.id || randomUUID(),
            } as T;
          })
          .filter(Boolean) as T[];

        const relatedQueryKeys = findRelatedQueryKeys(modelName, queryClient);
        const previousDataMap = new Map<QueryKey, any>();

        // Extract relation properties (e.g., dailyId)
        const relationFields = new Map<string, string>();
        for (const item of preparedItems) {
          for (const [key, value] of Object.entries(item as any)) {
            if (key.endsWith("Id") && typeof value === "string" && value) {
              // Relation field name and its value
              relationFields.set(key, value as string);
            }
          }
        }

        debugLog(
          `🍬 ${modelName} batch creation attempt: ${preparedItems.length} items`
        );

        // Batch optimistic update - with relation filtering
        relatedQueryKeys.forEach((queryKey) => {
          // Check if this query key is a relational query (e.g., ["Mission", "Daily", "daily-id", ...])
          const isRelationalQuery =
            queryKey.length > 3 &&
            typeof queryKey[1] === "string" &&
            typeof queryKey[2] === "string";

          const previousItems = queryClient.getQueryData(queryKey);
          previousDataMap.set(queryKey, previousItems); // Backup previous data

          if (isRelationalQuery) {
            // For relational queries, only add items that belong to the relation
            const relationName = queryKey[1] as string; // "Daily", "User" etc.
            const relationId = queryKey[2] as string; // Actual relation ID value
            const relationField = `${relationName.toLowerCase()}Id`; // "dailyId", "userId" etc.

            queryClient.setQueryData(queryKey, (oldData: any) => {
              const oldItems = Array.isArray(oldData) ? oldData : [];

              // Filter new items that belong to this relation ID
              const itemsToAdd = preparedItems.filter(
                (newItem: any) => newItem[relationField] === relationId
              );

              // Merge existing items with filtered new items
              if (itemsToAdd.length > 0) {
                return [...oldItems, ...itemsToAdd];
              }

              return oldItems; // No change if no items match relation ID
            });
          } else if (queryKey.length < 3 && queryKey[1] !== "currentId") {
            // Regular list query - add all items (old-AmplifyQuery behavior)
            // Avoid internal singleton keys like ["User","currentId"].
            queryClient.setQueryData(queryKey, (oldData: any) => {
              const oldItems = Array.isArray(oldData) ? oldData : [];
              return [...oldItems, ...preparedItems];
            });
          }
        });

        // Update individual item caches
        preparedItems.forEach((item) => {
          const singleItemQueryKey: QueryKey = itemKey(modelName, item.id);
          const previousItemSingle =
            queryClient.getQueryData<T>(singleItemQueryKey);
          previousDataMap.set(singleItemQueryKey, previousItemSingle);
          queryClient.setQueryData(singleItemQueryKey, item);
        });

        try {
          // Parallel API calls - apply auth mode
          const createPromises = preparedItems.map(async (newItem) => {
            try {
              const res = await (getClient().models as any)[modelName].create(
                newItem,
                authModeParams
              );
              const createdItem = (res as any)?.data;
              const errors = (res as any)?.errors;

              // Update individual item cache on API success
              if (createdItem) {
                const itemId = (createdItem as any)?.id;
                // 🔧 버그 수정: ID가 유효한 경우에만 개별 캐시에 저장
                if (itemId && typeof itemId === "string") {
                  queryClient.setQueryData<T>(
                    itemKey(modelName, itemId),
                    createdItem
                  );
                } else {
                  console.warn(
                    `🍬 ${modelName} createList: Invalid createdItem ID found, skipping cache update:`,
                    itemId,
                    createdItem
                  );
                }
              }
              if (!createdItem) {
                // Treat empty data as failure (Amplify can return { data: null, errors } without throwing)
                if (errors?.length) {
                  console.error(
                    `🍬 ${modelName} createList: create returned no data (has errors)`,
                    { errors }
                  );
                } else {
                  console.error(
                    `🍬 ${modelName} createList: create returned no data`
                  );
                }
                return null;
              }
              return createdItem;
            } catch (error) {
              console.error(
                `🍬 ${modelName} batch creation failed for ID ${newItem.id}:`,
                error
              );
              return null;
            }
          });

          const results = await Promise.all(createPromises);
          debugLog(
            `🍬 ${modelName} batch creation completed: ${results.length} items`
          );

          // After creation, invalidate all related queries to ensure exact server data
          // This is important as it prevents side effects of optimistic updates by invalidating related queries
          for (const [field, value] of relationFields) {
            // Extract relation name from field name (e.g., "dailyId" -> "Daily")
            const relationName = field
              .replace(/Id$/, "")
              .replace(/^./, (c) => c.toUpperCase());

            // Invalidate query for this relation
            queryClient.invalidateQueries({
              queryKey: [modelName, relationName, value],
              refetchType: "active",
            });

            // Also invalidate general queries
            queryClient.invalidateQueries({
              queryKey: [modelName],
              refetchType: "active",
            });
          }

          return results;
        } catch (apiError) {
          console.error(
            `🍬 ${modelName} batch creation API error, performing rollback:`,
            apiError
          );
          rollbackCache(queryClient, previousDataMap);
          throw apiError;
        }
      } catch (error) {
        console.error(`🍬 ${modelName} final batch creation error:`, error);
        return [];
      }
    },

    // Get item
    get: async (
      id: string,
      options = { forceRefresh: false }
    ): Promise<T | null> => {
      try {
        const singleItemQueryKey: QueryKey = itemKey(modelName, id);

        // Check cache first (if forceRefresh is false)
        if (!options.forceRefresh) {
          const cachedItem = queryClient.getQueryData<T>(singleItemQueryKey);
          if (cachedItem) {
            // 🔧 버그 수정: 캐시된 아이템의 실제 ID가 요청한 ID와 일치하는지 검증
            const itemId = (cachedItem as any)?.id;
            if (itemId === id) {
              return cachedItem;
            } else {
              // ID가 일치하지 않으면 캐시에서 제거하고 API 호출
              console.warn(
                `🍬 ${modelName} get: Cache ID mismatch! Requested: ${id}, Cached: ${itemId}. Removing invalid cache and fetching from API.`
              );
              queryClient.removeQueries({ queryKey: singleItemQueryKey });
            }
          }
        }

        // Determine auth mode (use provided option if available)
        const authMode = options?.authMode || currentAuthMode;

        // Get parameters based on auth mode
        const { authModeParams } = await getOwnerByAuthMode(authMode);

        // API call - apply auth mode
        const res = await (getClient().models as any)[modelName].get(
          { id },
          authModeParams
        );
        const apiResponse = (res as any)?.data;
        const errors = (res as any)?.errors;
        if (!apiResponse && errors?.length) {
          throw new Error(
            `🍬 ${modelName} get returned no data (has errors)`
          );
        }

        // Handle case where API returns array instead of single item
        let item = apiResponse;
        if (Array.isArray(apiResponse)) {
          console.warn(
            `🍬 ${modelName} get: API returned array instead of single item. Taking first item.`
          );
          item =
            apiResponse.find((i: any) => i?.id === id) ||
            apiResponse[0] ||
            null;
        }

        // Update cache
        if (item) {
          const itemId = (item as any)?.id;
          // 🔧 버그 수정: API 응답 아이템의 ID가 요청한 ID와 일치하는지 검증
          if (itemId && typeof itemId === "string" && itemId === id) {
            queryClient.setQueryData(singleItemQueryKey, item);

            // Update related list queries (lists that might contain this item)
            const relatedQueryKeys = findRelatedQueryKeys(
              modelName,
              queryClient
            );
            relatedQueryKeys.forEach((queryKey) => {
              // Exclude single item keys, only process list queries
              if (queryKey.length > 1 && queryKey[1] !== id) {
                // Query keys with id as second element are not single item get query key format, so treat as list
                queryClient.setQueryData(queryKey, (oldData: any) => {
                  const oldItems = Array.isArray(oldData) ? oldData : [];
                  const exists = oldItems.some(
                    (oldItem: any) => oldItem && oldItem.id === id
                  );
                  if (exists) {
                    return oldItems.map((oldItem: any) =>
                      oldItem && oldItem.id === id ? item : oldItem
                    );
                  } else {
                    // Need to check if item matches list query filter conditions (not checking here)
                    // If checking is difficult, invalidateQueries might be safer
                    // Currently implemented to add item to all related lists that might contain it on API get success
                    return [...oldItems, item];
                  }
                });
              }
            });
          } else {
            console.warn(
              `🍬 ${modelName} get: API response ID mismatch! Requested: ${id}, API Response ID: ${itemId}. Skipping cache update.`
            );
          }
        }

        return item || null;
      } catch (error) {
        console.error(`🍬 ${modelName} get error:`, error);
        return null;
      }
    },

    // Batch get items
    list: async (
      options = { filter: undefined, forceRefresh: false, throwOnError: false }
    ): Promise<T[]> => {
      try {
        // Determine query key
        const queryKey: QueryKey = options.filter
          ? [modelName, "filter", JSON.stringify(options.filter)]
          : [modelName];

        // Check cache first (if forceRefresh is false)
        if (!options.forceRefresh) {
          const cachedItems = queryClient.getQueryData<T[]>(queryKey);
          const queryState = queryClient.getQueryState(queryKey);
          if (
            cachedItems &&
            cachedItems.length > 0 &&
            !queryState?.isInvalidated
          ) {
            debugLog(`🍬 ${modelName} list using cache`, queryKey);
            return cachedItems.filter((item: any) => item !== null);
          }
        }

        // Determine auth mode (use provided option if available)
        const authMode = options?.authMode || currentAuthMode;

        // Get owner and parameters based on auth mode
        const { owner, authModeParams } = await getOwnerByAuthMode(authMode);

        // Get owner-based query name from global config
        const ownerQueryName = getOwnerQueryName(modelName);

        // Try query call
        try {
          debugLog(
            `🍬 ${modelName} list API call`,
            queryKey,
            `by ${ownerQueryName}`,
            `[Auth: ${authMode}]`
          );

          if (isDebugEnabled()) {
            const client = getClient();
            debugLog(`🍬 Debug - client.models exists:`, !!client.models);
            debugLog(
              `🍬 Debug - client.models[${modelName}] exists:`,
              !!client.models[modelName]
            );
            debugLog(
              `🍬 Debug - client.models[${modelName}][${ownerQueryName}] exists:`,
              !!(client.models as any)[modelName]?.[ownerQueryName]
            );
            debugLog(
              `🍬 Debug - Available methods for ${modelName}:`,
              Object.keys((client.models as any)[modelName] || {})
            );
          }

          // Execute owner query (old-AmplifyQuery behavior)
          const res = await (getClient().models as any)[modelName][
            ownerQueryName
          ]({ owner, authMode }, authModeParams);
          const result = (res as any)?.data;
          const errors = (res as any)?.errors;
          if (!result && errors?.length) {
            throw new Error(
              `🍬 ${modelName} ${ownerQueryName} returned no data (has errors)`
            );
          }

          // Extract result data + filter null values
          const items = (result?.items || result?.data || result || []).filter(
            (item: any) => item !== null
          );

          // Apply filter (if client-side filtering needed)
          let filteredItems = items;
          if (options.filter) {
            filteredItems = items.filter((item: T) => {
              return Object.entries(options.filter!).every(([key, value]) => {
                if (typeof value === "object" && value !== null) {
                  // Ensure type safety when accessing item with key
                  const itemValue = (item as Record<string, any>)[key];
                  if ("eq" in value) return itemValue === (value as any).eq;
                  if ("ne" in value) return itemValue !== (value as any).ne;
                  if ("gt" in value) return itemValue > (value as any).gt;
                  if ("lt" in value) return itemValue < (value as any).lt;
                  if ("contains" in value)
                    return String(itemValue).includes((value as any).contains);
                  if (
                    "between" in value &&
                    Array.isArray((value as any).between)
                  )
                    return (
                      itemValue >= (value as any).between[0] &&
                      itemValue <= (value as any).between[1]
                    );
                }
                // Ensure type safety when accessing item with key
                return (item as Record<string, any>)[key] === value;
              });
            });
          }

          // Update cache
          queryClient.setQueryData(queryKey, filteredItems);

          // Update individual item cache
          filteredItems.forEach((item: T) => {
            const itemId = (item as any)?.id;
            // 🔧 버그 수정: ID가 유효한 경우에만 개별 캐시에 저장
            if (itemId && typeof itemId === "string") {
              queryClient.setQueryData(itemKey(modelName, itemId), item);
            } else {
              console.warn(
                `🍬 ${modelName} list: Invalid item ID found, skipping cache update:`,
                itemId,
                item
              );
            }
          });

          return filteredItems;
        } catch (error) {
          // Check if the error is because the owner query doesn't exist
          if (
            (error as any)?.message?.includes("not found") ||
            (error as any)?.message?.includes("is not a function") ||
            (error as any)?.message?.includes("is undefined")
          ) {
            console.warn(
              `🍬 ${ownerQueryName} query not found. Trying default list query...`
            );
            // Try default list query if owner query not found
            const res = await (getClient().models as any)[modelName].list(
              {},
              authModeParams
            );
            const result = (res as any)?.data;
            const errors = (res as any)?.errors;
            if (!result && errors?.length) {
              throw new Error(
                `🍬 ${modelName} list fallback returned no data (has errors)`
              );
            }

            // Extract and process result data
            const items = (
              result?.items ||
              result?.data ||
              result ||
              []
            ).filter((item: any) => item !== null);

            // Filter, cache update etc. remaining logic same
            let filteredItems = items;
            if (options.filter) {
              // Filtering logic (same as before)
              filteredItems = items.filter((item: T) => {
                return Object.entries(options.filter!).every(([key, value]) => {
                  if (typeof value === "object" && value !== null) {
                    // Ensure type safety when accessing item with key
                    const itemValue = (item as Record<string, any>)[key];
                    if ("eq" in value) return itemValue === (value as any).eq;
                    if ("ne" in value) return itemValue !== (value as any).ne;
                    if ("gt" in value) return itemValue > (value as any).gt;
                    if ("lt" in value) return itemValue < (value as any).lt;
                    if ("contains" in value)
                      return String(itemValue).includes(
                        (value as any).contains
                      );
                    if (
                      "between" in value &&
                      Array.isArray((value as any).between)
                    )
                      return (
                        itemValue >= (value as any).between[0] &&
                        itemValue <= (value as any).between[1]
                      );
                  }
                  // Ensure type safety when accessing item with key
                  return (item as Record<string, any>)[key] === value;
                });
              });
            }

            queryClient.setQueryData(queryKey, filteredItems);
            filteredItems.forEach((item: T) => {
              const itemId = (item as any)?.id;
              // 🔧 버그 수정: ID가 유효한 경우에만 개별 캐시에 저장
              if (itemId && typeof itemId === "string") {
                queryClient.setQueryData(itemKey(modelName, itemId), item);
              } else {
                console.warn(
                  `🍬 ${modelName} list fallback: Invalid item ID found, skipping cache update:`,
                  itemId,
                  item
                );
              }
            });

            return filteredItems;
          }
          throw error; // Pass other errors to upper catch
        }
      } catch (error) {
        debugLog("🍬 error", error);
        console.error(`🍬 ${modelName} list error:`, error);
        // Invalidate list query cache on error
        const queryKey: QueryKey = [
          modelName,
          "filter",
          JSON.stringify(options.filter),
        ];
        queryClient.invalidateQueries({ queryKey });
        if (options?.throwOnError) throw error;
        return [];
      }
    },

    // Update item (modified to use helper functions)
    update: async (
      data: Partial<T> & { id: string },
      options?: AuthOptions
    ): Promise<T | null> => {
      try {
        if (!data?.id) {
          console.error(
            `🍬 ${modelName} update error: No valid data or id provided.`
          );
          return null;
        }

        // Determine auth mode (use provided option if available)
        const authMode = options?.authMode || currentAuthMode;

        // Get parameters based on auth mode
        const { authModeParams } = await getOwnerByAuthMode(authMode);

        const dataWithoutOwner = Utils.removeOwnerField(data as any, "update");
        const cleanedData: Record<string, any> = {};
        // Always include id, and only include other fields that are actually passed (not undefined)
        Object.entries(dataWithoutOwner).forEach(([key, value]) => {
          if (key === "id" || value !== undefined) {
            cleanedData[key] = value;
          }
        });

        const { id: itemId } = cleanedData; // Get id from cleanedData

        // Find related query keys
        const relatedQueryKeys = findRelatedQueryKeys(modelName, queryClient);

        // Perform optimistic update
        const previousDataMap = await performOptimisticUpdate(
          queryClient,
          modelName,
          relatedQueryKeys,
          itemId,
          cleanedData as Partial<T> & { id: string }
        );

        try {
          // Attempt API call - apply auth mode
          debugLog(
            `🍬 ${modelName} update attempt [Auth: ${authMode}]:`,
            itemId
          );
          const res = await (getClient().models as any)[modelName].update(
            cleanedData,
            authModeParams
          );
          const updatedItem = (res as any)?.data;
          const errors = (res as any)?.errors;

          if (updatedItem) {
            // Update cache on API success
            handleCacheUpdateOnSuccess(
              queryClient,
              modelName,
              relatedQueryKeys,
              itemId,
              updatedItem
            );

            // Invalidate all related queries to automatically fetch new data
            queryClient.invalidateQueries({
              queryKey: [modelName],
              refetchType: "active",
            });

            debugLog(`🍬 ${modelName} update success:`, itemId);
            return updatedItem;
          }
          // No data returned -> treat as error and rollback
          console.error(
            `🍬 ${modelName} update failed: empty response`,
            errors ? { errors } : undefined
          );
          rollbackCache(queryClient, previousDataMap);
          throw new Error(
            `🍬 ${modelName} update returned no data${errors ? " (has errors)" : ""}`
          );
        } catch (apiError) {
          // Rollback and log error on API failure
          console.error(
            `🍬 ${modelName} update error, performing rollback:`,
            apiError
          );
          rollbackCache(queryClient, previousDataMap);
          throw apiError;
        }
      } catch (error) {
        console.error(`🍬 ${modelName} final update error:`, error);
        return null;
      }
    },

    // Delete item (modified to use helper functions)
    delete: async (id: string, options?: AuthOptions): Promise<boolean> => {
      try {
        if (!id) {
          console.error(`🍬 ${modelName} delete error: No valid id provided.`);
          return false;
        }

        // Determine auth mode (use provided option if available)
        const authMode = options?.authMode || currentAuthMode;

        // Get parameters based on auth mode
        const { authModeParams } = await getOwnerByAuthMode(authMode);

        // Find related query keys
        const relatedQueryKeys = findRelatedQueryKeys(modelName, queryClient);

        // Backup item data before deletion (for rollback)
        const previousDataMap = new Map<QueryKey, any>();

        // Backup previous data and perform optimistic update for individual item (set to null)
        const singleItemQueryKey: QueryKey = itemKey(modelName, id);
        const previousItemSingle =
          queryClient.getQueryData<T>(singleItemQueryKey);
        previousDataMap.set(singleItemQueryKey, previousItemSingle);
        queryClient.setQueryData(singleItemQueryKey, null);

        // Backup and perform optimistic update for list queries (remove item)
        relatedQueryKeys.forEach((queryKey) => {
          if (isItemKeyForModel(modelName, queryKey)) {
            return;
          }
          const data = queryClient.getQueryData(queryKey);
          if (data) {
            previousDataMap.set(queryKey, data);
          }
          queryClient.setQueryData(queryKey, (oldData: any) => {
            const oldItems = Array.isArray(oldData) ? oldData : [];
            return oldItems.filter((item: any) => (item as any)?.id !== id);
          });
        });

        try {
          // API call - apply auth mode
          debugLog(
            `🍬 ${modelName} delete attempt [Auth: ${authMode}]:`,
            id
          );
          const res = await (getClient().models as any)[modelName].delete(
            { id },
            authModeParams
          );
          const errors = (res as any)?.errors;
          // Delete can return no data on success; only treat explicit errors as failure.
          if (errors?.length) {
            throw new Error(
              `🍬 ${modelName} delete returned errors without throwing`
            );
          }
          debugLog(`🍬 ${modelName} delete success:`, id);

          // On API success, invalidate all related queries to automatically refresh
          relatedQueryKeys.forEach((queryKey) =>
            queryClient.invalidateQueries({
              queryKey,
              refetchType: "active",
            })
          );
          queryClient.invalidateQueries({
            queryKey: itemKey(modelName, id),
            refetchType: "active",
          });

          return true;
        } catch (error) {
          // Rollback on API error
          console.error(
            `🍬 ${modelName} delete API error, performing rollback:`,
            error
          );
          rollbackCache(queryClient, previousDataMap);
          throw error;
        }
      } catch (error) {
        console.error(`🍬 ${modelName} final delete error:`, error);
        return false;
      }
    },

    // Batch delete multiple items (consider applying helper functions)
    deleteList: async (
      ids: string[],
      options?: AuthOptions
    ): Promise<{ success: string[]; failed: string[] }> => {
      try {
        const results = {
          success: [] as string[],
          failed: [] as string[],
        };

        if (!ids || ids.length === 0) {
          console.warn(
            `🍬 ${modelName} batch delete: Empty ID array provided.`
          );
          return results;
        }

        // Determine auth mode (use provided option if available)
        const authMode = options?.authMode || currentAuthMode;

        // Get parameters based on auth mode
        const { authModeParams } = await getOwnerByAuthMode(authMode);

        // Prepare related query keys and previous data map
        const relatedQueryKeys = findRelatedQueryKeys(modelName, queryClient);
        const previousDataMap = new Map<QueryKey, any>();
        const previousItemsCache = new Map<string, T | null>(); // For individual item rollback

        // Optimistic update - remove items from all caches
        ids.forEach((id) => {
          // Backup previous data and perform optimistic update for individual item (null)
          const singleItemQueryKey: QueryKey = itemKey(modelName, id);
          const previousItemSingle =
            queryClient.getQueryData<T>(singleItemQueryKey);
          previousItemsCache.set(id, previousItemSingle || null);
          previousDataMap.set(singleItemQueryKey, previousItemSingle); // Backup to map
          queryClient.setQueryData(singleItemQueryKey, null);
        });

        // Update all list query caches (remove items included in id list)
        relatedQueryKeys.forEach((queryKey) => {
          if (isItemKeyForModel(modelName, queryKey)) {
            return;
          }
          const data = queryClient.getQueryData(queryKey);
          if (data) {
            previousDataMap.set(queryKey, data);
          }
          queryClient.setQueryData(queryKey, (oldData: any) => {
            const oldItems = Array.isArray(oldData) ? oldData : [];
            return oldItems.filter(
              (item: any) => item && !ids.includes((item as any).id)
            );
          });
        });

        try {
          debugLog(
            `🍬 ${modelName} batch delete attempt [Auth: ${authMode}]: ${ids.length} items`
          );
          // Parallel API calls - apply auth mode
          const deletePromises = ids.map(async (id) => {
            try {
              const res = await (getClient().models as any)[modelName].delete(
                { id },
                authModeParams
              );
              const errors = (res as any)?.errors;
              if (errors?.length) {
                throw new Error(
                  `🍬 ${modelName} delete returned errors without throwing`
                );
              }
              results.success.push(id);
              return { id, success: true };
            } catch (error) {
              console.error(
                `🍬 ${modelName} batch delete failed for ID ${id}:`,
                error
              );
              results.failed.push(id);
              return { id, success: false, error };
            }
          });

          await Promise.all(deletePromises);

          // If there are failed items, rollback only those items
          if (results.failed.length > 0) {
            console.warn(
              `🍬 ${modelName} batch delete: ${results.failed.length} items failed, performing partial rollback`
            );

            for (const failedId of results.failed) {
              // Rollback individual item
              const previousItem = previousItemsCache.get(failedId);
              if (previousItem !== undefined) {
                // Restore if not undefined (was in cache)
                const singleItemQueryKey: QueryKey = itemKey(
                  modelName,
                  failedId
                );
                queryClient.setQueryData(singleItemQueryKey, previousItem);
              }

              // Restore failed item to list queries
              relatedQueryKeys.forEach((queryKey) => {
                if (
                  queryKey.length > 1 &&
                  !ids.includes(queryKey[1] as string)
                ) {
                  // Restore failed item to list queries
                  queryClient.setQueryData(queryKey, (oldData: any) => {
                    const oldItems = Array.isArray(oldData) ? oldData : [];
                    const previousItem = previousItemsCache.get(failedId);
                    if (!previousItem) return oldItems;

                    // Do not add duplicate item if already in list
                    if (
                      oldItems.some((item: any) => item && item.id === failedId)
                    ) {
                      return oldItems;
                    }
                    return [...oldItems, previousItem];
                  });
                }
              });
            }
          }

          // Invalidate all related queries to force refresh (safety mechanism)
          relatedQueryKeys.forEach((queryKey) =>
            queryClient.invalidateQueries({ queryKey })
          );
          ids.forEach((id) =>
            queryClient.invalidateQueries({ queryKey: itemKey(modelName, id) })
          );

          debugLog(
            `🍬 ${modelName} batch delete: ${results.success.length} items deleted, ${results.failed.length} items failed`
          );
          return results;
        } catch (generalError) {
          // General error occurred, performing full rollback
          console.error(
            `🍬 ${modelName} batch delete: General error occurred, performing full rollback:`,
            generalError
          );
          rollbackCache(queryClient, previousDataMap);
          // Invalidate all queries when a broad error occurs
          queryClient.invalidateQueries({ queryKey: [modelName] });
          results.failed = [...ids]; // Mark all IDs as failed
          throw generalError; // Re-throw the error
        }
      } catch (error) {
        console.error(`🍬 ${modelName} final batch delete error:`, error);
        return { success: [], failed: ids }; // Return all IDs as failed
      }
    },

    // Create or update (modified to use helper functions)
    upsert: async (
      data: Partial<T> & { id: string },
      options?: AuthOptions
    ): Promise<T | null> => {
      try {
        if (!data?.id) {
          console.error(
            `🍬 ${modelName} upsert error: No valid data or id provided.`
          );
          return null;
        }

        // Determine auth mode (use provided options if available)
        const authMode = options?.authMode || currentAuthMode;

        // Get parameters based on auth mode
        const { authModeParams } = await getOwnerByAuthMode(authMode);

        // Check existing item in cache (without API call)
        // Call get first to ensure latest state. service.get checks cache and calls API if needed.
        const existingItem = await service.get(data.id);

        const dataWithoutOwner = Utils.removeOwnerField(data as any, "upsert");
        const cleanedData: Record<string, any> = {};
        Object.entries(dataWithoutOwner).forEach(([key, value]) => {
          if (key === "id" || value !== undefined) {
            cleanedData[key] = value;
          }
        });
        cleanedData.id = data.id; // Preserve ID

        // Find related query keys
        const relatedQueryKeys = findRelatedQueryKeys(modelName, queryClient);

        // Perform optimistic update
        const previousDataMap = await performOptimisticUpdate(
          queryClient,
          modelName,
          relatedQueryKeys,
          data.id,
          cleanedData as Partial<T> & { id: string }
        );

        try {
          if (existingItem) {
            // Use update logic if item exists - apply auth mode
            debugLog(
              `🍬 ${modelName} upsert(update) attempt [Auth: ${authMode}]:`,
              data.id
            );
            const res = await (getClient().models as any)[modelName].update(
              cleanedData,
              authModeParams
            );
            const updatedItem = (res as any)?.data;
            const errors = (res as any)?.errors;
            if (updatedItem) {
              handleCacheUpdateOnSuccess(
                queryClient,
                modelName,
                relatedQueryKeys,
                data.id,
                updatedItem
              );
              debugLog(`🍬 ${modelName} upsert(update) success:`, data.id);
              return updatedItem;
            }
            // No data -> treat as error and rollback
            console.error(
              `🍬 ${modelName} upsert(update) failed: empty response`,
              errors ? { errors } : undefined
            );
            rollbackCache(queryClient, previousDataMap);
            throw new Error(
              `🍬 ${modelName} upsert(update) returned no data${errors ? " (has errors)" : ""}`
            );
          } else {
            // Use create logic if item doesn't exist - apply auth mode
            debugLog(
              `🍬 ${modelName} upsert(create) attempt [Auth: ${authMode}]:`,
              data.id
            );
            const res = await (getClient().models as any)[modelName].create(
              cleanedData,
              authModeParams
            );
            const createdItem = (res as any)?.data;
            const errors = (res as any)?.errors;
            if (createdItem) {
              handleCacheUpdateOnSuccess(
                queryClient,
                modelName,
                relatedQueryKeys,
                data.id,
                createdItem
              );
              debugLog(`🍬 ${modelName} upsert(create) success:`, data.id);
              return createdItem;
            }
            // No data -> treat as error and rollback
            console.error(
              `🍬 ${modelName} upsert(create) failed: empty response`,
              errors ? { errors } : undefined
            );
            rollbackCache(queryClient, previousDataMap);
            throw new Error(
              `🍬 ${modelName} upsert(create) returned no data${errors ? " (has errors)" : ""}`
            );
          }
        } catch (apiError) {
          // Rollback and log error on API error
          console.error(
            `🍬 ${modelName} upsert error, performing rollback:`,
            apiError
          );
          rollbackCache(queryClient, previousDataMap);
          throw apiError;
        }
      } catch (error) {
        console.error(`🍬 ${modelName} final upsert error:`, error);
        return null;
      }
    },

    // Index-based query (added method)
    customList: async (
      queryName: string,
      args: Record<string, any>,
      options = { forceRefresh: false, throwOnError: false }
    ): Promise<T[]> => {
      try {
        // Determine auth mode (use provided options if available)
        const authMode = options?.authMode || currentAuthMode;

        // Get owner and parameters based on auth mode
        const { owner, authModeParams } = await getOwnerByAuthMode(authMode);

        // Add owner value to queries requiring owner field when userPool auth
        const enhancedArgs = { ...args };
        if (
          owner &&
          authMode === "userPool" &&
          queryName.toLowerCase().includes("owner")
        ) {
          enhancedArgs.owner = owner;
        }

        // Detect relational query (if fields like dailyId, userId exist)
        const relationField = Object.keys(enhancedArgs).find((key) =>
          key.endsWith("Id")
        );
        const isRelationalQuery = !!relationField;
        const relationId = isRelationalQuery
          ? enhancedArgs[relationField]
          : null;
        const relationName = isRelationalQuery
          ? relationField
              .replace(/Id$/, "") // 'dailyId' → 'daily'
              .replace(/^./, (c) => c.toUpperCase()) // 'daily' → 'Daily'
          : null;

        // Create query key (include relation info for relational queries)
        const queryKey: QueryKey = isRelationalQuery
          ? [
              modelName,
              relationName as string,
              relationId,
              "query",
              queryName,
              JSON.stringify(enhancedArgs),
            ]
          : [modelName, "query", queryName, JSON.stringify(enhancedArgs)];

        // Check cache first (if forceRefresh is false)
        // Important: respect invalidation state so we don't serve stale data after direct mutations.
        if (!options.forceRefresh) {
          const cachedItems = queryClient.getQueryData<T[]>(queryKey);
          const queryState = queryClient.getQueryState(queryKey);
          if (
            cachedItems &&
            cachedItems.length > 0 &&
            !queryState?.isInvalidated
          ) {
            debugLog(`🍬 ${modelName} ${queryName} using cache`);
            return cachedItems.filter((item: any) => item !== null);
          }
        }

        debugLog(
          `🍬 ${modelName} customList call [Auth: ${authMode}]:`,
          queryName,
          enhancedArgs
        );

        // Check if index query method exists
        if (!(getClient().models as any)[modelName]?.[queryName]) {
          throw new Error(`🍬 Query ${queryName} does not exist.`);
        }

        // Execute index query - apply auth mode
        const res = await (getClient().models as any)[modelName][queryName](
          enhancedArgs,
          authModeParams
        );
        const result = (res as any)?.data;
        const errors = (res as any)?.errors;
        if (!result && errors?.length) {
          throw new Error(
            `🍬 ${modelName} ${queryName} returned no data (has errors)`
          );
        }

        // Extract result data
        const items = result?.items || result?.data || result || [];
        debugLog(
          `🍬 ${modelName} ${queryName} result:`,
          items.length,
          "items"
        );

        // Filter null values
        const filteredItems = items.filter((item: any) => item !== null);

        // Update cache
        queryClient.setQueryData(queryKey, filteredItems);

        // Update individual item cache
        filteredItems.forEach((item: T) => {
          const itemId = (item as any)?.id;
          // 🔧 버그 수정: ID가 유효한 경우에만 개별 캐시에 저장
          if (itemId && typeof itemId === "string") {
            queryClient.setQueryData(itemKey(modelName, itemId), item);
          } else {
            console.warn(
              `🍬 ${modelName} customList: Invalid item ID found, skipping cache update:`,
              itemId,
              item
            );
          }
        });

        return filteredItems;
      } catch (error) {
        console.error(`🍬 ${modelName} ${queryName} error:`, error);
        // Invalidate customList query cache on error
        // For relational queries, only invalidate related query
        if (typeof args === "object") {
          const relationField = Object.keys(args).find((key) =>
            key.endsWith("Id")
          );
          if (relationField) {
            const relationName = relationField
              .replace(/Id$/, "")
              .replace(/^./, (c) => c.toUpperCase());
            const queryKey: QueryKey = [
              modelName,
              relationName,
              args[relationField],
              "query",
              queryName,
              JSON.stringify(args),
            ];
            queryClient.invalidateQueries({ queryKey });
          } else {
            const queryKey: QueryKey = [
              modelName,
              "query",
              queryName,
              JSON.stringify(args),
            ];
            queryClient.invalidateQueries({ queryKey });
          }
        }
        if (options?.throwOnError) throw error;
        return [];
      }
    },

    // Load from cache - Not directly implemented in TanStack Query
    loadFromCache: () => {
      // Note: This function is not directly supported in TanStack Query
      // If needed, connect to Zustand store implementation here
      console.warn(
        `🍬 ${modelName}.getStore() is not directly supported in TanStack Query.`
      );
      // Return empty object temporarily or throw error
      return {} as any; // or throw new Error("getStore is not supported in TanStack Query implementation");
    },

    // Cache reset - Using invalidateQueries in TanStack Query
    resetCache: () => {
      // Invalidate all queries related to this model
      queryClient.invalidateQueries({ queryKey: [modelName] });
    },

    // React Hook returning method - Reimplemented based on TanStack Query
    useHook: (options?: {
      initialFetchOptions?: {
        fetch?: boolean;
        filter?: Record<string, any>;
      };
      customList?: {
        queryName: string;
        args: Record<string, any>;
        forceRefresh?: boolean;
      };
      realtime?: {
        enabled?: boolean;
        observeOptions?: Record<string, any>;
        events?: Array<"create" | "update" | "delete">;
      };
    }): ModelHook<T> => {
      const hookQueryClient = useQueryClient();
      // Ensure direct service calls (create/update/delete) use the same QueryClient
      // as hooks, so caches stay consistent.
      useEffect(() => {
        attachQueryClient(hookQueryClient);
      }, [hookQueryClient]);

      // Determine query key
      const queryKey: QueryKey = useMemo(() => {
        if (options?.customList) {
          return [
            modelName,
            "query",
            options.customList.queryName,
            JSON.stringify(options.customList.args),
          ];
        }
        if (options?.initialFetchOptions?.filter) {
          return [
            modelName,
            "filter",
            JSON.stringify(options.initialFetchOptions.filter),
          ];
        }
        return [modelName];
      }, [
        modelName,
        options?.initialFetchOptions?.filter,
        options?.customList?.queryName,
        options?.customList?.args,
      ]);

      // Determine query function
      const queryFn = useCallback(
        async (context: QueryFunctionContext<QueryKey>): Promise<T[]> => {
          debugLog(`🍬 ${modelName} useHook queryFn called`, {
            queryKey,
            isRefetch: context.meta?.refetch,
            customList: options?.customList?.queryName,
          });
          
          if (options?.customList) {
            debugLog(
              `🍬 ${modelName} useHook customList call:`,
              options.customList.queryName,
              options.customList.args,
              options.customList.forceRefresh
            );
            const result = await service.customList(
              options.customList.queryName,
              options.customList.args,
              { forceRefresh: options.customList.forceRefresh }
            );
            debugLog(
              `🍬 ${modelName} useHook customList result:`,
              result?.length || 0,
              "items"
            );
            return result;
          }

          if (options?.initialFetchOptions?.filter) {
            const result = await service.list({
              filter: options.initialFetchOptions.filter,
              forceRefresh: true,
            });
            debugLog(
              `🍬 ${modelName} useHook list (filtered) result:`,
              result?.length || 0,
              "items"
            );
            return result;
          }

          const result = await service.list();
          debugLog(
            `🍬 ${modelName} useHook list result:`,
            result?.length || 0,
            "items"
          );
          return result;
        },
        [
          options?.initialFetchOptions?.filter,
          options?.customList?.queryName,
          options?.customList?.args,
          options?.customList?.forceRefresh,
          service,
          modelName,
          queryKey,
        ]
      );

      const realtimeEnabled = options?.realtime?.enabled === true;
      const realtimeEvents =
        options?.realtime?.events ?? ["create", "update", "delete"];

      const queryOptions: UseQueryOptions<T[], Error, T[], QueryKey> = {
        queryKey,
        queryFn,
        enabled: options?.initialFetchOptions?.fetch !== false && !realtimeEnabled,
        staleTime: 1000 * 30, // Keep fresh for 30 seconds (refresh more frequently)
        gcTime: 1000 * 60 * 5, // Keep in cache for 5 minutes (prevents data from being garbage collected)
        refetchOnMount: true, // Refetch on component mount
        refetchOnWindowFocus: false, // Don't auto-refetch on window focus
        refetchOnReconnect: true, // Refetch on network reconnect
        // Keep previous data during refetch to prevent UI flicker
        // This ensures data persists during refetch operations
        placeholderData: (previousData: T[] | undefined) => {
          debugLog(
            `🍬 ${modelName} useHook placeholderData called - previous data:`,
            previousData?.length || 0,
            "items"
          );
          return previousData;
        },
      };

      const [isSynced, setIsSynced] = useState<boolean | undefined>(undefined);

      const {
        data: items = [],
        isLoading,
        error,
        refetch,
      } = useQuery<T[], Error, T[], QueryKey>(queryOptions);

      // Log data changes (debug only) - avoid spamming when nothing changed
      const lastDebugStateRef = useRef<{
        itemsCount: number;
        isLoading: boolean;
        hasError: boolean;
      } | null>(null);
      useEffect(() => {
        if (!isDebugEnabled()) return;
        const nextState = {
          itemsCount: items?.length || 0,
          isLoading: Boolean(isLoading),
          hasError: Boolean(error),
        };
        const prev = lastDebugStateRef.current;
        if (
          prev &&
          prev.itemsCount === nextState.itemsCount &&
          prev.isLoading === nextState.isLoading &&
          prev.hasError === nextState.hasError
        ) {
          return;
        }
        lastDebugStateRef.current = nextState;
        debugLog(`🍬 ${modelName} useHook data changed:`, {
          ...nextState,
          queryKey,
        });
      }, [items?.length, isLoading, error, modelName, queryKey]);

      useEffect(() => {
        if (!realtimeEnabled) return;
        if (options?.customList) {
          const client = getClient();
          const model = (client.models as any)?.[modelName];
          if (!model) {
            console.warn(
              `🍬 ${modelName} useHook realtime: model not available.`
            );
            return;
          }

          const observeOptions = {
            ...(options?.realtime?.observeOptions || {}),
          } as Record<string, any>;
          if (
            observeOptions.filter === undefined &&
            options?.initialFetchOptions?.filter
          ) {
            observeOptions.filter = options.initialFetchOptions.filter;
          }
          const subscriptions = [
            realtimeEvents.includes("create") && model.onCreate
              ? model.onCreate(observeOptions).subscribe({
                  next: () =>
                    hookQueryClient.invalidateQueries({
                      queryKey,
                      refetchType: "active",
                    }),
                  error: (err: any) =>
                    console.error(
                      `🍬 ${modelName} useHook realtime onCreate error:`,
                      err
                    ),
                })
              : null,
            realtimeEvents.includes("update") && model.onUpdate
              ? model.onUpdate(observeOptions).subscribe({
                  next: () =>
                    hookQueryClient.invalidateQueries({
                      queryKey,
                      refetchType: "active",
                    }),
                  error: (err: any) =>
                    console.error(
                      `🍬 ${modelName} useHook realtime onUpdate error:`,
                      err
                    ),
                })
              : null,
            realtimeEvents.includes("delete") && model.onDelete
              ? model.onDelete(observeOptions).subscribe({
                  next: () =>
                    hookQueryClient.invalidateQueries({
                      queryKey,
                      refetchType: "active",
                    }),
                  error: (err: any) =>
                    console.error(
                      `🍬 ${modelName} useHook realtime onDelete error:`,
                      err
                    ),
                })
              : null,
          ].filter(Boolean);

          return () => {
            subscriptions.forEach((sub: any) => sub?.unsubscribe?.());
          };
        }

        const client = getClient();
        const model = (client.models as any)?.[modelName];
        if (!model?.observeQuery) {
          console.warn(
            `🍬 ${modelName} useHook realtime: observeQuery not available.`
          );
          return;
        }

        const observeOptions = {
          ...(options?.realtime?.observeOptions || {}),
        } as Record<string, any>;

        if (
          observeOptions.filter === undefined &&
          options?.initialFetchOptions?.filter
        ) {
          observeOptions.filter = options.initialFetchOptions.filter;
        }

        let isMounted = true;
        let lastSynced: boolean | undefined = undefined;
        // observeQuery can temporarily emit an empty list during initial sync/reconnect.
        // If we immediately overwrite a non-empty cache with [], list UIs "flicker" (items disappear then reappear).
        // Keep the last known non-empty list until isSynced is true.
        const lastNonEmptyItemsRef = { current: [] as T[] };
        const subscription = model.observeQuery(observeOptions).subscribe({
          next: ({ items: nextItems, isSynced: synced }: any) => {
            if (!isMounted) return;
            const safeItems = Array.isArray(nextItems)
              ? nextItems.filter(Boolean)
              : [];

            const previousItems =
              hookQueryClient.getQueryData<T[]>(queryKey) || [];

            const nextSynced = Boolean(synced);
            if (lastSynced !== nextSynced) {
              lastSynced = nextSynced;
              setIsSynced(nextSynced);
            }

            if (safeItems.length > 0) {
              lastNonEmptyItemsRef.current = safeItems as T[];
            }

            // ✅ Guard: if we're not synced yet and observeQuery emits an empty list,
            // do NOT clobber a previously non-empty cache.
            if (!nextSynced && safeItems.length === 0 && previousItems.length > 0) {
              return;
            }

            // Avoid cache thrash: observeQuery can emit repeatedly even when data didn't change.
            if (
              areItemArraysEquivalentById(previousItems as any, safeItems as any)
            ) {
              return;
            }

            hookQueryClient.setQueryData(queryKey, safeItems);
            safeItems.forEach((item: any) => {
              if (item?.id) {
                hookQueryClient.setQueryData(
                  itemKey(modelName, item.id),
                  item
                );
              }
            });
          },
          error: (err: any) => {
            console.error(
              `🍬 ${modelName} useHook realtime subscribe error:`,
              err
            );
          },
        });

        return () => {
          isMounted = false;
          subscription?.unsubscribe?.();
        };
      }, [
        realtimeEnabled,
        modelName,
        queryKey,
        hookQueryClient,
        options?.customList,
        options?.initialFetchOptions?.filter,
        options?.realtime?.observeOptions,
      ]);

      // Interface functions implementation
      const getItem = useCallback(
        (id: string): T | undefined => {
          // Use useQueryData to get latest single item from current cache
          const cachedItem = hookQueryClient.getQueryData<T>(
            itemKey(modelName, id)
          );
          // 🔧 버그 수정: 캐시된 아이템의 ID가 요청한 ID와 일치하는지 검증
          if (cachedItem) {
            const itemId = (cachedItem as any)?.id;
            if (itemId === id) {
              return cachedItem;
            } else {
              console.warn(
                `🍬 ${modelName} useHook.getItem: Cache ID mismatch! Requested: ${id}, Cached: ${itemId}. Returning undefined.`
              );
              return undefined;
            }
          }
          return undefined;
        },
        [hookQueryClient, modelName]
      );

      const createItem = useCallback(
        async (data: Partial<T>): Promise<T | null> => {
          try {
            const result = await service.create(data);
            if (result) {
              // Keep hook cache in sync immediately
              hookQueryClient.setQueryData<T[]>(
                queryKey,
                (oldData: any) => {
                  const oldItems = Array.isArray(oldData) ? oldData : [];
                  if (oldItems.some((item: any) => item?.id === (result as any).id)) {
                    return oldItems;
                  }
                  return [...oldItems, result];
                }
              );
              hookQueryClient.setQueryData(
                itemKey(modelName, (result as any).id),
                result
              );
            }
            // Automatically refresh list after successful create
            await refetch();
            return result;
          } catch (_error) {
            console.error(`🍬 ${modelName} useHook create error:`, _error);
            throw _error; // Re-throw error
          }
        },
        [service, refetch] // Add refetch dependency
      );

      const updateItem = useCallback(
        async (data: Partial<T> & { id: string }): Promise<T | null> => {
          try {
            const result = await service.update(data);
            if (result) {
              // Keep hook cache in sync immediately
              hookQueryClient.setQueryData<T[]>(
                queryKey,
                (oldData: any) => {
                  const oldItems = Array.isArray(oldData) ? oldData : [];
                  return oldItems.map((item: any) =>
                    item && item.id === (result as any).id ? result : item
                  );
                }
              );
              hookQueryClient.setQueryData(
                itemKey(modelName, (result as any).id),
                result
              );
            }
            // Automatically refresh list after successful update
            await refetch();
            return result;
          } catch (_error) {
            console.error(`🍬 ${modelName} useHook update error:`, _error);
            throw _error;
          }
        },
        [service, refetch] // Add refetch dependency
      );

      const deleteItem = useCallback(
        async (id: string): Promise<boolean> => {
          try {
            const result = await service.delete(id);
            if (result) {
              // Keep hook cache in sync immediately
              hookQueryClient.setQueryData<T[]>(
                queryKey,
                (oldData: any) => {
                  const oldItems = Array.isArray(oldData) ? oldData : [];
                  return oldItems.filter((item: any) => item?.id !== id);
                }
              );
              hookQueryClient.setQueryData(itemKey(modelName, id), null);
            }
            // Automatically refresh list after successful delete
            await refetch();
            return result;
          } catch (error) {
            console.error(`🍬 ${modelName} useHook delete error:`, error);
            throw error;
          }
        },
        [service, refetch] // refetch dependency added
      );

      const refresh = useCallback(
        async (refreshOptions?: { filter?: Record<string, any> }) => {
          debugLog(`🍬 ${modelName} useHook refresh called`, queryKey);
          // Keep behavior consistent with old-AmplifyQuery:
          // refresh == refetch() (same queryFn as initial load)
          const { data } = await refetch({ throwOnError: true });
          return data || [];
        },
        [refetch, queryKey, modelName]
      );

      const customListFn = useCallback(
        async (
          queryName: string,
          args: Record<string, any>,
          options?: { forceRefresh?: boolean; throwOnError?: boolean }
        ): Promise<T[]> => {
          try {
            const result = await service.customList(queryName, args, options);
            return result;
          } catch (error) {
            console.error(`🍬 ${modelName} useHook customList error:`, error);
            throw error;
          }
        },
        [service]
      );

      return {
        items,
        isLoading,
        error: error as Error | null,
        isSynced,
        getItem,
        refresh,
        create: createItem,
        update: updateItem,
        delete: deleteItem,
        customList: customListFn,
      };
    },

    // Hook for managing single item - Reimplemented based on TanStack Query
    useItemHook: (
      id: string,
      options?: {
        realtime?: {
          enabled?: boolean;
          observeOptions?: Record<string, any>;
        };
      }
    ): ItemHook<T> => {
      const hookQueryClient = useQueryClient();
      // Ensure direct service calls (create/update/delete) use the same QueryClient
      // as hooks, so caches stay consistent.
      useEffect(() => {
        attachQueryClient(hookQueryClient);
      }, [hookQueryClient]);
      // Runtime safety: avoid non-string ids creating broken query keys like
      // ["User","item",[...]] which can cause cache thrash/flicker.
      const safeId = typeof id === "string" ? id : "";
      const singleItemQueryKey: QueryKey = itemKey(modelName, safeId);
      const realtimeEnabled = options?.realtime?.enabled === true;

      // First check data from cache
      const rawCachedData = hookQueryClient.getQueryData<T | T[]>(
        singleItemQueryKey
      );

      // 🔧 버그 수정: 배열이 캐시되어 있는 경우 처리
      let cachedData: T | undefined;
      if (Array.isArray(rawCachedData)) {
        console.warn(
          `🍬 ${modelName} useItemHook: Cache contains array instead of single item. Finding matching item.`
        );
        const matchingItem = rawCachedData.find(
          (item: any) => item?.id === safeId
        );
        cachedData = matchingItem || undefined;
        // Normalize the cache in-place instead of deleting it (deleting causes UI flicker).
        hookQueryClient.setQueryData(singleItemQueryKey, matchingItem ?? null);
      } else if (rawCachedData && (rawCachedData as any)?.id === id) {
        cachedData = rawCachedData as T;
      } else if (rawCachedData) {
        console.warn(
          `🍬 ${modelName} useItemHook: Cache ID mismatch! Requested: ${safeId}, Cached: ${
            (rawCachedData as any)?.id
          }. Ignoring cached data.`
        );
        cachedData = undefined;
      }

      // Single item query
      const {
        data: item,
        isLoading,
        error,
        refetch,
      } = useQuery<T | null, Error, T | null, QueryKey>({
        queryKey: singleItemQueryKey,
        queryFn: () => service.get(safeId),
        initialData: cachedData, // Use cached data as initial value if available
        staleTime: 1000 * 60, // Keep data "fresh" for 1 minute
        refetchOnMount: cachedData ? false : true, // Only refetch if no cached data
        refetchOnWindowFocus: false, // Disable window focus refetch to prevent loops
        enabled: !!safeId && !realtimeEnabled, // Only enable query when id exists
      });

      const [isSynced, setIsSynced] = useState<boolean | undefined>(undefined);

      useEffect(() => {
        if (!realtimeEnabled || !id) return;

        const client = getClient();
        const model = (client.models as any)?.[modelName];
        if (!model?.observeQuery) {
          console.warn(
            `🍬 ${modelName} useItemHook realtime: observeQuery not available.`
          );
          return;
        }

        const observeOptions = {
          ...(options?.realtime?.observeOptions || {}),
        } as Record<string, any>;

        if (!observeOptions.filter) {
          observeOptions.filter = { id: { eq: id } };
        }

        let isMounted = true;
        let lastSynced: boolean | undefined = undefined;
        // observeQuery can temporarily emit empty items during sync/reconnect, even when the item
        // still exists on the server. If we immediately set the cache to null, UI flickers.
        // When observeQuery reports "missing", confirm with a server get (forceRefresh) before clearing.
        let lastMissingConfirmAt = 0;
        const subscription = model.observeQuery(observeOptions).subscribe({
          next: ({ items: nextItems, isSynced: synced }: any) => {
            if (!isMounted) return;
            const safeItems = Array.isArray(nextItems)
              ? nextItems.filter(Boolean)
              : [];
            const nextItem = safeItems.find((entry: any) => entry?.id === id) || null;

            const nextSynced = Boolean(synced);
            if (lastSynced !== nextSynced) {
              lastSynced = nextSynced;
              setIsSynced(nextSynced);
            }

            const prevItem = hookQueryClient.getQueryData<any>(singleItemQueryKey);
            if (!nextItem) {
              // Never clear immediately. During sync/reconnect observeQuery can be temporarily empty.
              if (!nextSynced) return;
              const now = Date.now();
              // Throttle server confirmations to avoid loops.
              if (now - lastMissingConfirmAt < 2000) return;
              lastMissingConfirmAt = now;
              void (async () => {
                try {
                  const latest = await service.get(id, { forceRefresh: true });
                  if (!isMounted) return;
                  if (latest) {
                    hookQueryClient.setQueryData(singleItemQueryKey, latest);
                  } else {
                    hookQueryClient.setQueryData(singleItemQueryKey, null);
                  }
                } catch (e) {
                  // If confirm fails, keep existing cache (avoid flicker)
                  debugWarn(`🍬 ${modelName} useItemHook realtime missing confirm error:`, e);
                }
              })();
              return;
            }

            if (signatureForModelItem(prevItem) === signatureForModelItem(nextItem)) {
              // Avoid thrashing caches when observeQuery emits identical item repeatedly
              return;
            }

            const relatedQueryKeys = findRelatedQueryKeys(
              modelName,
              hookQueryClient
            );

            if (nextItem) {
              hookQueryClient.setQueryData(singleItemQueryKey, nextItem);
              relatedQueryKeys.forEach((queryKey) => {
                if (isItemKeyForModel(modelName, queryKey)) {
                  return;
                }
                hookQueryClient.setQueryData(queryKey, (oldData: any) => {
                  const oldItems = Array.isArray(oldData) ? oldData : [];
                  const hasItem = oldItems.some((entry: any) => entry?.id === id);
                  if (hasItem) {
                    return oldItems.map((entry: any) =>
                      entry?.id === id ? nextItem : entry
                    );
                  }
                  if (queryKey.length === 1) {
                    return [...oldItems, nextItem];
                  }
                  return oldItems;
                });
              });
            }

          },
          error: (err: any) => {
            console.error(
              `🍬 ${modelName} useItemHook realtime subscribe error:`,
              err
            );
          },
        });

        return () => {
          isMounted = false;
          subscription?.unsubscribe?.();
        };
      }, [
        realtimeEnabled,
        id,
        modelName,
        hookQueryClient,
        singleItemQueryKey,
        options?.realtime?.observeOptions,
      ]);

      // useMutation hooks call service methods,
      // Service methods handle optimistic updates and cache updates/rollbacks internally.
      // Mutations inside useHook only serve to call service methods.

      const updateMutation = useMutation({
        mutationFn: (data: Partial<T> & { id: string }) => service.update(data),
        // onSuccess, onMutate, onError logic moved to service method
      });

      const deleteMutation = useMutation({
        mutationFn: () => service.delete(id),
        // onSuccess, onMutate, onError logic moved to service method
      });

      // Interface function implementations
      const refreshItem = useCallback(async (): Promise<T | null> => {
        debugLog(
          `🍬 ${modelName} useItemHook refresh called`,
          singleItemQueryKey
        );
        // IMPORTANT: Use hookQueryClient.refetchQueries() or refetch() instead of service.get()
        // to ensure we're updating the same QueryClient instance that useQuery uses.
        // This prevents data from disappearing during refetch.
        try {
          // First, fetch fresh data with forceRefresh
          const latest = await service.get(id, { forceRefresh: true });
          
          // Update the hookQueryClient cache to sync with the fetched data
          if (latest) {
            hookQueryClient.setQueryData(singleItemQueryKey, latest);
          } else {
            hookQueryClient.setQueryData(singleItemQueryKey, null);
          }
          
          // Also trigger refetch to ensure UI updates
          await refetch();
          
          return latest || null;
        } catch (error) {
          console.error(`🍬 ${modelName} useItemHook refresh error:`, error);
          // On error, still try to refetch to get current state
          const refetchResult = await refetch();
          return (refetchResult.data as T | null) || null;
        }
      }, [id, modelName, service, singleItemQueryKey, hookQueryClient, refetch]);

      const updateItem = useCallback(
        async (data: Partial<T>): Promise<T | null> => {
          // No additional work needed here as cache is already updated in service.update
          try {
            // Explicitly add id to resolve type error
            const updateData = { ...data, id } as Partial<T> & { id: string };
            const result = await updateMutation.mutateAsync(updateData);
            return result;
          } catch (error) {
            console.error(`🍬 ${modelName} useItemHook update error:`, error);
            throw error;
          }
        },
        [updateMutation, id]
      );

      const deleteItem = useCallback(async (): Promise<boolean> => {
        try {
          const result = await deleteMutation.mutateAsync();
          if (result) {
            // Ensure the hook's query cache reflects deletion immediately
            hookQueryClient.setQueryData(singleItemQueryKey, null);
            hookQueryClient.invalidateQueries({
              queryKey: [modelName],
              refetchType: "active",
            });
            hookQueryClient.invalidateQueries({
              queryKey: singleItemQueryKey,
              refetchType: "active",
            });
          }
          return result;
        } catch (error) {
          console.error(`🍬 ${modelName} useItemHook delete error:`, error);
          throw error;
        }
      }, [deleteMutation, hookQueryClient, modelName, singleItemQueryKey]);

      // Change loading state to false when isLoading is true and cached data exists
      const effectiveLoading = isLoading && !cachedData;

      // 캐시 정리를 위한 효과 최적화 (한 번만 실행)
      const shouldCleanCache = Array.isArray(rawCachedData);
      if (shouldCleanCache && !isLoading) {
        // 로딩이 완료된 후에만 캐시 정리 실행
        setTimeout(() => {
          const currentCache = hookQueryClient.getQueryData(singleItemQueryKey);
          if (Array.isArray(currentCache)) {
            hookQueryClient.setQueryData(singleItemQueryKey, item);
          }
        }, 100);
      }

      return {
        item: item || null,
        isLoading: effectiveLoading, // Not loading if cached data exists
        error: error as Error | null, // Explicitly specify error type
        isSynced,
        refresh: refreshItem,
        update: updateItem,
        delete: deleteItem,
      };
    },

    // Method to add model-specific extension features
    withExtensions: <E>(extensions: E): AmplifyDataService<T> & E => {
      // Add extension features to existing service object
      return {
        ...service,
        ...extensions,
      };
    },

    // Add TanStack Query Store access method (use when needed)
    getStore: () => {
      // TanStack Query doesn't directly expose Zustand store
      // Need to connect Zustand store implementation here if needed
      console.warn(
        `🍬 ${modelName}.getStore() is not directly supported in TanStack Query.`
      );
      // Temporarily return empty object or throw error
      return {} as any; // Or throw new Error("getStore is not supported in TanStack Query implementation");
    },
  };

  return service;
}
