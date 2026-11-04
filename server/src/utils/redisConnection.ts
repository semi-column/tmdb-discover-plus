import { TIMEOUTS } from '../constants.ts';

export function redisRecoveryOptions() {
  return {
    pingInterval: TIMEOUTS.REDIS_STARTUP_MS,
    // Written commands ignore timeouts; cap the backlog while a stalled socket awaits reconnect.
    commandsQueueMaxLength: 1_000,
    socket: {
      connectTimeout: TIMEOUTS.REDIS_STARTUP_MS,
      socketTimeout: 2 * TIMEOUTS.REDIS_STARTUP_MS,
      // node-redis otherwise stops reconnecting after a socket timeout.
      reconnectStrategy: (retries: number) =>
        Math.min(50 * 2 ** retries, 2_000) + Math.floor(Math.random() * 200),
    },
  };
}

async function awaitRedis<T>(operation: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), TIMEOUTS.REDIS_STARTUP_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function awaitRedisStartup<T>(connection: Promise<T>): Promise<T> {
  return awaitRedis(connection, 'Redis startup connection timed out');
}

// node-redis's command timeout stops once a command has been written to the socket.
export function awaitRedisCommand<T>(command: Promise<T>): Promise<T> {
  return awaitRedis(command, 'Redis command timed out');
}
