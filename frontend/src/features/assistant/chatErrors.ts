import { ChatProblem } from './chatStream';

/** What an answer that failed shows: a friendly text and whether "Try again" makes sense. */
export interface ChatError {
  code: string;
  message: string;
  retryable: boolean;
}

/** The stream closed without `done` or `error` (network drop, proxy timeout). */
export const INTERRUPTED: ChatError = {
  code: 'INTERRUPTED',
  message: 'The answer was interrupted. Please try again.',
  retryable: true,
};

/** Texts for the `error` event codes, used when the server sends no message (it normally does, and it is safe). */
const EVENT_MESSAGES: Record<string, string> = {
  ASSISTANT_UNAVAILABLE: 'The assistant is unavailable right now. Please try again in a few minutes.',
  ASSISTANT_TIMEOUT: 'The assistant took too long to answer. Please try again, perhaps with a shorter question.',
  DATA_UNAVAILABLE: "Your information can't be looked up right now. Please try again in a moment.",
  ASSISTANT_FAILED: "The assistant couldn't answer this time. Please try again.",
};

/** An `error` event of the stream. */
export function streamError(code: string, message: string): ChatError {
  return { code, message: message.trim() || EVENT_MESSAGES[code] || EVENT_MESSAGES.ASSISTANT_FAILED!, retryable: true };
}

/** A failed request before the stream (Problem Details, the gateway's 429, the network). */
export function requestError(error: unknown, maxMessageLength: number): ChatError {
  if (error instanceof ChatProblem) {
    switch (error.code) {
      case 'VALIDATION_FAILED':
        return { code: error.code, message: `The question could not be sent. Questions can be up to ${maxMessageLength} characters long.`, retryable: false };
      case 'CONVERSATION_NOT_FOUND':
        return { code: error.code, message: 'This conversation has expired. Start a new chat to go on.', retryable: false };
      case 'CHAT_IN_PROGRESS':
        return { code: error.code, message: 'Another answer is still being written, maybe in another tab. Please wait until it is finished, then try again.', retryable: true };
      case 'ASSISTANT_UNAVAILABLE':
        return { code: error.code, message: EVENT_MESSAGES.ASSISTANT_UNAVAILABLE!, retryable: true };
      default:
        break;
    }
    if (error.status === 401) {
      return { code: 'UNAUTHORIZED', message: 'Your session has ended. Please log in again to use the assistant.', retryable: false };
    }
    if (error.status === 429) {
      const wait = error.retryAfterSeconds ? `${Math.ceil(error.retryAfterSeconds)} seconds` : 'a few seconds';
      return { code: 'RATE_LIMITED', message: `You're asking faster than the assistant can answer. Please wait ${wait}, then try again.`, retryable: true };
    }
    if (error.status >= 500) {
      return { code: error.code, message: 'Something went wrong on our side. Please try again in a moment.', retryable: true };
    }
    return { code: error.code, message: "The question couldn't be sent. Please try again.", retryable: true };
  }
  return { code: 'NETWORK_ERROR', message: "Can't reach the assistant. Check your connection and try again.", retryable: true };
}
