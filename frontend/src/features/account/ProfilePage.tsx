import { useRef, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Cake, CircleCheck, IdCard, Mail, Smartphone, Sparkles, UserRoundPen, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/app/providers/useAuth';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DateField } from '@/components/ui/DateField';
import { SelectField, TextField } from '@/components/ui/Field';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { authApi } from '@/features/auth/authApi';
import { normalizePhone } from '@/features/auth/schemas';
import { ApiError } from '@/lib/api/apiError';
import { applyServerErrors } from '@/lib/api/formErrors';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { countries } from '@/lib/countries';
import { accountApi } from './accountApi';
import { ProfileChecklist } from './ProfileChecklist';
import { PROFILE_FIELD_IDS } from './profileFieldIds';
import { ProfilePhotoCard } from './ProfilePhotoCard';
import { profileSchema, todayIso, type ProfileForm } from './schemas';
import type { Profile } from './types';
import { useProfile } from './useAccount';

/**
 * /account/profile: the photo and the profile checklist side by side (from `xl`), then the personal details form in
 * three groups (name on the ID, contact, about you) with a save bar that sticks to the bottom while there are unsaved
 * changes. Inside the "My account" layout, which shows the banner with the name.
 */
export function ProfilePage() {
  const profile = useProfile();
  const photoInput = useRef<HTMLInputElement>(null);

  if (profile.isPending) {
    return <LoadingState label="Loading your profile…" rows={3} />;
  }
  if (profile.isError) {
    const error = ApiError.from(profile.error);
    return <ErrorState description={error.message} correlationId={error.correlationId} onRetry={() => void profile.refetch()} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <ProfilePhotoCard profile={profile.data} inputRef={photoInput} />
        <ProfileChecklist profile={profile.data} onAddPhoto={() => photoInput.current?.click()} />
      </div>
      <PersonalDetailsCard profile={profile.data} />
    </div>
  );
}

function PersonalDetailsCard({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient();
  const { updateUser } = useAuth();
  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: toForm(profile),
  });

  const mutation = useMutation({
    mutationFn: (form: ProfileForm) =>
      accountApi.updateProfile({
        firstName: form.firstName,
        lastName: form.lastName,
        phone: normalizePhone(form.phone),
        dateOfBirth: form.dateOfBirth || undefined,
        nationality: form.nationality || undefined,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.account.profile, saved);
      // Show what the server stored (trimmed names, normalized phone) and mark the form clean again.
      reset(toForm(saved));
      updateUser({ firstName: saved.firstName, lastName: saved.lastName });
      toast.success('Your profile was saved.');
    },
    onError: (error) => {
      applyServerErrors(error, setError, ['firstName', 'lastName', 'phone', 'dateOfBirth', 'nationality']);
    },
  });
  const error = mutation.error ? ApiError.from(mutation.error) : null;

  return (
    <Card role="region" aria-labelledby="personal-details-title" className="min-w-0">
      <div className="flex items-start gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-role-500 to-role-700 text-white shadow-glow">
          <UserRoundPen className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="personal-details-title" className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">Personal details</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
            When you book a flight or a hotel, we fill in your name, e-mail and mobile number for you.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit((form) => mutation.mutate(form))} noValidate className="px-5 pt-5 sm:px-6">
        {error && error.code !== 'VALIDATION_FAILED' && <Alert tone="danger" className="mb-5">{error.message}</Alert>}
        <AccountFacts profile={profile} />

        <FormGroup
          id="profile-group-name"
          icon={IdCard}
          title="Name on your ID"
          description="Exactly as on your passport or ID card: airlines and hotels check it."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="First name" autoComplete="given-name" error={errors.firstName?.message} {...register('firstName')} />
            <TextField label="Last name" autoComplete="family-name" error={errors.lastName?.message} {...register('lastName')} />
          </div>
        </FormGroup>

        <FormGroup id="profile-group-contact" icon={Smartphone} title="Contact" description="Filled in for you at checkout.">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id={PROFILE_FIELD_IDS.phone}
              label="Mobile number"
              optional
              type="tel"
              autoComplete="tel"
              hint="With country code, for example +91 98000 00000"
              error={errors.phone?.message}
              {...register('phone')}
            />
          </div>
        </FormGroup>

        <FormGroup id="profile-group-about" icon={Cake} iconTile="bg-accent-50 text-accent-600 ring-accent-100" title="About you" description="Both are optional.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="dateOfBirth"
              render={({ field }) => (
                <DateField
                  id={PROFILE_FIELD_IDS.dateOfBirth}
                  label="Date of birth"
                  optional
                  max={todayIso()}
                  error={errors.dateOfBirth?.message}
                  {...field}
                />
              )}
            />
            <SelectField id={PROFILE_FIELD_IDS.nationality} label="Nationality" optional error={errors.nationality?.message} {...register('nationality')}>
              <option value="">Not set</option>
              {countries().map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </SelectField>
          </div>
        </FormGroup>

        <SaveBar dirty={isDirty} saving={mutation.isPending} onDiscard={() => reset()} />
      </form>
    </Card>
  );
}

