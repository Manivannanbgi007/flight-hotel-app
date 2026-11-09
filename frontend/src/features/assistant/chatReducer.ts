import { toActions, toBlocks, type ChatAction as ButtonAction, type ChatBlock } from './blocks';
import { streamError, type ChatError } from './chatErrors';
import type { ChatStreamEvent, ConversationMessageView, Source } from './types';

/**
 * The chat panel's state as a pure reducer: the messages on screen and how one streamed answer builds up
 * (status → delta… → done | error), including the grounding check's `replace`.
 */

export type AnswerStatus = 'streaming' | 'done' | 'stopped' | 'error';

export interface UserMessage {
  id: string;
  role: 'user';
  text: string;
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  /** The question this answers (for "Try again"). */
  question: string;
  text: string;
  status: AnswerStatus;
  /** The progress line while it streams ("Looking up your trips…"); null once text arrives. */
  statusText: string | null;
  sources: Source[];
  /** Cards built by the server from the tool results (empty when the answer has none). */
  blocks: ChatBlock[];
  /** Buttons (route keys) built by the server; resolved against the allowlist when shown. */
  actions: ButtonAction[];
  /** false = the grounding check replaced the model's answer with the safe answer. */
  grounded: boolean;
  error: ChatError | null;
}

/** A line between messages ("Your earlier conversation has expired…"). */
export interface NoticeMessage {
  id: string;
  role: 'notice';
  text: string;
}

export type ChatMessage = UserMessage | AssistantMessage | NoticeMessage;

export interface ChatState {
  messages: ChatMessage[];
  /** Loading an earlier conversation (after a reload). */
  restoring: boolean;
  restoreFailed: boolean;
}

export type ChatAction =
  | { type: 'ask'; userMessageId: string; answerId: string; question: string }
  | { type: 'event'; answerId: string; event: ChatStreamEvent }
  | { type: 'failed'; answerId: string; error: ChatError }
  | { type: 'stopped'; answerId: string }
  | { type: 'retry'; answerId: string }
  | { type: 'notice'; id: string; beforeId: string; text: string }
  | { type: 'restore-start' }
  | { type: 'restored'; messages: ChatMessage[] }
  | { type: 'restore-failed' }
  | { type: 'reset' };

export const INITIAL_STATUS = 'Sending your question…';

export function initialChatState(restoring = false): ChatState {
  return { messages: [], restoring, restoreFailed: false };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'ask':
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: action.userMessageId, role: 'user', text: action.question },
          newAnswer(action.answerId, action.question),
        ],
      };
    case 'event':
      return updateAnswer(state, action.answerId, (answer) => applyEvent(answer, action.event));
    case 'failed':
      return updateAnswer(state, action.answerId, (answer) =>
        answer.status === 'streaming' ? { ...answer, status: 'error', statusText: null, error: action.error } : answer);
    case 'stopped':
      return updateAnswer(state, action.answerId, (answer) =>
        answer.status === 'streaming' ? { ...answer, status: 'stopped', statusText: null } : answer);
    case 'retry':
      return updateAnswer(state, action.answerId, (answer) => newAnswer(answer.id, answer.question));
    case 'notice': {
      const index = state.messages.findIndex((message) => message.id === action.beforeId);
      const notice: NoticeMessage = { id: action.id, role: 'notice', text: action.text };
      const messages = [...state.messages];
      messages.splice(index === -1 ? messages.length : index, 0, notice);
      return { ...state, messages };
    }
    case 'restore-start':
      return { ...state, restoring: true, restoreFailed: false };
    case 'restored':
      // Questions asked while the history loaded stay after it.
      return { messages: [...action.messages, ...state.messages], restoring: false, restoreFailed: false };
    case 'restore-failed':
      return { ...state, restoring: false, restoreFailed: true };
    case 'reset':
      return initialChatState();
    default:
      return state;
  }
}

function newAnswer(id: string, question: string): AssistantMessage {
  return { id, role: 'assistant', question, text: '', status: 'streaming', statusText: INITIAL_STATUS, sources: [], blocks: [], actions: [], grounded: true, error: null };
}

function updateAnswer(state: ChatState, id: string, update: (answer: AssistantMessage) => AssistantMessage): ChatState {
  let changed = false;
  const messages = state.messages.map((message) => {
    if (message.id !== id || message.role !== 'assistant') {
      return message;
    }
    const next = update(message);
    changed = changed || next !== message;
    return next;
  });
  return changed ? { ...state, messages } : state;
}

/** One stream event applied to the answer it belongs to. Events after the end (done, error, stopped) are ignored. */
export function applyEvent(answer: AssistantMessage, event: ChatStreamEvent): AssistantMessage {
  if (answer.status !== 'streaming') {
    return answer;
  }
  switch (event.type) {
    case 'conversation':
      return answer;
    case 'status':
      return event.text ? { ...answer, statusText: event.text } : answer;
    case 'delta':
      // replace: the grounding check stopped an answer that named something not in the user's data. Show only the safe text.
      return event.replace
        ? { ...answer, text: event.text, grounded: false, statusText: null }
        : { ...answer, text: answer.text + event.text, statusText: event.text ? null : answer.statusText };
    case 'blocks':
      return { ...answer, blocks: event.blocks, actions: event.actions };
    case 'done':
      return { ...answer, status: 'done', statusText: null, sources: event.sources, grounded: answer.grounded && event.grounded };
    case 'error':
      return { ...answer, status: 'error', statusText: null, error: streamError(event.code, event.message) };
    default:
      return answer;
  }
}

/** A saved conversation (`GET /conversations/{id}`) as messages on screen. */
export function fromConversation(messages: ConversationMessageView[]): ChatMessage[] {
  let question = '';
  return messages.map((message): ChatMessage => {
    if (message.role === 'user') {
      question = message.text;
      return { id: message.id, role: 'user', text: message.text };
    }
    return {
      id: message.id,
      role: 'assistant',
      question,
      text: message.text,
      status: 'done',
      statusText: null,
      sources: message.sources ?? [],
      blocks: toBlocks(message.blocks),
      actions: toActions(message.actions),
      grounded: message.grounded !== false,
      error: null,
    };
  });
}

/** The answer currently streaming, if any. */
export function streamingAnswer(state: ChatState): AssistantMessage | null {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i]!;
    if (message.role === 'assistant' && message.status === 'streaming') {
      return message;
    }
  }
  return null;
}
