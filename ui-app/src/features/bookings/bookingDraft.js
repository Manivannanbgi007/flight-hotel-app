const keyOf = (quoteId) => `booking-draft:${quoteId}`;

export function loadDraft(quoteId) {
  try {
    const text = sessionStorage.getItem(keyOf(quoteId));
    if (!text) return null;
    const draft = JSON.parse(text);
    return draft.quoteId === quoteId && Array.isArray(draft.guests) ? draft : null;
  } catch {
    return null;
  }
}

/** Saving after the customer edited the details drops the old key: the content changed, so it is a new request. */
export function saveDraft(draft) {
  try {
    sessionStorage.setItem(keyOf(draft.quoteId), JSON.stringify(draft));
  } catch {
    // Private mode or storage full: the review page then sends the customer back to the guest details.
  }
}

export function clearDraft(quoteId) {
  try {
    sessionStorage.removeItem(keyOf(quoteId));
  } catch {
    // Nothing to clean up.
  }
}

/** A fresh key (letters, digits and dashes: the server accepts 8 to 100 of those). */
export function newIdempotencyKey() {
  return globalThis.crypto.randomUUID();
}
