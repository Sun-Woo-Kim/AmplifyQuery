import { GraphQLClient } from "./types";

/**
 * API client to be used throughout the application.
 * This is injected by the library user.
 */
let _client: GraphQLClient | null = null;

/**
 * Function to set the client.
 * @param client GraphQL client to inject.
 */
export function setClient(client: GraphQLClient): void {
  _client = client;
}

/**
 * Returns the currently configured client.
 * Throws an error if the client has not been set.
 */
export function getClient(): GraphQLClient {
  if (!_client) {
    throw new Error(
      "API client has not been configured. Please call AmplifyQuery.configure() first."
    );
  }
  return _client;
}
