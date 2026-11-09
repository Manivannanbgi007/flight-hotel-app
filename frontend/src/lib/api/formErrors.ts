import type { FieldPath, FieldValues, UseFormSetError } from 'react-hook-form';

import { describeFailedRules } from '@/features/auth/passwordRules';
import { ApiError } from './apiError';

/**
 * Puts server-side validation errors next to the matching form fields.
 * - `VALIDATION_FAILED`: every field error the form knows about.
 * - `WEAK_PASSWORD`: the failed password rules, on `passwordField`.
 *
 * @returns true when at least one error was shown on a field (so no extra banner is needed)
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly FieldPath<T>[],
  passwordField?: FieldPath<T>,
): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }
  if (error.code === 'WEAK_PASSWORD' && passwordField) {
    setError(passwordField, { type: 'server', message: describeFailedRules(error.details.rules) }, { shouldFocus: true });
    return true;
  }
  let applied = false;
  for (const fieldError of error.fieldErrors) {
    const field = fields.find((name) => name === fieldError.field);
    if (field) {
      setError(field, { type: 'server', message: fieldError.message }, { shouldFocus: !applied });
      applied = true;
    }
  }
  return applied;
}
