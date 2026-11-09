import { z } from 'zod';

import { nameField, PHONE_PATTERN } from '@/features/auth/schemas';
import { isPasswordValid } from '@/features/auth/passwordRules';
import type { PassengerRequest } from './types';

const PASSPORT = /^[A-Z0-9]{5,20}$/;

/** `YYYY-MM-DD` from a date input, or '' when empty. Compared as strings (same format). */
const optionalDate = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Enter a valid date');
const optionalCountry = z.string().regex(/^([A-Z]{2})?$/, 'Choose a country');

/** Today as `YYYY-MM-DD` in the user's time zone (the reference for "in the past" / "in the future"). */
export function todayIso(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export const profileSchema = z.object({
  firstName: nameField('first name'),
  lastName: nameField('last name'),
  phone: z
    .string()
    .trim()
    .refine((value) => value === '' || PHONE_PATTERN.test(value.replace(/[\s-]/g, '')), {
      message: 'Enter 7–15 digits, optionally starting with +',
    }),
  dateOfBirth: optionalDate.refine((value) => value === '' || value < todayIso(), {
    message: 'The date of birth must be in the past',
  }),
  nationality: optionalCountry,
});
export type ProfileForm = z.infer<typeof profileSchema>;

export const passengerSchema = z
  .object({
    passengerType: z.enum(['ADULT', 'CHILD', 'INFANT']),
    firstName: nameField('first name'),
    lastName: nameField('last name'),
    dateOfBirth: optionalDate.refine((value) => value === '' || value < todayIso(), {
      message: 'The date of birth must be in the past',
    }),
    gender: z.enum(['', 'MALE', 'FEMALE', 'OTHER']),
    nationality: optionalCountry,
    passportNumber: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase().replace(/\s/g, ''))
      .refine((value) => value === '' || PASSPORT.test(value), { message: 'Use 5–20 letters or digits' }),
    passportExpiry: optionalDate.refine((value) => value === '' || value > todayIso(), {
      message: 'The passport must still be valid',
    }),
    passportCountry: optionalCountry,
    /** Editing a passenger that already has a passport. */
    hasStoredPassport: z.boolean(),
    removePassport: z.boolean(),
  })
  .superRefine((form, ctx) => {
    if (form.removePassport) {
      return;
    }
    // Same rule as the API (PASSPORT_DETAILS_INCOMPLETE): a new number needs expiry and country; changing
    // expiry/country of a stored passport needs both.
    const changingStored = form.hasStoredPassport && (form.passportExpiry !== '' || form.passportCountry !== '');
    if (form.passportNumber !== '' || changingStored) {
      if (form.passportExpiry === '') {
        ctx.addIssue({ code: 'custom', path: ['passportExpiry'], message: 'Enter the expiry date' });
      }
      if (form.passportCountry === '') {
        ctx.addIssue({ code: 'custom', path: ['passportCountry'], message: 'Choose the issuing country' });
      }
    } else if (!form.hasStoredPassport && (form.passportExpiry !== '' || form.passportCountry !== '')) {
      ctx.addIssue({ code: 'custom', path: ['passportNumber'], message: 'Enter the passport number' });
    }
  });
export type PassengerFormInput = z.input<typeof passengerSchema>;
export type PassengerForm = z.output<typeof passengerSchema>;

/** Form values → API body. Empty optional fields are left out; an empty passport number keeps the stored one. */
export function toPassengerRequest(form: PassengerForm): PassengerRequest {
  const optional = (value: string) => (value === '' ? undefined : value);
  return {
    passengerType: form.passengerType,
    firstName: form.firstName,
    lastName: form.lastName,
    dateOfBirth: optional(form.dateOfBirth),
    gender: form.gender === '' ? undefined : form.gender,
    nationality: optional(form.nationality),
    passportNumber: form.removePassport ? undefined : optional(form.passportNumber),
    passportExpiry: form.removePassport ? undefined : optional(form.passportExpiry),
    passportCountry: form.removePassport ? undefined : optional(form.passportCountry),
    removePassport: form.removePassport,
  };
}

export const preferencesSchema = z.object({
  preferredCabin: z.enum(['', 'ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']),
  homeAirport: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => value === '' || /^[A-Z]{3}$/.test(value), { message: 'Use the 3-letter airport code, e.g. BLR' }),
  seatPreference: z.enum(['', 'WINDOW', 'AISLE', 'NO_PREFERENCE']),
  mealPreference: z.enum(['', 'NO_PREFERENCE', 'STANDARD', 'VEGETARIAN', 'VEGAN', 'JAIN', 'HALAL', 'KOSHER', 'DIABETIC']),
});
export type PreferencesFormInput = z.input<typeof preferencesSchema>;
export type PreferencesForm = z.output<typeof preferencesSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z
      .string()
      .min(1, 'Choose a new password')
      .refine((value) => isPasswordValid(value), { message: 'The password does not meet all the rules below' }),
    confirmPassword: z.string().min(1, 'Repeat the new password'),
  })
  .superRefine((form, ctx) => {
    if (form.newPassword !== form.confirmPassword) {
      ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'The passwords do not match' });
    }
    if (form.newPassword === form.currentPassword) {
      ctx.addIssue({ code: 'custom', path: ['newPassword'], message: 'The new password must be different' });
    }
  });
export type ChangePasswordForm = z.infer<typeof changePasswordSchema>;

