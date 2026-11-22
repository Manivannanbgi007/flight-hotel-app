import { apiClient } from '@/lib/api/client';

/** Only the filters that are set go into the query string. */
function historyParams(filters, withSort = true) {
  if (!filters) return {};
  return {
    q: filters.q || undefined,
    status: filters.status || undefined,
    method: filters.method || undefined,
    bookingType: filters.bookingType || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    sort: withSort ? filters.sort || undefined : undefined,
  };
}

/** `/api/payments` and `/api/invoices` (API_DOCUMENTATION.md, Payments). */
export const paymentApi = {
  /** The order for a booking that waits for payment. The same key (or an order still open) returns the same order. */
  async createOrder(bookingId, idempotencyKey) {
    const { data } = await apiClient.post(
      '/payments/create-order',
      { bookingId },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    return data;
  },

  /** The checkout window's callback. The server decides (signature + the provider's own record), not the browser. */
  async verify(callback) {
    const { data } = await apiClient.post('/payments/verify', callback);
    return data;
  },

  /** The checkout window said a payment failed; the server closes the attempt if the provider confirms it. */
  async reportFailure(orderId, paymentId) {
    const { data } = await apiClient.post('/payments/report-failure', { orderId, paymentId });
    return data;
  },

  /** The labelled "Demo payment" buttons (only exists in local and Docker setups). */
  async demoCheckout(orderId, outcome) {
    const { data } = await apiClient.post(`/payments/demo/${outcome}`, { orderId });
    return data;
  },

  async history(page, size = 10, filters) {
    const { data } = await apiClient.get('/payments', { params: { page, size, ...historyParams(filters) } });
    return data;
  },

  /** The figures above the history, for the same filters (without paging and sorting). */
  async historySummary(filters) {
    const { data } = await apiClient.get('/payments/summary', { params: historyParams(filters, false) });
    return data;
  },

  /** One payment of mine with its refunds (`404` for anybody else's). */
  async get(paymentId) {
    const { data } = await apiClient.get(`/payments/${encodeURIComponent(paymentId)}`);
    return data;
  },

  async forBooking(bookingId) {
    const { data } = await apiClient.get(`/payments/booking/${encodeURIComponent(bookingId)}`);
    return data;
  },

  /** 404 until the booking is confirmed. */
  async invoiceForBooking(bookingId) {
    const { data } = await apiClient.get(`/invoices/booking/${encodeURIComponent(bookingId)}`);
    return data;
  },
};
