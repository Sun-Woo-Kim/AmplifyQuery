# AmplifyQuery

A library that combines AWS Amplify and React Query, making it easier to manage Amplify backend data in React applications.

## Key Features

- 💡 **Simple Type-Based API**: Written in TypeScript for complete type safety and autocompletion support.
- 🔄 **React Query Integration**: Leverage all React Query features like caching, retries, background updates, etc.
- 📱 **Offline Support**: Persistent query caching via platform-agnostic storage (MMKV for React Native, localStorage for Web) for fast data loading even offline.
- 🪝 **Convenient Hooks API**: Abstract complex data synchronization into simple Hooks.
- 🔴 **Realtime Subscriptions**: Built-in support for AWS Amplify realtime updates with automatic cache synchronization.
- 🛡 **Auth Mode Support**: Supports various AWS Amplify authentication modes (API Key, IAM, Cognito, etc.).
- ⚙️ **Global Configuration**: Set model mappings and auth modes once - no more repetitive configuration.
- ⚡ **Performance Optimized**: Maximize performance with request batching and intelligent caching.
- 🔄 **Automatic Cache Sync**: Mutations automatically update the cache for consistent UI state.

## Installation

```bash
npm install amplifyquery
# or
yarn add amplifyquery
```

## Basic Usage

### 1. Initialization

```typescript
import { AmplifyQuery } from "amplifyquery";
import { generateClient } from "aws-amplify/api";

// Create Amplify client and initialize AmplifyQuery
const client = generateClient();
AmplifyQuery.configure({
  client,

  // Global model owner query mapping (optional)
  // Set once and all services will use it automatically
  modelOwnerQueryMap: {
    User: "listUserByOwner",
    Project: "listProjectByOwner",
    Todo: "listTodoByOwner",
    Comment: "listCommentByOwner",
    // Add your model mappings here
  },

  // Default authentication mode (optional)
  defaultAuthMode: "userPool",

  // Caching options (optional)
  isCachingEnabled: true,

  // Customize Query Client configuration (optional)
  queryClientConfig: {
    defaultOptions: {
      queries: {
        staleTime: 60000, // 1 minute
      },
    },
  },

  // Storage configuration (optional)
  storage: {
    storageId: "my-app.cache", // Storage identifier (MMKV id for React Native, localStorage key prefix for Web)
    cacheKey: "MY_QUERY_CACHE", // Cache key name
    maxAge: 1000 * 60 * 60 * 24 * 3, // 3 days (in milliseconds)
  },
});
```

### 2. Setup Provider (Important!)

Wrap your application with `AmplifyQueryProvider` at the root level. This provides the React Query client context to your components.

```tsx
// App.tsx or your main application file
import React from "react";
import { AmplifyQueryProvider } from "amplifyquery"; // Or from 'amplifyquery/provider'
import YourApp from "./YourApp"; // Your main application component

function App() {
  return (
    <AmplifyQueryProvider>
      <YourApp />
    </AmplifyQueryProvider>
  );
}

export default App;
```

Alternatively, if you need to use a custom `QueryClient` instance:

```tsx
// App.tsx or your main application file
import React from "react";
import { createCustomQueryProvider, getQueryClient } from "amplifyquery"; // Or from 'amplifyquery/provider'
import { QueryClient } from "@tanstack/react-query";
import YourApp from "./YourApp"; // Your main application component

// Create a custom client (optional)
const customQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Your custom query client options
      staleTime: 1000 * 60 * 10, // 10 minutes
    },
  },
});

// Create a provider with your custom client, or use the default
const MyCustomProvider = createCustomQueryProvider(customQueryClient);
// const MyDefaultProvider = createCustomQueryProvider(); // Uses the default client configured via AmplifyQuery.configure()

function App() {
  return (
    // Use your custom provider
    <MyCustomProvider>
      <YourApp />
    </MyCustomProvider>
    // Or, if using the default client with createCustomQueryProvider:
    // <MyDefaultProvider>
    //   <YourApp />
    // </MyDefaultProvider>
  );
}

export default App;
```

### 3. Service Creation

