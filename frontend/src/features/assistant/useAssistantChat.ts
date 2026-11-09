import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { ApiError } from '@/lib/api/apiError';
import { assistantApi } from './assistantApi';
import { INTERRUPTED, requestError, streamError } from './chatErrors';
import { chatReducer, fromConversation, initialChatState, streamingAnswer, type ChatMessage } from './chatReducer';
import { ChatProblem, streamChat, type StreamChatOptions } from './chatStream';
import { clearConversationId, readConversationId, writeConversationId } from './conversationStorage';
import { nextSentences, plainText } from './messageFormat';
import type { ChatStreamEvent } from './types';

let sequence = 0;
const localId = () => `local-${++sequence}`;

/** `409 CHAT_IN_PROGRESS` right after Stop: the server is still closing the previous answer. Wait and ask again. */
const BUSY_RETRIES = 2;
const BUSY_RETRY_MS = 2_000;
/** `429` (questions per user at the gateway): wait `Retry-After` (or the bucket's refill) and ask again, twice at most. */
const RATE_RETRIES = 2;
const RATE_RETRY_DEFAULT_S = 10;
const RATE_RETRY_MAX_S = 30;

export interface Announcement {
  id: number;
  text: string;
}

export interface UseAssistantChatOptions {
  userId: string;
  maxMessageLength: number;
  /** A finished answer (for reading it aloud). */
  onAnswer?: (answer: { text: string; grounded: boolean }) => void;
  /** The model went away (503 / `ASSISTANT_UNAVAILABLE`): check the config again. */
  onUnavailable?: () => void;
  /** For tests. */
  stream?: (options: StreamChatOptions) => Promise<void>;
  wait?: (ms: number) => Promise<void>;
}

export interface AssistantChat {
  messages: ChatMessage[];
  restoring: boolean;
  restoreFailed: boolean;
  /** An answer is streaming. */
  busy: boolean;
  /** For the screen-reader live region: status lines, whole sentences of the answer, errors. */
  announcement: Announcement | null;
  /** false when nothing was sent (empty, or an answer is still streaming). */
  send: (text: string) => boolean;
  /** Aborts the streaming answer (the text so far stays). */
  stop: () => void;
  retry: (answerId: string) => void;
  /** Deletes the conversation on the server and starts again. */
  newChat: () => void;
  retryRestore: () => void;
}

/**
 * One user's conversation with the assistant: streams answers, keeps the conversation id (sessionStorage, per user)
 * so the context survives closing the panel and reloading the page, and restores the history from the server.
 */
