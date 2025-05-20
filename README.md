# AmplifyQuery

A library that combines AWS Amplify and React Query, making it easier to manage Amplify backend data in React applications.

## Key Features

- 💡 **Simple Type-Based API**: Written in TypeScript for complete type safety and autocompletion support.
- 🔄 **React Query Integration**: Leverage all React Query features like caching, retries, background updates, etc.
- 📱 **Offline Support**: Persistent query caching via MMKV for fast data loading even offline.
- 🪝 **Convenient Hooks API**: Abstract complex data synchronization into simple Hooks.
- 🛡 **Auth Mode Support**: Supports various AWS Amplify authentication modes (API Key, IAM, Cognito, etc.).
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

### 2. Service Creation

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

// Create Todo service
const TodoService = AmplifyQuery.createAmplifyService<TodoModel>("Todo");

// Create Singleton service (for single-instance models)
const UserSettingsService =
  AmplifyQuery.createSingletonService<UserSettingsModel>("UserSettings");
```

### 3. Data Fetching and Saving

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

### 4. Using React Hooks

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
// Set global default authentication mode
AmplifyQuery.configure({ client, defaultAuthMode: "userPool" });

// Set authentication mode for a service
TodoService.setAuthMode("apiKey");

// Apply authentication mode to a specific request
await TodoService.list({ authMode: "iam" });

// Get a new service instance with a specific auth mode applied
const adminTodoService = TodoService.withAuthMode("iam");
```

## Important Notes

- This library is designed to be used with AWS Amplify v6 or higher.
- Requires React Query v5 or higher.
- Test thoroughly before using in a production project.

## License

MIT
