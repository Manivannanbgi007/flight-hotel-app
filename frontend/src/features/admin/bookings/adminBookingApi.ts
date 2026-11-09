import type { BookingStatus, RefundItem } from '@/features/bookings/types';
import type { SupportBookingRow } from '@/features/support/types';
import { apiClient } from '@/lib/api/client';
import type { Page } from '@/lib/api/types';

/** A row of `GET /api/admin/bookings` (API_DOCUMENTATION.md §14.2): the support lookup row plus the owner and refunds. */
export interface AdminBookingRow extends SupportBookingRow {
  userId: string;
  refundedAmount: number;
}

/** The list's filters, as kept in the URL. Empty strings mean "all"; `from` / `to` are creation dates. */
export type AdminBookingFilters = {
  q: string;
  status: BookingStatus | '';
  type: 'HOTEL' | 'FLIGHT' | '';
  from: string;
  to: string;
  attention: boolean;
  page: number;
  sort?: string;
};

export interface GoodwillRefundBody {
  amount: number;
  reason: string;
}

export const adminBookingApi = {
  async list(filters: AdminBookingFilters, size = 20): Promise<Page<AdminBookingRow>> {
    const { data } = await apiClient.get<Page<AdminBookingRow>>('/admin/bookings', {
      params: {
        q: filters.q || undefined,
        status: filters.status || undefined,
        type: filters.type || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        attention: filters.attention || undefined,
        page: filters.page,
        size,
        sort: filters.sort,
      },
    });
    return data;
  },

  /**
   * Goodwill refund (REFUND_MANAGE): at most what is still refundable (`422 REFUND_TOO_LARGE`; `409 NOT_REFUNDABLE`
   * when nothing was paid). The same key returns the same refund (double click, retry after a timeout).
   */
  async goodwillRefund(bookingId: string, body: GoodwillRefundBody, idempotencyKey: string): Promise<RefundItem> {
    const { data } = await apiClient.post<RefundItem>(`/admin/bookings/${encodeURIComponent(bookingId)}/refunds`, body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return data;
  },
};
