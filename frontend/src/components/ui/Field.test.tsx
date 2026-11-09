import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CheckboxField, PasswordField, SelectField, TextAreaField, TextField } from './Field';

describe('TextField', () => {
  it('is labelled, marks optional fields and describes itself with the hint', () => {
    render(<TextField label="Mobile number" optional hint="With country code" />);

    const input = screen.getByLabelText(/Mobile number/);
    expect(screen.getByText('(optional)')).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription('With country code');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('shows the error instead of the hint and marks the field invalid', () => {
    render(<TextField label="Email" hint="We send the tickets here" error="Enter a valid email address" />);

    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a valid email address');
    expect(screen.queryByText('We send the tickets here')).not.toBeInTheDocument();
  });

  it('has no description without hint or error, keeps a given id and passes props and ref to the input', async () => {
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn();
    render(<TextField ref={ref} id="city" label="City" placeholder="e.g. Goa" onChange={onChange} />);

    const input = screen.getByRole('textbox', { name: 'City' });
    expect(input).toHaveAttribute('id', 'city');
    expect(input).toHaveAttribute('placeholder', 'e.g. Goa');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(ref.current).toBe(input);

    await userEvent.setup().type(input, 'Goa');
    expect(onChange).toHaveBeenCalledTimes(3);
  });
});

describe('PasswordField', () => {
  it('hides the password until the user asks to see it', async () => {
    const user = userEvent.setup();
    render(<PasswordField label="Password" hint="At least 10 characters" />);

    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAccessibleDescription('At least 10 characters');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);

    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('shows its error', () => {
    render(<PasswordField label="Password" error="Enter your password" />);

    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Enter your password');
  });
});

describe('SelectField and TextAreaField', () => {
  it('label the control and show hint or error', async () => {
    const user = userEvent.setup();
    render(
      <>
        <SelectField label="Cabin" error="Choose a cabin">
          <option value="">Choose</option>
          <option value="ECONOMY">Economy</option>
        </SelectField>
        <TextAreaField label="Message" hint="Up to 2000 characters" />
      </>,
    );

    const select = screen.getByRole('combobox', { name: 'Cabin' });
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription('Choose a cabin');
    await user.selectOptions(select, 'Economy');
    expect(select).toHaveValue('ECONOMY');

    const message = screen.getByRole('textbox', { name: 'Message' });
    expect(message).toHaveAttribute('rows', '4');
    expect(message).toHaveAccessibleDescription('Up to 2000 characters');
  });
});

describe('CheckboxField', () => {
  it('toggles from its label and describes its error', async () => {
    const user = userEvent.setup();
    render(<CheckboxField label="I accept the terms" error="Please accept the terms to continue" />);

    const checkbox = screen.getByRole('checkbox', { name: 'I accept the terms' });
    expect(checkbox).toHaveAttribute('aria-invalid', 'true');
    expect(checkbox).toHaveAccessibleDescription('Please accept the terms to continue');

    await user.click(screen.getByText('I accept the terms'));
    expect(checkbox).toBeChecked();
  });

  it('has no error state by default', () => {
    render(<CheckboxField label="Newsletter" />);

    const checkbox = screen.getByRole('checkbox', { name: 'Newsletter' });
    expect(checkbox).not.toHaveAttribute('aria-invalid');
    expect(checkbox).not.toHaveAttribute('aria-describedby');
  });
});
