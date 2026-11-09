import { z } from 'zod';

import { emailField, nameField, PHONE_PATTERN } from '@/features/auth/schemas';

/** Guest details form: one guest per room, a contact for the confirmation, optional requests and coupon. */
export const guestDetailsSchema = z.object({
  guests: z.array(z.object({ firstName: nameField('first name'), lastName: nameField('last name') })).min(1),
  contactEmail: emailField,
  contactPhone: z
    .string()
    .trim()
    .min(1, 'Enter a phone number for the hotel')
    .refine((value) => PHONE_PATTERN.test(value.replace(/[\s-]/g, '')), {
      message: 'Enter 7–15 digits, optionally starting with +',
    }),
  specialRequests: z.string().trim().max(500, 'Please keep this under 500 characters'),
  couponCode: z
    .string()
    .trim()
    .max(30, 'Coupon codes are at most 30 characters')
    .regex(/^[A-Za-z0-9-]*$/, 'Coupon codes only contain letters, digits and -'),
});
export type GuestDetailsForm = z.infer<typeof guestDetailsSchema>;
