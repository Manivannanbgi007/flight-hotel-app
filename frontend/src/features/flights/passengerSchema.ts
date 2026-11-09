import { differenceInYears, isValid, parseISO } from 'date-fns';
import { z } from 'zod';

import { emailField, nameField, PHONE_PATTERN } from '@/features/auth/schemas';
import type { PassengerType } from '@/features/account/types';
import type { Passengers } from './types';

/** The travellers of a trip in booking order: adults, then children, then infants. */
export function passengerSlots(passengers: Passengers): PassengerType[] {
  return [
    ...Array<PassengerType>(passengers.adults).fill('ADULT'),
    ...Array<PassengerType>(passengers.children).fill('CHILD'),
    ...Array<PassengerType>(passengers.infants).fill('INFANT'),
  ];
}

/** "Adult 1", "Child 2", "Infant 1" for the n-th traveller of the list. */
export function passengerLabel(types: PassengerType[], index: number): string {
  const type = types[index] ?? 'ADULT';
  const number = types.slice(0, index + 1).filter((t) => t === type).length;
  return `${type === 'ADULT' ? 'Adult' : type === 'CHILD' ? 'Child' : 'Infant'} ${number}`;
}

/** Whole years between the date of birth and `on` (both `YYYY-MM-DD`); null when either is not a date. */
export function ageOn(dateOfBirth: string, on: string): number | null {
  const born = parseISO(dateOfBirth);
  const day = parseISO(on);
  return isValid(born) && isValid(day) ? differenceInYears(day, born) : null;
}

export const PASSPORT_PATTERN = /^[A-Z0-9]{5,20}$/;

const passengerShape = z.object({
  passengerType: z.enum(['ADULT', 'CHILD', 'INFANT']),
  firstName: nameField('first name'),
  lastName: nameField('last name'),
  dateOfBirth: z.string(),
  gender: z.enum(['', 'MALE', 'FEMALE', 'OTHER']),
  nationality: z.string(),
  passportNumber: z.string().trim(),
  passportExpiry: z.string(),
  passportCountry: z.string(),
});

export interface PassengerRules {
  /** Passport details are asked for (and required) only on international trips. */
  international: boolean;
  /** First departure date, `YYYY-MM-DD`: adults and children are aged on it. */
  firstDeparture: string;
  /** Last departure date: an infant must be under 2 on every flight, a passport valid on the last one. */
  lastDeparture: string;
}

/**
 * Passenger form rules (API_DOCUMENTATION.md §8.1a): adults 12 and older, children 2–11, infants under 2 (date of
 * birth required for children and infants), passport number, expiry and country only on international trips.
 */
export function flightPassengersSchema(rules: PassengerRules) {
  return z.object({
    passengers: z.array(passengerShape).min(1),
    contactEmail: emailField,
    contactPhone: z
      .string()
      .trim()
      .min(1, 'Enter a phone number for the airline')
      .refine((value) => PHONE_PATTERN.test(value.replace(/[\s-]/g, '')), { message: 'Enter 7–15 digits, optionally starting with +' }),
    couponCode: z
      .string()
      .trim()
      .max(30, 'Coupon codes are at most 30 characters')
      .regex(/^[A-Za-z0-9-]*$/, 'Coupon codes only contain letters, digits and -'),
  }).superRefine((form, ctx) => {
    form.passengers.forEach((passenger, index) => {
      const issue = (field: string, message: string) => ctx.addIssue({ code: 'custom', path: ['passengers', index, field], message });
      const { passengerType: type, dateOfBirth } = passenger;
      if (dateOfBirth === '' && type !== 'ADULT') {
        issue('dateOfBirth', 'Enter the date of birth');
      } else if (dateOfBirth !== '') {
        const reference = type === 'INFANT' ? rules.lastDeparture : rules.firstDeparture;
        const age = ageOn(dateOfBirth, reference);
        if (age === null) {
          issue('dateOfBirth', 'Enter a valid date');
        } else if (parseISO(dateOfBirth) >= parseISO(rules.firstDeparture)) {
          issue('dateOfBirth', 'The date of birth must be in the past');
        } else if (type === 'ADULT' && age < 12) {
          issue('dateOfBirth', 'Adults must be 12 or older on the travel date');
        } else if (type === 'CHILD' && age < 2) {
          issue('dateOfBirth', 'A child must be at least 2 on the travel date; book this traveller as an infant');
        } else if (type === 'CHILD' && age >= 12) {
          issue('dateOfBirth', 'Travellers of 12 and older travel as adults');
        } else if (type === 'INFANT' && age >= 2) {
          issue('dateOfBirth', 'An infant must be under 2 on every flight; book this traveller as a child');
        }
      }
      if (rules.international) {
        if (!PASSPORT_PATTERN.test(passenger.passportNumber.toUpperCase())) {
          issue('passportNumber', 'Enter the passport number (5–20 letters and digits)');
        }
        if (passenger.passportExpiry === '' || ageOn(passenger.passportExpiry, '2100-01-01') === null) {
          issue('passportExpiry', 'Enter the passport expiry date');
        } else if (passenger.passportExpiry <= rules.lastDeparture) {
          issue('passportExpiry', 'The passport must be valid on the last travel date');
        }
        if (!/^[A-Z]{2}$/.test(passenger.passportCountry)) {
          issue('passportCountry', 'Choose the issuing country');
        }
      }
    });
  });
}
export type FlightPassengersForm = z.infer<ReturnType<typeof flightPassengersSchema>>;
export type PassengerFormValues = FlightPassengersForm['passengers'][number];
