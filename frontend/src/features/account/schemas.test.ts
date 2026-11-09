import { changePasswordSchema, passengerSchema, profileSchema, todayIso, toPassengerRequest, type PassengerFormInput } from './schemas';

const passenger = (overrides: Partial<PassengerFormInput> = {}): PassengerFormInput => ({
  passengerType: 'ADULT',
  firstName: 'Asha',
  lastName: 'Rao',
  dateOfBirth: '',
  gender: '',
  nationality: '',
  passportNumber: '',
  passportExpiry: '',
  passportCountry: '',
  hasStoredPassport: false,
  removePassport: false,
  ...overrides,
});

/** First message per field, which is what the form shows (react-hook-form's default "firstError" mode). */
const errorsOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) => {
  const errors: Record<string, string> = {};
  for (const issue of result.error?.issues ?? []) {
    errors[issue.path.join('.')] ??= issue.message;
  }
  return errors;
};

describe('passenger form', () => {
  it('accepts a passenger without passport', () => {
    expect(passengerSchema.safeParse(passenger()).success).toBe(true);
  });

  it('needs expiry and country together with a new passport number', () => {
    expect(errorsOf(passengerSchema.safeParse(passenger({ passportNumber: 'z1234567' })))).toEqual({
      passportExpiry: 'Enter the expiry date',
      passportCountry: 'Choose the issuing country',
    });
  });

  it('needs a number when only expiry/country are given for a passenger without passport', () => {
    expect(errorsOf(passengerSchema.safeParse(passenger({ passportExpiry: '2099-01-31', passportCountry: 'IN' })))).toEqual({
      passportNumber: 'Enter the passport number',
    });
  });

  it('keeps a stored passport when the number is left empty', () => {
    const result = passengerSchema.parse(
      passenger({ hasStoredPassport: true, passportExpiry: '2099-01-31', passportCountry: 'IN' }),
    );
    expect(toPassengerRequest(result)).toMatchObject({
      passportNumber: undefined,
      passportExpiry: '2099-01-31',
      passportCountry: 'IN',
      removePassport: false,
    });
  });

  it('normalizes and validates the passport number', () => {
    expect(passengerSchema.parse(passenger({ passportNumber: 'z 123 4567', passportExpiry: '2099-01-31', passportCountry: 'IN' }))
      .passportNumber).toBe('Z1234567');
    expect(errorsOf(passengerSchema.safeParse(passenger({ passportNumber: 'Z-12', passportExpiry: '2099-01-31', passportCountry: 'IN' }))))
      .toEqual({ passportNumber: 'Use 5–20 letters or digits' });
  });

  it('rejects an expired passport and a birth date in the future', () => {
    expect(errorsOf(passengerSchema.safeParse(passenger({
      passportNumber: 'Z1234567', passportExpiry: '2001-01-01', passportCountry: 'IN', dateOfBirth: '2999-01-01',
    })))).toEqual({
      passportExpiry: 'The passport must still be valid',
      dateOfBirth: 'The date of birth must be in the past',
    });
  });

  it('sends removePassport without passport fields', () => {
    const result = passengerSchema.parse(passenger({ hasStoredPassport: true, removePassport: true, passportCountry: 'IN' }));
    expect(toPassengerRequest(result)).toMatchObject({ removePassport: true, passportCountry: undefined });
  });
});

describe('profile form', () => {
  it('validates names, phone and nationality', () => {
    expect(errorsOf(profileSchema.safeParse({
      firstName: '4sha', lastName: '', phone: '12ab', dateOfBirth: todayIso(), nationality: 'india',
    }))).toEqual({
      firstName: "First name can only contain letters, spaces, . ' -",
      lastName: 'Enter your last name',
      phone: 'Enter 7–15 digits, optionally starting with +',
      dateOfBirth: 'The date of birth must be in the past',
      nationality: 'Choose a country',
    });
  });

  it('accepts international names and formatted phone numbers', () => {
    expect(profileSchema.safeParse({
      firstName: 'José María', lastName: "O'Brien-Nair", phone: '+91 98765-43210', dateOfBirth: '1994-05-17', nationality: 'IN',
    }).success).toBe(true);
  });
});

describe('change password form', () => {
  it('requires a different, valid, repeated new password', () => {
    expect(errorsOf(changePasswordSchema.safeParse({
      currentPassword: 'Travel2026Safe', newPassword: 'Travel2026Safe', confirmPassword: 'Travel2026Safe',
    }))).toEqual({ newPassword: 'The new password must be different' });

    // Every problem at once, not one after another.
    expect(errorsOf(changePasswordSchema.safeParse({
      currentPassword: 'Travel2026Safe', newPassword: 'password123', confirmPassword: 'other',
    }))).toEqual({
      newPassword: 'The password does not meet all the rules below',
      confirmPassword: 'The passwords do not match',
    });
  });
});
