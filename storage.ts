/**
 * Platform-agnostic storage abstraction
 * Supports React Native (MMKV) and Web (localStorage)
 */

export type StorageLike = {
  set: (key: string, value: string) => void;
  getString: (key: string) => string | undefined;
  remove?: (key: string) => boolean;
  delete?: (key: string) => void;
  clearAll?: () => void;
};

/**
 * Detect if we're running in React Native environment
 */
function isReactNative(): boolean {
  // Check for React Native environment indicators
  if (typeof navigator !== "undefined" && navigator.product === "ReactNative") {
    return true;
  }
  
  // Web environment check - if window exists and is not React Native, it's web
  if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
    // Additional check: if we're in a browser environment, it's definitely web
    if (typeof document !== "undefined" && typeof document.createElement !== "undefined") {
      return false;
    }
  }
  
  // Check for React Native specific globals (more reliable than __DEV__)
  if (typeof global !== "undefined") {
    try {
      // Try to require react-native - if it succeeds, we're in React Native
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const RN = require("react-native");
      // If Platform exists, we're definitely in React Native
      if (RN.Platform) {
        return true;
      }
    } catch {
      // require failed - not React Native environment
      return false;
    }
  }
  
  return false;
}

/**
 * Create platform-specific storage instance
 * @param id Storage identifier (used for MMKV, ignored for localStorage)
 * @returns Storage instance
 */
export function createStorage(id: string): StorageLike {
  // React Native: Use MMKV if available
  if (isReactNative()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mmkv: any = require("react-native-mmkv");
      
      if (typeof mmkv.createMMKV === "function") {
        return mmkv.createMMKV({ id }) as StorageLike;
      }
      if (typeof mmkv.MMKV === "function") {
        return new mmkv.MMKV({ id }) as StorageLike;
      }
    } catch (error) {
      // MMKV not available, fall through to localStorage
      console.warn(
        "react-native-mmkv not available, falling back to localStorage"
      );
    }
  }

  // Web: Use localStorage
  if (typeof window !== "undefined" && window.localStorage) {
    return {
      set: (key: string, value: string) => {
        try {
          window.localStorage.setItem(key, value);
        } catch (error) {
          console.error("Error saving to localStorage:", error);
        }
      },
      getString: (key: string) => {
        try {
          return window.localStorage.getItem(key) || undefined;
        } catch (error) {
          console.error("Error reading from localStorage:", error);
          return undefined;
        }
      },
      remove: (key: string) => {
        try {
          window.localStorage.removeItem(key);
          return true;
        } catch (error) {
          console.error("Error removing from localStorage:", error);
          return false;
        }
      },
      delete: (key: string) => {
        try {
          window.localStorage.removeItem(key);
        } catch (error) {
          console.error("Error deleting from localStorage:", error);
        }
      },
      clearAll: () => {
        try {
          window.localStorage.clear();
        } catch (error) {
          console.error("Error clearing localStorage:", error);
        }
      },
    };
  }

  // Fallback: In-memory storage (for SSR or unsupported environments)
  const memoryStorage = new Map<string, string>();
  return {
    set: (key: string, value: string) => {
      memoryStorage.set(key, value);
    },
    getString: (key: string) => {
      return memoryStorage.get(key);
    },
    remove: (key: string) => {
      return memoryStorage.delete(key);
    },
    delete: (key: string) => {
      memoryStorage.delete(key);
    },
    clearAll: () => {
      memoryStorage.clear();
    },
  };
}
