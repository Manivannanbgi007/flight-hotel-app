import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';

import { ApiError } from './apiError';
import { applyServerErrors } from './formErrors';

function httpError(status: number, data: unknown, headers: Record<string, string> = {}): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('failed', 'ERR_BAD_RESPONSE', config, null, {
    status, statusText: '', data, headers, config,
  } as AxiosResponse);
}

describe('ApiError.from', () => {
  it('keeps an ApiError as it is', () => {
    const error = new ApiError(409, 'CONFLICT', 'Already changed');

    expect(ApiError.from(error)).toBe(error);
  });

  it('reads the Problem Details body of the backend', () => {
    const error = ApiError.from(httpError(422, {
      status: 422,
      code: 'PASSPORT_DETAILS_INCOMPLETE',
      detail: 'Passport expiry and country are required.',
      correlationId: 'corr-1',
      errors: [{ field: 'passportExpiry', message: 'Required' }],
      details: { passengerIndex: 1 },
    }));

    expect(error).toMatchObject({
      status: 422,
      code: 'PASSPORT_DETAILS_INCOMPLETE',
      message: 'Passport expiry and country are required.',
      correlationId: 'corr-1',
      fieldErrors: [{ field: 'passportExpiry', message: 'Required' }],
      details: { passengerIndex: 1 },
    });
    expect(error).toBeInstanceOf(ApiError);
    expect(error.name).toBe('ApiError');
  });

  it('takes the correlation id from the response header when the body has none', () => {
    const error = ApiError.from(httpError(500, { code: 'INTERNAL_ERROR' }, { 'x-correlation-id': 'corr-from-header' }));

    expect(error.correlationId).toBe('corr-from-header');
    expect(error.fieldErrors).toEqual([]);
    expect(error.details).toEqual({});
  });

  it.each([
    [401, 'Please log in to continue.'],
    [403, 'You are not allowed to do this.'],
    [404, 'Not found.'],
    [429, 'Too many requests. Please wait a moment.'],
    [502, 'Something went wrong on our side. Please try again later.'],
    [418, 'The request could not be completed.'],
  ])('gives a safe default message for HTTP %i without a body', (status, message) => {
    const error = ApiError.from(httpError(status, undefined));

    expect(error).toMatchObject({ status, code: `HTTP_${status}`, message, correlationId: null });
  });

  it('turns a missing response into a network error', () => {
    const error = ApiError.from(new AxiosError('Network Error', 'ERR_NETWORK', { headers: new AxiosHeaders() }));

    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR', message: 'Cannot reach the server. Check your connection and try again.' });
  });

  it('never shows the text of an unexpected error', () => {
    const error = ApiError.from(new TypeError("Cannot read properties of undefined (reading 'id')"));

    expect(error).toMatchObject({ status: 0, code: 'UNKNOWN_ERROR', message: 'Something went wrong. Please try again.' });
  });
});

describe('applyServerErrors', () => {
  type Form = { email: string; password: string; phone: string };
  const fields = ['email', 'password', 'phone'] as const;

  it('ignores errors that are not API errors', () => {
    const setError = vi.fn();

    expect(applyServerErrors<Form>(new Error('boom'), setError, fields)).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });

  it('puts known field errors on their fields and focuses the first one', () => {
    const setError = vi.fn();
    const error = new ApiError(400, 'VALIDATION_FAILED', 'Invalid', [
      { field: 'unknownField', message: 'Ignored' },
      { field: 'phone', message: 'Enter 7–15 digits' },
      { field: 'email', message: 'Already registered' },
    ]);

    expect(applyServerErrors<Form>(error, setError, fields)).toBe(true);
    expect(setError.mock.calls).toEqual([
      ['phone', { type: 'server', message: 'Enter 7–15 digits' }, { shouldFocus: true }],
      ['email', { type: 'server', message: 'Already registered' }, { shouldFocus: false }],
    ]);
  });

  it('reports false when no field error matches the form, so the caller shows a banner', () => {
    const setError = vi.fn();
    const error = new ApiError(400, 'VALIDATION_FAILED', 'Invalid', [{ field: 'somethingElse', message: 'Wrong' }]);

    expect(applyServerErrors<Form>(error, setError, fields)).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });

  it('explains which password rules failed on the password field', () => {
    const setError = vi.fn();
    const error = new ApiError(422, 'WEAK_PASSWORD', 'Weak', [], null, { rules: ['LENGTH', 'DIGIT', 'NOT_A_RULE'] });

    expect(applyServerErrors<Form>(error, setError, fields, 'password')).toBe(true);
    expect(setError).toHaveBeenCalledWith('password',
      { type: 'server', message: 'Choose a stronger password: 10–64 characters, at least one number.' }, { shouldFocus: true });
  });

  it('treats WEAK_PASSWORD like any other error when the form has no password field', () => {
    const setError = vi.fn();
    const error = new ApiError(422, 'WEAK_PASSWORD', 'Weak', [], null, { rules: ['LENGTH'] });

    expect(applyServerErrors<Form>(error, setError, fields)).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });
});
