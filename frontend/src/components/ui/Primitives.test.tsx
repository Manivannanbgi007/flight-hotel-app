import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import { Avatar } from './Avatar';
import { Breadcrumbs } from './Breadcrumbs';
import { DataTable, TableCard, Td, Th, Tr } from './DataTable';
import { PageHeader, Section } from './PageHeader';
import { StatCard } from './StatCard';
import { EmptyState, LoadingState } from './StateViews';
import { Stepper } from './Stepper';
import { Tabs } from './Tabs';
import { Tooltip } from './Tooltip';

describe('Tabs', () => {
  const items = [
    { id: 'upcoming', label: 'Upcoming', badge: 2, content: <p>upcoming panel</p> },
    { id: 'done', label: 'Completed', content: <p>completed panel</p> },
    { id: 'cancelled', label: 'Cancelled', content: <p>cancelled panel</p> },
  ];

  it('is a named tab list whose selected tab controls the panel', async () => {
    const user = userEvent.setup();
    render(<Tabs label="Trips" items={items} />);

    const list = screen.getByRole('tablist', { name: 'Trips' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(screen.getByRole('tabpanel', { name: /Upcoming/ })).toHaveTextContent('upcoming panel');

    await user.click(screen.getByRole('tab', { name: 'Completed' }));
    expect(screen.getByRole('tabpanel', { name: 'Completed' })).toHaveTextContent('completed panel');
  });

  it('moves with the arrow keys, Home and End, and only the selected tab is in the Tab order', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs label="Trips" items={items} onChange={onChange} />);

    await user.tab();
    expect(screen.getByRole('tab', { name: /Upcoming/ })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Completed' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Completed' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Cancelled' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Upcoming/ })).toHaveFocus();
    expect(onChange.mock.calls.map(([id]) => id)).toEqual(['done', 'cancelled', 'upcoming']);
    expect(screen.getByRole('tab', { name: 'Completed' })).toHaveAttribute('tabindex', '-1');
  });
});

describe('Tooltip', () => {
  it('describes its trigger, shows on hover and focus, and hides with Escape', async () => {
    const user = userEvent.setup();
    render(<Tooltip content="Refunds take 5–7 days"><button type="button">Refund info</button></Tooltip>);

    const trigger = screen.getByRole('button', { name: 'Refund info' });
    expect(trigger).toHaveAccessibleDescription('Refunds take 5–7 days');
    const tip = screen.getByRole('tooltip', { hidden: true });
    expect(tip).toHaveClass('sr-only');

    await user.hover(trigger);
    expect(tip).not.toHaveClass('sr-only');
    await user.keyboard('{Escape}');
    expect(tip).toHaveClass('sr-only');

    await user.unhover(trigger);
    await user.tab();
    expect(trigger).toHaveFocus();
    expect(tip).not.toHaveClass('sr-only');
  });
});

describe('Avatar', () => {
  it('shows initials, hidden from screen readers unless it is labelled', () => {
    const { container, rerender } = render(<Avatar name="Asha Rao" />);
    expect(screen.getByText('AR')).toHaveAttribute('aria-hidden', 'true');

    rerender(<Avatar name="Sam" label="Sam, support agent" />);
    expect(screen.getByRole('img', { name: 'Sam, support agent' })).toHaveTextContent('S');

    rerender(<Avatar name="Asha Rao" src="blob:photo" />);
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });
});

describe('StatCard', () => {
  it('reads the value, the label and the change in words', () => {
    render(<StatCard label="Bookings" value="1,284" change={{ percent: 12.5, period: 'vs last month' }} />);

    expect(screen.getByText('Bookings')).toBeInTheDocument();
    expect(screen.getByText('1,284')).toBeInTheDocument();
    expect(screen.getByText(/12\.5%/).closest('span')).toHaveTextContent('Up 12.5%');
    expect(screen.getByText('vs last month')).toBeInTheDocument();
  });

  it('colours a rise of a bad figure as bad, and says when there is nothing to compare', () => {
    const { rerender } = render(<StatCard label="Cancellations" value="18" change={{ percent: 4, upIsGood: false }} />);
    expect(screen.getByText(/4%/).closest('span')).toHaveClass('text-danger-700');

    rerender(<StatCard label="Cancellations" value="18" change={{ percent: null, period: 'vs last month' }} />);
    expect(screen.getByText('No earlier figures to compare vs last month')).toBeInTheDocument();
  });

  it('counts numbers up but gives screen readers the final value at once, and announces loading', () => {
    const { rerender } = render(<StatCard label="Revenue" value={200000} format={(value) => `₹${Math.round(value)}`} />);
    expect(screen.getByText('₹200000', { selector: '.sr-only' })).toBeInTheDocument();

    rerender(<StatCard label="Revenue" value={0} loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading Revenue…');
  });

  it('is a link to the details when `to` is given', () => {
    render(<MemoryRouter><StatCard label="Refunds" value="3" to="/admin/refunds" /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /Refunds/ })).toHaveAttribute('href', '/admin/refunds');
  });
});

