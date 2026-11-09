import type { PaymentProvider, PaymentStatus, PaymentSummary } from '@/features/payments/types';
import { apiClient } from '@/lib/api/client';
import type { Page } from '@/lib/api/types';

/** `/api/admin/payments`, `/api/admin/refunds`, `/api/payments/{id}` (API_DOCUMENTATION.md §14.3, PAYMENT_READ_ANY). */

export interface AdminPaymentRow extends PaymentSummary {
  /** HOTEL or FLIGHT; null for an old payment whose booking is unknown. */
  bookingType?: 'HOTEL' | 'FLIGHT' | null;
  userId: string | null;
  contactEmail: string | null;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  failureCode: string | null;
}

export type AdminRefundStatus = 'PENDING' | 'PROCESSED' | 'FAILED';

/** A refund of a payment (payment-service). Refunds are started from the booking, never from here. */
export interface PaymentRefund {
  id: string;
  amount: number;
  currency?: string;
  status: AdminRefundStatus;
  reason: string;
  providerRefundId: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentDetails extends PaymentSummary {
  bookingType?: 'HOTEL' | 'FLIGHT' | null;
  contactEmail?: string | null;
  providerPaymentId?: string | null;
  providerOrderId?: string | null;
  failureCode?: string | null;
  refunds: PaymentRefund[];
}

export interface AdminRefundRow extends PaymentRefund {
  paymentId: string;
  bookingId: string;
  bookingReference: string | null;
}

export type PaymentBookingType = 'HOTEL' | 'FLIGHT';

export type PaymentFilters = {
  q: string;
  status: PaymentStatus | '';
  provider: PaymentProvider | '';
  /** Card, UPI, … as the provider reported it (matched without regard to case). */
  method?: string;
  bookingType?: PaymentBookingType | '';
  from: string;
  to: string;
  page: number;
  sort?: string;
};

/** `GET /api/admin/payments/summary`: counts and money for the same filters as the list. */
export interface PaymentsSummary {
  total: number;
  /** Captured payments, also those refunded since. */
  successful: number;
  failed: number;
  /** Attempts that are still open (created, waiting for the provider). */
  pending: number;
  collectedAmount: number;
  refundedAmount: number;
  currency: string;
}

/** The query string the list and its summary share (no page, size or sort). */
const filterParams = (filters: PaymentFilters) => ({
  q: filters.q || undefined,
  status: filters.status || undefined,
  provider: filters.provider || undefined,
  method: filters.method || undefined,
  bookingType: filters.bookingType || undefined,
  from: filters.from || undefined,
  to: filters.to || undefined,
});

export type RefundFilters = {
  q: string;
  status: AdminRefundStatus | '';
  from: string;
  to: string;
  page: number;
};

export const adminPaymentApi = {
  async list(filters: PaymentFilters, size = 20): Promise<Page<AdminPaymentRow>> {
    const { data } = await apiClient.get<Page<AdminPaymentRow>>('/admin/payments', {
      params: { ...filterParams(filters), page: filters.page, size, sort: filters.sort },
    });
    return data;
  },

  async summary(filters: PaymentFilters): Promise<PaymentsSummary> {
    const { data } = await apiClient.get<PaymentsSummary>('/admin/payments/summary', { params: filterParams(filters) });
    return data;
  },

  async get(paymentId: string): Promise<PaymentDetails> {
    const { data } = await apiClient.get<PaymentDetails>(`/payments/${encodeURIComponent(paymentId)}`);
    return data;
  },

  async refunds(filters: RefundFilters, size = 20): Promise<Page<AdminRefundRow>> {
    const { data } = await apiClient.get<Page<AdminRefundRow>>('/admin/refunds', {
      params: {
        q: filters.q || undefined,
        status: filters.status || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        page: filters.page,
        size,
      },
    });
    return data;
  },
};
