import { render } from '@testing-library/react';

import * as Illustrations from '.';
import { P } from './palette';

const drawings = Object.entries(Illustrations).filter(([name]) => name.endsWith('Illustration')) as
  [string, (props: { className?: string }) => React.ReactElement][];

describe('illustrations', () => {
  it('has every scene the design system lists', () => {
    expect(drawings.map(([name]) => name).sort()).toEqual([
      'AccessDeniedIllustration', 'AdminSignInIllustration', 'BoardingPassIllustration', 'CustomerSignInIllustration',
      'EmptyInboxIllustration', 'GlobeIllustration', 'HotelIllustration', 'LostIllustration', 'ManagerSignInIllustration',
      'NoResultsIllustration', 'PaymentFailedIllustration', 'PaymentSuccessIllustration', 'StormIllustration',
      'SuitcaseIllustration', 'SupportSignInIllustration', 'TravelHeroIllustration',
    ]);
  });

  it.each(drawings)('%s is decorative, inline and self-contained', (_name, Drawing) => {
    const { container } = render(<Drawing className="w-40" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).toHaveClass('w-40');
    // No external images or fonts (CSP: 'self' only), no text to translate.
    expect(container.querySelector('image, use[href^="http"], text, foreignObject')).toBeNull();
    expect(container.innerHTML).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it('fills its box by default, and a width class sizes it (w-full would otherwise win in the CSS)', () => {
    const svgOf = (className?: string) => render(<Illustrations.SuitcaseIllustration className={className} />).container.querySelector('svg')!;
    expect(svgOf()).toHaveClass('w-full');
    expect(svgOf('w-28')).not.toHaveClass('w-full');
    expect(svgOf('w-40 sm:w-44')).not.toHaveClass('w-full');
    expect(svgOf('mx-auto h-full w-auto')).not.toHaveClass('w-full');
    expect(svgOf('max-w-sm animate-float')).toHaveClass('w-full', 'max-w-sm');
  });

  it('gives each instance its own gradient ids, so two copies on a page never share one', () => {
    const { container } = render(<><Illustrations.TravelHeroIllustration /><Illustrations.TravelHeroIllustration /></>);
    const ids = [...container.querySelectorAll('[id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const element of container.querySelectorAll('[fill^="url(#"]')) {
      const id = element.getAttribute('fill')!.slice(5, -1);
      expect(ids).toContain(id);
    }
  });

  it('uses the colours of the design tokens', async () => {
    // Tests run in Node: read index.css itself (the app's tsconfig has no Node types, hence the untyped import).
    const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { readFileSync: (path: string, encoding: 'utf8') => string };
    const css = fs.readFileSync('src/index.css', 'utf8');
    const token = (name: string) => new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)?.[1]?.toLowerCase();
    for (const step of ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']) {
      expect(P[`brand${step}` as keyof typeof P]).toBe(token(`brand-${step}`));
    }
    for (const step of ['50', '100', '200', '300', '400', '500', '600']) {
      expect(P[`accent${step}` as keyof typeof P]).toBe(token(`accent-${step}`));
    }
    expect(P.success500).toBe(token('success-500'));
    expect(P.success600).toBe(token('success-600'));
    expect(P.danger500).toBe(token('danger-500'));
    expect(P.danger600).toBe(token('danger-600'));
    expect(P.warning500).toBe(token('warning-500'));
  });
});