export function useAssistantChat({
  userId,
  maxMessageLength,
  onAnswer,
  onUnavailable,
  stream = streamChat,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: UseAssistantChatOptions): AssistantChat {
  const [storedId] = useState(() => readConversationId(userId));
  const [state, dispatch] = useReducer(chatReducer, storedId !== null, initialChatState);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const conversationRef = useRef<string | null>(storedId);
  const controllerRef = useRef<AbortController | null>(null);
  const callbacks = useRef({ onAnswer, onUnavailable });
  useEffect(() => {
    callbacks.current = { onAnswer, onUnavailable };
  });

  const announce = useCallback((text: string) => {
    if (text.trim()) {
      setAnnouncement((previous) => ({ id: (previous?.id ?? 0) + 1, text: text.trim() }));
    }
  }, []);

  // After a reload: the earlier conversation of this tab. 404 = expired or not ours → start fresh.
  useEffect(() => {
    if (!storedId) {
      return undefined;
    }
    const controller = new AbortController();
    assistantApi.conversation(storedId, controller.signal)
      .then((conversation) => {
        if (controller.signal.aborted) return;
        // "New chat" while it loaded: the old messages are not wanted any more.
        const wanted = conversationRef.current === storedId;
        dispatch({ type: 'restored', messages: wanted ? fromConversation(conversation.messages ?? []) : [] });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) {
          if (conversationRef.current === storedId) {
            conversationRef.current = null;
            clearConversationId(userId);
          }
          dispatch({ type: 'restored', messages: [] });
        } else {
          dispatch({ type: 'restore-failed' });
        }
      });
    return () => controller.abort();
  }, [storedId, userId, restoreAttempt]);

  const run = useCallback(async (question: string, answerId: string) => {
    const controller = new AbortController();
    controllerRef.current = controller;
    const current = () => controllerRef.current === controller;
    let text = '';
    let announced = 0;
    let finished = false;

    const onEvent = (event: ChatStreamEvent) => {
      if (!current()) return;
      switch (event.type) {
        case 'conversation':
          conversationRef.current = event.id;
          writeConversationId(userId, event.id);
          break;
        case 'status':
          announce(event.text);
          break;
        case 'delta':
          if (event.replace) {
            text = event.text;
            announced = text.length;
            announce(`The answer was replaced with a checked one: ${plainText(text)}`);
          } else {
            text += event.text;
            const next = nextSentences(text, announced);
            if (next) {
              announced = next.to;
              announce(next.chunk);
            }
          }
          break;
        case 'done': {
          finished = true;
          const sources = event.sources.length > 0 ? ` Based on: ${event.sources.map((source) => source.label).join(', ')}.` : '';
          announce(`${plainText(text.slice(announced))}${sources}`);
          break;
        }
        case 'error':
          finished = true;
          announce(streamError(event.code, event.message).message);
          if (event.code === 'ASSISTANT_UNAVAILABLE') callbacks.current.onUnavailable?.();
          break;
        default:
          break;
      }
      dispatch({ type: 'event', answerId, event });
      if (event.type === 'done') {
        callbacks.current.onAnswer?.({ text, grounded: event.grounded });
      }
    };

    try {
      let freshConversation = false;
      let busyRetries = 0;
      let rateRetries = 0;
      for (;;) {
        try {
          await stream({ message: question, conversationId: conversationRef.current, signal: controller.signal, onEvent });
          break;
        } catch (error) {
          if (controller.signal.aborted || !(error instanceof ChatProblem)) throw error;
          if (error.code === 'CONVERSATION_NOT_FOUND' && !freshConversation) {
            // Expired (24 h) or not ours: this question starts a new conversation.
            freshConversation = true;
            conversationRef.current = null;
            clearConversationId(userId);
            dispatch({ type: 'notice', id: localId(), beforeId: answerId, text: 'The earlier conversation has expired, so this question starts a new one.' });
            continue;
          }
          if (error.code === 'CHAT_IN_PROGRESS' && busyRetries < BUSY_RETRIES) {
            busyRetries++;
            dispatch({ type: 'event', answerId, event: { type: 'status', text: 'Waiting for the previous answer to finish…', tool: null } });
            await wait(BUSY_RETRY_MS);
            if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
            continue;
          }
          // The gateway's question limit: wait as long as it says (a short wait only) and ask again, visibly.
          const seconds = error.status === 429 ? Math.ceil(error.retryAfterSeconds ?? RATE_RETRY_DEFAULT_S) : 0;
          if (seconds > 0 && seconds <= RATE_RETRY_MAX_S && rateRetries < RATE_RETRIES) {
            rateRetries++;
            const text = `You asked several questions in a row. Asking again in ${seconds} seconds…`;
            dispatch({ type: 'event', answerId, event: { type: 'status', text, tool: null } });
            announce(text);
            await wait(seconds * 1000);
            if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
            continue;
          }
          throw error;
        }
      }
      if (!finished && current()) {
        dispatch({ type: 'failed', answerId, error: INTERRUPTED });
        announce(INTERRUPTED.message);
      }
    } catch (error) {
      if (!current()) return;
      if (controller.signal.aborted) {
        dispatch({ type: 'stopped', answerId });
        announce('Stopped.');
        return;
      }
      const chatError = requestError(error, maxMessageLength);
      if (chatError.code === 'ASSISTANT_UNAVAILABLE') callbacks.current.onUnavailable?.();
      dispatch({ type: 'failed', answerId, error: chatError });
      announce(chatError.message);
    } finally {
      if (current()) controllerRef.current = null;
    }
  }, [userId, maxMessageLength, stream, wait, announce]);

  const send = useCallback((raw: string) => {
    const question = raw.trim().slice(0, maxMessageLength);
    if (!question || controllerRef.current) {
      return false;
    }
    const answerId = localId();
    dispatch({ type: 'ask', userMessageId: localId(), answerId, question });
    void run(question, answerId);
    return true;
  }, [maxMessageLength, run]);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const messagesRef = useRef(state.messages);
  useEffect(() => {
    messagesRef.current = state.messages;
  });

  const retry = useCallback((answerId: string) => {
    const answer = messagesRef.current.find((message) => message.id === answerId);
    if (!answer || answer.role !== 'assistant' || controllerRef.current) {
      return;
    }
    dispatch({ type: 'retry', answerId });
    void run(answer.question, answerId);
  }, [run]);

  const newChat = useCallback(() => {
    const controller = controllerRef.current;
    controllerRef.current = null;
    controller?.abort();
    const id = conversationRef.current;
    conversationRef.current = null;
    clearConversationId(userId);
    dispatch({ type: 'reset' });
    announce('New chat started.');
    if (id) {
      void assistantApi.deleteConversation(id).catch(() => undefined);
    }
  }, [userId, announce]);

  const retryRestore = useCallback(() => {
    dispatch({ type: 'restore-start' });
    setRestoreAttempt((attempt) => attempt + 1);
  }, []);

  // Closing the app or signing out: never leave an answer streaming for nobody.
  useEffect(() => () => {
    const controller = controllerRef.current;
    controllerRef.current = null;
    controller?.abort();
  }, []);

  return {
    messages: state.messages,
    restoring: state.restoring,
    restoreFailed: state.restoreFailed,
    busy: streamingAnswer(state) !== null,
    announcement,
    send,
    stop,
    retry,
    newChat,
    retryRestore,
  };
}
