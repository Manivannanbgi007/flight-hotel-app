/**
 * What the customer entered on the guest details page, kept for the review page. It lives in sessionStorage (this
 * tab only, gone when the tab closes) and holds no payment data. The Idempotency-Key is created when the booking is
 * confirmed and kept here, so a retry after a timeout or a reload returns the same booking instead of a second one.
 */
export interface BookingDraft {
  quoteId: string;
  contact: { email: string; phone: string };
  guests: { firstName: string; lastName: string }[];
  specialRequests: string;
  couponCode: string;
  idempotencyKey?: string;
}

const keyOf = (quoteId: string) => `booking-draft:${quoteId}`;

export function loadDraft(quoteId: string): BookingDraft | null {
  try {
    const text = sessionStorage.getItem(keyOf(quoteId));
    if (!text) return null;
    const draft = JSON.parse(text) as BookingDraft;
    return draft.quoteId === quoteId && Array.isArray(draft.guests) ? draft : null;
  } catch {
    return null;
  }
}

/** Saving after the customer edited the details drops the old key: the content changed, so it is a new request. */
export function saveDraft(draft: BookingDraft): void {
  try {
    sessionStorage.setItem(keyOf(draft.quoteId), JSON.stringify(draft));
  } catch {
    // Private mode or storage full: the review page then sends the customer back to the guest details.
  }
}

export function clearDraft(quoteId: string): void {
  try {
    sessionStorage.removeItem(keyOf(quoteId));
  } catch {
    // Nothing to clean up.
  }
}

/** A fresh key (letters, digits and dashes: the server accepts 8 to 100 of those). */
export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}
