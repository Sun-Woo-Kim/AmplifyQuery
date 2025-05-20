import { AmplifyDataService, ModelHook, BaseModel } from "./types";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUser } from "aws-amplify/auth";
import { getUrl, remove, uploadData, downloadData } from "aws-amplify/storage";
import { randomUUID } from "expo-crypto";
import * as FileSystem from "expo-file-system";
import { useCallback } from "react";
import { MMKV } from "react-native-mmkv";

// Create MMKV storage instance
const storage = new MMKV({ id: "mmkv.amplify-query" });

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
      console.warn(
        `The owner field exists. This field is added automatically and will be excluded from the ${operation} operation.`
      );
    }
    return dataWithoutOwner;
  },
};

/**
 * Storage related utilities
 */
export const StorageService = {
  // URL cache internal type definition
  _types: {
    // URL cache interface (used internally only)
    Item: {} as {
      url: string; // Cached URL
      expiresAt: number; // URL expiration time (timestamp)
    },

    // Cache data structure (stored as key-value)
    CacheData: {} as {
      [key: string]: {
        url: string;
        expiresAt: number;
      };
    },
  },

  // Memory cache (for fast access)
  _urlCache: new Map<string, { url: string; expiresAt: number }>(),

  // MMKV cache storage key
  _CACHE_KEY: "storage_url_cache",

  // Initialization status
  _initialized: false,

  /**
   * Initialize the memory cache.
   * Loads URL cache from MMKV storage.
   */
  _initCache: () => {
    if (StorageService._initialized) return;

    try {
      // Retrieve URL cache data from MMKV
      const cachedData = storage.getString(StorageService._CACHE_KEY);

      // Restore to memory cache
      if (cachedData && cachedData.length > 0) {
        const parsedData = JSON.parse(cachedData) as {
          [key: string]: { url: string; expiresAt: number };
        };
        const now = Date.now();

        // Add only non-expired items to memory cache
        Object.entries(parsedData).forEach(([key, item]) => {
          if (item.expiresAt > now) {
            StorageService._urlCache.set(key, {
              url: item.url,
              expiresAt: item.expiresAt,
            });
          }
        });
      }

      StorageService._initialized = true;
    } catch (error) {
      console.error("URL cache initialization error:", error);
      // Clear cache on error
      StorageService.clearUrlCache();
      StorageService._initialized = true;
    }
  },

  /**
   * Save cache to MMKV storage.
   */
  _saveCache: () => {
    try {
      const cacheData: { [key: string]: { url: string; expiresAt: number } } =
        {};

      // Convert memory cache to persistent storage format
      StorageService._urlCache.forEach((item, key) => {
        cacheData[key] = {
          url: item.url,
          expiresAt: item.expiresAt,
        };
      });

      // Save to MMKV
      storage.set(StorageService._CACHE_KEY, JSON.stringify(cacheData));
    } catch (error) {
      console.error("URL cache save error:", error);
    }
  },

  /**
   * Upload an image file to Storage.
   * @param file File to upload (Blob or File object)
   * @param key Path and filename to save as (auto-generated if not specified)
   * @returns Key of the uploaded file
   */
  uploadImage: async (file: Blob | File, key?: string): Promise<string> => {
    try {
      const fileKey =
        key || `images/${randomUUID()}.${file.type.split("/")[1] || "jpg"}`;
      const result = await uploadData({
        path: fileKey,
        data: file,
        options: {
          contentType: file.type,
        },
      }).result;
      return result.path;
    } catch (error) {
      console.error("File upload failed:", error);
      throw error;
    }
  },

  /**
   * Get the URL of a stored file. (Auto-caching)
   * @param key File key
   * @param options Caching options (forceRefresh: ignore cache and fetch new URL)
   * @returns File URL
   */
  getFileUrl: async (
    key: string,
    options?: { forceRefresh?: boolean }
  ): Promise<string> => {
    try {
      // Initialize cache (only runs on first call)
      if (!StorageService._initialized) {
        StorageService._initCache();
      }

      // If not ignoring cache and URL is in cache, return from cache
      const cachedItem = StorageService._urlCache.get(key);
      const now = Date.now();

      // If cached URL exists, is not expired, and not forced refresh
      if (cachedItem && cachedItem.expiresAt > now && !options?.forceRefresh) {
        return cachedItem.url;
      }

      // If not in cache, expired, or forced refresh, get new URL
      // Number of seconds till the URL expires.
      // The expiration time of the presigned url is dependent on the session and will max out at 1 hour.
      const result = await getUrl({
        path: key,
        options: {
          // Default 1 hour expiration, adjustable if needed
          expiresIn: 60 * 60, // 1 hour
        },
      });

      const url = result.url.toString();

      // Convert expiration time to timestamp
      const expiresAt = result.expiresAt.getTime();

      // Save to cache
      StorageService._urlCache.set(key, {
        url,
        expiresAt,
      });

      // Also save to persistent storage
      StorageService._saveCache();

      return url;
    } catch (error) {
      console.error("Failed to get file URL:", error);
      throw error;
    }
  },

  /**
   * Delete a stored file.
   * @param key Key of the file to delete
   */
  deleteFile: async (key: string): Promise<void> => {
    try {
      await remove({ path: key });
      // Remove from cache on file deletion
      StorageService._urlCache.delete(key);
      // Update persistent storage
      StorageService._saveCache();
    } catch (error) {
      console.error("File deletion failed:", error);
      throw error;
    }
  },

  /**
   * Clear the URL cache.
   */
  clearUrlCache: (): void => {
    StorageService._urlCache.clear();
    storage.delete(StorageService._CACHE_KEY);
  },

  /**
   * Remove a specific key's URL cache.
   * @param key Key of the URL to remove
   */
  clearUrlCacheForKey: (key: string): void => {
    StorageService._urlCache.delete(key);
    // Update persistent storage
    StorageService._saveCache();
  },

  /**
   * Remove only expired URL caches.
   */
  clearExpiredUrlCache: (): void => {
    const now = Date.now();
    for (const [key, item] of StorageService._urlCache.entries()) {
      if (item.expiresAt <= now) {
        StorageService._urlCache.delete(key);
      }
    }
    // Update persistent storage
    StorageService._saveCache();
  },

  /**
   * Download an audio file.
   * @param audioKey Key of the audio file to download
   * @returns Local file system path of the downloaded file
   */
  downloadAudioFile: async (audioKey: string): Promise<string> => {
    try {
      // Create directory path where the file will be saved
      const audioDir = `${FileSystem.cacheDirectory}sounds/`;
      const localFilePath = `${audioDir}${audioKey}`;

      // Check if directory exists, create if not
      const dirInfo = await FileSystem.getInfoAsync(audioDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(audioDir, { intermediates: true });
      }

      // Check if file already exists
      const fileInfo = await FileSystem.getInfoAsync(localFilePath);
      if (fileInfo.exists) {
        console.log("Audio file already exists locally:", localFilePath);
        return localFilePath;
      }

      // Get file URL from S3
      const s3Url = await getUrl({ path: `public/sound/${audioKey}` });

      // Download file
      const downloadResult = await FileSystem.downloadAsync(
        s3Url.url.toString(),
        localFilePath
      );

      console.log("Audio file downloaded successfully:", downloadResult.uri);
      return downloadResult.uri;
    } catch (error) {
      console.error("Audio file download failed:", error);
      throw error;
    }
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
        console.log(`🍬 ${service.modelName} relational refresh called`, id);
        const { data } = await refetch({ throwOnError: true });
        return data || [];
      },
      create: createItem, // ID-specific method
      update: baseHook.update,
      delete: baseHook.delete,
      customList: baseHook.customList,
    };
  };
}
