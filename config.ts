/**
 * Global configuration for AmplifyQuery library
 */

// Global configuration state
let globalConfig: {
  modelOwnerQueryMap?: Record<string, string>;
  defaultAuthMode?:
    | "apiKey"
    | "iam"
    | "identityPool"
    | "oidc"
    | "userPool"
    | "lambda"
    | "none";
} = {};

/**
 * Set the global model owner query mapping
 * @param queryMap Mapping of model names to their owner query names
 */
export function setModelOwnerQueryMap(queryMap: Record<string, string>): void {
  globalConfig.modelOwnerQueryMap = { ...queryMap };
  console.log("🔧 AmplifyQuery: Global model owner query map configured");
}

/**
 * Get the global model owner query mapping
 * @returns The global model owner query mapping or undefined if not set
 */
export function getModelOwnerQueryMap(): Record<string, string> | undefined {
  return globalConfig.modelOwnerQueryMap;
}

/**
 * Get owner query name for a specific model
 * @param modelName The model name
 * @returns The owner query name or default format if not found
 */
export function getOwnerQueryName(modelName: string): string {
  const queryMap = getModelOwnerQueryMap();
  return queryMap?.[modelName] || `list${modelName}sByOwner`;
}

/**
 * Set the default auth mode
 * @param authMode Default authentication mode
 */
export function setDefaultAuthMode(
  authMode:
    | "apiKey"
    | "iam"
    | "identityPool"
    | "oidc"
    | "userPool"
    | "lambda"
    | "none"
): void {
  globalConfig.defaultAuthMode = authMode;
  console.log(`🔧 AmplifyQuery: Default auth mode set to ${authMode}`);
}

/**
 * Get the default auth mode
 * @returns The default auth mode or 'userPool' if not set
 */
export function getDefaultAuthMode():
  | "apiKey"
  | "iam"
  | "identityPool"
  | "oidc"
  | "userPool"
  | "lambda"
  | "none" {
  return globalConfig.defaultAuthMode || "userPool";
}

/**
 * Reset global configuration (mainly for testing)
 */
export function resetConfig(): void {
  globalConfig = {};
  console.log("🔧 AmplifyQuery: Global configuration reset");
}