/**
 * The account's e-mail (with its verification, and a new link when it is not verified) and the membership date, as two
 * tiles. A `dl`; each tile's icon sits inside its `dt`, so the list stays valid.
 */
function AccountFacts({ profile }: { profile: Profile }) {
  const resend = useMutation({ mutationFn: () => authApi.resendVerification(profile.email) });
  const tile = 'relative min-w-0 rounded-2xl bg-slate-50/80 py-3.5 pl-[4.25rem] pr-4 ring-1 ring-inset ring-slate-200/70';
  const icon = 'absolute left-4 top-3.5 flex size-10 items-center justify-center rounded-xl bg-role-50 ring-1 ring-inset ring-role-100';
  return (
    <dl className="grid gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className={tile}>
        <dt className="text-xs font-semibold text-slate-600">
          <span aria-hidden="true" className={icon}><Mail className="size-5" /></span>
          Sign-in e-mail
        </dt>
        <dd className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="break-all text-[0.9375rem] font-semibold text-slate-900">{profile.email}</span>
          {profile.emailVerified ? <Badge tone="success" dot>Verified</Badge> : <Badge tone="warning" dot>Not verified</Badge>}
        </dd>
        {!profile.emailVerified && (
          <dd className="mt-1.5 text-sm">
            {!resend.isSuccess && (
              <Button variant="link" className="text-sm" loading={resend.isPending} onClick={() => resend.mutate()}>
                Send the verification link again
              </Button>
            )}
            <p role="status" className="font-medium text-success-700 empty:hidden">{resend.isSuccess && resend.data.message}</p>
            {resend.isError && <p className="font-medium text-danger-600">{ApiError.from(resend.error).message}</p>}
          </dd>
        )}
      </div>
      <div className={tile}>
        <dt className="text-xs font-semibold text-slate-600">
          <span aria-hidden="true" className={icon}><Sparkles className="size-5" /></span>
          Member since
        </dt>
        <dd className="mt-0.5 text-[0.9375rem] font-semibold text-slate-900">{format(new Date(profile.memberSince), 'MMMM yyyy')}</dd>
      </div>
    </dl>
  );
}

/**
 * A group of fields with its title: above the fields on narrow screens, in a column on the left from `xl`. A `group`
 * named by its heading (a fieldset's legend cannot sit in a grid column).
 */
function FormGroup({ id, icon: Icon, iconTile, title, description, children }: {
  id: string;
  icon: LucideIcon;
  /** Classes for the icon's tile; by default the role tile, which icon-colors.css tints per icon. */
  iconTile?: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-labelledby={id}
      className="mt-6 grid gap-4 border-t border-slate-100 pt-6 xl:grid-cols-[15rem_minmax(0,1fr)] xl:gap-8"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset', iconTile ?? 'bg-role-50 ring-role-100')}>
          <Icon className="size-[1.125rem]" />
        </span>
        <div className="min-w-0">
          <h3 id={id} className="text-[0.9375rem] font-bold text-slate-900">{title}</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{description}</p>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Save and discard. It sticks to the bottom of the window while the form has unsaved changes (a frosted bar with a
 * pulsing dot and the sheen on "Save changes"); otherwise it says everything is saved. The sentence is a status region,
 * so screen readers hear the change once.
 */
function SaveBar({ dirty, saving, onDiscard }: { dirty: boolean; saving: boolean; onDiscard: () => void }) {
  return (
    <div className={cn('z-10 -mx-5 mt-6 px-3 pb-3 sm:-mx-6', dirty && 'sticky bottom-0')}>
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 ring-1 transition-[background-color,box-shadow] duration-(--duration-base) ease-out-soft',
          dirty ? 'glass shadow-xl ring-role-200' : 'bg-slate-50 ring-slate-200/70',
        )}
      >
        <p role="status" className="flex items-center gap-2 text-sm font-medium text-slate-700">
          {dirty ? (
            <>
              <span aria-hidden="true" className="relative flex size-2.5">
                <span className="absolute inset-0 rounded-full text-warning-500 animate-pulse-ring" />
                <span className="relative size-2.5 rounded-full bg-warning-500" />
              </span>
              You have unsaved changes
            </>
          ) : (
            <>
              <CircleCheck className="size-4 text-success-600" aria-hidden="true" />
              Everything is saved
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <Button variant="ghost" onClick={onDiscard}>
              Discard
            </Button>
          )}
          <Button type="submit" loading={saving} disabled={!dirty} className={cn(dirty && 'sheen-sweep')}>
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}

function toForm(profile: Profile): ProfileForm {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    phone: profile.phone ?? '',
    dateOfBirth: profile.dateOfBirth ?? '',
    nationality: profile.nationality ?? '',
  };
}
