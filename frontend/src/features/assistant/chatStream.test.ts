import { ChatProblem, readChatEvents, retryAfterSeconds, streamChat, toSources } from './chatStream';
import type { ChatStreamEvent } from './types';

const encoder = new TextEncoder();

/** A response body that delivers exactly these chunks (strings are UTF-8 encoded). */
function body(...chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk));
      controller.close();
    },
  });
}

async function read(...chunks: (string | Uint8Array)[]): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  await readChatEvents(body(...chunks), (event) => events.push(event));
  return events;
}

/** The real stream of the contract (Spring writes `event:` and `data:` without a space). */
const REAL_STREAM = [
  'event:conversation\ndata:{"id":"01a1afe8-274d-7009-b220-93959948511e"}\n\n',
  'event:status\ndata:{"text":"Thinking…","tool":null}\n\n',
  ':keep-alive\n\n',
  'event:status\ndata:{"text":"Looking up your trips…","tool":"my_bookings"}\n\n',
  'event:delta\ndata:{"text":"You have no upcoming ","replace":false}\n\n',
  'event:delta\ndata:{"text":"trips at this time.","replace":false}\n\n',
  'event:done\ndata:{"messageId":"01a1afe8-dfd9","sources":[{"tool":"my_bookings","label":"Your trips"}],"grounded":true}\n\n',
].join('');

const EXPECTED: ChatStreamEvent[] = [
  { type: 'conversation', id: '01a1afe8-274d-7009-b220-93959948511e' },
  { type: 'status', text: 'Thinking…', tool: null },
  { type: 'status', text: 'Looking up your trips…', tool: 'my_bookings' },
  { type: 'delta', text: 'You have no upcoming ', replace: false },
  { type: 'delta', text: 'trips at this time.', replace: false },
  { type: 'done', messageId: '01a1afe8-dfd9', sources: [{ tool: 'my_bookings', label: 'Your trips' }], grounded: true },
];

describe('readChatEvents (the assistant stream)', () => {
  it('reads several events in one chunk and ignores the keep-alive comments', async () => {
    expect(await read(REAL_STREAM)).toEqual(EXPECTED);
  });

  it('reads events split anywhere across chunks, even inside a field name or the JSON', async () => {
    const chunks: string[] = [];
    for (let i = 0; i < REAL_STREAM.length; i += 7) chunks.push(REAL_STREAM.slice(i, i + 7));

    expect(await read(...chunks)).toEqual(EXPECTED);
  });

  it('accepts CR LF line ends, also when a CR LF pair is split between chunks, and a space after the colon', async () => {
    const events = await read(
      'event: delta\r\ndata: {"text":"Hello ","replace":false}\r',
      '\n\r\nevent: delta\r\ndata: {"text":"there","replace":false}\r\n\r\n',
    );

    expect(events).toEqual([
      { type: 'delta', text: 'Hello ', replace: false },
      { type: 'delta', text: 'there', replace: false },
    ]);
  });

  it('decodes characters whose UTF-8 bytes are split across chunks (₹, …)', async () => {
    const bytes = encoder.encode('event:delta\ndata:{"text":"₹6,300 for your stay…","replace":false}\n\n');
    const rupee = bytes.indexOf(0xe2);

    const events = await read(bytes.slice(0, rupee + 1), bytes.slice(rupee + 1, rupee + 2), bytes.slice(rupee + 2));

    expect(events).toEqual([{ type: 'delta', text: '₹6,300 for your stay…', replace: false }]);
  });

  it('keeps a replacing delta, the error event and the ungrounded done', async () => {
    const events = await read(
      'event:delta\ndata:{"text":"I can only give you booking references…","replace":true}\n\n',
      'event:done\ndata:{"messageId":"m1","sources":[],"grounded":false}\n\n',
      'event:error\ndata:{"code":"ASSISTANT_TIMEOUT","message":"The assistant took too long to answer."}\n\n',
    );

    expect(events).toEqual([
      { type: 'delta', text: 'I can only give you booking references…', replace: true },
      { type: 'done', messageId: 'm1', sources: [], grounded: false },
      { type: 'error', code: 'ASSISTANT_TIMEOUT', message: 'The assistant took too long to answer.' },
    ]);
  });

  it('skips unknown events, malformed data and comment-only chunks', async () => {
    const events = await read(
      ': keep-alive\n\n',
      'event:typing\ndata:{"x":1}\n\n',
      'event:delta\ndata:{not json\n\n',
      'event:delta\ndata:{"text":"ok","replace":false}\n\n',
    );

    expect(events).toEqual([{ type: 'delta', text: 'ok', replace: false }]);
  });

  it('lists each source once, in the order given', () => {
    expect(toSources([{ tool: 'a', label: 'A' }, { tool: 'b', label: 'B' }, { tool: 'a', label: 'A again' }, { tool: 1 }, null])).toEqual([
      { tool: 'a', label: 'A' },
      { tool: 'b', label: 'B' },
    ]);
    expect(toSources('nope')).toEqual([]);
  });
});

