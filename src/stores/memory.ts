import type { IdempotencyStore } from '../types.js';

export interface MemoryStoreOptions {
  // Default TTL applied when claim() is called without an explicit ttlSeconds.
  defaultTtlSeconds?: number;
}

export class MemoryStore implements IdempotencyStore {
  // Value is the expiry epoch-ms, or Infinity when the entry never expires.
  private readonly seen = new Map<string, number>();
  private readonly defaultTtlSeconds?: number;

  constructor(options: MemoryStoreOptions = {}) {
    this.defaultTtlSeconds = options.defaultTtlSeconds;
  }

  async claim(id: string, ttlSeconds?: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.seen.get(id);
    if (existing !== undefined && existing > now) return false;

    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    const expiry = ttl === undefined ? Infinity : now + ttl * 1000;
    this.seen.set(id, expiry);
    return true;
  }
}
