import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SuggestField, type Suggestion } from './SuggestField';

const CITIES: Suggestion[] = [
  { value: 'Goa', description: '7 hotels' },
  { value: 'Gangtok', description: '1 hotel' },
];

function Form({ onSubmit, suggestions = CITIES }: { onSubmit: (city: string) => void; suggestions?: Suggestion[] }) {
  const [city, setCity] = useState('');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(city);
      }}
    >
      <SuggestField label="Destination" value={city} onChange={setCity} suggestions={city ? suggestions : []} />
      <button type="submit">Search</button>
    </form>
  );
}

const field = () => screen.getByRole('combobox', { name: 'Destination' });

describe('SuggestField', () => {
  it('suggests while typing, and Enter submits the typed text when no suggestion was picked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Form onSubmit={onSubmit} />);

    await user.type(field(), 'G');
    const list = screen.getByRole('listbox', { name: 'Suggestions' });
    expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual(['Goa7 hotels', 'Gangtok1 hotel']);
    expect(field()).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('G');
  });

  it('picks a suggestion with the arrows and Enter, or with a click', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Form onSubmit={onSubmit} />);

    await user.type(field(), 'g');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(field()).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: /Gangtok/ }).id);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(field()).toHaveValue('Goa');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.clear(field());
    await user.type(field(), 'G');
    await user.click(screen.getByRole('option', { name: /Gangtok/ }));
    expect(field()).toHaveValue('Gangtok');
    expect(field()).toHaveFocus();
  });

  it('closes with Escape and when focus leaves', async () => {
    const user = userEvent.setup();
    render(<Form onSubmit={vi.fn()} />);

    await user.type(field(), 'G');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.keyboard('o');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.tab();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
