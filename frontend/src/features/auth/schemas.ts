import { z } from 'zod';

import { isPasswordValid } from './passwordRules';

/** Same rules as the backend DTOs (identity-service AuthDtos), so most mistakes are caught before sending. */
export const NAME_PATTERN = /^[\p{L}][\p{L} .'-]{0,79}$/u;
export const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

export const emailField = z
  .string()
  .trim()
  .min(1, 'Enter your email address')
  .max(254, 'Email is too long')
  .email('Enter a valid email address');

export const nameField = (what: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter your ${what}`)
    .regex(NAME_PATTERN, `${what.charAt(0).toUpperCase()}${what.slice(1)} can only contain letters, spaces, . ' -`);

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Enter your password'),
  rememberMe: z.boolean(),
});
export type LoginForm = z.infer<typeof loginSchema>;

const WEAK = 'The password does not meet all the rules below';

const newPasswordFields = {
  password: z
    .string()
    .min(1, 'Choose a password')
    .refine((value) => isPasswordValid(value), { message: WEAK }),
  confirmPassword: z.string().min(1, 'Repeat the password'),
};

export const registerSchema = z
  .object({
    firstName: nameField('first name'),
    lastName: nameField('last name'),
    email: emailField,
    phone: z
      .string()
      .trim()
      .refine((value) => value === '' || PHONE_PATTERN.test(value.replace(/[\s-]/g, '')), {
        message: 'Enter 7–15 digits, optionally starting with +',
      }),
    ...newPasswordFields,
    acceptTerms: z.boolean().refine((value) => value, { message: 'Please accept the terms to continue' }),
  })
  .superRefine((form, ctx) => {
    // Field-level checks run first; only the rule that needs the email is checked here.
    if (form.password && !isPasswordValid(form.password, form.email)) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: WEAK });
    }
    if (form.confirmPassword && form.password !== form.confirmPassword) {
      ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'The passwords do not match' });
    }
  });
export type RegisterForm = z.infer<typeof registerSchema>;

export const emailOnlySchema = z.object({ email: emailField });
export type EmailOnlyForm = z.infer<typeof emailOnlySchema>;

export const resetPasswordSchema = z.object(newPasswordFields).superRefine((form, ctx) => {
  if (form.confirmPassword && form.password !== form.confirmPassword) {
    ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'The passwords do not match' });
  }
});
export type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

/** "+91 98765-43210" → "+919876543210" (the API accepts digits with an optional leading +). */
export function normalizePhone(phone: string): string | undefined {
  const compact = phone.replace(/[\s-]/g, '');
  return compact === '' ? undefined : compact;
}
