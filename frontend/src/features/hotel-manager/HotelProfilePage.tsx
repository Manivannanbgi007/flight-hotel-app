import { Controller, useFieldArray, useForm, useWatch, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import {
  Building2, CircleCheck, Clock3, ExternalLink, Info, Mail, MapPin, Phone, Plus, ScrollText, Sparkles, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { checkboxClass } from '@/components/ui/fieldStyles';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { TimeField } from '@/components/ui/TimeField';
import { hotelApi } from '@/features/hotels/hotelApi';
import { PROPERTY_TYPE_LABELS, type PropertyType } from '@/features/hotels/types';
import { ApiError } from '@/lib/api/apiError';
import { applyServerErrors } from '@/lib/api/formErrors';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { countries } from '@/lib/countries';
import { ManagerPageHeader, SectionCard } from './ManagerParts';
import { managerApi } from './managerApi';
import { formToProfileRequest, profileSchema, profileToForm, type ProfileForm } from './schemas';
import { HOTEL_STATUS_LABELS, POLICY_TYPE_LABELS, type HotelProfile, type PolicyType } from './types';

const DESCRIPTION_MAX = 5000;
const MAX_RULES = 20;

const statusTone = (status: HotelProfile['status']) => (status === 'ACTIVE' ? 'success' : status === 'DRAFT' ? 'warning' : 'neutral');

/** The form's sections, in page order: their anchor, title, one-line description and icon. */
const SECTIONS = [
  { id: 'profile-basics', title: 'Basic information', description: 'The name, type and description guests read first.', icon: Building2 },
  { id: 'profile-location', title: 'Address and location', description: 'Where the hotel is, and its place on the map.', icon: MapPin },
  { id: 'profile-stay', title: 'Stay and contact', description: 'Check-in and check-out times, and how guests reach the front desk.', icon: Clock3 },
  { id: 'profile-amenities', title: 'Amenities', description: 'Facilities of the whole hotel. Room amenities are set per room type.', icon: Sparkles },
  { id: 'profile-rules', title: 'House rules', description: 'What guests agree to when they book: children, pets, smoking, ID, payment.', icon: ScrollText },
] as const satisfies readonly { id: string; title: string; description: string; icon: LucideIcon }[];
type SectionId = (typeof SECTIONS)[number]['id'];
const section = (id: SectionId) => SECTIONS.find((item) => item.id === id)!;

/**
 * /hotel-manager/hotels/:hotelId/profile — what guests see on the hotel page: name, description, address, check-in
 * times, contacts, amenities and house rules, as one form in section cards (with an "On this page" guide on wide
 * screens) and a save bar that stays in view.
 */
export function HotelProfilePage() {
  const { hotelId = '' } = useParams();
  const profile = useQuery({ queryKey: queryKeys.hotelManager.profile(hotelId), queryFn: () => managerApi.profile(hotelId) });
  if (profile.isPending) return <LoadingState label="Loading the hotel profile…" rows={4} />;
  if (profile.isError) {
    const error = ApiError.from(profile.error);
    return <ErrorState description={error.message} correlationId={error.correlationId} onRetry={() => void profile.refetch()} />;
  }
  // Re-mount after a save (new version) so the form shows what the server stored.
  return <ProfileEditor key={profile.data.version} profile={profile.data} />;
}

function ProfileEditor({ profile }: { profile: HotelProfile }) {
  const queryClient = useQueryClient();
  const amenities = useQuery({ queryKey: queryKeys.hotels.amenities, queryFn: hotelApi.amenities, staleTime: Infinity });
  const {
    register,
    handleSubmit,
    setError,
    control,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileForm>({ resolver: zodResolver(profileSchema), defaultValues: profileToForm(profile) });
  const policies = useFieldArray({ control, name: 'policies' });
  const [description = '', latitude = '', longitude = '', chosenAmenities = []] = useWatch({
    control,
    name: ['description', 'latitude', 'longitude', 'amenities'],
  });

  const save = useMutation({
    mutationFn: (form: ProfileForm) => managerApi.updateProfile(profile.id, formToProfileRequest(form, profile.version)),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.hotelManager.profile(profile.id), saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.hotelManager.hotels });
      toast.success('The hotel profile was saved. Search results update within seconds.');
    },
    onError: (error) => {
      applyServerErrors(error, setError, ['name', 'description', 'addressLine', 'city', 'countryCode', 'latitude', 'longitude',
        'contactEmail', 'contactPhone']);
    },
  });
  const error = save.error ? ApiError.from(save.error) : null;
  const hotelAmenities = (amenities.data ?? []).filter((a) => a.category === 'HOTEL');
  const selected = hotelAmenities.filter((a) => chosenAmenities.includes(a.code)).length;
  const mapLink = latitude.trim() !== '' && longitude.trim() !== '' && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
    ? `https://www.openstreetmap.org/?mlat=${Number(latitude)}&mlon=${Number(longitude)}#map=17/${Number(latitude)}/${Number(longitude)}`
    : null;

  return (
    <form onSubmit={handleSubmit((form) => save.mutate(form))} noValidate className="flex flex-col gap-5">
      <ManagerPageHeader
        icon={<Building2 className="size-5" />}
        title="Hotel profile"
        description="What guests see on the hotel page: name, description, address, check-in times, contacts, amenities and house rules."
        actions={(
          <span className="flex items-center gap-2">
            <Badge tone={statusTone(profile.status)} dot>{HOTEL_STATUS_LABELS[profile.status]}</Badge>
            <span className="text-xs text-slate-500">Publishing is done by an administrator</span>
          </span>
        )}
      />
      {profile.dataSource === 'DEMO' && (
        <Alert tone="warning">This is a demo listing. Changes are allowed, but customers always see it marked as demo.</Alert>
      )}
      {error && error.code !== 'VALIDATION_FAILED' && (
        <Alert tone="danger">
          {error.code === 'CONCURRENT_MODIFICATION' ? 'Someone else saved this hotel meanwhile. Reload the page to see their changes.' : error.message}
        </Alert>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[15rem_minmax(0,1fr)]">
        <SectionGuide control={control} />

        <div className="flex min-w-0 flex-col gap-5">
          <ProfileSection id="profile-basics" bodyClassName="grid gap-4 sm:grid-cols-2">
            <TextField label="Hotel name" error={errors.name?.message} {...register('name')} />
            <SelectField label="Property type" {...register('propertyType')}>
              {(Object.keys(PROPERTY_TYPE_LABELS) as PropertyType[]).map((t) => <option key={t} value={t}>{PROPERTY_TYPE_LABELS[t]}</option>)}
            </SelectField>
            <SelectField label="Star rating" optional {...register('starRating')}>
              <option value="">Not rated</option>
              {[1, 2, 3, 4, 5].map((s) => <option key={s} value={s}>{s} star{s === 1 ? '' : 's'}</option>)}
            </SelectField>
            <div className="sm:col-span-2">
              <TextAreaField id="description" label="Description" rows={6} error={errors.description?.message}
                hint={`What makes the stay special: the setting, the rooms, food and facilities. ${description.length.toLocaleString('en-IN')} / ${DESCRIPTION_MAX.toLocaleString('en-IN')} characters`}
                {...register('description')} />
            </div>
          </ProfileSection>

          <ProfileSection id="profile-location" bodyClassName="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <TextField label="Street address" error={errors.addressLine?.message} {...register('addressLine')} />
            </div>
            <TextField label="City" error={errors.city?.message} {...register('city')} />
            <TextField label="State" optional {...register('state')} />
            <TextField label="Postal code" optional {...register('postalCode')} />
            <SelectField label="Country" error={errors.countryCode?.message} {...register('countryCode')}>
              {countries().map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </SelectField>
            <TextField label="Latitude" inputMode="decimal" placeholder="15.4909" error={errors.latitude?.message} {...register('latitude')} />
            <TextField label="Longitude" inputMode="decimal" placeholder="73.8278" error={errors.longitude?.message} {...register('longitude')} />
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-info-50/70 p-3 text-xs leading-relaxed text-slate-700 ring-1 ring-inset ring-info-100 sm:col-span-2">
              <p className="flex min-w-0 flex-1 basis-72 gap-2">
                <Info className="mt-px size-4 shrink-0 text-info-600" aria-hidden="true" />
                <span>
                  Latitude and longitude place the hotel on the map and enable "distance from" search. Tip: right-click the
                  hotel in OpenStreetMap and choose "Show address".
                </span>
              </p>
              {mapLink && (
                <a href={mapLink} target="_blank" rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 font-semibold text-info-700 hover:underline">
                  Check on the map<ExternalLink className="size-3.5" aria-hidden="true" />
                  <span className="sr-only"> (OpenStreetMap, opens in a new tab)</span>
                </a>
              )}
            </div>
          </ProfileSection>

          <ProfileSection id="profile-stay" bodyClassName="grid gap-4 sm:grid-cols-2">
            <Controller control={control} name="checkInTime" render={({ field }) => (
              <TimeField label="Check-in from" error={errors.checkInTime?.message} {...field} />
            )} />
            <Controller control={control} name="checkOutTime" render={({ field }) => (
              <TimeField label="Check-out until" error={errors.checkOutTime?.message} {...field} />
            )} />
            <TextField label="Contact email" optional type="email" icon={Mail} placeholder="frontdesk@example.com"
              error={errors.contactEmail?.message} {...register('contactEmail')} />
            <TextField label="Contact phone" optional type="tel" icon={Phone} placeholder="+91 832 200 0000"
              error={errors.contactPhone?.message} {...register('contactPhone')} />
          </ProfileSection>

          <ProfileSection
            id="profile-amenities"
            actions={amenities.data && <Badge tone={selected > 0 ? 'role' : 'neutral'}>{selected} selected</Badge>}
          >
            {amenities.isPending ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
                <span role="status" className="sr-only">Loading the amenities…</span>
                {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-11 rounded-xl" />)}
              </div>
            ) : hotelAmenities.length === 0 ? (
              <p className="text-sm text-slate-500">No hotel amenities to choose from.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {hotelAmenities.map((amenity) => (
                  <label key={amenity.code}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700',
                      'transition-colors duration-(--duration-fast) hover:border-slate-300 hover:bg-slate-50',
                      'has-[:checked]:border-role-300 has-[:checked]:bg-role-50 has-[:checked]:text-role-900',
                    )}>
                    <input type="checkbox" value={amenity.code} className={checkboxClass} {...register('amenities')} />
                    {amenity.name}
                  </label>
                ))}
              </div>
            )}
          </ProfileSection>

          <ProfileSection
            id="profile-rules"
            actions={(
              <Button variant="secondary" size="sm" disabled={policies.fields.length >= MAX_RULES}
                onClick={() => policies.append({ type: 'OTHER', description: '' })}>
                <Plus className="size-4" aria-hidden="true" /> Add rule
              </Button>
            )}
          >
            {policies.fields.length === 0 ? (
              <div className="flex flex-col items-center gap-1 rounded-xl border-2 border-dashed border-slate-200 px-4 py-6 text-center">
                <ScrollText className="size-6 text-slate-400" aria-hidden="true" />
                <p className="text-sm font-semibold text-slate-700">No rules yet.</p>
                <p className="text-xs text-slate-500">Add rules about children, pets, smoking, ID at check-in or payment.</p>
              </div>
            ) : (
              <ol className="flex flex-col gap-3">
                {policies.fields.map((field, index) => (
                  <li key={field.id}
                    className="grid items-start gap-3 rounded-xl bg-slate-50/80 p-3 ring-1 ring-inset ring-slate-200/70 sm:grid-cols-[2rem_11rem_minmax(0,1fr)_auto]">
                    <span aria-hidden="true" className="mt-8 hidden size-7 items-center justify-center rounded-full bg-white text-xs font-bold text-slate-600 ring-1 ring-slate-200 sm:flex">
                      {index + 1}
                    </span>
                    <SelectField label="Type" {...register(`policies.${index}.type`)}>
                      {(Object.keys(POLICY_TYPE_LABELS) as PolicyType[]).map((t) => <option key={t} value={t}>{POLICY_TYPE_LABELS[t]}</option>)}
                    </SelectField>
                    <TextField label="Rule" error={errors.policies?.[index]?.description?.message} {...register(`policies.${index}.description`)} />
                    <Button variant="ghost" className="justify-self-end sm:mt-7 sm:justify-self-auto" aria-label={`Remove rule ${index + 1}`} onClick={() => policies.remove(index)}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
            {policies.fields.length >= MAX_RULES && <p className="mt-3 text-xs text-slate-500">A hotel can have up to {MAX_RULES} rules.</p>}
          </ProfileSection>
        </div>
      </div>

      {/* Stays in view at the bottom; it ends left of the AI assistant's floating button (56 px, bottom right). */}
      <div className="sticky bottom-4 z-20 mr-16 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/90 py-2.5 pl-4 pr-2.5 shadow-lg backdrop-blur-md sm:bottom-6 sm:mr-20">
        <p className="flex items-center gap-2 text-sm font-medium text-slate-700" role="status">
          {isDirty ? (
            <><span aria-hidden="true" className="size-2 rounded-full bg-warning-500" />Unsaved changes</>
          ) : (
            <><CircleCheck className="size-4 text-success-600" aria-hidden="true" />All changes saved</>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {isDirty && <Button variant="ghost" onClick={() => reset()} disabled={save.isPending}>Discard changes</Button>}
          <Button type="submit" loading={save.isPending} disabled={!isDirty}>Save profile</Button>
        </div>
      </div>
    </form>
  );
}

/** One section of the form: a card with the section's icon, title and description; `id` is the guide's anchor. */
function ProfileSection({ id, actions, bodyClassName, children }: {
  id: SectionId;
  actions?: React.ReactNode;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  const { title, description, icon: Icon } = section(id);
  return (
    <SectionCard id={id} className="scroll-mt-24" title={title} description={description} icon={<Icon className="size-5" />}
      actions={actions} bodyClassName={bodyClassName}>
      {children}
    </SectionCard>
  );
}

/**
 * "On this page" (wide screens): a link to each section, with a check once the section's required fields are filled
 * (amenities: at least one; house rules: at least one, each described), and how many sections are complete.
 */
function SectionGuide({ control }: { control: Control<ProfileForm> }) {
  const values = useWatch({ control });
  const filled = (value: string | undefined) => (value ?? '').trim() !== '';
  const complete: Record<SectionId, boolean> = {
    'profile-basics': filled(values.name) && filled(values.description),
    'profile-location': filled(values.addressLine) && filled(values.city) && filled(values.countryCode),
    'profile-stay': filled(values.checkInTime) && filled(values.checkOutTime) && (filled(values.contactEmail) || filled(values.contactPhone)),
    'profile-amenities': (values.amenities ?? []).length > 0,
    'profile-rules': (values.policies ?? []).length > 0 && (values.policies ?? []).every((rule) => filled(rule?.description)),
  };
  const done = SECTIONS.filter((item) => complete[item.id]).length;
  const go = (event: React.MouseEvent<HTMLAnchorElement>, id: SectionId) => {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };
  return (
    <nav aria-label="On this page" className="hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card xl:sticky xl:top-24 xl:block">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">On this page</p>
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs font-medium text-slate-600">
          <span>Profile complete</span>
          <span className="tabular-nums">{done} of {SECTIONS.length}</span>
        </div>
        <div aria-hidden="true" className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-role-600 transition-[width] duration-(--duration-slow)" style={{ width: `${(done / SECTIONS.length) * 100}%` }} />
        </div>
      </div>
      <ul className="mt-3 flex flex-col gap-0.5">
        {SECTIONS.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`} onClick={(event) => go(event, item.id)}
              aria-label={`${item.title}, ${complete[item.id] ? 'complete' : 'to do'}`}
              className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900">
              {complete[item.id] ? (
                <CircleCheck className="size-4 shrink-0 text-success-600" aria-hidden="true" />
              ) : (
                <span aria-hidden="true" className="size-4 shrink-0 rounded-full border-2 border-dashed border-slate-300" />
              )}
              <span className="min-w-0 flex-1">{item.title}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">
        A section is ticked when guests have what they need from it: a description, the address, contact details,
        at least one amenity and house rules.
      </p>
    </nav>
  );
}
