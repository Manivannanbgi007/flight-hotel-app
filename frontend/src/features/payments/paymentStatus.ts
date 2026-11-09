import type { PaymentStatus } from './types';

/** How each payment status is shown (PAYMENT_INTEGRATION.md section 4), in plain words. */
export const paymentStatusInfo: Record<PaymentStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
  INITIATED: { label: 'Not paid', tone: 'neutral' },
  PENDING: { label: 'Processing', tone: 'info' },
  SUCCESS: { label: 'Paid', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  REFUND_PENDING: { label: 'Refund in progress', tone: 'warning' },
  PARTIALLY_REFUNDED: { label: 'Partly refunded', tone: 'warning' },
  REFUNDED: { label: 'Refunded', tone: 'neutral' },
};
