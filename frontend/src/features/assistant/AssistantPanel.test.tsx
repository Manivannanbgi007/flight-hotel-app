import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError } from '@/lib/api/apiError';
import { refreshAccessToken } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryKeys';
import { sessionStore } from '@/lib/auth/sessionStore';
import type { AuthUser } from '@/lib/auth/types';
import { admin, customer } from '@/test/renderRoutes';
import AssistantPanel from './AssistantPanel';
import { assistantApi } from './assistantApi';
import { readConversationId, writeConversationId } from './conversationStorage';
import type { PanelSize } from './panelFrame';
import type { AssistantConfig } from './types';

vi.mock('@/lib/api/client', () => ({ apiClient: {}, refreshAccessToken: vi.fn() }));
vi.mock('./assistantApi', () => ({
  assistantApi: { conversation: vi.fn(), deleteConversation: vi.fn(), transcribe: vi.fn(), speech: vi.fn() },
}));

const CONVERSATION_ID = '01a1afe8-274d-7009-b220-93959948511e';
const CONFIG: AssistantConfig = {
  enabled: true,
  model: 'granite4:tiny-h',
  voice: { transcription: false, speech: false },
  limits: { maxMessageLength: 2000, maxAudioBytes: 5242880, maxAudioSeconds: 60, maxSpeechChars: 1000 },
};

const encoder = new TextEncoder();
const ev = (name: string, data: unknown) => `event:${name}\ndata:${JSON.stringify(data)}\n\n`;

/** A streamed answer the test controls: push events, end the stream; aborting the request errors it like fetch does. */
function liveAnswer() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
  return {
    respond(init?: RequestInit) {
      init?.signal?.addEventListener('abort', () => controller.error(new DOMException('The operation was aborted.', 'AbortError')));
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    },
    push: (...chunks: string[]) => act(async () => {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }),
    end: () => act(async () => {
      controller.close();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }),
  };
}

/** A complete answer in one response. */
function answer(text: string, sources = [{ tool: 'my_bookings', label: 'Your trips' }], conversationId = CONVERSATION_ID) {
  return new Response(
    ev('conversation', { id: conversationId }) + ev('status', { text: 'Looking up your trips…', tool: 'my_bookings' })
      + ev('delta', { text, replace: false }) + ev('done', { messageId: 'm1', sources, grounded: true }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}

function problem(status: number, code: string, detail: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ status, code, detail }), { status, headers: { 'Content-Type': 'application/problem+json', ...headers } });
}

type Reply = Response | ((init?: RequestInit) => Response);
let replies: Reply[] = [];
const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
  const reply = replies.shift();
  if (!reply) throw new TypeError('Failed to fetch');
  return typeof reply === 'function' ? reply(init) : reply;
});

const sentBodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { message: string; conversationId?: string });

function renderPanel({ user = customer as AuthUser, config = CONFIG, open = true, size = 'normal' as PanelSize } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const onClose = vi.fn();
  const onActivity = vi.fn();
  const onSizeChange = vi.fn();
  const props = { open, onClose, size, onSizeChange, config, user, onActivity };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AssistantPanel {...props} />
    </QueryClientProvider>,
  );
  const rerender = (next: Partial<typeof props>) => view.rerender(
    <QueryClientProvider client={queryClient}>
      <AssistantPanel {...props} {...next} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onClose, onActivity, onSizeChange, invalidate, rerender };
}

const panel = () => screen.getByRole('dialog', { name: 'AI assistant' });
const input = () => screen.getByRole('textbox', { name: 'Your question' });
const messages = () => screen.getByRole('list', { name: 'Messages' });

beforeEach(() => {
  replies = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  sessionStore.set({ accessToken: 'token-1', user: customer });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  window.localStorage.clear();
  sessionStore.clear();
});

