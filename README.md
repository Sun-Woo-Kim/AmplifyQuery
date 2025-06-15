# AmplifyQuery

A library that combines AWS Amplify and React Query, making it easier to manage Amplify backend data in React applications.

## Key Features

- 💡 **Simple Type-Based API**: Written in TypeScript for complete type safety and autocompletion support.
- 🔄 **React Query Integration**: Leverage all React Query features like caching, retries, background updates, etc.
- 📱 **Offline Support**: Persistent query caching via MMKV for fast data loading even offline.
- 🪝 **Convenient Hooks API**: Abstract complex data synchronization into simple Hooks.
- 🛡 **Auth Mode Support**: Supports various AWS Amplify authentication modes (API Key, IAM, Cognito, etc.).
- ⚙️ **Global Configuration**: Set model mappings and auth modes once - no more repetitive configuration.
- ⚡ **Performance Optimized**: Maximize performance with request batching and intelligent caching.

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
    mmkvId: "my-app.cache", // MMKV store ID
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
  } = TodoService.useHook();

  // Hook for managing a single item
  const { item: settings, update: updateSettings } =
    UserSettingsService.useItemHook(); // Assuming UserSettingsService is defined

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

## Advanced Features

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

AmplifyQuery uses MMKV to persistently cache query results. This allows the app to display previous data immediately upon restart.

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

// Set authentication mode for an existing service
TodoService.setAuthMode("apiKey");

await TodoService.list({ authMode: "iam" });
const adminTodoService = TodoService.withAuthMode("iam");
```

## Important Notes

- This library is designed to be used with AWS Amplify v6 or higher.
- Requires React Query v5 or higher.
- Test thoroughly before using in a production project.

## License

MIT
