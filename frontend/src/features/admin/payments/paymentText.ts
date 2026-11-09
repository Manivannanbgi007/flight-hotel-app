import type { Tone } from '../shared/labels';
import type { AdminRefundStatus } from './adminPaymentApi';

/** Refund status of payment-service (not the booking's refund item status). */
export const REFUND_STATUS_INFO: Record<AdminRefundStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'In progress', tone: 'warning' },
  PROCESSED: { label: 'Refunded', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
};
export const REFUND_STATUSES = Object.keys(REFUND_STATUS_INFO) as AdminRefundStatus[];

const REFUND_REASONS: Record<string, string> = {
  CANCELLATION: 'Cancellation',
  BOOKING_FAILED: 'Booking could not be confirmed',
  LATE_PAYMENT: 'Paid after the time to pay',
  DUPLICATE_PAYMENT: 'Paid twice',
  GOODWILL: 'Goodwill',
  HOTEL_CANCELLED: 'Cancelled by the hotel',
};

export function refundReasonLabel(reason: string): string {
  return REFUND_REASONS[reason] ?? reason;
}

/** The methods the payment providers report (Razorpay's own names, and "demo" for the demo payment). */
export const PAYMENT_METHODS = [
  { value: 'card', label: 'Card' },
  { value: 'upi', label: 'UPI' },
  { value: 'netbanking', label: 'Net banking' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'emi', label: 'EMI' },
  { value: 'paylater', label: 'Pay later' },
  { value: 'demo', label: 'Demo payment' },
] as const;

/** "UPI" for `upi`; an unknown method is shown as it came; a payment without one (not paid yet) as a dash. */
export function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return '—';
  return PAYMENT_METHODS.find((known) => known.value === method.toLowerCase())?.label ?? method;
}
