import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RealtimeContext } from '@/app/providers/realtimeContext';
import type { RealtimeStatus } from '@/lib/realtime/types';
import { Alert } from './Alert';
import { Button } from './Button';
import { FullPageLoader } from './FullPageLoader';
import { LiveIndicator } from './LiveIndicator';
import { EmptyState, ErrorState } from './StateViews';
import { Switch } from './Switch';

describe('Button', () => {
  it('is a plain button by default, so it never submits a form by accident', async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <Button>Cancel</Button>
        <Button type="submit">Save</Button>
      </form>,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('is busy and cannot be clicked again while loading', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Button onClick={onClick}>Pay now</Button>);
    const button = screen.getByRole('button', { name: 'Pay now' });
    expect(button).not.toHaveAttribute('aria-busy');

    rerender(<Button loading onClick={onClick}>Pay now</Button>);

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Alert', () => {
  it.each([
    ['danger', 'alert'],
    ['warning', 'alert'],
    ['info', 'status'],
    ['success', 'status'],
  ] as const)('a %s message is announced as %s', (tone, role) => {
    render(<Alert tone={tone} title="Heads up">Details here</Alert>);

    const alert = screen.getByRole(role);
    expect(alert).toHaveTextContent('Heads up');
    expect(alert).toHaveTextContent('Details here');
  });

  it('is informational by default', () => {
    render(<Alert>Prices include taxes.</Alert>);

    expect(screen.getByRole('status')).toHaveTextContent('Prices include taxes.');
  });
});

describe('EmptyState and ErrorState', () => {
  it('an empty state shows its title, explanation and action', () => {
    render(<EmptyState title="No trips yet" description="Your bookings appear here." action={<a href="/hotels">Find a hotel</a>} />);

    expect(screen.getByRole('heading', { name: 'No trips yet' })).toBeInTheDocument();
    expect(screen.getByText('Your bookings appear here.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find a hotel' })).toBeInTheDocument();
  });

  it('an error state is announced, has a default title and offers retry with the support reference', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<ErrorState description="The server did not answer." correlationId="corr-42" onRetry={onRetry} />);

    const error = screen.getByRole('alert');
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(error).toHaveTextContent('The server did not answer.');
    expect(error).toHaveTextContent('Support reference: corr-42');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('an error state without retry or reference shows neither', () => {
    render(<ErrorState title="Payment failed" />);

    expect(screen.getByRole('heading', { name: 'Payment failed' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/Support reference/)).not.toBeInTheDocument();
  });
});

describe('Switch', () => {
  it('is a named on/off switch that reports the new value', async () => {
    const onCheckedChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Switch aria-label="Booking e-mails" checked={false} onCheckedChange={onCheckedChange} />);

    const toggle = screen.getByRole('switch', { name: 'Booking e-mails' });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);

    rerender(<Switch aria-label="Booking e-mails" checked onCheckedChange={onCheckedChange} />);
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
  });

  it('cannot be changed when disabled', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Security e-mails" checked disabled onCheckedChange={onCheckedChange} />);

    await userEvent.setup().click(screen.getByRole('switch', { name: 'Security e-mails' }));

    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe('LiveIndicator', () => {
  const renderWith = (status: RealtimeStatus) => render(
    <RealtimeContext.Provider value={{ status, serverTimeOffsetMs: 0 }}>
      <LiveIndicator />
    </RealtimeContext.Provider>,
  );

  it('shows nothing before a live connection is wanted', () => {
    const { container } = renderWith('idle');

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['connected', 'Live', 'This page updates automatically'],
    ['connecting', 'Connecting…', 'Live updates paused; data refreshes when reconnected'],
    ['reconnecting', 'Reconnecting…', 'Live updates paused; data refreshes when reconnected'],
    ['offline', 'Offline', 'Live updates paused; data refreshes when reconnected'],
  ] as const)('tells the user when the status is %s', (status, label, title) => {
    renderWith(status);

    const indicator = screen.getByRole('status');
    expect(indicator).toHaveTextContent(label);
    expect(indicator).toHaveAttribute('title', title);
  });
});

describe('FullPageLoader', () => {
  it('announces what is loading', () => {
    render(<FullPageLoader label="Restoring your session…" />);

    expect(screen.getByRole('status')).toHaveTextContent('Restoring your session…');
  });

  it('says "Loading…" by default', () => {
    render(<FullPageLoader />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });
});
