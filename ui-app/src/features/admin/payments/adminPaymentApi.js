import { apiClient } from '@/lib/api/client';

/** `/api/admin/payments`, `/api/admin/refunds`, `/api/payments/{id}` (API_DOCUMENTATION.md §14.3, PAYMENT_READ_ANY). */

/** The query string the list and its summary share (no page, size or sort). */
const filterParams = (filters) => ({
  q: filters.q || undefined,
  status: filters.status || undefined,
  provider: filters.provider || undefined,
  method: filters.method || undefined,
  bookingType: filters.bookingType || undefined,
  from: filters.from || undefined,
  to: filters.to || undefined,
});

export const adminPaymentApi = {
  async list(filters, size = 20) {
    const { data } = await apiClient.get('/admin/payments', {
      params: { ...filterParams(filters), page: filters.page, size, sort: filters.sort },
    });
    return data;
  },

  async summary(filters) {
    const { data } = await apiClient.get('/admin/payments/summary', { params: filterParams(filters) });
    return data;
  },

  async get(paymentId) {
    const { data } = await apiClient.get(`/payments/${encodeURIComponent(paymentId)}`);
    return data;
  },

  async refunds(filters, size = 20) {
    const { data } = await apiClient.get('/admin/refunds', {
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
