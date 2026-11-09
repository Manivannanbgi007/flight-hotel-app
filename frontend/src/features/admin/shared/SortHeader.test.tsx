import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SortHeader } from './adminUi';
import type { SortState } from './searchState';

function Header({ sort, onSort }: { sort: SortState | null; onSort: (sort: SortState) => void }) {
  return (
    <table>
      <thead>
        <tr>
          <SortHeader label="Amount" field="totalAmount" sort={sort} onSort={onSort} align="right" />
          <SortHeader label="Booked" field="createdAt" sort={sort} onSort={onSort} />
        </tr>
      </thead>
    </table>
  );
}

function SortableHeader({ onSort }: { onSort: (sort: SortState) => void }) {
  const [sort, setSort] = useState<SortState | null>(null);
  return <Header sort={sort} onSort={(next) => { onSort(next); setSort(next); }} />;
}

describe('SortHeader', () => {
  it('sorts descending on the first click, then ascending, and tells the order with aria-sort', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    render(<SortableHeader onSort={onSort} />);
    const amount = screen.getByRole('columnheader', { name: 'Amount' });
    const booked = screen.getByRole('columnheader', { name: 'Booked' });
    expect(amount).toHaveAttribute('aria-sort', 'none');
    expect(booked).toHaveAttribute('aria-sort', 'none');

    await user.click(screen.getByRole('button', { name: 'Amount' }));
    expect(onSort).toHaveBeenLastCalledWith({ field: 'totalAmount', direction: 'desc' });
    expect(amount).toHaveAttribute('aria-sort', 'descending');
    expect(booked).toHaveAttribute('aria-sort', 'none');

    await user.click(screen.getByRole('button', { name: 'Amount' }));
    expect(onSort).toHaveBeenLastCalledWith({ field: 'totalAmount', direction: 'asc' });
    expect(amount).toHaveAttribute('aria-sort', 'ascending');

    await user.click(screen.getByRole('button', { name: 'Amount' }));
    expect(onSort).toHaveBeenLastCalledWith({ field: 'totalAmount', direction: 'desc' });
  });

  it('starts another column descending, whatever the current order', async () => {
    const onSort = vi.fn();
    render(<Header sort={{ field: 'totalAmount', direction: 'asc' }} onSort={onSort} />);

    await userEvent.click(screen.getByRole('button', { name: 'Booked' }));
    expect(onSort).toHaveBeenCalledWith({ field: 'createdAt', direction: 'desc' });
  });

  it('shows the sorted column with an arrow in the portal accent, the others with a faint icon', () => {
    render(<Header sort={{ field: 'createdAt', direction: 'desc' }} onSort={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Booked' }).querySelector('svg')).toHaveClass('text-role-600');
    expect(screen.getByRole('button', { name: 'Amount' }).querySelector('svg')).toHaveClass('text-role-300');
    // The sorted column is a white chip on the highlighted header band.
    expect(screen.getByRole('button', { name: 'Booked' })).toHaveClass('bg-white');
    expect(screen.getByRole('button', { name: 'Amount' })).not.toHaveClass('bg-white');
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toHaveClass('text-right');
  });
});
