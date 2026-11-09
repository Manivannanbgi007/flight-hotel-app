import { act, renderHook, waitFor } from '@testing-library/react';

import { ChatProblem, type StreamChatOptions } from './chatStream';
import { useAssistantChat } from './useAssistantChat';

vi.mock('@/lib/api/client', () => ({ apiClient: {}, refreshAccessToken: vi.fn() }));
vi.mock('./assistantApi', () => ({ assistantApi: { conversation: vi.fn(), deleteConversation: vi.fn() } }));

const CONVERSATION_ID = '01a1afe8-274d-7009-b220-93959948511e';

/** A stream that first fails with `problems`, then answers. */
function streamFailingWith(...problems: ChatProblem[]) {
  return vi.fn(async ({ onEvent }: StreamChatOptions) => {
    const problem = problems.shift();
    if (problem) throw problem;
    onEvent({ type: 'conversation', id: CONVERSATION_ID });
    onEvent({ type: 'delta', text: 'Answer.', replace: false });
    onEvent({ type: 'done', messageId: 'm', sources: [], grounded: true });
  });
}

function setup(stream: ReturnType<typeof streamFailingWith>) {
  const wait = vi.fn(async () => undefined);
  const onAnswer = vi.fn();
  const view = renderHook(() => useAssistantChat({ userId: 'u1', maxMessageLength: 2000, stream, wait, onAnswer }));
  return { ...view, wait, onAnswer };
}

const lastAnswer = (messages: ReturnType<typeof useAssistantChat>['messages']) => messages.at(-1)!;

afterEach(() => window.sessionStorage.clear());

describe('useAssistantChat: waiting and asking again', () => {
  it('asks again after a 429, as long as the gateway says (short waits only)', async () => {
    const stream = streamFailingWith(new ChatProblem(429, 'RATE_LIMITED', '', 7));
    const { result, wait, onAnswer } = setup(stream);

    act(() => {
      result.current.send('Hi');
    });

    await waitFor(() => expect(lastAnswer(result.current.messages)).toMatchObject({ status: 'done', text: 'Answer.' }));
    expect(wait).toHaveBeenCalledWith(7_000);
    expect(stream).toHaveBeenCalledTimes(2);
    expect(onAnswer).toHaveBeenCalledWith({ text: 'Answer.', grounded: true });
  });

  it('gives up after two waits and shows the limit', async () => {
    const limited = () => new ChatProblem(429, 'RATE_LIMITED', '', 5);
    const { result, wait } = setup(streamFailingWith(limited(), limited(), limited()));

    act(() => {
      result.current.send('Hi');
    });

    await waitFor(() => expect(lastAnswer(result.current.messages)).toMatchObject({ status: 'error', error: { code: 'RATE_LIMITED' } }));
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('does not wait minutes: a long Retry-After is shown at once', async () => {
    const { result, wait } = setup(streamFailingWith(new ChatProblem(429, 'RATE_LIMITED', '', 300)));

    act(() => {
      result.current.send('Hi');
    });

    await waitFor(() => expect(lastAnswer(result.current.messages)).toMatchObject({ status: 'error' }));
    expect(wait).not.toHaveBeenCalled();
  });

  it('waits for the previous answer to end (409 right after Stop) and asks again', async () => {
    const { result, wait } = setup(streamFailingWith(new ChatProblem(409, 'CHAT_IN_PROGRESS', 'Please wait.')));

    act(() => {
      result.current.send('Hi');
    });

    await waitFor(() => expect(lastAnswer(result.current.messages)).toMatchObject({ status: 'done' }));
    expect(wait).toHaveBeenCalledWith(2_000);
  });

  it('a question while an answer streams is not sent', async () => {
    const stream = vi.fn(() => new Promise<void>(() => undefined));
    const { result } = renderHook(() => useAssistantChat({ userId: 'u1', maxMessageLength: 2000, stream }));

    let first = false;
    let second = true;
    act(() => {
      first = result.current.send('One');
    });
    act(() => {
      second = result.current.send('Two');
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(result.current.busy).toBe(true);
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
