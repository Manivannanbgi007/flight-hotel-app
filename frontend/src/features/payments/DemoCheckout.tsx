import { useState } from 'react';
import { FlaskConical } from 'lucide-react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api/apiError';
import { formatMoney } from '@/lib/format';
import { paymentApi } from './paymentApi';
import type { CheckoutCallback, PaymentOrder } from './types';

/**
 * The DEMO payment page (PAYMENT_INTEGRATION.md section 1): clearly labelled, no real money, no account needed.
 * "Pay" and "Fail" play the role of the provider's checkout. The server still verifies the signed result like a
 * real payment, so the whole flow after this point (verification, events, confirmation) is the real one.
 */
export function DemoCheckout({ order, disabled, onCallback, onFailure, onError }: {
  order: PaymentOrder;
  disabled?: boolean;
  /** The demo "checkout" succeeded: send it to the server for verification. */
  onCallback: (callback: CheckoutCallback) => void;
  /** The demo "checkout" failed: tell the server so the attempt is closed. */
  onFailure: (callback: { orderId: string; paymentId: string }) => void;
  onError: (message: string) => void;
}) {
  const [working, setWorking] = useState<'pay' | 'fail' | null>(null);

  const run = async (outcome: 'pay' | 'fail') => {
    setWorking(outcome);
    try {
      const callback = await paymentApi.demoCheckout(order.orderId, outcome);
      if (outcome === 'pay') {
        onCallback(callback);
      } else {
        onFailure({ orderId: callback.orderId, paymentId: callback.paymentId });
      }
    } catch (error) {
      onError(ApiError.from(error).message);
    } finally {
      setWorking(null);
    }
  };

  return (
    <section
      aria-label="Demo payment"
      className="mt-5 rounded-2xl border-2 border-dashed border-warning-500/60 bg-gradient-to-b from-warning-50 to-white p-4 animate-scale-in sm:p-5"
    >
      <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
        <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-lg bg-warning-100 text-warning-700">
          <FlaskConical className="size-4" />
        </span>
        Demo payment
      </h3>
      <Alert tone="warning" className="mt-3">
        This is a demonstration. No real money is used and no card details are needed. Choose what should happen.
      </Alert>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button size="lg" loading={working === 'pay'} disabled={disabled || working !== null} onClick={() => void run('pay')}>
          Pay {formatMoney(order.amount, order.currency, true)}
        </Button>
        <Button size="lg" variant="danger" loading={working === 'fail'} disabled={disabled || working !== null} onClick={() => void run('fail')}>
          Fail the payment
        </Button>
      </div>
    </section>
  );
}
