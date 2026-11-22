/**
 * Razorpay Checkout (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/). The card, UPI
 * or net-banking details are typed into Razorpay's own window and never reach our pages or servers. Only used when
 * the server's order says provider = RAZORPAY.
 */

const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

let loading = null;

/** Loads Razorpay's script once. Rejects when it cannot be loaded (offline, blocked by an ad blocker). */
export function loadRazorpay() {
  if (window.Razorpay) {
    return Promise.resolve(window.Razorpay);
  }
  loading ??= new Promise((resolve, reject) => {
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
export function toPaise(amount) {
  return Math.round(amount * 100);
}
