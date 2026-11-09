import { apiClient } from '@/lib/api/client';
import type { Page } from '@/lib/api/types';
import type {
  CheckoutCallback, Invoice, PaymentDetails, PaymentHistoryFilters, PaymentHistorySummary, PaymentOrder, PaymentResult, PaymentSummary,
} from './types';

/** Only the filters that are set go into the query string. */
function historyParams(filters?: PaymentHistoryFilters, withSort = true) {
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
  async createOrder(bookingId: string, idempotencyKey: string): Promise<PaymentOrder> {
    const { data } = await apiClient.post<PaymentOrder>(
      '/payments/create-order',
      { bookingId },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    return data;
  },

  /** The checkout window's callback. The server decides (signature + the provider's own record), not the browser. */
  async verify(callback: CheckoutCallback): Promise<PaymentResult> {
    const { data } = await apiClient.post<PaymentResult>('/payments/verify', callback);
    return data;
  },

  /** The checkout window said a payment failed; the server closes the attempt if the provider confirms it. */
  async reportFailure(orderId: string, paymentId: string): Promise<PaymentResult> {
    const { data } = await apiClient.post<PaymentResult>('/payments/report-failure', { orderId, paymentId });
    return data;
  },

  /** The labelled "Demo payment" buttons (only exists in local and Docker setups). */
  async demoCheckout(orderId: string, outcome: 'pay' | 'fail'): Promise<CheckoutCallback> {
    const { data } = await apiClient.post<CheckoutCallback>(`/payments/demo/${outcome}`, { orderId });
    return data;
  },

  async history(page: number, size = 10, filters?: PaymentHistoryFilters): Promise<Page<PaymentSummary>> {
    const { data } = await apiClient.get<Page<PaymentSummary>>('/payments', { params: { page, size, ...historyParams(filters) } });
    return data;
  },

  /** The figures above the history, for the same filters (without paging and sorting). */
  async historySummary(filters?: PaymentHistoryFilters): Promise<PaymentHistorySummary> {
    const { data } = await apiClient.get<PaymentHistorySummary>('/payments/summary', { params: historyParams(filters, false) });
    return data;
  },

  /** One payment of mine with its refunds (`404` for anybody else's). */
  async get(paymentId: string): Promise<PaymentDetails> {
    const { data } = await apiClient.get<PaymentDetails>(`/payments/${encodeURIComponent(paymentId)}`);
    return data;
  },

  async forBooking(bookingId: string): Promise<PaymentSummary[]> {
    const { data } = await apiClient.get<PaymentSummary[]>(`/payments/booking/${encodeURIComponent(bookingId)}`);
    return data;
  },

  /** 404 until the booking is confirmed. */
  async invoiceForBooking(bookingId: string): Promise<Invoice> {
    const { data } = await apiClient.get<Invoice>(`/invoices/booking/${encodeURIComponent(bookingId)}`);
    return data;
  },
};
