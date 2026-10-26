import { EventEmitter } from 'node:events';
import { createClient, type RedisClientType } from 'redis';
import { createLogger } from '../../utils/logger.ts';
import type { InstanceInfo, LiveBatch, TailItem } from './types.ts';

const log = createLogger('obs:live');

const MINUTE_TTL_SEC = 24 * 3600;
const TAIL_MAX = 500;
const INSTANCE_STALE_MS = 90_000;
const LIVE_CHANNEL = 'obs:live';

export interface LiveStore {
  readonly driver: 'redis' | 'memory';
  apply(batch: LiveBatch, hourTtlSec: number): Promise<void>;
  readBuckets(
    kind: 'm' | 'h',
    from: number,
    to: number
  ): Promise<Map<number, Record<string, number>>>;
  countUsers(keys: string[]): Promise<number>;
  readTail(limit: number): Promise<TailItem[]>;
  subscribe(listener: (items: TailItem[]) => void): () => void;
  heartbeat(instance: string, sample: Record<string, unknown>): Promise<void>;
  listInstances(): Promise<InstanceInfo[]>;
  incr(key: string, ttlSec: number): Promise<number>;
  getCount(key: string): Promise<number>;
  del(key: string): Promise<void>;
  setFlag(key: string, ttlSec: number): Promise<void>;
  hasFlag(key: string): Promise<boolean>;
  close(): Promise<void>;
}

function toNumbers(raw: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = Number(v);
  return out;
}

export class RedisLiveStore implements LiveStore {
  readonly driver = 'redis' as const;
  private client: RedisClientType;
  private subscriber: RedisClientType | null = null;
  private emitter = new EventEmitter();

  constructor(url: string) {
    this.client = createClient({ url });
    this.client.on('error', (err: Error) => log.warn('Redis error', { error: err.message }));
    this.emitter.setMaxListeners(50);
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async apply(batch: LiveBatch, hourTtlSec: number): Promise<void> {
    const multi = this.client.multi();
    for (const [minute, fields] of batch.minutes) {
      const key = `obs:m:${minute}`;
      for (const [field, value] of fields) multi.hIncrBy(key, field, value);
      multi.expire(key, MINUTE_TTL_SEC);
    }
    for (const [hour, fields] of batch.hours) {
      const key = `obs:h:${hour}`;
      for (const [field, value] of fields) multi.hIncrBy(key, field, value);
      multi.expire(key, hourTtlSec);
    }
    for (const [suffix, users] of batch.users) {
      const key = `obs:u:${suffix}`;
      multi.pfAdd(key, [...users]);
      multi.expire(key, hourTtlSec);
    }
    if (batch.tail.length) {
      multi.lPush(
        'obs:tail',
        batch.tail.map((item) => JSON.stringify(item))
      );
      multi.lTrim('obs:tail', 0, TAIL_MAX - 1);
      multi.publish(LIVE_CHANNEL, JSON.stringify(batch.tail));
    }
    await multi.exec();
  }

  async readBuckets(kind: 'm' | 'h', from: number, to: number) {
    const out = new Map<number, Record<string, number>>();
    const buckets: number[] = [];
    for (let b = from; b <= to; b++) buckets.push(b);
    for (let i = 0; i < buckets.length; i += 200) {
      const chunk = buckets.slice(i, i + 200);
      const multi = this.client.multi();
      for (const b of chunk) multi.hGetAll(`obs:${kind}:${b}`);
      const results = (await multi.exec()) as unknown as Array<Record<string, string>>;
      chunk.forEach((b, idx) => {
        const raw = results[idx];
        if (raw && Object.keys(raw).length) out.set(b, toNumbers(raw));
      });
    }
    return out;
  }

  async countUsers(keys: string[]): Promise<number> {
    if (!keys.length) return 0;
    return this.client.pfCount(keys.map((k) => `obs:u:${k}`));
  }

  async readTail(limit: number): Promise<TailItem[]> {
    const raw = await this.client.lRange('obs:tail', 0, Math.min(limit, TAIL_MAX) - 1);
    return raw.map((item) => JSON.parse(item) as TailItem);
  }

  subscribe(listener: (items: TailItem[]) => void): () => void {
    this.emitter.on('live', listener);
    if (!this.subscriber) {
      const sub = this.client.duplicate();
      this.subscriber = sub;
      sub.on('error', (err: Error) => log.warn('Redis subscriber error', { error: err.message }));
      sub
        .connect()
        .then(() =>
          sub.subscribe(LIVE_CHANNEL, (message: string) => {
            try {
              this.emitter.emit('live', JSON.parse(message));
            } catch {
              // ignore malformed payloads
            }
          })
        )
        .catch((err: Error) => log.warn('Redis subscribe failed', { error: err.message }));
    }
    return () => {
      this.emitter.off('live', listener);
      if (this.emitter.listenerCount('live') === 0 && this.subscriber) {
        const sub = this.subscriber;
        this.subscriber = null;
        sub.quit().catch(() => undefined);
      }
    };
  }

  async heartbeat(instance: string, sample: Record<string, unknown>): Promise<void> {
    await this.client
      .multi()
      .zAdd('obs:instances', { score: Date.now(), value: instance })
      .set(`obs:instance:${instance}`, JSON.stringify(sample), { EX: 120 })
      .zRemRangeByScore('obs:instances', 0, Date.now() - 7 * 24 * 3600 * 1000)
      .exec();
  }

  async listInstances(): Promise<InstanceInfo[]> {
    const entries = await this.client.zRangeWithScores('obs:instances', 0, -1);
    const out: InstanceInfo[] = [];
    for (const { value, score } of entries) {
      const fresh = Date.now() - score < INSTANCE_STALE_MS;
      const raw = fresh ? await this.client.get(`obs:instance:${value}`) : null;
      out.push({ instance: value, lastSeen: score, sample: raw ? JSON.parse(raw) : null });
    }
    return out.sort((a, b) => b.lastSeen - a.lastSeen);
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    const [count] = (await this.client
      .multi()
      .incr(`obs:${key}`)
      .expire(`obs:${key}`, ttlSec, 'NX')
      .exec()) as unknown as [number];
    return Number(count);
  }

  async getCount(key: string): Promise<number> {
    return Number((await this.client.get(`obs:${key}`)) ?? 0);
  }

  async del(key: string): Promise<void> {
    await this.client.del(`obs:${key}`);
  }

  async setFlag(key: string, ttlSec: number): Promise<void> {
    await this.client.set(`obs:${key}`, '1', { EX: ttlSec });
  }

  async hasFlag(key: string): Promise<boolean> {
    return (await this.client.exists(`obs:${key}`)) === 1;
  }

  async close(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
    await this.client.quit().catch(() => undefined);
  }
}

interface Expiring<T> {
  value: T;
  expiresAt: number;
}

/** Single-process fallback used when Redis is not configured. */
export class MemoryLiveStore implements LiveStore {
  readonly driver = 'memory' as const;
  private buckets = new Map<string, Expiring<Map<string, number>>>();
  private users = new Map<string, Expiring<Set<string>>>();
  private counters = new Map<string, Expiring<number>>();
  private tail: TailItem[] = [];
  private emitter = new EventEmitter();
  private instances = new Map<string, InstanceInfo>();

