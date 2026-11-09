import { ApiError } from '@/lib/api/apiError';
import { paymentApi } from './paymentApi';
import type { PaymentOrder } from './types';

/**
 * The booking page says "waiting for payment" a moment before the payment service has been told (they are linked by
 * messages, not by one database): then the server answers PAYMENT_NOT_READY and we simply ask again, for up to ~10 s.
 * A new key per attempt: the server returns the same order while one is still open (double click, two tabs).
 */
export async function createOrderWhenReady(bookingId: string, attempts = 10, delayMs = 1000): Promise<PaymentOrder> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await paymentApi.createOrder(bookingId, globalThis.crypto.randomUUID());
    } catch (error) {
      if (ApiError.from(error).code !== 'PAYMENT_NOT_READY' || attempt >= attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
