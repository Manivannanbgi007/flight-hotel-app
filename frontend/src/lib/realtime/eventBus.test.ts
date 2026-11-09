import { RealtimeEventBus } from './eventBus';
import type { RealtimeMessage } from './types';

const message = (type: string): RealtimeMessage => ({
  id: '1',
  type,
  resourceType: 'BOOKING',
  resourceId: 'b-1',
  data: {},
  occurredAt: new Date().toISOString(),
});

describe('RealtimeEventBus', () => {
  it('delivers messages to subscribers of that type and to wildcard subscribers', () => {
    const bus = new RealtimeEventBus();
    const typed = vi.fn();
    const wildcard = vi.fn();
    const other = vi.fn();
    bus.subscribe('booking.status-changed', typed);
    bus.subscribe('*', wildcard);
    bus.subscribe('notification.created', other);

    bus.publish(message('booking.status-changed'));

    expect(typed).toHaveBeenCalledOnce();
    expect(wildcard).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new RealtimeEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe('x', handler);

    unsubscribe();
    bus.publish(message('x'));

    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps delivering when one handler throws', () => {
    const bus = new RealtimeEventBus();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const healthy = vi.fn();
    bus.subscribe('x', () => {
      throw new Error('boom');
    });
    bus.subscribe('x', healthy);

    bus.publish(message('x'));

    expect(healthy).toHaveBeenCalledOnce();
  });
});
