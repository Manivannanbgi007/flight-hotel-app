type RazorpayModule = typeof import('./razorpay');

const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';
const scripts = () => [...document.head.querySelectorAll<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`)];

/** A fresh copy of the module (it remembers a load in progress). */
async function freshModule(): Promise<RazorpayModule> {
  vi.resetModules();
  return import('./razorpay');
}

afterEach(() => {
  scripts().forEach((script) => script.remove());
  delete window.Razorpay;
});

describe('loadRazorpay', () => {
  it('uses Razorpay at once when its script is already on the page', async () => {
    const Razorpay = vi.fn();
    window.Razorpay = Razorpay as unknown as NonNullable<Window['Razorpay']>;
    const { loadRazorpay } = await freshModule();

    await expect(loadRazorpay()).resolves.toBe(Razorpay);
    expect(scripts()).toHaveLength(0);
  });

  it('adds the checkout script once, even when asked twice, and resolves when it has started', async () => {
    const { loadRazorpay } = await freshModule();

    const first = loadRazorpay();
    const second = loadRazorpay();
    expect(second).toBe(first);
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]!.async).toBe(true);

    const Razorpay = vi.fn();
    window.Razorpay = Razorpay as unknown as NonNullable<Window['Razorpay']>;
    scripts()[0]!.dispatchEvent(new Event('load'));

    await expect(first).resolves.toBe(Razorpay);
  });

  it('fails when the script loads but Razorpay does not start', async () => {
    const { loadRazorpay } = await freshModule();

    const loading = loadRazorpay();
    scripts()[0]!.dispatchEvent(new Event('load'));

    await expect(loading).rejects.toThrow('Razorpay did not start');
  });

  it('fails when the script is blocked, and tries again next time', async () => {
    const { loadRazorpay } = await freshModule();

    const loading = loadRazorpay();
    scripts()[0]!.dispatchEvent(new Event('error'));

    await expect(loading).rejects.toThrow('Razorpay could not be loaded');
    expect(scripts()).toHaveLength(0);

    const retry = loadRazorpay();
    expect(retry).not.toBe(loading);
    expect(scripts()).toHaveLength(1);
    retry.catch(() => undefined);
  });
});

describe('toPaise', () => {
  it('turns rupees into whole paise without floating-point leftovers', async () => {
    const { toPaise } = await freshModule();

    expect(toPaise(2625)).toBe(262500);
    expect(toPaise(1968.75)).toBe(196875);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise(19.999)).toBe(2000);
  });
});
