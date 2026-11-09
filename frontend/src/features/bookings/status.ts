import type { BookingPaymentStatus, BookingStatus, BookingTab } from './types';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

interface StatusInfo {
  label: string;
  tone: StatusTone;
  /** One sentence for the customer: what this status means and what happens next. */
  description: string;
}

/** How each booking status is shown (BOOKING_WORKFLOW.md section 1). Plain words, no internal terms. */
export const statusInfo: Record<BookingStatus, StatusInfo> = {
  INITIATED: { label: 'Securing your room', tone: 'info', description: 'We are holding your room at the quoted price.' },
  PENDING_PAYMENT: { label: 'Waiting for payment', tone: 'warning', description: 'Your room is held. Pay before the timer ends to keep it.' },
  PAYMENT_SUCCESS: { label: 'Payment received', tone: 'info', description: 'We are confirming your room with the hotel.' },
  SUPPLIER_PENDING: { label: 'Confirming with the hotel', tone: 'info', description: 'This usually takes a few seconds.' },
  CONFIRMED: { label: 'Confirmed', tone: 'success', description: 'Your stay is confirmed. Show the confirmation number at check-in.' },
  COMPLETED: { label: 'Completed', tone: 'neutral', description: 'This stay is over. We hope you enjoyed it.' },
  CANCELLATION_PENDING: {
    label: 'Cancellation in progress',
    tone: 'warning',
    description: 'We have asked the hotel to cancel. Your booking stays valid until the hotel confirms.',
  },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', description: 'This booking was cancelled.' },
  REFUND_PENDING: { label: 'Refund in progress', tone: 'warning', description: 'Your money is on its way back to your original payment method.' },
  REFUNDED: { label: 'Refunded', tone: 'neutral', description: 'Your payment was refunded in full.' },
  FAILED: { label: 'Not booked', tone: 'danger', description: 'We could not complete this booking. Nothing was charged.' },
  EXPIRED: { label: 'Expired', tone: 'neutral', description: 'The time to pay ran out, so the room was released.' },
};

/** Flight wording where the hotel version would be wrong ("room", "hotel"); every other status reads the same. */
const flightDescriptions: Partial<Record<BookingStatus, string>> = {
  INITIATED: 'We are holding your seats at the quoted fare.',
  PENDING_PAYMENT: 'Your seats are held. Pay before the timer ends to keep them.',
  PAYMENT_SUCCESS: 'We are confirming your tickets with the airline.',
  SUPPLIER_PENDING: 'We are waiting for the airline to issue your tickets. This usually takes a few seconds.',
  CONFIRMED: 'Your flight is confirmed. Show your booking reference (PNR) and ticket number at check-in.',
  COMPLETED: 'This trip is over. We hope you had a good flight.',
  CANCELLATION_PENDING: 'We have asked the airline to cancel. Your tickets stay valid until the airline confirms.',
  FAILED: 'We could not complete this booking. Nothing was charged.',
  EXPIRED: 'The time to pay ran out, so the seats were released.',
};

/** A refunded booking where the cancellation fee was kept (payment status PARTIALLY_REFUNDED). */
const partlyRefunded = (status: BookingStatus, paymentStatus?: BookingPaymentStatus) =>
  status === 'REFUNDED' && paymentStatus === 'PARTIALLY_REFUNDED';

/** What a status means for the customer, in the words of the booking's type. */
export function statusDescription(status: BookingStatus, type: 'HOTEL' | 'FLIGHT' = 'HOTEL', paymentStatus?: BookingPaymentStatus): string {
  if (partlyRefunded(status, paymentStatus)) {
    return 'Your refund was paid back to your original payment method. The cancellation fee was kept.';
  }
  return (type === 'FLIGHT' ? flightDescriptions[status] : undefined) ?? statusInfo[status].description;
}

/** The label of a status; flights say "airline" where hotels say "hotel". */
export function statusLabel(status: BookingStatus, type: 'HOTEL' | 'FLIGHT' = 'HOTEL', paymentStatus?: BookingPaymentStatus): string {
  if (type === 'FLIGHT') {
    if (status === 'INITIATED') return 'Securing your seats';
    if (status === 'SUPPLIER_PENDING') return 'Confirming with the airline';
  }
  if (partlyRefunded(status, paymentStatus)) return 'Partly refunded';
  return statusInfo[status].label;
}

/** The booking's own payment status (not a payment attempt's: see payments/paymentStatus.ts). */
export const bookingPaymentStatusInfo: Record<BookingPaymentStatus, { label: string; tone: StatusTone }> = {
  UNPAID: { label: 'Not paid', tone: 'neutral' },
  PAYMENT_FAILED: { label: 'Payment failed', tone: 'danger' },
  PAID: { label: 'Paid', tone: 'success' },
  REFUND_PENDING: { label: 'Refund in progress', tone: 'warning' },
  PARTIALLY_REFUNDED: { label: 'Partly refunded', tone: 'warning' },
  REFUNDED: { label: 'Refunded', tone: 'neutral' },
};

/** Statuses where the system is working and the page should keep checking. */
export function isProcessing(status: BookingStatus): boolean {
  return status === 'INITIATED' || status === 'PAYMENT_SUCCESS' || status === 'SUPPLIER_PENDING';
}

/** The booking ended without a stay (nothing to pay or wait for). */
export function isDeadEnd(status: BookingStatus): boolean {
  return status === 'FAILED' || status === 'EXPIRED';
}

export function isConfirmed(status: BookingStatus): boolean {
  return status === 'CONFIRMED' || status === 'COMPLETED' || status === 'CANCELLATION_PENDING';
}

export const bookingTabs: { value: BookingTab; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'UPCOMING', label: 'Upcoming' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function parseTab(value: string | null): BookingTab {
  return bookingTabs.some((tab) => tab.value === value) ? (value as BookingTab) : 'ALL';
}

/** Reason codes the hotel gives when it could not hold the rooms, in words for the customer. */
export function failureAdvice(reason: string | null, type: 'HOTEL' | 'FLIGHT' = 'HOTEL'): string {
  if (type === 'FLIGHT') {
    switch (reason) {
      case 'SOLD_OUT':
        return 'The seats were taken by someone else a moment ago. Please choose another flight.';
      case 'PRICE_CHANGED':
        return 'The fare changed since you searched. Please search again to see today\'s price.';
      case 'OFFER_EXPIRED':
        return 'Fares are kept for 20 minutes and this one ran out. Please search again.';
      case 'INVALID_PASSENGERS':
        return 'The passenger details did not match the trip (travellers, ages or names). Please search again and check them.';
      case 'NO_RESPONSE':
        return 'The airline system did not answer in time. Please try again.';
      case 'PAYMENT_TIMEOUT':
        return 'The time to pay ran out, so the seats were released.';
      default:
        return 'Please search again and choose another flight.';
    }
  }
  switch (reason) {
    case 'SOLD_OUT':
      return 'The room was booked by someone else a moment ago. Please choose another room or date.';
    case 'PRICE_CHANGED':
      return 'The price changed since you checked. Please check availability again to see today\'s price.';
    case 'QUOTE_EXPIRED':
      return 'Prices are held for 15 minutes and this one ran out. Please check availability again.';
    case 'NO_RESPONSE':
      return 'The hotel did not answer in time. Please try again.';
    case 'PAYMENT_TIMEOUT':
      return 'The time to pay ran out, so the room was released.';
    default:
      return 'Please search again and choose another room.';
  }
}
