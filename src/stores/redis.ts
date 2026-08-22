import type { IdempotencyStore } from '../types.js';

// Minimal shape of the ioredis client we rely on. Kept local so the package does
// not need ioredis types at build time (it is an optional peer dep).
interface RedisLike {
  set(
    key: string,
    value: string,
    mode: 'EX',
    ttl: number,
    nx: 'NX',
  ): Promise<string | null>;
  set(key: string, value: string, nx: 'NX'): Promise<string | null>;
}

type RedisConnectionOptions = Record<string, unknown> | string;

export interface RedisStoreOptions {
  // Key prefix so claims do not collide with other data in the same Redis.
  keyPrefix?: string;
  // TTL used when claim() is called without an explicit ttlSeconds.
  defaultTtlSeconds?: number;
}

export class RedisStore implements IdempotencyStore {
  private readonly keyPrefix: string;
  private readonly defaultTtlSeconds: number;
  private clientPromise: Promise<RedisLike> | undefined;

  constructor(
    // An existing ioredis instance, or connection options/URL to build one from.
    private readonly clientOrOptions: RedisLike | RedisConnectionOptions,
    options: RedisStoreOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? 'payhooks:idem:';
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? 24 * 60 * 60;
  }

  private async client(): Promise<RedisLike> {
    if (!this.clientPromise) {
      this.clientPromise = this.resolveClient();
    }
    return this.clientPromise;
  }

  private async resolveClient(): Promise<RedisLike> {
    const given = this.clientOrOptions;
    if (given && typeof (given as RedisLike).set === 'function') {
      return given as RedisLike;
    }

    // Indirect specifier so the type checker does not try to resolve this
    // optional peer dep at build time when it is not installed.
    const specifier = 'ioredis';
    let mod: { default: new (opts: RedisConnectionOptions) => RedisLike };
    try {
      mod = (await import(specifier)) as unknown as {
        default: new (opts: RedisConnectionOptions) => RedisLike;
      };
    } catch {
      throw new Error(
        'RedisStore requires the "ioredis" package, which is not installed. ' +
          'Install it with `npm install ioredis` (it is an optional peer dependency), ' +
          'or pass an existing ioredis client instance to the RedisStore constructor.',
      );
    }
    const Redis = mod.default;
    return new Redis(given as RedisConnectionOptions);
  }

  async claim(id: string, ttlSeconds?: number): Promise<boolean> {
    const client = await this.client();
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    const result = await client.set(this.keyPrefix + id, '1', 'EX', ttl, 'NX');
    return result === 'OK';
  }
}