```typescript
import { AmplifyQuery } from "amplifyquery";

// Define Todo model type (adjust to your backend schema)
interface TodoModel {
  id: string;
  name: string;
  description?: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

// Create Todo service - automatically uses global modelOwnerQueryMap
const TodoService = AmplifyQuery.createAmplifyService<TodoModel>("Todo");

// Create service with custom auth mode (optional)
const AdminTodoService = AmplifyQuery.createAmplifyService<TodoModel>(
  "Todo",
  "iam"
);

// Create Singleton service (for single-instance models like user settings)
const UserSettingsService =
  AmplifyQuery.createSingletonService<UserSettingsModel>(
    AmplifyQuery.createAmplifyService<UserSettingsModel>("UserSettings"),
    AmplifyQuery.getModelIds.UserSettings
  );

// Singleton hook (recommended)
const {
  item: settings,
  isLoading: isSettingsLoading,
  update: upsertSettings, // creates if missing
  refresh: refreshSettings,
} = UserSettingsService.useSingletonHook();
```

### 4. Data Fetching and Saving

```typescript
// Fetch all items
const todos = await TodoService.list();

// Filtering
const completedTodos = await TodoService.list({
  filter: { completed: { eq: true } },
});

// Fetch a single item
const todo = await TodoService.get("some-id");

// Create
const newTodo = await TodoService.create({
  name: "Buy milk",
  description: "Low-fat milk",
  completed: false,
});

// Update
await TodoService.update({
  id: "some-id",
  completed: true,
});

// Delete
await TodoService.delete("some-id");
```

### 5. Using React Hooks

#### Basic Usage

```tsx
import React from "react";
import { View, Text, Button } from "react-native";

function TodoScreen() {
  // Hook for managing a list of items
  const {
    items: todos,
    isLoading,
    error,
    refresh,
    create,
    update,
    delete: deleteTodo,
    getItem,
  } = TodoService.useHook();

  // Hook for managing a single item
  const {
    item: settings,
    isLoading: isSettingsLoading,
    update: updateSettings,
    refresh: refreshSettings,
  } = UserSettingsService.useItemHook("settings-id");

  if (isLoading) return <Text>Loading...</Text>;
  if (error) return <Text>Error: {error.message}</Text>;

  return (
    <View>
      {todos.map((todo) => (
        <View key={todo.id}>
          <Text>{todo.name}</Text>
          <Button
            title={todo.completed ? "Done" : "Mark as Done"}
            onPress={() => update({ id: todo.id, completed: !todo.completed })}
          />
          <Button title="Delete" onPress={() => deleteTodo(todo.id)} />
        </View>
      ))}
      <Button
        title="New Todo"
        onPress={() => create({ name: "New Todo", completed: false })}
      />
      <Button title="Refresh" onPress={() => refresh()} />
    </View>
  );
}
```

#### Realtime Subscriptions

Enable real-time updates using AWS Amplify's `observeQuery` feature:

```tsx
function TodoScreen() {
  // Enable realtime for list updates
  const {
    items: todos,
    isLoading,
    isSynced, // true when realtime subscription is active
    create,
    update,
    delete: deleteTodo,
  } = TodoService.useHook({
    realtime: {
      enabled: true,
      // Optional: filter events to subscribe to
      events: ["create", "update", "delete"],
    },
  });

  // Enable realtime for single item updates
  const {
    item: todo,
    isSynced: isItemSynced,
    update: updateTodo,
  } = TodoService.useItemHook(todoId, {
    realtime: {
      enabled: true,
    },
  });

  return (
    <View>
      {isSynced && <Text>🟢 Live updates active</Text>}
      {todos.map((todo) => (
        <Text key={todo.id}>{todo.name}</Text>
      ))}
    </View>
  );
}
```

**Realtime Features:**
- ✅ Automatic cache synchronization when data changes
- ✅ Works across multiple devices/sessions
- ✅ `isSynced` flag indicates subscription status
- ✅ Optimistic updates are immediately reflected
- ✅ No manual refresh needed for real-time changes