describe('PageHeader and Section', () => {
  it('give the page its h1 and sections a labelled h2', () => {
    render(
      <>
        <PageHeader eyebrow="Admin portal" title="Bookings" description="All bookings." actions={<button type="button">Export</button>} />
        <Section id="recent" title="Recent">content</Section>
      </>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Bookings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Recent' })).toHaveTextContent('content');
  });
});

describe('Stepper', () => {
  it('marks the current step and says which steps are done', () => {
    render(<Stepper label="Booking steps" current={1} steps={[{ label: 'Choose' }, { label: 'Guest details' }, { label: 'Pay' }]} />);

    const nav = screen.getByRole('navigation', { name: 'Booking steps' });
    const steps = within(nav).getAllByRole('listitem');
    expect(steps.map((step) => step.getAttribute('aria-current'))).toEqual([null, 'step', null]);
    expect(steps[0]).toHaveTextContent('Choose (completed)');
  });
});

describe('Breadcrumbs', () => {
  it('links the way up and marks the current page', () => {
    render(<MemoryRouter><Breadcrumbs items={[{ label: 'Admin portal', to: '/admin' }, { label: 'Bookings', to: '/admin/bookings' }, { label: 'Details' }]} /></MemoryRouter>);

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/admin', '/admin/bookings']);
    expect(within(nav).getByText('Details')).toHaveAttribute('aria-current', 'page');
  });
});

describe('DataTable', () => {
  it('is a captioned table with column headers', () => {
    render(
      <DataTable caption="Bookings" head={<><Th>Reference</Th><Th numeric>Amount</Th></>}>
        <Tr><Td primary>HT-1</Td><Td numeric>₹2,816</Td></Tr>
      </DataTable>,
    );
    const table = screen.getByRole('table', { name: 'Bookings' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Reference', 'Amount']);
    expect(within(table).getByRole('columnheader', { name: 'Amount' })).toHaveClass('text-right');
    expect(within(table).getByRole('cell', { name: '₹2,816' })).toHaveClass('text-right');
  });
});

describe('TableCard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const table = (props: { scroll?: boolean }) => (
    <TableCard caption="Bookings" {...props}>
      <thead><tr><th scope="col">Reference</th></tr></thead>
      <tbody><tr><td>HT-1</td></tr></tbody>
    </TableCard>
  );

  it('scrolls sideways below xl and clips with a sticky header row from xl; `scroll` keeps scrolling', () => {
    const { rerender } = render(table({}));
    const card = screen.getByRole('table', { name: 'Bookings' }).parentElement;
    expect(card).toHaveClass('overflow-x-auto', 'xl:overflow-x-clip', 'xl:[&_thead_th]:sticky');

    rerender(table({ scroll: true }));
    expect(card).toHaveClass('overflow-x-auto');
    expect(card).not.toHaveClass('xl:overflow-x-clip');
    expect(card).not.toHaveClass('xl:[&_thead_th]:sticky');
  });

  it('goes back to scrolling sideways when the table is wider than its card', () => {
    let measure = () => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) {
        measure = callback;
      }
      observe() {}
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200);
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(950);
    render(table({}));
    const card = screen.getByRole('table', { name: 'Bookings' }).parentElement;
    expect(card).toHaveClass('xl:overflow-x-clip');

    act(() => measure());
    expect(card).toHaveClass('overflow-x-auto');
    expect(card).not.toHaveClass('xl:overflow-x-clip');
  });
});

describe('state views', () => {
  it('draw a decorative illustration that screen readers skip', () => {
    const { container } = render(<EmptyState title="No trips yet" illustration="search" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('can leave the illustration out', () => {
    const { container } = render(<EmptyState title="Nothing" illustration="none" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('announce loading once while showing shimmer rows', () => {
    const { container } = render(<LoadingState label="Loading bookings…" rows={2} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading bookings…');
    expect(container.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0);
  });
});
