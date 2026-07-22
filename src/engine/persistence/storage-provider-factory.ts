import type { StorageProvider, StorageProviderConfig } from './storage-provider';
import { LocalStorageProvider } from './providers/local-storage-provider';
import { NullStorageProvider } from './providers/null-storage-provider';

export enum StorageProviderType {
  LOCAL_STORAGE = 'local_storage',
  NULL = 'null',
}

type ProviderFactory = (config?: StorageProviderConfig) => StorageProvider;

export class StorageProviderFactory {
  private readonly registry_: Map<string, ProviderFactory> = new Map();

  constructor() {
    // Seed with built-in providers
    this.registry_.set(StorageProviderType.LOCAL_STORAGE, (config) => new LocalStorageProvider(config));
    this.registry_.set(StorageProviderType.NULL, () => new NullStorageProvider());
  }

  /** Register a new provider type. Pro plugins use this to add D1, WebSocket, etc. */
  register(type: string, factory: ProviderFactory): void {
    this.registry_.set(type, factory);
  }

  /** Create a provider instance by type. */
  create(type: string, config?: StorageProviderConfig): StorageProvider {
    const factory = this.registry_.get(type);

    if (!factory) {
      throw new Error(`Unknown storage provider type: ${type}`);
    }

    return factory(config);
  }

  /** Check if a provider type is registered. */
  has(type: string): boolean {
    return this.registry_.has(type);
  }
}