**Note:** When `realtime.enabled` is `true`, the initial fetch is skipped to avoid duplicate data. The subscription provides the initial data set.

## Advanced Features

### Realtime Subscriptions

AmplifyQuery supports real-time data synchronization using AWS Amplify's `observeQuery` API. When enabled, your UI automatically updates when data changes on the server or other devices.

#### useHook Realtime Options

```typescript
const {
  items,
  isSynced, // true when subscription is active
  create,
  update,
  delete: deleteItem,
} = TodoService.useHook({
  realtime: {
    enabled: true, // Enable realtime subscription
    events: ["create", "update", "delete"], // Optional: filter events
    observeOptions: {
      // Optional: additional observeQuery options
      filter: { completed: { eq: false } },
    },
  },
});
```

#### useItemHook Realtime Options

```typescript
const {
  item,
  isSynced, // true when subscription is active
  update,
  delete: deleteItem,
} = TodoService.useItemHook(todoId, {
  realtime: {
    enabled: true,
    observeOptions: {
      // Optional: additional observeQuery options
    },
  },
});
```

#### How It Works

1. **Initial Load**: When `realtime.enabled` is `true`, the hook subscribes to `observeQuery` instead of making a one-time fetch
2. **Cache Updates**: All changes (create/update/delete) are automatically synchronized to the React Query cache
3. **Cross-Device**: Changes made on other devices or sessions are immediately reflected
4. **Optimistic Updates**: Local mutations are immediately reflected, then confirmed via realtime events

#### Best Practices

- Use realtime for collaborative features or when data changes frequently
- Monitor `isSynced` to show connection status to users
- Combine with optimistic updates for the best user experience
- Consider using `events` filter to reduce unnecessary updates

### Global Configuration

AmplifyQuery supports global configuration to reduce code duplication and simplify service creation.

```typescript
// Set global model owner query mapping (can be done separately from configure)
AmplifyQuery.setModelOwnerQueryMap({
  User: "listUserByOwner",
  Project: "listProjectByOwner",
  Todo: "listTodoByOwner",
  Comment: "listCommentByOwner",
  Like: "listLikeByOwner",
  // Add all your model mappings here
});

// Set global default auth mode
AmplifyQuery.setDefaultAuthMode("userPool");

// Now all services created will automatically use these settings
const UserService = AmplifyQuery.createAmplifyService<User>("User");
const ProjectService = AmplifyQuery.createAmplifyService<Project>("Project");
const TodoService = AmplifyQuery.createAmplifyService<Todo>("Todo");

// Get current global settings
const currentQueryMap = AmplifyQuery.getModelOwnerQueryMap();
const currentAuthMode = AmplifyQuery.getDefaultAuthMode();

// Reset configuration (useful for testing)
AmplifyQuery.resetConfig();
```

#### Migration from Previous Versions

If you were previously passing `modelOwnerQueryMap` to each service, you can now simplify your code:

**Before (repetitive):**

```typescript
const modelOwnerQueryMap = {
  User: "listUserByOwner",
  Project: "listProjectByOwner",
  Todo: "listTodoByOwner",
};

// Had to pass queryMap to every service
const UserService = AmplifyQuery.createAmplifyService<User>(
  "User",
  modelOwnerQueryMap
);
const ProjectService = AmplifyQuery.createAmplifyService<Project>(
  "Project",
  modelOwnerQueryMap
);
const TodoService = AmplifyQuery.createAmplifyService<Todo>(
  "Todo",
  modelOwnerQueryMap
);
```

**After (clean):**

```typescript
// Set once globally
AmplifyQuery.configure({
  client,
  modelOwnerQueryMap: {
    User: "listUserByOwner",
    Project: "listProjectByOwner",
    Todo: "listTodoByOwner",
  },
});

// Create services without repetition
const UserService = AmplifyQuery.createAmplifyService<User>("User");
const ProjectService = AmplifyQuery.createAmplifyService<Project>("Project");
const TodoService = AmplifyQuery.createAmplifyService<Todo>("Todo");
```

### Caching

