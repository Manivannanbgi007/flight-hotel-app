import { INTERRUPTED } from './chatErrors';
import { applyEvent, chatReducer, fromConversation, initialChatState, INITIAL_STATUS, streamingAnswer, type AssistantMessage, type ChatState } from './chatReducer';
import type { ChatStreamEvent } from './types';

function asked(question = 'What are my upcoming trips?'): ChatState {
  return chatReducer(initialChatState(), { type: 'ask', userMessageId: 'u1', answerId: 'a1', question });
}

function answer(state: ChatState): AssistantMessage {
  return state.messages.find((m): m is AssistantMessage => m.role === 'assistant')!;
}

function play(state: ChatState, ...events: ChatStreamEvent[]): ChatState {
  return events.reduce((current, event) => chatReducer(current, { type: 'event', answerId: 'a1', event }), state);
}

describe('chatReducer', () => {
  it('adds the question and an answer that is streaming', () => {
    const state = asked();

    expect(state.messages).toEqual([
      { id: 'u1', role: 'user', text: 'What are my upcoming trips?' },
      expect.objectContaining({ id: 'a1', role: 'assistant', status: 'streaming', text: '', statusText: INITIAL_STATUS, question: 'What are my upcoming trips?' }),
    ]);
    expect(streamingAnswer(state)?.id).toBe('a1');
  });

  it('shows the latest status, then appends the deltas (the status line goes once text arrives)', () => {
    let state = play(asked(), { type: 'conversation', id: 'c1' }, { type: 'status', text: 'Looking up your trips…', tool: 'my_bookings' });
    expect(answer(state).statusText).toBe('Looking up your trips…');

    state = play(state, { type: 'delta', text: 'You have ', replace: false }, { type: 'delta', text: 'one trip.', replace: false });

    expect(answer(state)).toMatchObject({ text: 'You have one trip.', statusText: null, status: 'streaming' });
  });

  it('replace discards the text shown so far and marks the answer as not grounded', () => {
    const state = play(
      asked(),
      { type: 'delta', text: 'Your booking HT-INVENTED costs ₹99', replace: false },
      { type: 'delta', text: 'I can only give you booking references that I found in your data.', replace: true },
      { type: 'done', messageId: 'm1', sources: [{ tool: 'my_bookings', label: 'Your trips' }], grounded: false },
    );

    expect(answer(state)).toMatchObject({
      text: 'I can only give you booking references that I found in your data.',
      status: 'done',
      grounded: false,
      sources: [{ tool: 'my_bookings', label: 'Your trips' }],
    });
  });

  it('done finishes the answer with its sources', () => {
    const state = play(asked(), { type: 'delta', text: 'Done.', replace: false }, { type: 'done', messageId: 'm1', sources: [{ tool: 't', label: 'T' }], grounded: true });

    expect(answer(state)).toMatchObject({ status: 'done', grounded: true, sources: [{ tool: 't', label: 'T' }], statusText: null });
    expect(streamingAnswer(state)).toBeNull();
  });

  it('an error event keeps the text so far and shows the safe message with a retry', () => {
    const state = play(asked(), { type: 'delta', text: 'Partial', replace: false }, { type: 'error', code: 'ASSISTANT_TIMEOUT', message: '' });

    expect(answer(state)).toMatchObject({
      status: 'error',
      text: 'Partial',
      error: { code: 'ASSISTANT_TIMEOUT', retryable: true, message: expect.stringContaining('took too long') },
    });
  });

  it('uses the message of the error event when the server sends one', () => {
    const state = play(asked(), { type: 'error', code: 'DATA_UNAVAILABLE', message: 'Your trips cannot be read right now.' });

    expect(answer(state).error?.message).toBe('Your trips cannot be read right now.');
  });

  it('ignores events after the answer ended', () => {
    const done = play(asked(), { type: 'done', messageId: 'm', sources: [], grounded: true });

    expect(applyEvent(answer(done), { type: 'delta', text: 'late', replace: false })).toBe(answer(done));
  });

  it('stop and failure only end an answer that is still streaming', () => {
    const stopped = chatReducer(play(asked(), { type: 'delta', text: 'Half', replace: false }), { type: 'stopped', answerId: 'a1' });
    expect(answer(stopped)).toMatchObject({ status: 'stopped', text: 'Half' });

    const failed = chatReducer(asked(), { type: 'failed', answerId: 'a1', error: INTERRUPTED });
    expect(answer(failed)).toMatchObject({ status: 'error', error: INTERRUPTED });
    expect(chatReducer(stopped, { type: 'failed', answerId: 'a1', error: INTERRUPTED })).toBe(stopped);
  });

  it('retry starts the same answer again', () => {
    const failed = chatReducer(asked('Q?'), { type: 'failed', answerId: 'a1', error: INTERRUPTED });

    const retried = chatReducer(failed, { type: 'retry', answerId: 'a1' });

    expect(answer(retried)).toMatchObject({ id: 'a1', question: 'Q?', status: 'streaming', text: '', error: null });
    expect(retried.messages).toHaveLength(2);
  });

  it('puts a notice before an answer, restores history before new questions, and resets', () => {
    let state = chatReducer(initialChatState(true), { type: 'ask', userMessageId: 'u2', answerId: 'a2', question: 'New?' });
    state = chatReducer(state, { type: 'notice', id: 'n1', beforeId: 'a2', text: 'Expired' });
    expect(state.messages.map((m) => m.id)).toEqual(['u2', 'n1', 'a2']);

    state = chatReducer(state, {
      type: 'restored',
      messages: fromConversation([
        { id: 's1', role: 'user', text: 'Old?', createdAt: '', sources: [], grounded: true },
        { id: 's2', role: 'assistant', text: 'Old answer', createdAt: '', sources: [{ tool: 't', label: 'T' }], grounded: false },
      ]),
    });
    expect(state.restoring).toBe(false);
    expect(state.messages.map((m) => m.id)).toEqual(['s1', 's2', 'u2', 'n1', 'a2']);
    expect(state.messages[1]).toMatchObject({ role: 'assistant', question: 'Old?', status: 'done', grounded: false, sources: [{ tool: 't', label: 'T' }] });

    expect(chatReducer(state, { type: 'reset' })).toEqual(initialChatState());
  });
});
