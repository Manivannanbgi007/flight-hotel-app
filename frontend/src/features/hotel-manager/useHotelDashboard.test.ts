import { limited, PORTFOLIO_PARALLEL } from './useHotelDashboard';

describe('portfolio request limiter', () => {
  it('runs at most two hotel dashboards at a time, in order, and passes results and errors through', async () => {
    let running = 0;
    let most = 0;
    const order: number[] = [];
    const releases: (() => void)[] = [];
    const task = (id: number) => () => new Promise<number>((resolve) => {
      running += 1;
      most = Math.max(most, running);
      order.push(id);
      releases.push(() => { running -= 1; resolve(id); });
    });

    const results = [1, 2, 3, 4].map((id) => limited(task(id)));
    await Promise.resolve();
    expect(order).toEqual([1, 2]);

    // Finishing one task starts the next waiting one.
    while (releases.length > 0) {
      releases.shift()!();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(await Promise.all(results)).toEqual([1, 2, 3, 4]);
    expect(order).toEqual([1, 2, 3, 4]);
    expect(most).toBe(PORTFOLIO_PARALLEL);

    await expect(limited(() => Promise.reject(new Error('down')))).rejects.toThrow('down');
    // A failed task frees its slot.
    expect(await limited(() => Promise.resolve('next'))).toBe('next');
  });
});
