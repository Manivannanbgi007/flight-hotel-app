import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { IdCard, Lock } from 'lucide-react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { DateField } from '@/components/ui/DateField';
import { CheckboxField, SelectField, TextField } from '@/components/ui/Field';
import { ApiError } from '@/lib/api/apiError';
import { applyServerErrors } from '@/lib/api/formErrors';
import { countries } from '@/lib/countries';
import { accountApi } from './accountApi';
import { passengerSchema, toPassengerRequest, todayIso, type PassengerForm as PassengerFormValues, type PassengerFormInput } from './schemas';
import type { Passenger } from './types';

const PASSENGER_TYPES = [
  { value: 'ADULT', label: 'Adult (12+ years)' },
  { value: 'CHILD', label: 'Child (2–11 years)' },
  { value: 'INFANT', label: 'Infant (under 2)' },
] as const;

/** Add or edit a saved passenger. The stored passport number is never shown or sent back in full. */
export function PassengerForm({ passenger, onSaved, onCancel }: {
  passenger?: Passenger;
  onSaved: (saved: Passenger) => void;
  onCancel: () => void;
}) {
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<PassengerFormInput, unknown, PassengerFormValues>({
    resolver: zodResolver(passengerSchema),
    defaultValues: {
      passengerType: passenger?.passengerType ?? 'ADULT',
      firstName: passenger?.firstName ?? '',
      lastName: passenger?.lastName ?? '',
      dateOfBirth: passenger?.dateOfBirth ?? '',
      gender: passenger?.gender ?? '',
      nationality: passenger?.nationality ?? '',
      passportNumber: '',
      passportExpiry: passenger?.passportExpiry ?? '',
      passportCountry: passenger?.passportCountry ?? '',
      hasStoredPassport: passenger?.hasPassport ?? false,
      removePassport: false,
    },
  });
  const removePassport = useWatch({ control, name: 'removePassport' });

  const mutation = useMutation({
    mutationFn: (form: PassengerFormValues) => {
      const body = toPassengerRequest(form);
      return passenger ? accountApi.updatePassenger(passenger.id, body) : accountApi.createPassenger(body);
    },
    onSuccess: onSaved,
    onError: (error) => {
      applyServerErrors(error, setError, [
        'firstName', 'lastName', 'dateOfBirth', 'nationality', 'passportNumber', 'passportExpiry', 'passportCountry',
      ]);
    },
  });
  const error = mutation.error ? ApiError.from(mutation.error) : null;
  const countryOptions = countries();
  const today = todayIso();

  return (
    <form
      onSubmit={handleSubmit((form) => mutation.mutate(form))}
      noValidate
      className="flex flex-col gap-4"
      aria-label={passenger ? `Edit ${passenger.firstName} ${passenger.lastName}` : 'New passenger'}
    >
      {error && error.code !== 'VALIDATION_FAILED' && <Alert tone="danger">{error.message}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Passenger type" {...register('passengerType')}>
          {PASSENGER_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Gender" optional {...register('gender')}>
          <option value="">Not specified</option>
          <option value="FEMALE">Female</option>
          <option value="MALE">Male</option>
          <option value="OTHER">Other</option>
        </SelectField>
        <TextField label="First name" hint="As on the passport or ID" error={errors.firstName?.message} {...register('firstName')} />
        <TextField label="Last name" error={errors.lastName?.message} {...register('lastName')} />
        <Controller
          control={control}
          name="dateOfBirth"
          render={({ field }) => <DateField label="Date of birth" optional max={today} error={errors.dateOfBirth?.message} {...field} />}
        />
        <SelectField label="Nationality" optional error={errors.nationality?.message} {...register('nationality')}>
          <option value="">Not set</option>
          {countryOptions.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </SelectField>
      </div>

      <fieldset className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-slate-800">
          <IdCard className="size-4 text-brand-600" aria-hidden="true" />
          Passport (for international flights)
        </legend>
        {passenger?.hasPassport && (
          <CheckboxField label={`Remove the stored passport (${passenger.passportNumberMasked})`} {...register('removePassport')} />
        )}
        {!removePassport && (
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label="Passport number"
              optional={!passenger?.hasPassport}
              autoComplete="off"
              placeholder={passenger?.hasPassport ? `${passenger.passportNumberMasked} (unchanged)` : undefined}
              hint={passenger?.hasPassport ? 'Leave empty to keep the stored number.' : undefined}
              error={errors.passportNumber?.message}
              {...register('passportNumber')}
            />
            <Controller
              control={control}
              name="passportExpiry"
              render={({ field }) => <DateField label="Expiry date" min={today} error={errors.passportExpiry?.message} {...field} />}
            />
            <SelectField label="Issuing country" error={errors.passportCountry?.message} {...register('passportCountry')}>
              <option value="">Choose…</option>
              {countryOptions.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </SelectField>
          </div>
        )}
        <p className="flex items-start gap-1.5 text-xs text-slate-600">
          <Lock className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          Passport numbers are stored encrypted and only the last 4 characters are ever shown.
        </p>
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={mutation.isPending}>
          {passenger ? 'Save passenger' : 'Add passenger'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={mutation.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
