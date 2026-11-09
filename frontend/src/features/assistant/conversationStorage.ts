/**
 * The open conversation's id, per tab (`sessionStorage`) and per user, so the panel survives a reload. Only the id is
 * stored, never message text (the server keeps the conversation for 24 h and checks the owner). Storage can be
 * missing or blocked (private mode, sandboxed frames): then the conversation simply starts fresh after a reload.
 */
const PREFIX = 'fh.assistant.conversation.';
const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function readConversationId(userId: string): string | null {
  try {
    const value = window.sessionStorage.getItem(PREFIX + userId);
    return value && CONVERSATION_ID.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeConversationId(userId: string, conversationId: string): void {
  if (!CONVERSATION_ID.test(conversationId)) {
    return;
  }
  try {
    window.sessionStorage.setItem(PREFIX + userId, conversationId);
  } catch {
    // Not stored: the conversation still works until the page is reloaded.
  }
}

export function clearConversationId(userId: string): void {
  try {
    window.sessionStorage.removeItem(PREFIX + userId);
  } catch {
    // Nothing stored.
  }
}
