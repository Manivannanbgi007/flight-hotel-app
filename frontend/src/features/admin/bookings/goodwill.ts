import { z } from 'zod';

import type { BookingDetails } from '@/features/bookings/types';
import { hasCapturedPayment } from '@/features/documents/documentDownload';
import { formatMoney } from '@/lib/format';

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * What a goodwill refund may still give back (API_DOCUMENTATION.md §14.2): paid − refunded − refunds in progress.
 * Only a hint for the form: the server decides (`422 REFUND_TOO_LARGE`).
 */
export function refundableAmount(booking: Pick<BookingDetails, 'paymentStatus' | 'totalAmount' | 'refundedAmount' | 'refunds'>): number {
  if (!hasCapturedPayment(booking.paymentStatus)) {
    return 0;
  }
  const inProgress = booking.refunds.filter((refund) => refund.status === 'REQUESTED').reduce((sum, refund) => sum + refund.amount, 0);
  return Math.max(0, round2(booking.totalAmount - booking.refundedAmount - inProgress));
}

export const GOODWILL_REASON_MAX = 500;

/** Amount in rupees (up to 2 decimals, more than 0, at most `max`) and a reason (required). */
export const goodwillSchema = (max: number, currency = 'INR') =>
  z.object({
    amount: z
      .string()
      .trim()
      .min(1, 'Enter the amount')
      .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), 'Enter an amount in rupees, for example 500 or 499.50')
      .refine((value) => Number(value) > 0, 'Enter more than 0')
      .refine((value) => Number(value) <= max, `At most ${formatMoney(max, currency, true)} can be refunded`),
    reason: z.string().trim().min(5, 'Write the reason (at least 5 characters)').max(GOODWILL_REASON_MAX, `Use at most ${GOODWILL_REASON_MAX} characters`),
  });
export type GoodwillForm = { amount: string; reason: string };
