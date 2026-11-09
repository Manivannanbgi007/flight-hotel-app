import type { ChatAction, ChatBlock } from './blocks';

/** The assistant API (api-assistant contract, AI_ASSISTANT.md §7). */

/** `GET /api/assistant/config` */
export interface AssistantConfig {
  /** false = Ollama is down, the model is not pulled yet, or it cannot call tools: no chat at all. */
  enabled: boolean;
  /** The model answering, e.g. `granite4:tiny-h`. */
  model: string;
  /** true only while the optional speech server runs (compose profile `voice`). */
  voice: { transcription: boolean; speech: boolean };
  limits: AssistantLimits;
}

export interface AssistantLimits {
  maxMessageLength: number;
  maxAudioBytes: number;
  maxAudioSeconds: number;
  maxSpeechChars: number;
}

/** A tool the answer used ("Based on: Your trips"). */
export interface Source {
  tool: string;
  label: string;
}

/** `GET /api/assistant/conversations/{id}` */
export interface ConversationView {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessageView[];
}

export interface ConversationMessageView {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  sources: Source[];
  /** false = the model's answer was replaced by the safe answer (grounding check). */
  grounded: boolean;
  /** Cards and buttons the server built from the tool results (missing in conversations saved before they existed). */
  blocks?: unknown;
  actions?: unknown;
}

/** The server-sent events of `POST /api/assistant/chat`, parsed. */
export type ChatStreamEvent =
  | { type: 'conversation'; id: string }
  | { type: 'status'; text: string; tool: string | null }
  | { type: 'delta'; text: string; replace: boolean }
  | { type: 'blocks'; blocks: ChatBlock[]; actions: ChatAction[] }
  | { type: 'done'; messageId: string; sources: Source[]; grounded: boolean }
  | { type: 'error'; code: string; message: string };
