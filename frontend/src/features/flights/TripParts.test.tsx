import { render, screen } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { renderRoutes } from '@/test/renderRoutes';
import { FareCountdown, PriceLines, TripProblem } from './TripParts';

describe('FareCountdown', () => {
  it('shows the time left as a timer that is not read out every second', () => {
    render(<FareCountdown remaining={19 * 60 + 5} />);

    const timer = screen.getByRole('timer');
    expect(timer).toHaveTextContent('Fare kept for 19:05');
    expect(timer).not.toHaveClass('bg-warning-50');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('turns to a warning in the last five minutes', () => {
    render(<FareCountdown remaining={4 * 60 + 59} />);

    expect(screen.getByRole('timer')).toHaveClass('bg-warning-50');
  });

  it('announces once that the fare has expired', () => {
    render(<FareCountdown remaining={0} />);

    expect(screen.getByRole('status')).toHaveTextContent('This fare has expired.');
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });
});

describe('PriceLines', () => {
  it('lists the server price lines and the total', () => {
    render(<PriceLines lines={[{ label: 'Fare · 2 adults', amount: 9000 }, { label: 'GST 5%', amount: 450 }]} total={9450} currency="INR" />);

    expect(screen.getByText('Fare · 2 adults').nextElementSibling).toHaveTextContent('₹9,000.00');
    expect(screen.getByText('Total').nextElementSibling).toHaveTextContent('₹9,450.00');
  });
});

describe('TripProblem', () => {
  it('explains an expired fare and links back to the search', () => {
    renderRoutes(<TripProblem error={new ApiError(404, 'OFFER_EXPIRED', 'Offer expired')} onRetry={vi.fn()} />);

    expect(screen.getByText('This fare has expired')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Search flights' })).toHaveAttribute('href', '/flights');
  });

  it('offers a retry for other problems', async () => {
    const onRetry = vi.fn();
    const { user } = renderRoutes(<TripProblem error={new ApiError(503, 'UNAVAILABLE', 'The flight service is not answering.')} onRetry={onRetry} />);

    expect(screen.getByText('The flight service is not answering.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
