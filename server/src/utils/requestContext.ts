import { AsyncLocalStorage } from 'node:async_hooks';
import { nanoid } from 'nanoid';

interface RequestStore {
  requestId: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestStore>();

export function getRequestId(): string | undefined {
  return asyncLocalStorage.getStore()?.requestId;
}

const VALID_REQUEST_ID = /^[\w\-.]+$/;
const MAX_REQUEST_ID_LENGTH = 128;

export function requestIdMiddleware() {
  return (req: any, res: any, next: () => void): void => {
    const incoming = req.headers['x-request-id'] as string | undefined;
    const requestId =
      incoming && incoming.length <= MAX_REQUEST_ID_LENGTH && VALID_REQUEST_ID.test(incoming)
        ? incoming
        : nanoid(12);
    res.setHeader('X-Request-Id', requestId);
    asyncLocalStorage.run({ requestId }, next);
  };
}
