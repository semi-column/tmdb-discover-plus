import { createHash } from 'node:crypto';

export function normalizeMessage(message: string): string {
  return message
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\btt\d+\b/g, '<imdb>')
    .replace(/\b[0-9a-f]{12,}\b/gi, '<hex>')
    .replace(/(["'`])(?:(?!\1).){1,200}\1/g, '<str>')
    .replace(/\d+(\.\d+)?/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** First stack frame from our own code, without line/column so small edits don't split a group. */
export function topAppFrame(stack: string): string {
  for (const line of stack.split('\n').slice(1)) {
    if (line.includes('node_modules') || line.includes('node:')) continue;
    const match = /at\s+(?:(.+?)\s+\()?.*?([\w.-]+\/[\w.-]+\.(?:ts|js)):\d+/.exec(line);
    if (match) return `${match[1] ?? '<anonymous>'}@${match[2]}`;
  }
  return '';
}

export function computeFingerprint(
  level: string,
  context: string,
  message: string,
  detail: string,
  stack: string,
  classification = ''
): string {
  return createHash('sha1')
    .update(
      [
        level,
        context,
        classification,
        normalizeMessage(message),
        normalizeMessage(detail),
        topAppFrame(stack),
      ].join('|')
    )
    .digest('hex')
    .slice(0, 16);
}

export function extractDetail(data: Record<string, unknown> | null): {
  detail: string;
  stack: string;
} {
  if (!data) return { detail: '', stack: '' };
  const pick = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as { message?: unknown }).message === 'string'
    ) {
      return (value as { message: string }).message;
    }
    return '';
  };
  const detail = pick(data.error) || pick(data.reason) || pick(data.err);
  const nestedStack = [data.error, data.err, data.reason]
    .map((value) =>
      value && typeof value === 'object' ? (value as { stack?: unknown }).stack : undefined
    )
    .find((value) => typeof value === 'string' && value);
  let stack =
    typeof data.stack === 'string'
      ? data.stack
      : typeof nestedStack === 'string'
        ? nestedStack
        : '';
  let error: unknown = [data.error, data.err, data.reason].find(
    (value) => value && typeof value === 'object'
  );
  for (let depth = 0; depth < 4; depth++) {
    if (!error || typeof error !== 'object' || !('cause' in error)) break;
    error = error.cause;
    if (!error || typeof error !== 'object') break;
    const cause =
      'stack' in error && typeof error.stack === 'string'
        ? error.stack
        : 'message' in error && typeof error.message === 'string'
          ? error.message
          : '';
    if (cause) stack += `\nCaused by: ${cause}`;
  }
  return { detail: detail.slice(0, 1000), stack: stack.slice(0, 4000) };
}

export function classifyError(message: string, data: Record<string, unknown> | null): string {
  if (data?.classification === 'user_config') return 'user_config';
  const { detail } = extractDetail(data);
  if (/invalid api key|collection id required/i.test(`${message} ${detail}`)) return 'user_config';
  return 'application';
}
