/**
 * Razorpay Checkout (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/). The card, UPI
 * or net-banking details are typed into Razorpay's own window and never reach our pages or servers. Only used when
 * the server's order says provider = RAZORPAY.
 */

const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

export interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface RazorpayFailure {
  error: { code?: string; description?: string; metadata?: { order_id?: string; payment_id?: string } };
}

export interface RazorpayOptions {
  key: string;
  /** Display only: the order on Razorpay's side already fixes the amount. In paise. */
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { email: string; name?: string; contact?: string };
  theme: { color: string };
  handler: (response: RazorpayResponse) => void;
  modal: { ondismiss: () => void };
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', handler: (failure: RazorpayFailure) => void): void;
}

type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let loading: Promise<RazorpayConstructor> | null = null;

/** Loads Razorpay's script once. Rejects when it cannot be loaded (offline, blocked by an ad blocker). */
export function loadRazorpay(): Promise<RazorpayConstructor> {
  if (window.Razorpay) {
    return Promise.resolve(window.Razorpay);
  }
  loading ??= new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Razorpay did not start')));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('Razorpay could not be loaded'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Rupees to paise for Razorpay's display amount. */
export function toPaise(amount: number): number {
  return Math.round(amount * 100);
}
