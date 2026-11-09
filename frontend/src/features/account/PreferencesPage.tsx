import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Armchair, BellRing, IndianRupee, Plane } from 'lucide-react';
import { toast } from 'sonner';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SelectField, TextField } from '@/components/ui/Field';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { applyServerErrors } from '@/lib/api/formErrors';
import { queryKeys } from '@/lib/api/queryKeys';
import { accountApi } from './accountApi';
import { SectionHeader } from './AccountLayout';
import { preferencesSchema, type PreferencesForm, type PreferencesFormInput } from './schemas';
import type { TravelPreferences } from './types';
import { usePreferences } from './useAccount';

const CABINS = [
  ['ECONOMY', 'Economy'],
  ['PREMIUM_ECONOMY', 'Premium economy'],
  ['BUSINESS', 'Business'],
  ['FIRST', 'First'],
] as const;
const SEATS = [
  ['WINDOW', 'Window'],
  ['AISLE', 'Aisle'],
  ['NO_PREFERENCE', 'No preference'],
] as const;
const MEALS = [
  ['NO_PREFERENCE', 'No preference'],
  ['STANDARD', 'Standard'],
  ['VEGETARIAN', 'Vegetarian'],
  ['VEGAN', 'Vegan'],
  ['JAIN', 'Jain'],
  ['HALAL', 'Halal'],
  ['KOSHER', 'Kosher'],
  ['DIABETIC', 'Diabetic'],
] as const;

export function PreferencesPage() {
  const preferences = usePreferences();
  if (preferences.isPending) {
    return <LoadingState label="Loading your travel preferences…" rows={2} />;
  }
  if (preferences.isError) {
    const error = ApiError.from(preferences.error);
    return <ErrorState description={error.message} correlationId={error.correlationId} onRetry={() => void preferences.refetch()} />;
  }
  return <PreferencesFormCard preferences={preferences.data} />;
}

function toForm(preferences: TravelPreferences): PreferencesFormInput {
  return {
    preferredCabin: preferences.preferredCabin ?? '',
    homeAirport: preferences.homeAirport ?? '',
    seatPreference: preferences.seatPreference ?? '',
    mealPreference: preferences.mealPreference ?? '',
  };
}

function PreferencesFormCard({ preferences }: { preferences: TravelPreferences }) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty },
  } = useForm<PreferencesFormInput, unknown, PreferencesForm>({
    resolver: zodResolver(preferencesSchema),
    defaultValues: toForm(preferences),
  });

  const mutation = useMutation({
    mutationFn: (form: PreferencesForm) =>
      accountApi.updatePreferences({
        preferredCabin: form.preferredCabin || null,
        homeAirport: form.homeAirport || null,
        seatPreference: form.seatPreference || null,
        mealPreference: form.mealPreference || null,
        preferredCurrency: 'INR',
        // The newsletter now lives in the notification settings (§10d); identity-service keeps its stored flag.
        newsletterOptIn: preferences.newsletterOptIn,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.account.preferences, saved);
      reset(toForm(saved));
      toast.success('Your preferences were saved.');
    },
    onError: (error) => {
      applyServerErrors(error, setError, ['homeAirport']);
    },
  });
  const error = mutation.error ? ApiError.from(mutation.error) : null;

  return (
    <Card className="p-5 sm:p-6">
      <SectionHeader title="Travel preferences" description="Used to pre-fill searches and bookings. You can always change them per trip." />
      <form onSubmit={handleSubmit((form) => mutation.mutate(form))} noValidate className="flex flex-col gap-6">
        {error && error.code !== 'VALIDATION_FAILED' && <Alert tone="danger">{error.message}</Alert>}
        <PreferenceGroup icon={<Plane className="size-4" />} title="Flying">
          <SelectField label="Preferred cabin" optional {...register('preferredCabin')}>
            <option value="">No preference</option>
            {CABINS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Home airport"
            optional
            maxLength={3}
            placeholder="BLR"
            className="uppercase"
            hint="3-letter airport code"
            error={errors.homeAirport?.message}
            {...register('homeAirport')}
          />
        </PreferenceGroup>
        <PreferenceGroup icon={<Armchair className="size-4" />} title="On board">
          <SelectField label="Seat" optional {...register('seatPreference')}>
            <option value="">Not set</option>
            {SEATS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
          <SelectField label="Meal" optional {...register('mealPreference')}>
            <option value="">Not set</option>
            {MEALS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        </PreferenceGroup>
        <PreferenceGroup icon={<IndianRupee className="size-4" />} title="Payments">
          <TextField label="Currency" value="INR — Indian rupee" disabled readOnly hint="More currencies will follow." />
        </PreferenceGroup>
        <p className="flex items-start gap-2 rounded-xl bg-brand-50/70 px-4 py-3 text-sm text-slate-700 ring-1 ring-brand-100">
          <BellRing className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
          <span>
            The newsletter and the e-mails we send are in your{' '}
            <Link to="/account/notifications/settings" className="font-semibold text-brand-700 hover:underline">notification settings</Link>.
          </span>
        </p>
        <div className="border-t border-slate-100 pt-5">
          <Button type="submit" loading={mutation.isPending} disabled={!isDirty}>
            Save preferences
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** A titled group of fields (a fieldset, so screen readers hear the group name with each field). */
function PreferenceGroup({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
        <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-brand-100">{icon}</span>
        {title}
      </legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