function sse(text: string, init: ResponseInit = {}): Response {
  return new Response(body(text), { status: 200, headers: { 'Content-Type': 'text/event-stream' }, ...init });
}

function problem(status: number, json: object | null, headers: Record<string, string> = {}): Response {
  return new Response(json ? JSON.stringify(json) : null, {
    status,
    headers: { ...(json ? { 'Content-Type': 'application/problem+json' } : {}), ...headers },
  });
}

describe('streamChat', () => {
  const signal = new AbortController().signal;

  it('posts the question with the bearer token and continues the conversation', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sse(REAL_STREAM));
    const events: ChatStreamEvent[] = [];

    await streamChat({ message: 'Hi', conversationId: 'c-1', signal, onEvent: (e) => events.push(e), fetchImpl, getAccessToken: () => 'token-1', refresh: vi.fn() });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('/api/assistant/chat');
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBe(signal);
    expect(init?.headers).toMatchObject({ Accept: 'text/event-stream', 'Content-Type': 'application/json', Authorization: 'Bearer token-1' });
    expect(JSON.parse(String(init?.body))).toEqual({ message: 'Hi', conversationId: 'c-1' });
    expect(events).toEqual(EXPECTED);
  });

  it('leaves the conversation id out for a new conversation', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sse(''));

    await streamChat({ message: 'Hi', conversationId: null, signal, onEvent: vi.fn(), fetchImpl, getAccessToken: () => 't', refresh: vi.fn() });

    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toEqual({ message: 'Hi' });
  });

  it('refreshes the session once after a 401 and asks again with the new token', async () => {
    let token = 'old';
    const refresh = vi.fn(async () => {
      token = 'new';
      return true;
    });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(problem(401, { code: 'UNAUTHORIZED', detail: 'Token expired' }))
      .mockResolvedValueOnce(sse(REAL_STREAM));
    const events: ChatStreamEvent[] = [];

    await streamChat({ message: 'Hi', conversationId: null, signal, onEvent: (e) => events.push(e), fetchImpl, getAccessToken: () => token, refresh });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]![1]?.headers).toMatchObject({ Authorization: 'Bearer new' });
    expect(events).toHaveLength(EXPECTED.length);
  });

  it('gives up with a 401 problem when the session cannot be refreshed', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(problem(401, { code: 'UNAUTHORIZED', detail: 'Token expired' }));

    const error = await streamChat({ message: 'Hi', conversationId: null, signal, onEvent: vi.fn(), fetchImpl, getAccessToken: () => 'old', refresh: vi.fn().mockResolvedValue(false) })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ChatProblem);
    expect(error).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reads Problem Details before the stream (409 one answer at a time)', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      problem(409, { code: 'CHAT_IN_PROGRESS', detail: 'Please wait until the current answer is finished.', correlationId: 'corr-1' }),
    );

    const error = await streamChat({ message: 'Hi', conversationId: null, signal, onEvent: vi.fn(), fetchImpl, getAccessToken: () => 't', refresh: vi.fn() })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 409, code: 'CHAT_IN_PROGRESS', message: 'Please wait until the current answer is finished.', correlationId: 'corr-1' });
  });

  it("reads the gateway's empty 429 with Retry-After", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(problem(429, null, { 'Retry-After': '7' }));

    const error = await streamChat({ message: 'Hi', conversationId: null, signal, onEvent: vi.fn(), fetchImpl, getAccessToken: () => 't', refresh: vi.fn() })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 7 });
  });

  it("works out the wait from the gateway's token-bucket headers when there is no Retry-After", () => {
    expect(retryAfterSeconds(new Headers({
      'X-RateLimit-Requested-Tokens': '10, 10',
      'X-RateLimit-Remaining': '4, 0',
      'X-RateLimit-Replenish-Rate': '1, 1',
    }))).toBe(10);
    expect(retryAfterSeconds(new Headers({ 'Retry-After': '3', 'X-RateLimit-Remaining': '0' }))).toBe(3);
    expect(retryAfterSeconds(new Headers())).toBeNull();
  });

  it('treats a 200 that is not an event stream as a problem', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));

    const error = await streamChat({ message: 'Hi', conversationId: null, signal, onEvent: vi.fn(), fetchImpl, getAccessToken: () => 't', refresh: vi.fn() })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
  });
});
