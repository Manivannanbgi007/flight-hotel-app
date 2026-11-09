import { render, screen } from '@testing-library/react';

import { SuitcaseIllustration } from '@/components/illustrations';
import { PageContainer } from './PageContainer';
import { PageHero } from './PageHero';

describe('PageHero', () => {
  it('holds the page heading, the eyebrow, the description and the actions', () => {
    render(
      <PageHero eyebrow="Hotels" title="Find a hotel" description="Stays across India." actions={<a href="/offers">See offers</a>} />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Find a hotel' })).toBeInTheDocument();
    expect(screen.getByText('Hotels')).toBeInTheDocument();
    expect(screen.getByText('Stays across India.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See offers' })).toBeInTheDocument();
  });

  it('keeps the illustration decorative and puts the overlapping content after the band', () => {
    const { container } = render(
      <PageHero title="Find a flight" illustration={<SuitcaseIllustration className="w-64" />}>
        <form aria-label="Search flights" />
      </PageHero>,
    );

    const svg = container.querySelector('svg')!;
    expect(svg.closest('[aria-hidden="true"]')).not.toBeNull();
    const band = screen.getByRole('heading', { level: 1 }).closest('section')!;
    const form = screen.getByRole('form', { name: 'Search flights' });
    expect(band.contains(form)).toBe(false);
    expect(band.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('uses dark text on the light sky tone', () => {
    render(<PageHero tone="sky" title="Offers" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Offers' })).toHaveClass('text-slate-900');
  });
});

describe('PageContainer', () => {
  it('frames the page at the asked width with a decorative backdrop', () => {
    const { container } = render(<PageContainer width="md"><h1>Guest details</h1></PageContainer>);

    expect(screen.getByRole('heading', { name: 'Guest details' }).parentElement).toHaveClass('max-w-3xl', 'px-4');
    expect(container.querySelector('[aria-hidden="true"]')).toHaveClass('bg-gradient-mesh');
  });

  it('can leave the backdrop out', () => {
    const { container } = render(<PageContainer backdrop={false}><p>Content</p></PageContainer>);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});
