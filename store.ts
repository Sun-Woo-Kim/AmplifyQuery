import { BaseModel, StoreState } from "./types";
import { create } from "zustand";

/**
 * Create cache store for each model
 */
export function createModelStore<T extends BaseModel>(modelName: string) {
  return create<StoreState<T>>((set, get) => ({
    items: [],
    itemsMap: new Map<string, T>(),
    lastFetched: null,
    isLoading: false,
    error: null,

    setItems: (items: T[]) => {
      const itemsMap = new Map<string, T>();
      items.forEach((item) => itemsMap.set(item.id, item));

      set({
        items,
        itemsMap,
        lastFetched: Date.now(),
        error: null,
      });
    },

    setItem: (item: T) => {
      const items = [...get().items];
      const itemsMap = new Map(get().itemsMap);

      // Search for existing item
      const index = items.findIndex((i) => i.id === item.id);

      if (index >= 0) {
        // Update existing item
        items[index] = item;
      } else {
        // Add new item
        items.push(item);
      }

      // Update map
      itemsMap.set(item.id, item);

      set({
        items,
        itemsMap,
        lastFetched: Date.now(),
        error: null,
      });
    },

    removeItem: (id: string) => {
      const items = get().items.filter((item) => item.id !== id);
      const itemsMap = new Map(get().itemsMap);
      itemsMap.delete(id);

      set({
        items,
        itemsMap,
        error: null,
      });
    },

    setLoading: (isLoading: boolean) => set({ isLoading }),

    setError: (error: Error | null) => set({ error }),

    resetState: () =>
      set({
        items: [],
        itemsMap: new Map<string, T>(),
        lastFetched: null,
        isLoading: false,
        error: null,
      }),
  }));
}
