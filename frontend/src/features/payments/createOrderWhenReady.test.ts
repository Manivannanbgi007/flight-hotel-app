import { ApiError } from '@/lib/api/apiError';
import { createOrderWhenReady } from './createOrderWhenReady';
import { paymentApi } from './paymentApi';
import type { PaymentOrder } from './types';

vi.mock('./paymentApi', () => ({ paymentApi: { createOrder: vi.fn() } }));

const order = { paymentId: 'p1', orderId: 'order_demo_1' } as PaymentOrder;
const notReady = () => new ApiError(409, 'PAYMENT_NOT_READY', 'We are preparing your payment.');

describe('createOrderWhenReady', () => {
  it('asks again while the payment service has not been told about the booking yet', async () => {
    vi.mocked(paymentApi.createOrder).mockRejectedValueOnce(notReady()).mockRejectedValueOnce(notReady()).mockResolvedValue(order);

    await expect(createOrderWhenReady('b1', 5, 1)).resolves.toBe(order);

    expect(paymentApi.createOrder).toHaveBeenCalledTimes(3);
    const keys = vi.mocked(paymentApi.createOrder).mock.calls.map((call) => call[1]);
    expect(new Set(keys).size).toBe(3);
  });

  it('gives up after the last attempt and shows the server message', async () => {
    vi.mocked(paymentApi.createOrder).mockRejectedValue(notReady());

    await expect(createOrderWhenReady('b1', 3, 1)).rejects.toMatchObject({ code: 'PAYMENT_NOT_READY' });
    expect(paymentApi.createOrder).toHaveBeenCalledTimes(3);
  });

  it('does not retry other errors', async () => {
    vi.mocked(paymentApi.createOrder).mockRejectedValue(new ApiError(409, 'PAYMENT_WINDOW_CLOSED', 'Too late.'));

    await expect(createOrderWhenReady('b1', 5, 1)).rejects.toMatchObject({ code: 'PAYMENT_WINDOW_CLOSED' });
    expect(paymentApi.createOrder).toHaveBeenCalledTimes(1);
  });
});