AmplifyQuery uses platform-agnostic persistent storage (MMKV for React Native, localStorage for Web) to cache query results. This allows the app to display previous data immediately upon restart.

```typescript
// Enable/disable caching (enabled by default)
AmplifyQuery.configure({
  client,
  isCachingEnabled: true, // or false
  storage: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days (in milliseconds)
  },
});

// Reset cache for a specific model
TodoService.resetCache();

// Force refresh a specific query
const todos = await TodoService.list({ forceRefresh: true });
```

#### Automatic Cache Synchronization

AmplifyQuery automatically synchronizes the cache when you use hook methods (`create`, `update`, `delete`):

- **Immediate Updates**: Changes are reflected in the UI immediately after successful operations
- **Consistent State**: The cache stays in sync across all hook instances
- **Optimistic Updates**: UI updates before server confirmation for better UX
- **Realtime Integration**: Works seamlessly with realtime subscriptions

```tsx
// Create, update, delete automatically update the cache
const { create, update, delete: deleteItem } = TodoService.useHook();

// These operations immediately update the hook's items array
await create({ name: "New Todo" });
await update({ id: todoId, completed: true });
await deleteItem(todoId);
```

### Authentication Modes

Access data with various authentication methods.

```typescript
// Set global default authentication mode via configure
AmplifyQuery.configure({
  client,
  defaultAuthMode: "userPool",
});

// Or set it separately
AmplifyQuery.setDefaultAuthMode("userPool");

// Create service with custom auth mode
const AdminTodoService = AmplifyQuery.createAmplifyService<TodoModel>(
  "Todo",
  "iam"
);

TodoService.setAuthMode("apiKey");
await TodoService.list({ authMode: "iam" });
const adminTodoService = TodoService.withAuthMode("iam");
```

### Hook API Reference

#### useHook(options?)

Returns a hook for managing a list of items.

**Options:**
- `initialFetchOptions?: { fetch?: boolean, filter?: Record<string, any> }` - Control initial data fetch
- `customList?: { queryName: string, args: Record<string, any>, forceRefresh?: boolean }` - Use custom query for list
- `realtime?: { enabled?: boolean, observeOptions?: Record<string, any>, events?: Array<"create" | "update" | "delete"> }` - Enable realtime subscriptions

**Returns:**
```typescript
{
  items: T[];              // Array of items
  isLoading: boolean;       // Loading state
  error: Error | null;      // Error state
  isSynced?: boolean;       // Realtime sync status (if realtime enabled)
  getItem: (id: string) => T | undefined;  // Get item by ID from cache
  refresh: (options?: { filter?: Record<string, any> }) => Promise<T[]>;  // Refresh list
  create: (data: Partial<T>) => Promise<T | null>;  // Create new item
  update: (data: Partial<T> & { id: string }) => Promise<T | null>;  // Update item
  delete: (id: string) => Promise<boolean>;  // Delete item
  customList?: (queryName: string, args: Record<string, any>, options?: { forceRefresh?: boolean }) => Promise<T[]>;  // Custom list query
}
```

#### useItemHook(id, options?)

Returns a hook for managing a single item.

**Parameters:**
- `id: string` - The ID of the item to manage

**Options:**
- `realtime?: { enabled?: boolean, observeOptions?: Record<string, any> }` - Enable realtime subscription

**Returns:**
```typescript
{
  item: T | null;          // The item (null if not found or not loaded)
  isLoading: boolean;       // Loading state
  error: Error | null;      // Error state
  isSynced?: boolean;       // Realtime sync status (if realtime enabled)
  refresh: () => Promise<T | null>;  // Refresh item
  update: (data: Partial<T>) => Promise<T | null>;  // Update item (id not needed)
  delete: () => Promise<boolean>;  // Delete item (id not needed)
}
```

## Important Notes

- This library is designed to be used with AWS Amplify v6 or higher.
- Requires React Query v5 or higher.
- When `realtime.enabled` is `true`, the initial fetch is skipped to avoid duplicate data.
- All mutations (`create`, `update`, `delete`) automatically synchronize the cache.
- Test thoroughly before using in a production project.

## License

MIT
