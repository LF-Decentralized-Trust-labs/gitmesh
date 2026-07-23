import type { AgentAdapter } from "./types.js";

/** Lazily loads an adapter module on first use. */
export type AdapterLoader = () => Promise<AgentAdapter>;

/**
 * Built-in adapter loaders keyed by adapter name. Loaders are lazy: an
 * adapter module is imported only when first requested, so listing adapters
 * never pays for loading them all.
 */
export const builtinAdapterLoaders: ReadonlyMap<string, AdapterLoader> = new Map<
  string,
  AdapterLoader
>([
  [
    "claude-code",
    async () => (await import("./claude-code/index.js")).claudeCodeAdapter,
  ],
]);

export interface AdapterRegistry {
  /** Registered adapter names, sorted for deterministic output. */
  list(): string[];
  has(name: string): boolean;
  /** Register an adapter loader; duplicate names are an error. */
  register(name: string, loader: AdapterLoader): void;
  /** Load an adapter by name; the loader runs at most once. */
  load(name: string): Promise<AgentAdapter>;
}

export function createAdapterRegistry(
  loaders: ReadonlyMap<string, AdapterLoader> = builtinAdapterLoaders,
): AdapterRegistry {
  const registered = new Map(loaders);
  const cache = new Map<string, Promise<AgentAdapter>>();

  return {
    list() {
      return [...registered.keys()].sort();
    },
    has(name) {
      return registered.has(name);
    },
    register(name, loader) {
      if (registered.has(name)) {
        throw new Error(`Adapter already registered: ${name}`);
      }
      registered.set(name, loader);
    },
    async load(name) {
      const cached = cache.get(name);
      if (cached) {
        return cached;
      }
      const loader = registered.get(name);
      if (!loader) {
        throw new Error(`Unknown adapter: ${name}`);
      }
      const loading = loader();
      cache.set(name, loading);
      // A rejected load must not poison the cache; allow retries.
      loading.catch(() => cache.delete(name));
      return loading;
    },
  };
}
