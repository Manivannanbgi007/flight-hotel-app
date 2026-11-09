import type { PassengerFormValues } from './passengerSchema';

/**
 * What the customer entered on the passenger page, kept for the review page. It lives in sessionStorage (this tab
 * only, gone when the tab closes) **without passport numbers**: those stay in memory only (see below). The
 * Idempotency-Key is created when the booking is confirmed and kept here, so a retry returns the same booking.
 */
export type DraftPassenger = Omit<PassengerFormValues, 'passportNumber'>;

export interface FlightDraft {
  tripOfferId: string;
  contact: { email: string; phone: string };
  passengers: DraftPassenger[];
  couponCode: string;
  idempotencyKey?: string;
}

const keyOf = (tripOfferId: string) => `flight-draft:${tripOfferId}`;

export function loadFlightDraft(tripOfferId: string): FlightDraft | null {
  try {
    const text = sessionStorage.getItem(keyOf(tripOfferId));
    if (!text) return null;
    const draft = JSON.parse(text) as FlightDraft;
    return draft.tripOfferId === tripOfferId && Array.isArray(draft.passengers) ? draft : null;
  } catch {
    return null;
  }
}

export function saveFlightDraft(draft: FlightDraft): void {
  try {
    sessionStorage.setItem(keyOf(draft.tripOfferId), JSON.stringify(draft));
  } catch {
    // Private mode or storage full: the review page then sends the customer back to the passenger details.
  }
}

export function clearFlightDraft(tripOfferId: string): void {
  try {
    sessionStorage.removeItem(keyOf(tripOfferId));
  } catch {
    // Nothing to clean up.
  }
  passportNumbers.delete(tripOfferId);
}

/**
 * Passport numbers are sensitive: they are never written to sessionStorage or localStorage. They live only in this
 * variable, so they are gone after a reload (the review page then asks for the passenger details again).
 */
const passportNumbers = new Map<string, string[]>();

export function rememberPassportNumbers(tripOfferId: string, numbers: string[]): void {
  passportNumbers.set(tripOfferId, numbers);
}

export function recallPassportNumbers(tripOfferId: string): string[] {
  return passportNumbers.get(tripOfferId) ?? [];
}
