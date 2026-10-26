export interface RequestEvent {
  ts: number;
  requestId: string;
  instance: string;
  method: string;
  route: string;
  path: string;
  status: number;
  durationMs: number;
  resource: string;
  source: string;
  contentType: string;
  catalogId: string;
  userHash: string;
  client: string;
  ua: string;
  country: string;
  colo: string;
  ipHash: string;
  cacheHits: number;
  cacheMisses: number;
  upstreamCalls: number;
  upstreamMs: number;
  errorFp: string;
  /** 1 / sampling probability, so sums over stored rows estimate true counts. */
  weight: number;
}

export interface UpstreamEvent {
  ts: number;
  requestId: string;
  instance: string;
  provider: string;
  host: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  error: string;
  timedOut: boolean;
}

export interface ErrorEvent {
  ts: number;
  fingerprint: string;
  level: 'warn' | 'error';
  context: string;
  message: string;
  stack: string;
  requestId: string;
  instance: string;
  route: string;
}

export interface SystemSample {
  ts: number;
  instance: string;
  data: Record<string, unknown>;
}

export type TailItem = Pick<
  RequestEvent,
  | 'ts'
  | 'requestId'
  | 'instance'
  | 'method'
  | 'path'
  | 'route'
  | 'status'
  | 'durationMs'
  | 'source'
  | 'resource'
  | 'client'
  | 'country'
  | 'cacheHits'
  | 'cacheMisses'
  | 'upstreamCalls'
  | 'errorFp'
>;

/** minute|hour epoch -> field -> increment */
export type CounterBatch = Map<number, Map<string, number>>;

export interface LiveBatch {
  minutes: CounterBatch;
  hours: CounterBatch;
  /** HyperLogLog key suffix -> user hashes */
  users: Map<string, Set<string>>;
  tail: TailItem[];
}

export interface InstanceInfo {
  instance: string;
  lastSeen: number;
  sample: Record<string, unknown> | null;
}
