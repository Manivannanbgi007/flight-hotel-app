import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StarRatingInput, StarScore } from './StarRatingInput';

function Controlled({ initial = 0, error, onChange = () => {} }: { initial?: number; error?: string; onChange?: (value: number) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <StarRatingInput
      name="rating"
      label="Your rating"
      value={value}
      error={error}
      hint="Tap a star"
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('StarRatingInput', () => {
  it('is a group of five radio buttons named by its label, nothing chosen at first', () => {
    render(<Controlled />);

    const group = screen.getByRole('group', { name: 'Your rating' });
    const stars = within(group).getAllByRole('radio');
    expect(stars).toHaveLength(5);
    expect(stars.map((star) => star.getAttribute('value'))).toEqual(['1', '2', '3', '4', '5']);
    expect(stars.every((star) => !(star as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole('radio', { name: '1 star' })).toBeInTheDocument();
    expect(screen.getByText('Not rated yet')).toBeInTheDocument();
    expect(group).toHaveAccessibleDescription('Tap a star');
  });

  it('chooses a rating by click and shows it in words', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: '4 stars' }));

    expect(onChange).toHaveBeenCalledWith(4);
    expect(screen.getByRole('radio', { name: '4 stars' })).toBeChecked();
    expect(screen.getByText('4 stars: Very good')).toBeInTheDocument();
  });

  it('works with the keyboard: Tab into the group, arrow keys change the rating', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled initial={3} onChange={onChange} />);

    await user.tab();
    expect(screen.getByRole('radio', { name: '3 stars' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');

    expect(onChange).toHaveBeenLastCalledWith(4);
    expect(screen.getByRole('radio', { name: '4 stars' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '4 stars' })).toHaveFocus();
  });

  it('shows an error, marks the stars invalid and links the message to the group', () => {
    render(<Controlled error="Choose a rating from 1 to 5 stars" />);

    const group = screen.getByRole('group', { name: 'Your rating' });
    expect(group).toHaveAccessibleDescription('Choose a rating from 1 to 5 stars');
    expect(screen.getByRole('radio', { name: '5 stars' })).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('StarScore', () => {
  it('reads a rating or an average as text', () => {
    render(<><StarScore rating={4} /><StarScore rating={4.36} /></>);

    expect(screen.getByRole('img', { name: '4 out of 5 stars' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '4.4 out of 5 stars' })).toBeInTheDocument();
  });
});