describe('AssistantPanel: chatting', () => {
  it('is a labelled dialog with the model, the role suggestions and the read-only note', () => {
    renderPanel();

    expect(panel()).toHaveAccessibleDescription('Model: granite4:tiny-h');
    expect(screen.getByRole('heading', { name: 'Hi Asha, how can I help?' })).toBeInTheDocument();
    expect(screen.getByText(/changes such as cancelling or paying are made on the pages/)).toBeInTheDocument();
    const suggestions = screen.getByRole('list', { name: 'Try asking' });
    expect(within(suggestions).getByRole('button', { name: 'What are my upcoming trips?' })).toBeInTheDocument();
    expect(within(suggestions).getByRole('button', { name: 'Current offers' })).toBeInTheDocument();
    expect(input()).toHaveFocus();
  });

  it('suggests staff questions to staff', () => {
    renderPanel({ user: admin });

    expect(within(screen.getByRole('list', { name: 'Try asking' })).getByRole('button', { name: 'Failed payments last week' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'What are my upcoming trips?' })).not.toBeInTheDocument();
  });

  it('streams an answer: status line, text, sources; the conversation continues with the same id', async () => {
    const live = liveAnswer();
    replies = [live.respond, answer('And nothing else.')];
    const { user, onActivity } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'What are my upcoming trips?' }));
    expect(within(messages()).getByText('What are my upcoming trips?')).toBeInTheDocument();
    await live.push(ev('conversation', { id: CONVERSATION_ID }), ev('status', { text: 'Looking up your trips…', tool: 'my_bookings' }));
    expect(within(messages()).getByText('Looking up your trips…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop the answer' })).toBeInTheDocument();
    expect(onActivity).toHaveBeenLastCalledWith(true);

    await live.push(ev('delta', { text: 'You have one trip: ', replace: false }), ev('delta', { text: '**HT-7K3M9Q2X** in Goa.', replace: false }));
    expect(within(messages()).getByText('HT-7K3M9Q2X')).toHaveProperty('tagName', 'STRONG');
    await live.push(ev('done', { messageId: 'm1', sources: [{ tool: 'my_bookings', label: 'Your trips' }], grounded: true }));
    await live.end();

    expect(within(screen.getByRole('list', { name: 'Sources' })).getByText('Your trips')).toBeInTheDocument();
    expect(screen.queryByText('Looking up your trips…')).not.toBeInTheDocument();
    expect(onActivity).toHaveBeenLastCalledWith(false);
    expect(readConversationId(customer.id)).toBe(CONVERSATION_ID);

    await user.type(input(), 'Anything else?{Enter}');
    expect(await within(messages()).findByText('And nothing else.')).toBeInTheDocument();
    expect(sentBodies()).toEqual([
      { message: 'What are my upcoming trips?' },
      { message: 'Anything else?', conversationId: CONVERSATION_ID },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/assistant/chat');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer token-1', Accept: 'text/event-stream' });
  });

  it('Enter sends, Shift+Enter starts a new line, empty questions are not sent', async () => {
    replies = [answer('Fine.')];
    const { user } = renderPanel();

    await user.type(input(), '{Enter}');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    await user.type(input(), 'Line one{Shift>}{Enter}{/Shift}Line two');
    expect(input()).toHaveValue('Line one\nLine two');
    expect(fetchMock).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    expect(await within(messages()).findByText('Fine.')).toBeInTheDocument();
    expect(sentBodies()[0]?.message).toBe('Line one\nLine two');
    expect(input()).toHaveValue('');
  });

  it('a suggestion that needs details fills the input instead of sending', async () => {
    const { user } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Show booking HT-…' }));

    expect(input()).toHaveValue('Show me the details of booking HT-');
    expect(input()).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enforces the character limit and shows the count near it', async () => {
    const { user } = renderPanel({ config: { ...CONFIG, limits: { ...CONFIG.limits, maxMessageLength: 20 } } });

    await user.type(input(), 'This question is far too long');

    expect(input()).toHaveValue('This question is far');
    expect(screen.getByText('20 / 20 characters')).toBeInTheDocument();
  });

  it('Stop aborts the answer and keeps the text so far', async () => {
    const live = liveAnswer();
    replies = [live.respond];
    const { user } = renderPanel();

    await user.type(input(), 'Tell me everything{Enter}');
    await live.push(ev('delta', { text: 'Here is the first part. ', replace: false }));
    await user.click(screen.getByRole('button', { name: 'Stop the answer' }));

    expect(await within(messages()).findByText('You stopped this answer.')).toBeInTheDocument();
    expect(within(messages()).getByText('Here is the first part.')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('shows the error event with "Try again", which asks the same question again', async () => {
    replies = [
      new Response(ev('conversation', { id: CONVERSATION_ID }) + ev('error', { code: 'ASSISTANT_TIMEOUT', message: 'The assistant took too long to answer.' }),
        { headers: { 'Content-Type': 'text/event-stream' } }),
      answer('Now it worked.'),
    ];
    const { user } = renderPanel();

    await user.type(input(), 'Slow question{Enter}');
    expect(await within(messages()).findByText('The assistant took too long to answer.')).toBeInTheDocument();

    await user.click(within(messages()).getByRole('button', { name: 'Try again' }));

    expect(await within(messages()).findByText('Now it worked.')).toBeInTheDocument();
    expect(screen.queryByText('The assistant took too long to answer.')).not.toBeInTheDocument();
    expect(sentBodies().map((body) => body.message)).toEqual(['Slow question', 'Slow question']);
    expect(within(messages()).getAllByText('Slow question')).toHaveLength(1);
  });

  it('explains problems before the stream: rate limit, model unavailable (re-checks the config), network', async () => {
    replies = [
      new Response(null, { status: 429, headers: { 'Retry-After': '120' } }),
      problem(503, 'ASSISTANT_UNAVAILABLE', 'The assistant is not available.'),
    ];
    const { user, invalidate } = renderPanel();

    await user.type(input(), 'One{Enter}');
    expect(await within(messages()).findByText(/Please wait 120 seconds, then try again/)).toBeInTheDocument();

    await user.type(input(), 'Two{Enter}');
    expect(await within(messages()).findByText(/The assistant is unavailable right now/)).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.assistant.config });

    await user.type(input(), 'Three{Enter}');
    expect(await within(messages()).findByText(/Can't reach the assistant/)).toBeInTheDocument();
  });

  it('marks an answer the grounding check replaced', async () => {
    replies = [new Response(
      ev('delta', { text: 'Booking HT-FAKE1234 ', replace: false })
        + ev('delta', { text: 'I can only give you booking references that I found in your data.', replace: true })
        + ev('done', { messageId: 'm1', sources: [{ tool: 'booking_details', label: 'Booking details' }], grounded: false }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    )];
    const { user } = renderPanel();

    await user.type(input(), 'Show HT-FAKE1234{Enter}');

    expect(await within(messages()).findByText('I can only give you booking references that I found in your data.')).toBeInTheDocument();
    expect(screen.queryByText(/HT-FAKE1234 $/)).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't be checked against your data/)).toBeInTheDocument();
  });

  it('renders answers as plain text: no links, no HTML', async () => {
    replies = [answer('Visit https://evil.example/pay or <a href="https://x.example">click</a> <img src=x onerror=alert(1)>')];
    const { user } = renderPanel();

    await user.type(input(), 'Where do I pay?{Enter}');

    const bubble = await within(messages()).findByText(/Visit https:\/\/evil\.example\/pay/);
    expect(bubble.textContent).toContain('<a href="https://x.example">click</a>');
    expect(within(messages()).queryByRole('link')).not.toBeInTheDocument();
    expect(messages().querySelector('img, a')).toBeNull();
  });
});

describe('AssistantPanel: session and conversation', () => {
  it('refreshes the session once after a 401 and asks again', async () => {
    replies = [problem(401, 'UNAUTHORIZED', 'Token expired'), answer('Hello again.')];
    vi.mocked(refreshAccessToken).mockImplementation(async () => {
      sessionStore.set({ accessToken: 'token-2', user: customer });
      return true;
    });
    const { user } = renderPanel();

    await user.type(input(), 'Hi{Enter}');

    expect(await within(messages()).findByText('Hello again.')).toBeInTheDocument();
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.map(([, init]) => (init?.headers as Record<string, string>).Authorization)).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  it('says the session ended when the refresh fails', async () => {
    replies = [problem(401, 'UNAUTHORIZED', 'Token expired')];
    vi.mocked(refreshAccessToken).mockResolvedValue(false);
    const { user } = renderPanel();

    await user.type(input(), 'Hi{Enter}');

    expect(await within(messages()).findByText(/Your session has ended/)).toBeInTheDocument();
    expect(within(messages()).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('restores the conversation of this tab after a reload', async () => {
    writeConversationId(customer.id, CONVERSATION_ID);
    vi.mocked(assistantApi.conversation).mockResolvedValue({
      id: CONVERSATION_ID,
      createdAt: '',
      updatedAt: '',
      messages: [
        { id: 's1', role: 'user', text: 'What are my upcoming trips?', createdAt: '', sources: [], grounded: true },
        { id: 's2', role: 'assistant', text: 'You have no upcoming trips.', createdAt: '', sources: [{ tool: 'my_bookings', label: 'Your trips' }], grounded: true },
      ],
    });
    replies = [answer('Still none.')];
    const { user } = renderPanel();

    expect(screen.getByRole('status')).toHaveTextContent('Loading your conversation…');
    expect(await within(await screen.findByRole('list', { name: 'Messages' })).findByText('You have no upcoming trips.')).toBeInTheDocument();
    expect(assistantApi.conversation).toHaveBeenCalledWith(CONVERSATION_ID, expect.any(AbortSignal));
    expect(screen.queryByRole('heading', { name: /how can I help/ })).not.toBeInTheDocument();

    await user.type(input(), 'And now?{Enter}');
    await within(messages()).findByText('Still none.');
    expect(sentBodies()[0]).toEqual({ message: 'And now?', conversationId: CONVERSATION_ID });
  });

  it('starts fresh when the stored conversation has expired (404)', async () => {
    writeConversationId(customer.id, CONVERSATION_ID);
    vi.mocked(assistantApi.conversation).mockRejectedValue(new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Not found.'));
    replies = [answer('Fresh answer.', undefined, '01a1b000-0000-7000-8000-000000000001')];
    const { user } = renderPanel();

    expect(await screen.findByRole('heading', { name: 'Hi Asha, how can I help?' })).toBeInTheDocument();
    expect(readConversationId(customer.id)).toBeNull();

    await user.type(input(), 'Hi{Enter}');
    await within(messages()).findByText('Fresh answer.');
    expect(sentBodies()[0]).toEqual({ message: 'Hi' });
  });

  it('starts a new conversation when the server says the current one expired while chatting', async () => {
    writeConversationId(customer.id, CONVERSATION_ID);
    vi.mocked(assistantApi.conversation).mockResolvedValue({ id: CONVERSATION_ID, createdAt: '', updatedAt: '', messages: [] });
    replies = [problem(404, 'CONVERSATION_NOT_FOUND', 'Not found.'), answer('New one.', undefined, '01a1b000-0000-7000-8000-000000000002')];
    const { user } = renderPanel();
    await waitFor(() => expect(screen.queryByText('Loading your conversation…')).not.toBeInTheDocument());

    await user.type(input(), 'Hi{Enter}');

    expect(await within(messages()).findByText('New one.')).toBeInTheDocument();
    expect(within(messages()).getByText(/earlier conversation has expired/)).toBeInTheDocument();
    expect(sentBodies()).toEqual([{ message: 'Hi', conversationId: CONVERSATION_ID }, { message: 'Hi' }]);
    expect(readConversationId(customer.id)).toBe('01a1b000-0000-7000-8000-000000000002');
  });

  it('"New chat" deletes the conversation and starts again', async () => {
    replies = [answer('First answer.'), answer('Second answer.', undefined, '01a1b000-0000-7000-8000-000000000003')];
    vi.mocked(assistantApi.deleteConversation).mockResolvedValue(undefined);
    const { user } = renderPanel();
    expect(screen.getByRole('button', { name: 'New chat' })).toBeDisabled();
    await user.type(input(), 'First{Enter}');
    await within(messages()).findByText('First answer.');

    await user.click(screen.getByRole('button', { name: 'New chat' }));

    expect(assistantApi.deleteConversation).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(screen.queryByRole('list', { name: 'Messages' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hi Asha, how can I help?' })).toBeInTheDocument();
    expect(readConversationId(customer.id)).toBeNull();
    expect(input()).toHaveFocus();

    await user.type(input(), 'Second{Enter}');
    await within(messages()).findByText('Second answer.');
    expect(sentBodies()[1]).toEqual({ message: 'Second' });
  });

  it('Escape minimizes the panel', async () => {
    const { user, onClose } = renderPanel();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });

  it('minimizes and maximizes from the header; maximized it is modal and keeps Tab inside', async () => {
    const { user, onClose, onSizeChange, rerender } = renderPanel();
    expect(panel()).not.toHaveAttribute('aria-modal');

    await user.click(screen.getByRole('button', { name: 'Maximize the assistant' }));
    expect(onSizeChange).toHaveBeenLastCalledWith('maximized');
    await user.click(screen.getByRole('button', { name: 'Minimize the assistant' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender({ size: 'maximized' });
    expect(panel()).toHaveAttribute('aria-modal', 'true');
    const restore = screen.getByRole('button', { name: 'Restore the assistant to its normal size' });
    await user.click(restore);
    expect(onSizeChange).toHaveBeenLastCalledWith('normal');

    // The last focusable element wraps round to the first.
    const focusable = panel().querySelectorAll<HTMLElement>('button:not([disabled]), textarea, [tabindex="0"]');
    focusable[focusable.length - 1]!.focus();
    await user.tab();
    expect(panel().contains(document.activeElement)).toBe(true);
  });

  it('shows "unavailable" instead of the chat when the assistant was switched off while open', () => {
    renderPanel({ config: { ...CONFIG, enabled: false } });

    expect(screen.getByRole('heading', { name: 'The assistant is unavailable right now' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Minimize the assistant' })).toHaveFocus();
  });
});

describe('AssistantPanel: voice', () => {
  /** A MediaRecorder stand-in: records "audio" in slices while started. */
  class FakeRecorder {
    static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus';
    state: 'inactive' | 'recording' = 'inactive';
    mimeType: string;
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_stream: MediaStream, options: MediaRecorderOptions) {
      this.mimeType = options.mimeType ?? '';
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['spoken audio'], { type: this.mimeType }) });
      setTimeout(() => this.onstop?.(), 0);
    }
  }

  const track = { stop: vi.fn() };

  beforeEach(() => {
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  it('records with the speech server, shows the recording, and puts the text into the input', async () => {
    vi.mocked(assistantApi.transcribe).mockResolvedValue('what are my upcoming trips');
    const { user } = renderPanel({ config: { ...CONFIG, voice: { transcription: true, speech: false } } });

    await user.click(screen.getByRole('button', { name: 'Ask by voice' }));

    expect(await screen.findByText('Recording')).toBeInTheDocument();
    expect(screen.getByText('0 of 60 seconds')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop recording' }));

    await waitFor(() => expect(input()).toHaveValue('what are my upcoming trips'));
    expect(assistantApi.transcribe).toHaveBeenCalledWith(expect.any(Blob), 'question.webm', expect.any(AbortSignal));
    expect(track.stop).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/browser's speech service/)).not.toBeInTheDocument();
  });

  it('in voice conversation mode the transcription is sent at once', async () => {
    vi.mocked(assistantApi.transcribe).mockResolvedValue('how many open tickets');
    replies = [answer('There are 5 open tickets.')];
    const { user } = renderPanel({ config: { ...CONFIG, voice: { transcription: true, speech: false } } });

    await user.click(screen.getByRole('switch', { name: 'Voice conversation' }));
    await user.click(screen.getByRole('button', { name: /^Ask by voice/ }));
    await screen.findByText('Recording');
    await user.click(screen.getByRole('button', { name: 'Stop recording' }));

    expect(await within(messages()).findByText('There are 5 open tickets.')).toBeInTheDocument();
    expect(sentBodies()[0]).toEqual({ message: 'how many open tickets' });
  });

  it('explains a blocked microphone', async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    const { user } = renderPanel({ config: { ...CONFIG, voice: { transcription: true, speech: false } } });

    await user.click(screen.getByRole('button', { name: 'Ask by voice' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Microphone access is blocked');
    expect(screen.getByRole('button', { name: 'Ask by voice' })).toBeEnabled();
  });

  it('closing the panel stops the recording and frees the microphone', async () => {
    const { user, rerender } = renderPanel({ config: { ...CONFIG, voice: { transcription: true, speech: false } } });
    await user.click(screen.getByRole('button', { name: 'Ask by voice' }));
    await screen.findByText('Recording');
    track.stop.mockClear();

    rerender({ open: false });

    expect(track.stop).toHaveBeenCalled();
    expect(assistantApi.transcribe).not.toHaveBeenCalled();
  });

  it('hides the microphone when neither the server nor the browser can do speech to text', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', fetchMock);
    renderPanel({ config: { ...CONFIG, voice: { transcription: false, speech: false } } });

    expect(screen.queryByRole('button', { name: /Ask by voice/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
