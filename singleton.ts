import { AmplifyDataService, SingletonAmplifyService } from "./types";
import { getClient } from "./client";
import { getCurrentUser } from "aws-amplify/auth";

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
        return baseService.get(modelId, options);
      } catch (error) {
        console.error(`${modelName} singleton instance lookup error:`, error);
        // Safely call getStore
        try {
          baseService
            .getStore?.()
            ?.setError?.(
              error instanceof Error ? error : new Error(String(error))
            );
        } catch (storeError) {
          // Ignore if getStore doesn't exist or call fails
        }
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
        // Safely call getStore
        try {
          baseService
            .getStore?.()
            ?.setError?.(
              error instanceof Error ? error : new Error(String(error))
            );
        } catch (storeError) {
          // Ignore if getStore doesn't exist or call fails
        }
        return null;
      }
    },

    upsertCurrent: async (data: Partial<Omit<T, "id">>) => {
      try {
        const modelId = await getModelId();

        // Check the latest status by forced refresh
        const existingItem = await baseService.get(modelId, {
          forceRefresh: true,
        });

        if (existingItem) {
          // Update
          return baseService.update({ ...data, id: modelId } as Partial<T> & {
            id: string;
          });
        } else {
          // Create (Direct call to Amplify Client - prevents random ID generation of generic create)
          const modelData = { ...data, id: modelId } as any;

          // Safely call getStore
          try {
            baseService.getStore?.()?.setLoading?.(true);
          } catch (storeError) {
            // Ignore if getStore doesn't exist or call fails
          }

          try {
            // Call appropriate model from Amplify Models
            const { data: createdItem } = await (getClient().models as any)[
              modelName
            ].create(modelData);

            if (createdItem) {
              try {
                baseService.getStore?.()?.setItem?.(createdItem);
              } catch (storeError) {
                // Ignore if getStore doesn't exist or call fails
              }
            }

            try {
              baseService.getStore?.()?.setLoading?.(false);
            } catch (storeError) {
              // Ignore if getStore doesn't exist or call fails
            }

            return createdItem ?? null;
          } catch (apiError) {
            try {
              baseService.getStore?.()?.setLoading?.(false);
              baseService
                .getStore?.()
                ?.setError?.(
                  apiError instanceof Error
                    ? apiError
                    : new Error(String(apiError))
                );
            } catch (storeError) {
              // Ignore if getStore doesn't exist or call fails
            }

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
