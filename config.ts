/**
 * Global configuration for AmplifyQuery library
 */

// Global configuration state
let globalConfig: {
  modelOwnerQueryMap?: Record<string, string>;
  awsJsonFieldMap?: Record<string, string[]>;
  awsJsonAutoTransform?: boolean;
  defaultAuthMode?:
    | "apiKey"
    | "iam"
    | "identityPool"
    | "oidc"
    | "userPool"
    | "lambda"
    | "none";
  singletonAutoCreate?: {
    enabled?: boolean;
    models?: string[];
  };
  debug?: boolean;
} = {};

function isDebugEnabledInternal(): boolean {
  // Debug logging must be explicitly enabled via AmplifyQuery.configure({ debug: true }).
  return globalConfig.debug === true;
}

export function setDebug(debug: boolean): void {
  globalConfig.debug = debug === true;
}

export function isDebugEnabled(): boolean {
  return isDebugEnabledInternal();
}

export function debugLog(...args: any[]): void {
  if (!isDebugEnabledInternal()) return;
  // eslint-disable-next-line no-console
  console.log(...args);
}

export function debugWarn(...args: any[]): void {
  if (!isDebugEnabledInternal()) return;
  // eslint-disable-next-line no-console
  console.warn(...args);
}

/**
 * Set the global model owner query mapping
 * @param queryMap Mapping of model names to their owner query names
 */
export function setModelOwnerQueryMap(queryMap: Record<string, string>): void {
  globalConfig.modelOwnerQueryMap = { ...queryMap };
  debugLog("🔧 AmplifyQuery: Global model owner query map configured");
}

/**
 * Set the global model AWSJSON field mapping
 * @param fieldMap Mapping of model names to AWSJSON field names
 */
export function setAwsJsonFieldMap(
  fieldMap: Record<string, string[]>
): void {
  const normalized: Record<string, string[]> = {};
  Object.entries(fieldMap || {}).forEach(([modelName, fields]) => {
    if (!Array.isArray(fields)) {
      normalized[modelName] = [];
      return;
    }
    normalized[modelName] = fields.filter(
      (field): field is string => typeof field === "string" && field.length > 0
    );
  });
  globalConfig.awsJsonFieldMap = normalized;
  debugLog("🔧 AmplifyQuery: Global AWSJSON field map configured", normalized);
}

/**
 * Get global AWSJSON field mapping
 * @returns Model-to-fields mapping or undefined
 */
export function getAwsJsonFieldMap(): Record<string, string[]> | undefined {
  return globalConfig.awsJsonFieldMap;
}

/**
 * Enable/disable automatic AWSJSON transform.
 * When enabled, service layer stringifies configured AWSJSON fields on writes
 * and parses them back on reads.
 */
export function setAwsJsonAutoTransform(enabled: boolean): void {
  globalConfig.awsJsonAutoTransform = enabled === true;
  debugLog(
    `🔧 AmplifyQuery: AWSJSON auto transform set to ${globalConfig.awsJsonAutoTransform}`
  );
}

export function isAwsJsonAutoTransformEnabled(): boolean {
  return globalConfig.awsJsonAutoTransform === true;
}

/**
 * Get the global model owner query mapping
 * @returns The global model owner query mapping or undefined if not set
 */
export function getModelOwnerQueryMap(): Record<string, string> | undefined {
  return globalConfig.modelOwnerQueryMap;
}

/**
 * Set the global selection set mapping
 * @param selectionSetMap Mapping of model names to selection sets
 */

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
  debugLog(`🔧 AmplifyQuery: Default auth mode set to ${authMode}`);
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
  debugLog("🔧 AmplifyQuery: Global configuration reset");
}

/**
 * Enable/disable singleton auto-create behavior for singleton hooks.
 *
 * - **New**: `useSingletonHook()` (recommended)
 */
export function setSingletonAutoCreate(config: {
  enabled?: boolean;
  models?: string[];
}): void {
  globalConfig.singletonAutoCreate = {
    // Default: enabled (singleton services are meant to be convenient)
    enabled: config.enabled !== false,
    models: Array.isArray(config.models) ? config.models : undefined,
  };
  debugLog(
    "🔧 AmplifyQuery: Singleton auto-create configured",
    globalConfig.singletonAutoCreate
  );
}

export function getSingletonAutoCreate(): {
  enabled?: boolean;
  models?: string[];
} | undefined {
  return globalConfig.singletonAutoCreate;
}

export function isSingletonAutoCreateEnabledForModel(modelName: string): boolean {
  const cfg = getSingletonAutoCreate();
  if (!cfg?.enabled) return false;
  if (!cfg.models || cfg.models.length === 0) return true;
  return cfg.models.includes(modelName);
}
