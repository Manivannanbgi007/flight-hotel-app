import {
  amountOf,
  canRetryRefund,
  cancellationStatusInfo,
  customerReasonSchema,
  initiatorLabel,
  latestRefund,
  notCancellableText,
  notCancellableTitle,
  OTHER_REASON,
  reasonOf,
  refundReasonLabels,
  staffReasonSchema,
} from './cancellation';
import { bookingPaymentStatusInfo, isConfirmed, statusDescription, statusLabel } from './status';
import { refundFixture } from './testData';

describe('cancellation wording', () => {
  it('labels the cancellation states and a refund that kept the fee', () => {
    expect(statusLabel('CANCELLATION_PENDING')).toBe('Cancellation in progress');
    expect(statusDescription('CANCELLATION_PENDING', 'FLIGHT')).toMatch(/airline/);
    expect(statusLabel('REFUNDED', 'HOTEL', 'REFUNDED')).toBe('Refunded');
    expect(statusLabel('REFUNDED', 'HOTEL', 'PARTIALLY_REFUNDED')).toBe('Partly refunded');
    expect(statusDescription('REFUNDED', 'HOTEL', 'PARTIALLY_REFUNDED')).toMatch(/fee was kept/);
    expect(bookingPaymentStatusInfo.PARTIALLY_REFUNDED.label).toBe('Partly refunded');
    // Golden rule 3: a booking being cancelled is still valid, so its references stay visible.
    expect(isConfirmed('CANCELLATION_PENDING')).toBe(true);
    expect(isConfirmed('CANCELLED')).toBe(false);
  });

  it('says who asked, in the words of the reader', () => {
    expect(initiatorLabel('CUSTOMER', 'customer')).toBe('You');
    expect(initiatorLabel('SUPPORT_AGENT', 'customer')).toBe('Our support team');
    expect(initiatorLabel('CUSTOMER', 'staff')).toBe('The customer');
    expect(initiatorLabel('ADMIN', 'staff')).toBe('An admin');
    // Phase 9: the hotel cancelled on its own (hotel manager portal).
    expect(initiatorLabel('HOTEL', 'customer')).toBe('The hotel');
    expect(initiatorLabel('HOTEL', 'staff')).toBe('The hotel');
    expect(refundReasonLabels.GOODWILL).toBe('Goodwill refund from our team');
    expect(initiatorLabel('SUPPORT_AGENT', 'staff')).toBe('A support agent');
    expect(initiatorLabel('ADMIN', 'customer')).toBe('Our support team');
  });

  it('labels a cancellation by its state, naming the hotel or the airline', () => {
    expect(cancellationStatusInfo('PENDING')).toEqual({ label: 'Waiting for the hotel', tone: 'warning' });
    expect(cancellationStatusInfo('PENDING', 'FLIGHT')).toEqual({ label: 'Waiting for the airline', tone: 'warning' });
    expect(cancellationStatusInfo('CONFIRMED')).toEqual({ label: 'Cancelled', tone: 'neutral' });
    expect(cancellationStatusInfo('REJECTED')).toEqual({ label: 'Not cancelled', tone: 'danger' });
  });
});

describe('why a booking cannot be cancelled', () => {
  it.each([
    ['NOT_CONFIRMED', 'This booking is not confirmed', 'Only confirmed bookings can be cancelled.'],
    ['CANCELLATION_IN_PROGRESS', 'Cancellation already in progress', 'We have already asked the hotel to cancel. The booking page shows the result.'],
    ['ALREADY_CANCELLED', 'This booking is already cancelled', 'There is nothing left to cancel.'],
    ['COMPLETED', 'This trip is over', 'Past trips cannot be cancelled.'],
    ['TOO_LATE', 'It is too late to cancel online', 'The time to cancel has passed. Please contact customer support.'],
    ['SOMETHING_NEW', 'This booking cannot be cancelled', 'Please contact customer support.'],
    [undefined, 'This booking cannot be cancelled', 'Please contact customer support.'],
  ])('reason %s has a title and an explanation', (reasonCode, title, text) => {
    expect(notCancellableTitle(reasonCode)).toBe(title);
    expect(notCancellableText(reasonCode)).toBe(text);
  });

  it('names the airline for flights', () => {
    expect(notCancellableText('CANCELLATION_IN_PROGRESS', 'FLIGHT')).toBe(
      'We have already asked the airline to cancel. The booking page shows the result.');
  });
});

describe('amounts in error details', () => {
  it('reads numbers and numeric text, nothing else', () => {
    expect(amountOf(1968.75)).toBe(1968.75);
    expect(amountOf('656.25')).toBe(656.25);
    expect(amountOf(0)).toBe(0);
    expect(amountOf(' ')).toBeNull();
    expect(amountOf('a lot')).toBeNull();
    expect(amountOf(Number.NaN)).toBeNull();
    expect(amountOf(Number.POSITIVE_INFINITY)).toBeNull();
    expect(amountOf(null)).toBeNull();
    expect(amountOf(undefined)).toBeNull();
  });
});

describe('retry refund', () => {
  it('is only offered while the refund is pending and the latest request failed', () => {
    const failed = refundFixture({ id: 'r1', status: 'FAILED', requestedAt: '2099-03-02T10:05:00Z' });
    const retried = refundFixture({ id: 'r2', status: 'REQUESTED', requestedAt: '2099-03-02T11:00:00Z' });

    expect(latestRefund([retried, failed])).toBe(retried);
    expect(latestRefund([])).toBeNull();
    expect(canRetryRefund({ status: 'REFUND_PENDING', refunds: [failed] })).toBe(true);
    expect(canRetryRefund({ status: 'REFUND_PENDING', refunds: [failed, retried] })).toBe(false);
    expect(canRetryRefund({ status: 'REFUNDED', refunds: [failed] })).toBe(false);
    expect(canRetryRefund({ status: 'REFUND_PENDING', refunds: [] })).toBe(false);
  });
});

describe('cancellation reason', () => {
  it('is optional for the customer and required for staff, up to 500 characters', () => {
    expect(customerReasonSchema.safeParse({ choice: '', other: '' }).success).toBe(true);
    expect(staffReasonSchema.safeParse({ choice: '', other: '' }).success).toBe(false);
    expect(staffReasonSchema.safeParse({ choice: OTHER_REASON, other: '  ' }).success).toBe(false);
    expect(staffReasonSchema.safeParse({ choice: OTHER_REASON, other: 'Airline moved the flight' }).success).toBe(true);
    expect(customerReasonSchema.safeParse({ choice: OTHER_REASON, other: 'x'.repeat(501) }).success).toBe(false);
  });

  it('sends the preset, or the text written under "Other"', () => {
    expect(reasonOf({ choice: 'Change of plans', other: 'ignored' })).toBe('Change of plans');
    expect(reasonOf({ choice: OTHER_REASON, other: ' Visa refused ' })).toBe('Visa refused');
    expect(reasonOf({ choice: OTHER_REASON, other: '' })).toBeUndefined();
    expect(reasonOf({ choice: '', other: '' })).toBeUndefined();
  });
});
