import { AmplifyDataService, SingletonAmplifyService, ItemHook } from "./types";
import { getClient } from "./client";
import { getCurrentUser } from "aws-amplify/auth";
import { useQuery } from "@tanstack/react-query";
import { getSingletonAutoCreate, isSingletonAutoCreateEnabledForModel } from "./config";
import { useEffect, useRef } from "react";
import { debugLog, debugWarn } from "./config";

/**
 * Function to create an extension service for singleton models
 * @param baseService Base service
 * @param getModelId Function to get the unique ID of the model
 * @returns Extended service supporting singleton pattern
 */
export function createSingletonService<T>(
  baseService: AmplifyDataService<T>,
  getModelId: () => Promise<string>
): SingletonAmplifyService<T> {
  // Extract modelName from baseService
  const { modelName } = baseService;

  // Create singleton service object
  const singletonService: SingletonAmplifyService<T> = {
    // Include all methods from the base service
    ...baseService,

    // Add singleton instance management methods
    getCurrent: async (options?: { forceRefresh?: boolean }) => {
      try {
        const modelId = await getModelId();
        debugLog(`🍬 ${modelName} singleton.getCurrent`, {
          modelId,
          forceRefresh: options?.forceRefresh === true,
        });
        return baseService.get(modelId, options);
      } catch (error) {
        // Keep singleton reads soft-failing (null) like base get().
        // (Do not call getStore here: TanStack Query service doesn't support it.)
        // console.error(`${modelName} singleton instance lookup error:`, error);
        return null;
      }
    },

    updateCurrent: async (data: Partial<Omit<T, "id">>) => {
      try {
        const modelId = await getModelId();
        return baseService.update({ ...data, id: modelId } as Partial<T> & {
          id: string;
        });
      } catch (error) {
        console.error(`${modelName} singleton instance update error:`, error);
        return null;
      }
    },

    upsertCurrent: async (data: Partial<Omit<T, "id">>) => {
      try {
        const modelId = await getModelId();

        // Check the latest status by forced refresh
        debugLog(`🍬 ${modelName} singleton.upsertCurrent check existing`, {
          modelId,
        });
        const existingItem = await baseService.get(modelId, {
          forceRefresh: true,
        });

        if (existingItem) {
          // Update
          debugLog(`🍬 ${modelName} singleton.upsertCurrent -> update`, {
            modelId,
          });
          return baseService.update({ ...data, id: modelId } as Partial<T> & {
            id: string;
          });
        } else {
          // Create using baseService so authMode/owner handling stays consistent.
          // (We still pass a fixed id to guarantee singleton identity.)
          debugWarn(`🍬 ${modelName} singleton.upsertCurrent missing -> create`, {
            modelId,
          });
          const modelData = { ...data, id: modelId } as any;

          try {
            // Use service.create to keep cache + auth mode consistent
            const createdItem = await baseService.create(modelData, {
              authMode: baseService.getAuthMode(),
            } as any);

            // Ensure cache is synced to latest server state
            try {
              await baseService.get(modelId, { forceRefresh: true });
            } catch {
              // ignore cache sync failures
            }

            return createdItem ?? null;
          } catch (apiError) {
            console.error(
              `${modelName} singleton instance Upsert error:`,
              apiError
            );
            throw apiError; // Propagate error upwards
          }
        }
      } catch (error) {
        console.error(
          `${modelName} singleton instance final Upsert error:`,
          error
        );
        return null;
      }
    },

    // React hook to manage the current singleton item
    useSigletoneHook: (
      options?: {
        autoCreate?: boolean;
        realtime?: {
          enabled?: boolean;
          observeOptions?: Record<string, any>;
        };
      }
    ): ItemHook<T> => {
      const {
        data: currentId,
        isLoading: isIdLoading,
        error: idError,
        refetch: refetchId,
      } = useQuery<string | null, Error, string | null, [string, string]>({
        queryKey: [modelName, "currentId"],
        queryFn: async () => {
          try {
            const id = await getModelId();
            return id || null;
          } catch (error) {
            return null;
          }
        },
        staleTime: 1000 * 60,
        refetchOnWindowFocus: false,
      });

      const idForItemHook = currentId ?? "";
      debugLog(`🍬 ${modelName} useSigletoneHook currentId`, {
        currentId,
        idForItemHook,
      });
      const core = baseService.useItemHook(
        idForItemHook,
        options?.realtime ? { realtime: options.realtime } : undefined
      );
      const attemptedAutoCreateForIdRef = useRef<string | null>(null);

      const cfg = getSingletonAutoCreate();
      const autoCreateEnabled =
        typeof options?.autoCreate === "boolean"
          ? options.autoCreate
          : cfg
            ? isSingletonAutoCreateEnabledForModel(modelName)
            : true;

      const item: T | null = currentId ? core.item : null;

      const isLoading = isIdLoading || core.isLoading;
      const error = (idError as Error | null) || core.error || null;

      useEffect(() => {
        debugLog(`🍬 ${modelName} useSigletoneHook effect check`, {
          currentId,
          isLoading,
          autoCreateEnabled,
          attemptedFor: attemptedAutoCreateForIdRef.current,
          hasError: Boolean(error),
          hasItem: Boolean(item),
        });
        if (!currentId) return;
        if (isLoading) return;
        if (!autoCreateEnabled) return;
        if (attemptedAutoCreateForIdRef.current === currentId) return;
        if (error) return;
        if (item) return;

        attemptedAutoCreateForIdRef.current = currentId;
        // Best-effort: create { id } if missing.
        void (async () => {
          try {
            debugWarn(`🍬 ${modelName} useSigletoneHook auto-create starting`, {
              currentId,
            });
            await singletonService.upsertCurrent({} as any);
            await singletonService.getCurrent({ forceRefresh: true });
            debugLog(`🍬 ${modelName} useSigletoneHook auto-create done`, {
              currentId,
            });
          } catch (e) {
            attemptedAutoCreateForIdRef.current = null; // allow retry later
            debugWarn(`🍬 ${modelName} useSigletoneHook auto-create failed:`, e);
          }
        })();
      }, [currentId, isLoading, item, modelName, autoCreateEnabled, error]);

      const refresh = async (): Promise<T | null> => {
        const latest = await singletonService.getCurrent({ forceRefresh: true });
        if (latest) return latest;

        if (!autoCreateEnabled) return null;

        // If missing, create then re-fetch to sync cache.
        await singletonService.upsertCurrent({} as any);
        return (await singletonService.getCurrent({ forceRefresh: true })) ?? null;
      };

      const update = async (data: Partial<T>): Promise<T | null> => {
        // Upsert to satisfy "create if missing" behavior.
        await singletonService.upsertCurrent(data as any);
        return (await singletonService.getCurrent({ forceRefresh: true })) ?? null;
      };

      const remove = async (): Promise<boolean> => {
        try {
          const modelId = await getModelId();
          return baseService.delete(modelId);
        } catch (e) {
          return false;
        }
      };

      return { item, isLoading, error, refresh, update, delete: remove };
    },

    // Backward-compatible alias
    useCurrentHook: (options) => singletonService.useSigletoneHook(options),
  };

  return singletonService;
}

/**
 * Define functions to get model IDs by model
 */
export const getModelIds = {
  // Get user ID
  User: async (): Promise<string> => {
    try {
      const { userId } = await getCurrentUser();
      return userId;
    } catch (e) {
      console.error("Failed to get user ID:", e);
      throw new Error("Unable to retrieve user authentication information.");
    }
  },

  // Users can add their own functions to get singleton model IDs here as needed.
};
