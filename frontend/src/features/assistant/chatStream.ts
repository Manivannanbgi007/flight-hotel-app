import { refreshAccessToken } from '@/lib/api/client';
import { sessionStore } from '@/lib/auth/sessionStore';
import { SseParser, type SseEvent } from '@/lib/realtime/sseParser';
import { toActions, toBlocks } from './blocks';
import type { ChatStreamEvent, Source } from './types';

/**
 * `POST /api/assistant/chat` as a stream of parsed events. `fetch` + `ReadableStream` (an EventSource cannot POST or
 * send the Authorization header), the same SSE parser as the live updates (split lines and CR LF across chunks,
 * several events per chunk, `: keep-alive` comments ignored).
 */

/** A problem before the stream started (Problem Details, or the gateway's empty 429). */
export class ChatProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** From `Retry-After` (429), in seconds. */
    readonly retryAfterSeconds: number | null = null,
    readonly correlationId: string | null = null,
  ) {
    super(message);
    this.name = 'ChatProblem';
  }
}

export interface StreamChatOptions {
  message: string;
  conversationId: string | null;
  signal: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
  /** For tests. */
  fetchImpl?: typeof fetch;
  refresh?: () => Promise<boolean>;
  getAccessToken?: () => string | null;
}

/**
 * Sends the question and calls `onEvent` for every event until the server closes the stream. Rejects with a
 * {@link ChatProblem} when the answer never started, with a TypeError when the network failed, and with an AbortError
 * when `signal` was aborted (Stop). A `401` refreshes the session once and tries again, like the API client.
 */
export async function streamChat({
  message,
  conversationId,
  signal,
  onEvent,
  fetchImpl = (input, init) => fetch(input, init),
  refresh = refreshAccessToken,
  getAccessToken = () => sessionStore.getAccessToken(),
}: StreamChatOptions): Promise<void> {
  const post = (token: string | null) =>
    fetchImpl('/api/assistant/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Requested-With': 'XMLHttpRequest',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(conversationId ? { message, conversationId } : { message }),
      signal,
      cache: 'no-store',
      credentials: 'same-origin',
    });

  const token = getAccessToken();
  let response = await post(token);
  if (response.status === 401 && token && (await refresh())) {
    await discard(response);
    response = await post(getAccessToken());
  }
  if (!response.ok || !response.body || !isEventStream(response)) {
    throw await problemOf(response);
  }
  await readChatEvents(response.body, onEvent);
}

function isEventStream(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream');
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Already closed.
  }
}

async function problemOf(response: Response): Promise<ChatProblem> {
  let body: { code?: unknown; detail?: unknown; correlationId?: unknown } = {};
  try {
    const text = await response.text();
    body = text ? (JSON.parse(text) as typeof body) : {};
  } catch {
    // Not JSON (the gateway's 429 has no body).
  }
  const status = response.ok ? 0 : response.status;
  const fallbackCode = response.ok ? 'UNEXPECTED_RESPONSE' : status === 429 ? 'RATE_LIMITED' : `HTTP_${status}`;
  return new ChatProblem(
    status,
    typeof body.code === 'string' ? body.code : fallbackCode,
    typeof body.detail === 'string' ? body.detail : '',
    status === 429 ? retryAfterSeconds(response.headers) : null,
    typeof body.correlationId === 'string' ? body.correlationId : response.headers.get('x-correlation-id'),
  );
}

/**
 * How long to wait after a `429`: `Retry-After` when sent; otherwise worked out from the gateway's token-bucket headers
 * (`X-RateLimit-Requested-Tokens` − `X-RateLimit-Remaining`, at `X-RateLimit-Replenish-Rate` per second; the values
 * are comma lists when several limiters ran). Null when nothing tells.
 */
export function retryAfterSeconds(headers: Headers): number | null {
  const retryAfter = Number(headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return retryAfter;
  }
  const numbers = (name: string) => {
    const value = headers.get(name);
    return value ? value.split(',').map((part) => Number(part.trim())).filter((n) => Number.isFinite(n) && n >= 0) : [];
  };
  const requested = Math.max(...numbers('x-ratelimit-requested-tokens'), 0);
  const remaining = numbers('x-ratelimit-remaining');
  const rate = Math.min(...numbers('x-ratelimit-replenish-rate').filter((n) => n > 0), Infinity);
  if (!requested || remaining.length === 0 || !Number.isFinite(rate)) {
    return null;
  }
  return Math.max(1, Math.ceil((requested - Math.min(...remaining)) / rate));
}

/** Reads the event stream to its end. UTF-8 characters split across chunks (₹ is three bytes) are decoded correctly. */
export async function readChatEvents(body: ReadableStream<Uint8Array>, onEvent: (event: ChatStreamEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser((event) => {
    const parsed = toChatEvent(event);
    if (parsed) {
      onEvent(parsed);
    }
  });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      parser.feed(decoder.decode(value, { stream: true }));
    }
    parser.feed(decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

/** One SSE event → a typed chat event; unknown events and malformed data are skipped. */
export function toChatEvent(event: SseEvent): ChatStreamEvent | null {
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(event.data);
    if (!parsed || typeof parsed !== 'object') return null;
    data = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  switch (event.event) {
    case 'conversation':
      return typeof data.id === 'string' ? { type: 'conversation', id: data.id } : null;
    case 'status':
      return { type: 'status', text: text(data.text), tool: typeof data.tool === 'string' ? data.tool : null };
    case 'delta':
      return { type: 'delta', text: text(data.text), replace: data.replace === true };
    case 'blocks':
      return { type: 'blocks', blocks: toBlocks(data.blocks), actions: toActions(data.actions) };
    case 'done':
      return { type: 'done', messageId: text(data.messageId), sources: toSources(data.sources), grounded: data.grounded !== false };
    case 'error':
      return { type: 'error', code: text(data.code) || 'ASSISTANT_FAILED', message: text(data.message) };
    default:
      return null;
  }
}

/** The answer's sources, once per tool, in the server's order. */
export function toSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const item of value) {
    const source = item as Partial<Source> | null;
    if (source && typeof source.tool === 'string' && typeof source.label === 'string' && !seen.has(source.tool)) {
      seen.add(source.tool);
      sources.push({ tool: source.tool, label: source.label });
    }
  }
  return sources;
}
