import { clearDraft, loadDraft, newIdempotencyKey, saveDraft, type BookingDraft } from './bookingDraft';
import { guestDetailsSchema } from './schemas';
import { failureAdvice, isConfirmed, isDeadEnd, isProcessing, parseTab, statusInfo } from './status';
import type { BookingStatus } from './types';

const ALL: BookingStatus[] = [
  'INITIATED', 'PENDING_PAYMENT', 'PAYMENT_SUCCESS', 'SUPPLIER_PENDING', 'CONFIRMED', 'COMPLETED',
  'CANCELLATION_PENDING', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED', 'FAILED', 'EXPIRED',
];

describe('booking statuses', () => {
  it('every status has a label, a tone and a sentence for the customer', () => {
    for (const status of ALL) {
      expect(statusInfo[status].label.length).toBeGreaterThan(2);
      expect(statusInfo[status].description).toMatch(/\.$/);
    }
  });

  it('knows when the system is still working, when a booking is confirmed and when it is a dead end', () => {
    expect(ALL.filter(isProcessing)).toEqual(['INITIATED', 'PAYMENT_SUCCESS', 'SUPPLIER_PENDING']);
    expect(ALL.filter(isConfirmed)).toEqual(['CONFIRMED', 'COMPLETED', 'CANCELLATION_PENDING']);
    expect(ALL.filter(isDeadEnd)).toEqual(['FAILED', 'EXPIRED']);
  });

  it('payment success alone never counts as confirmed (golden rule 2)', () => {
    expect(isConfirmed('PAYMENT_SUCCESS')).toBe(false);
    expect(isConfirmed('SUPPLIER_PENDING')).toBe(false);
  });

  it('reads the My Trips tab from the URL and ignores anything unknown', () => {
    expect(parseTab('UPCOMING')).toBe('UPCOMING');
    expect(parseTab('nonsense')).toBe('ALL');
    expect(parseTab(null)).toBe('ALL');
  });

  it('explains every hotel failure reason in words', () => {
    expect(failureAdvice('SOLD_OUT')).toMatch(/booked by someone else/);
    expect(failureAdvice('PRICE_CHANGED')).toMatch(/price changed/);
    expect(failureAdvice('QUOTE_EXPIRED')).toMatch(/15 minutes/);
    expect(failureAdvice('NO_RESPONSE')).toMatch(/did not answer/);
    expect(failureAdvice('PAYMENT_TIMEOUT')).toMatch(/time to pay/);
    expect(failureAdvice(null)).toMatch(/search again/);
  });
});

describe('booking draft', () => {
  const draft: BookingDraft = {
    quoteId: 'q1',
    contact: { email: 'asha@example.com', phone: '+91 98000 00000' },
    guests: [{ firstName: 'Asha', lastName: 'Rao' }],
    specialRequests: '',
    couponCode: 'WELCOME10',
  };

  beforeEach(() => sessionStorage.clear());

  it('is kept per quote and can be removed', () => {
    saveDraft(draft);
    expect(loadDraft('q1')).toEqual(draft);
    expect(loadDraft('other')).toBeNull();
    clearDraft('q1');
    expect(loadDraft('q1')).toBeNull();
  });

  it('keeps the idempotency key for a retry', () => {
    saveDraft({ ...draft, idempotencyKey: 'key-123456789' });
    expect(loadDraft('q1')?.idempotencyKey).toBe('key-123456789');
  });

  it('ignores damaged storage instead of crashing', () => {
    sessionStorage.setItem('booking-draft:q1', '{not json');
    expect(loadDraft('q1')).toBeNull();
    sessionStorage.setItem('booking-draft:q1', JSON.stringify({ quoteId: 'other', guests: [] }));
    expect(loadDraft('q1')).toBeNull();
  });

  it('makes keys the server accepts (8 to 100 letters, digits, - or _)', () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(newIdempotencyKey()).not.toBe(key);
  });
});

describe('guest details schema', () => {
  const valid = {
    guests: [{ firstName: 'Asha', lastName: 'Rao' }],
    contactEmail: 'asha@example.com',
    contactPhone: '+91 98000 00000',
    specialRequests: '',
    couponCode: '',
  };

  it('accepts complete details', () => {
    expect(guestDetailsSchema.safeParse(valid).success).toBe(true);
  });

  it('needs a name per guest, a valid email and a phone number', () => {
    const result = guestDetailsSchema.safeParse({
      ...valid, guests: [{ firstName: '', lastName: 'R4o' }], contactEmail: 'nope', contactPhone: '12',
    });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((issue) => issue.message) ?? [];
    expect(messages).toEqual(expect.arrayContaining([
      'Enter your first name', expect.stringMatching(/Last name can only contain letters/),
      'Enter a valid email address', 'Enter 7–15 digits, optionally starting with +',
    ]));
  });

  it('limits special requests and coupon characters like the server does', () => {
    expect(guestDetailsSchema.safeParse({ ...valid, specialRequests: 'x'.repeat(501) }).success).toBe(false);
    expect(guestDetailsSchema.safeParse({ ...valid, couponCode: 'WELCOME 10!' }).success).toBe(false);
    expect(guestDetailsSchema.safeParse({ ...valid, couponCode: 'WELCOME10' }).success).toBe(true);
  });
});