  private prune(): void {
    const now = Date.now();
    for (const map of [this.buckets, this.users, this.counters] as Array<
      Map<string, Expiring<unknown>>
    >) {
      for (const [key, entry] of map) if (entry.expiresAt <= now) map.delete(key);
    }
  }

  async apply(batch: LiveBatch, hourTtlSec: number): Promise<void> {
    this.prune();
    const now = Date.now();
    const merge = (key: string, fields: Map<string, number>, ttlSec: number) => {
      const entry = this.buckets.get(key) ?? { value: new Map<string, number>(), expiresAt: 0 };
      for (const [field, value] of fields)
        entry.value.set(field, (entry.value.get(field) ?? 0) + value);
      entry.expiresAt = now + ttlSec * 1000;
      this.buckets.set(key, entry);
    };
    for (const [minute, fields] of batch.minutes) merge(`m:${minute}`, fields, MINUTE_TTL_SEC);
    for (const [hour, fields] of batch.hours) merge(`h:${hour}`, fields, hourTtlSec);
    for (const [suffix, set] of batch.users) {
      const entry = this.users.get(suffix) ?? { value: new Set<string>(), expiresAt: 0 };
      for (const u of set) entry.value.add(u);
      entry.expiresAt = now + hourTtlSec * 1000;
      this.users.set(suffix, entry);
    }
    if (batch.tail.length) {
      this.tail = [...[...batch.tail].reverse(), ...this.tail].slice(0, TAIL_MAX);
      this.emitter.emit('live', batch.tail);
    }
  }

  async readBuckets(kind: 'm' | 'h', from: number, to: number) {
    const out = new Map<number, Record<string, number>>();
    for (let b = from; b <= to; b++) {
      const entry = this.buckets.get(`${kind}:${b}`);
      if (entry) out.set(b, Object.fromEntries(entry.value));
    }
    return out;
  }

  async countUsers(keys: string[]): Promise<number> {
    const union = new Set<string>();
    for (const key of keys) for (const u of this.users.get(key)?.value ?? []) union.add(u);
    return union.size;
  }

  async readTail(limit: number): Promise<TailItem[]> {
    return this.tail.slice(0, limit);
  }

  subscribe(listener: (items: TailItem[]) => void): () => void {
    this.emitter.on('live', listener);
    return () => this.emitter.off('live', listener);
  }

  async heartbeat(instance: string, sample: Record<string, unknown>): Promise<void> {
    this.instances.set(instance, { instance, lastSeen: Date.now(), sample });
  }

  async listInstances(): Promise<InstanceInfo[]> {
    return [...this.instances.values()];
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    this.prune();
    const entry = this.counters.get(key) ?? { value: 0, expiresAt: Date.now() + ttlSec * 1000 };
    entry.value += 1;
    this.counters.set(key, entry);
    return entry.value;
  }

  async getCount(key: string): Promise<number> {
    this.prune();
    return this.counters.get(key)?.value ?? 0;
  }

  async del(key: string): Promise<void> {
    this.counters.delete(key);
  }

  async setFlag(key: string, ttlSec: number): Promise<void> {
    this.counters.set(key, { value: 1, expiresAt: Date.now() + ttlSec * 1000 });
  }

  async hasFlag(key: string): Promise<boolean> {
    this.prune();
    return this.counters.has(key);
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}
