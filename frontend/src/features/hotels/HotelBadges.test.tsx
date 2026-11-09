import { render, screen } from '@testing-library/react';

import { DemoBadge, GuestRating, StarRating } from './HotelBadges';

describe('StarRating', () => {
  it('names the number of stars, and shows nothing for an unrated hotel', () => {
    const { container, rerender } = render(<StarRating stars={4} />);
    expect(screen.getByRole('img', { name: '4 star hotel' })).toBeInTheDocument();

    rerender(<StarRating stars={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('GuestRating', () => {
  it.each([
    [4.8, '4.8', 'Exceptional'],
    [4.5, '4.5', 'Exceptional'],
    [4.2, '4.2', 'Very good'],
    [3.5, '3.5', 'Good'],
    [3, '3.0', 'Fair'],
  ])('%f is shown as %s "%s"', (rating, score, label) => {
    render(<GuestRating rating={rating} reviews={12} />);

    expect(screen.getByText(score)).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText('· 12 reviews')).toBeInTheDocument();
  });

  it('uses the singular for one review and says when there are none', () => {
    const { rerender } = render(<GuestRating rating={5} reviews={1} />);
    expect(screen.getByText('· 1 review')).toBeInTheDocument();

    rerender(<GuestRating rating={null} reviews={0} />);
    expect(screen.getByText('No reviews yet')).toBeInTheDocument();
  });
});

describe('DemoBadge', () => {
  it('marks sample listings and explains them', () => {
    render(<DemoBadge />);

    expect(screen.getByText('Demo listing')).toHaveAttribute('title', 'Sample data for trying out the site. This hotel does not exist.');
  });
});
