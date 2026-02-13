import { AsyncLocalStorage } from 'node:async_hooks';
import { nanoid } from 'nanoid';

interface RequestStore {
  requestId: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestStore>();

export function getRequestId(): string | undefined {
  return asyncLocalStorage.getStore()?.requestId;
}

export function requestIdMiddleware() {
  return (req: any, res: any, next: () => void): void => {
    const requestId = (req.headers['x-request-id'] as string) || nanoid(12);
    res.setHeader('X-Request-Id', requestId);
    asyncLocalStorage.run({ requestId }, next);
  };
}
