/** Payment API shapes (API_DOCUMENTATION.md, Payments). Amounts are rupee numbers (never paise). */

export type PaymentStatus =
  | 'INITIATED'
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'REFUND_PENDING'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED';

export type PaymentProvider = 'RAZORPAY' | 'DEMO';

/** The order the customer pays: the amount is the one the server knows for the booking. */
export interface PaymentOrder {
  paymentId: string;
  bookingId: string;
  bookingReference: string;
  provider: PaymentProvider;
  orderId: string;
  /** Razorpay's public Key ID for the checkout window; null for DEMO. */
  keyId: string | null;
  amount: number;
  currency: string;
  description: string;
  contactEmail: string;
  paymentDeadline: string;
  status: PaymentStatus;
}

/** What the checkout window reports; the server checks it again with the provider. */
export interface CheckoutCallback {
  orderId: string;
  paymentId: string;
  signature: string;
}

export interface PaymentResult {
  paymentId: string;
  bookingId: string;
  status: PaymentStatus;
  method: string | null;
  amount: number;
  currency: string;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface PaymentSummary {
  id: string;
  bookingId: string;
  bookingReference: string | null;
  description: string | null;
  provider: PaymentProvider;
  amount: number;
  refundedAmount: number;
  currency: string;
  status: PaymentStatus;
  method: string | null;
  failureMessage: string | null;
  createdAt: string;
  verifiedAt: string | null;
  invoiceNumber: string | null;
  /** HOTEL or FLIGHT; missing for a payment whose booking is unknown. */
  bookingType?: 'HOTEL' | 'FLIGHT' | null;
}

/** A refund of one payment, as the payment's owner sees it. */
export interface PaymentRefundInfo {
  id: string;
  amount: number;
  status: 'PENDING' | 'PROCESSED' | 'FAILED';
  reason: string;
  providerRefundId: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `GET /api/payments/{id}` (the owner, or staff): the payment with its refunds. */
export interface PaymentDetails extends PaymentSummary {
  failureCode?: string | null;
  providerPaymentId?: string | null;
  contactEmail?: string | null;
  refunds: PaymentRefundInfo[];
}

/** My Payment History filters (all optional; `from` / `to` are India days). */
export interface PaymentHistoryFilters {
  q?: string;
  status?: PaymentStatus | '';
  method?: string;
  bookingType?: 'HOTEL' | 'FLIGHT' | '';
  from?: string;
  to?: string;
  /** `createdAt,desc` (default) or `amount,asc|desc` and so on. */
  sort?: string;
}

/** `GET /api/payments/summary`: the customer's counts and amounts for the same filters as the list. */
export interface PaymentHistorySummary {
  total: number;
  successful: number;
  failed: number;
  pending: number;
  paidAmount: number;
  refundedAmount: number;
  currency: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  bookingId: string;
  bookingReference: string;
  paymentId: string;
  billingName: string;
  billingEmail: string;
  description: string;
  currency: string;
  taxableAmount: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  issuedAt: string;
}
