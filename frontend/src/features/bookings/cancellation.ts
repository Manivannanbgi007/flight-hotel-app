import { z } from 'zod';

import type { StatusTone } from './status';
import type {
  BookingDetails,
  CancellationInitiator,
  CancellationStatus,
  RefundItem,
  RefundReason,
  RefundStatus,
} from './types';

/** Cancellation and refund wording (API_DOCUMENTATION.md §8.4, BOOKING_WORKFLOW.md §4). Plain words, no internal terms. */

type BookingType = 'HOTEL' | 'FLIGHT';

const supplierOf = (type: BookingType) => (type === 'FLIGHT' ? 'airline' : 'hotel');

/** Heading for "cannot be cancelled" (quote `reasonCode`, or `details.reasonCode` of 409 BOOKING_NOT_CANCELLABLE). */
export function notCancellableTitle(reasonCode: unknown): string {
  switch (reasonCode) {
    case 'NOT_CONFIRMED':
      return 'This booking is not confirmed';
    case 'CANCELLATION_IN_PROGRESS':
      return 'Cancellation already in progress';
    case 'ALREADY_CANCELLED':
      return 'This booking is already cancelled';
    case 'COMPLETED':
      return 'This trip is over';
    case 'TOO_LATE':
      return 'It is too late to cancel online';
    default:
      return 'This booking cannot be cancelled';
  }
}

/** Words for a reason code when the server sent no `message`. */
export function notCancellableText(reasonCode: unknown, type: BookingType = 'HOTEL'): string {
  switch (reasonCode) {
    case 'NOT_CONFIRMED':
      return 'Only confirmed bookings can be cancelled.';
    case 'CANCELLATION_IN_PROGRESS':
      return `We have already asked the ${supplierOf(type)} to cancel. The booking page shows the result.`;
    case 'ALREADY_CANCELLED':
      return 'There is nothing left to cancel.';
    case 'COMPLETED':
      return 'Past trips cannot be cancelled.';
    case 'TOO_LATE':
      return 'The time to cancel has passed. Please contact customer support.';
    default:
      return 'Please contact customer support.';
  }
}

export function cancellationStatusInfo(status: CancellationStatus, type: BookingType = 'HOTEL'): { label: string; tone: StatusTone } {
  switch (status) {
    case 'PENDING':
      return { label: `Waiting for the ${supplierOf(type)}`, tone: 'warning' };
    case 'CONFIRMED':
      return { label: 'Cancelled', tone: 'neutral' };
    default:
      return { label: 'Not cancelled', tone: 'danger' };
  }
}

/** Who asked for the cancellation, for the customer ("You") or for staff ("The customer"). */
export function initiatorLabel(initiatedBy: CancellationInitiator, viewer: 'customer' | 'staff'): string {
  if (initiatedBy === 'CUSTOMER') {
    return viewer === 'customer' ? 'You' : 'The customer';
  }
  if (initiatedBy === 'HOTEL') {
    return 'The hotel';
  }
  if (viewer === 'customer') {
    return 'Our support team';
  }
  return initiatedBy === 'ADMIN' ? 'An admin' : 'A support agent';
}

export const refundReasonLabels: Record<RefundReason, string> = {
  CANCELLATION: 'Cancellation',
  BOOKING_FAILED: 'Booking could not be confirmed',
  LATE_PAYMENT: 'Payment arrived after the time to pay',
  DUPLICATE_PAYMENT: 'Paid twice',
  GOODWILL: 'Goodwill refund from our team',
};

export const refundStatusInfo: Record<RefundStatus, { label: string; tone: StatusTone }> = {
  REQUESTED: { label: 'In progress', tone: 'warning' },
  COMPLETED: { label: 'Refunded', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
};

/** The newest refund request, or null. */
export function latestRefund(refunds: readonly RefundItem[]): RefundItem | null {
  return refunds.reduce<RefundItem | null>(
    (latest, refund) => (!latest || refund.requestedAt > latest.requestedAt ? refund : latest),
    null,
  );
}

/**
 * "Retry refund" makes sense only while the booking still waits for its money and the latest refund request failed
 * (otherwise the server answers 409 NO_FAILED_REFUND).
 */
export function canRetryRefund(booking: Pick<BookingDetails, 'status' | 'refunds'>): boolean {
  return booking.status === 'REFUND_PENDING' && latestRefund(booking.refunds)?.status === 'FAILED';
}

/** A number from a Problem Details `details` value (the server sends amounts as numbers). */
export function amountOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

// ---- The reason form ----

export const OTHER_REASON = 'OTHER';
export const REASON_MAX_LENGTH = 500;

/** Preset reasons; "Other" lets the user write one (up to 500 characters). */
export const customerReasons = ['Change of plans', 'Booked by mistake', 'Found a better price', 'Travel dates changed'] as const;
export const staffReasons = ['Customer asked us to cancel', 'The hotel or airline cannot honour the booking', 'Duplicate booking'] as const;

const reasonFields = z.object({
  choice: z.string(),
  other: z.string().trim().max(REASON_MAX_LENGTH, `Please keep this under ${REASON_MAX_LENGTH} characters`),
});

/** Optional for the booking's owner. */
export const customerReasonSchema = reasonFields;

/** Required when staff cancel someone else's booking (the server answers 422 REASON_REQUIRED otherwise). */
export const staffReasonSchema = reasonFields.superRefine((form, ctx) => {
  if (!form.choice) {
    ctx.addIssue({ code: 'custom', path: ['choice'], message: 'Choose a reason' });
  } else if (form.choice === OTHER_REASON && !form.other) {
    ctx.addIssue({ code: 'custom', path: ['other'], message: 'Write the reason' });
  }
});

export type CancelReasonForm = z.infer<typeof reasonFields>;

/** The reason sent to the server: the chosen preset or the text written under "Other"; undefined for none. */
export function reasonOf(form: CancelReasonForm): string | undefined {
  if (form.choice === OTHER_REASON) {
    return form.other.trim() || undefined;
  }
  return form.choice || undefined;
}
