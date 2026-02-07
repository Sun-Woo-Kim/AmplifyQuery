/**
 * Platform-agnostic UUID generation
 * Supports React Native (expo-crypto) and Web (crypto.randomUUID)
 */

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
 * Generate a random UUID
 * @returns UUID string
 */
export function randomUUID(): string {
  // React Native: Use expo-crypto if available
  if (isReactNative()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { randomUUID: expoRandomUUID } = require("expo-crypto");
      return expoRandomUUID();
    } catch (error) {
      // expo-crypto not available, fall through to web crypto
      console.warn("expo-crypto not available, falling back to crypto.randomUUID");
    }
  }

  // Web: Use crypto.randomUUID (available in modern browsers and Node.js 14.17+)
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback: Generate UUID v4 manually
  // This is a simple implementation for environments without crypto.randomUUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
