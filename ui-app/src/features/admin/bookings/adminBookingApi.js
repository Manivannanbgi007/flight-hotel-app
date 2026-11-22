import { apiClient } from '@/lib/api/client';

export const adminBookingApi = {
  async list(filters, size = 20) {
    const { data } = await apiClient.get('/admin/bookings', {
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
  async goodwillRefund(bookingId, body, idempotencyKey) {
    const { data } = await apiClient.post(`/admin/bookings/${encodeURIComponent(bookingId)}/refunds`, body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return data;
  },
};
