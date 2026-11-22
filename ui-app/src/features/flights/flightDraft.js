const keyOf = (tripOfferId) => `flight-draft:${tripOfferId}`;

export function loadFlightDraft(tripOfferId) {
  try {
    const text = sessionStorage.getItem(keyOf(tripOfferId));
    if (!text) return null;
    const draft = JSON.parse(text);
    return draft.tripOfferId === tripOfferId && Array.isArray(draft.passengers) ? draft : null;
  } catch {
    return null;
  }
}

export function saveFlightDraft(draft) {
  try {
    sessionStorage.setItem(keyOf(draft.tripOfferId), JSON.stringify(draft));
  } catch {
    // Private mode or storage full: the review page then sends the customer back to the passenger details.
  }
}

export function clearFlightDraft(tripOfferId) {
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
const passportNumbers = new Map();

export function rememberPassportNumbers(tripOfferId, numbers) {
  passportNumbers.set(tripOfferId, numbers);
}

export function recallPassportNumbers(tripOfferId) {
  return passportNumbers.get(tripOfferId) ?? [];
}
