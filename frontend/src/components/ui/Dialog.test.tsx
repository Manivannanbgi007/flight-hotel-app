import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Dialog } from './Dialog';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Deactivate Asha?" description="They are logged out everywhere.">
        <label>Reason <input /></label>
        <button type="button">Confirm</button>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('is a labelled modal that takes focus, keeps Tab inside and gives focus back on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });

    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Deactivate Asha?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('They are logged out everywhere.');
    expect(screen.getByRole('textbox', { name: 'Reason' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('closes with the close button', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is max-w-lg by default, and a max-w-* from the caller replaces it (no competing widths)', () => {
    const { rerender } = render(<Dialog open onClose={() => undefined} title="Default" />);
    expect(screen.getByRole('dialog')).toHaveClass('max-w-lg');

    rerender(<Dialog open onClose={() => undefined} title="Wide" className="max-w-2xl" />);
    const wide = screen.getByRole('dialog');
    expect(wide).toHaveClass('max-w-2xl');
    expect(wide).not.toHaveClass('max-w-lg');
  });
});
