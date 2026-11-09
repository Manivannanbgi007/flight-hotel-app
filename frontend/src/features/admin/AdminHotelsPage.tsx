import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Hotel, PenLine, Plus, UserMinus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { ExportMenu } from '@/components/export/ExportMenu';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SelectField, TextField } from '@/components/ui/Field';
import { buttonClass } from '@/components/ui/buttonStyles';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES } from '@/components/ui/paginationItems';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import { adminHotelApi } from '@/features/hotel-manager/managerApi';
import { HOTEL_STATUS_LABELS, type HotelStatus, type HotelSummary } from '@/features/hotel-manager/types';
import { DemoBadge } from '@/features/hotels/HotelBadges';
import { PROPERTY_TYPE_LABELS, type PropertyType } from '@/features/hotels/types';
import { ApiError } from '@/lib/api/apiError';
import { applyServerErrors } from '@/lib/api/formErrors';
import { queryKeys } from '@/lib/api/queryKeys';
import { countries } from '@/lib/countries';
import { describeFilters, type ExportColumn } from '@/lib/export';
import { formatDate } from '@/lib/format';
import { FilterCard, ListLoading, PageHeader, ResultCount } from './shared/adminUi';

const createSchema = z.object({
  name: z.string().trim().min(1, 'Enter the hotel name').max(150),
  propertyType: z.enum(['HOTEL', 'RESORT', 'APARTMENT', 'VILLA', 'HOSTEL', 'GUEST_HOUSE']),
  addressLine: z.string().trim().min(1, 'Enter the street address').max(255),
  city: z.string().trim().min(1, 'Enter the city').max(100),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  starRating: z.string(),
});
type CreateForm = z.infer<typeof createSchema>;

/** The columns of an export (CSV, Excel, PDF): what each hotel row shows. */
const EXPORT_COLUMNS: ExportColumn<HotelSummary>[] = [
  { header: 'Hotel', value: (hotel) => hotel.name },
  { header: 'City', value: (hotel) => hotel.city },
  { header: 'Status', value: (hotel) => HOTEL_STATUS_LABELS[hotel.status] ?? hotel.status },
  { header: 'Demo listing', value: (hotel) => hotel.dataSource === 'DEMO' },
  { header: 'Room types', value: (hotel) => hotel.roomTypes, type: 'integer' },
  { header: 'Managers', value: (hotel) => hotel.managers, type: 'integer' },
  { header: 'Updated', value: (hotel) => hotel.updatedAt.slice(0, 10), type: 'date' },
];

/** Admin: Hotel Management (create, publish/unpublish, assign hotel managers). Content is edited in the manager portal. */
export function AdminHotelsPage() {
  // The header's global search opens this page with `?q=` (a hotel's name).
  const [initialParams] = useSearchParams();
  const [search, setSearch] = useState(() => initialParams.get('q')?.trim() ?? '');
  const [status, setStatus] = useState<HotelStatus | ''>('');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const [creating, setCreating] = useState(false);
  const query = { search: search.trim(), status: status || undefined, page };
  const hotels = useQuery({
    queryKey: [...queryKeys.admin.hotels(JSON.stringify(query)), size],
    queryFn: () => adminHotelApi.list(query, size),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={<Hotel className="size-5" />}
        title="Hotels"
        description="Create hotels, publish or unpublish them and assign their managers. Content is edited in the hotel manager portal."
        actions={!creating && <Button variant="role" onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" /> New hotel</Button>}
      />
      {creating && <CreateHotel onDone={() => setCreating(false)} />}
      <FilterCard>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <TextField label="Search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Name or city" />
          <SelectField label="Status" value={status} onChange={(e) => { setStatus(e.target.value as HotelStatus | ''); setPage(0); }}>
            <option value="">All</option>
            {(Object.keys(HOTEL_STATUS_LABELS) as HotelStatus[]).map((s) => <option key={s} value={s}>{HOTEL_STATUS_LABELS[s]}</option>)}
          </SelectField>
        </div>
      </FilterCard>

      {hotels.isPending && <ListLoading label="Loading hotels…" rows={4} />}
      {hotels.isError && <ErrorState description={ApiError.from(hotels.error).message} onRetry={() => void hotels.refetch()} />}
      {hotels.data && hotels.data.content.length === 0 && (
        <EmptyState illustration="search" title="No hotels found" description="Try another name or city, or another status." />
      )}
      {hotels.data && hotels.data.content.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <ResultCount count={hotels.data.totalElements} noun={['hotel', 'hotels']} />
            <ExportMenu
              className="ml-auto"
              title="Hotels"
              subtitle="Admin portal"
              fileName="hotels"
              columns={EXPORT_COLUMNS}
              rows={hotels.data.content}
              total={hotels.data.totalElements}
              pageLabel={`Page ${hotels.data.page + 1} of ${Math.max(hotels.data.totalPages, 1)}`}
              fetchPage={(next, pageSize) => adminHotelApi.list({ ...query, page: next }, pageSize)}
              rowKey={(hotel) => hotel.id}
              filters={describeFilters([['Search', query.search], ['Status', status && HOTEL_STATUS_LABELS[status]]])}
            />
          </div>
          <ul className="flex flex-col gap-3 stagger">
            {hotels.data.content.map((hotel) => <li key={hotel.id}><AdminHotelRow hotel={hotel} /></li>)}
          </ul>
          <Pagination data={hotels.data} noun={['hotel', 'hotels']} pageSizes={PAGE_SIZES} sizeLabel="Per page"
            onPageChange={setPage} onPageSizeChange={(next) => { setSize(next); setPage(0); }} />
        </>
      )}
    </div>
  );
}

function AdminHotelRow({ hotel }: { hotel: HotelSummary }) {
  const queryClient = useQueryClient();
  const [showManagers, setShowManagers] = useState(false);
  const changeStatus = useMutation({
    mutationFn: (status: HotelStatus) => adminHotelApi.changeStatus(hotel.id, status),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'hotels'] });
      toast.success(saved.status === 'ACTIVE' ? `${saved.name} is published.` : `${saved.name} is no longer visible to customers.`);
    },
  });
  const error = changeStatus.error ? ApiError.from(changeStatus.error) : null;

  return (
    <Card className="p-4 transition-shadow hover:shadow-md sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-role-50 ring-1 ring-slate-200">
            {hotel.imageUrl
              ? <img src={hotel.imageUrl} alt="" className="size-full object-cover" loading="lazy" />
              : <Hotel className="size-6 text-role-600" aria-hidden="true" />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">{hotel.name}</h2>
              <Badge dot tone={hotel.status === 'ACTIVE' ? 'success' : hotel.status === 'DRAFT' ? 'warning' : 'neutral'}>{HOTEL_STATUS_LABELS[hotel.status]}</Badge>
              {hotel.dataSource === 'DEMO' && <DemoBadge />}
            </div>
            <p className="text-sm text-slate-600">
              {hotel.city} · {hotel.roomTypes} room type{hotel.roomTypes === 1 ? '' : 's'} · {hotel.managers} manager{hotel.managers === 1 ? '' : 's'} · updated {formatDate(hotel.updatedAt.slice(0, 10))}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/hotel-manager/hotels/${hotel.id}/profile`} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            <PenLine className="size-4" aria-hidden="true" /> Edit content
          </Link>
          <Button variant="secondary" size="sm" aria-expanded={showManagers} onClick={() => setShowManagers((v) => !v)}>
            <Users className="size-4" aria-hidden="true" /> Managers
          </Button>
          {hotel.status === 'ACTIVE' ? (
            <Button variant="secondary" size="sm" loading={changeStatus.isPending} onClick={() => changeStatus.mutate('INACTIVE')}>Unpublish</Button>
          ) : (
            <Button size="sm" variant="role" loading={changeStatus.isPending} onClick={() => changeStatus.mutate('ACTIVE')}>Publish</Button>
          )}
        </div>
      </div>
      {error && (
        <Alert tone="danger" className="mt-3" title={error.code === 'HOTEL_NOT_READY' ? 'Not ready to publish' : undefined}>
          {error.code === 'HOTEL_NOT_READY'
            ? `Still missing: ${(error.details.missing as string[] | undefined)?.join(', ')}.`
            : error.message}
        </Alert>
      )}
      {showManagers && <ManagersPanel hotelId={hotel.id} />}
    </Card>
  );
}

function ManagersPanel({ hotelId }: { hotelId: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const managers = useQuery({ queryKey: queryKeys.admin.hotelManagers(hotelId), queryFn: () => adminHotelApi.managers(hotelId) });
  const onChange = (list: Awaited<ReturnType<typeof adminHotelApi.managers>>) => {
    queryClient.setQueryData(queryKeys.admin.hotelManagers(hotelId), list);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'hotels'] });
  };
  const assign = useMutation({
    mutationFn: () => adminHotelApi.assignManager(hotelId, email.trim()),
    onSuccess: (list) => { onChange(list); setEmail(''); toast.success('Manager assigned.'); },
  });
  const remove = useMutation({ mutationFn: (userId: string) => adminHotelApi.unassignManager(hotelId, userId), onSuccess: onChange });

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <h3 className="text-sm font-bold text-slate-900">Hotel managers</h3>
      {managers.data?.length === 0 && <p className="text-sm text-slate-500">Nobody manages this hotel yet.</p>}
      <ul className="mt-2 flex flex-col gap-1">
        {managers.data?.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-slate-200">
            <span className="min-w-0 break-words">{m.firstName} {m.lastName} <span className="text-slate-500">{m.email}</span></span>
            <Button variant="ghost" size="sm" aria-label={`Remove ${m.email}`} loading={remove.isPending && remove.variables === m.userId}
              onClick={() => remove.mutate(m.userId)}>
              <UserMinus className="size-4" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (email.trim()) assign.mutate(); }}>
        <div className="min-w-0 flex-1 basis-60">
          <TextField label="Assign by email (account with the Hotel manager role)" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="manager@example.com" />
        </div>
        <Button type="submit" variant="role" loading={assign.isPending}>Assign</Button>
      </form>
      {assign.isError && <Alert tone="danger" className="mt-2">{ApiError.from(assign.error).message}</Alert>}
    </div>
  );
}

function CreateHotel({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, setError, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', propertyType: 'HOTEL', addressLine: '', city: '', countryCode: 'IN', starRating: '' },
  });
  const create = useMutation({
    mutationFn: (form: CreateForm) => adminHotelApi.create({ ...form, starRating: form.starRating ? Number(form.starRating) : undefined }),
    onSuccess: (hotel) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'hotels'] });
      toast.success(`${hotel.name} was created as a draft. Add rooms, photos and a description, then publish it.`);
      onDone();
    },
    onError: (error) => applyServerErrors(error, setError, ['name', 'addressLine', 'city', 'countryCode']),
  });
  return (
    <Card variant="tinted" className="p-5 animate-fade-up">
      <h2 className="mb-3 text-base font-bold text-slate-900">New hotel</h2>
      <form onSubmit={handleSubmit((form) => create.mutate(form))} noValidate className="grid gap-4 sm:grid-cols-3">
        <TextField label="Name" error={errors.name?.message} {...register('name')} />
        <SelectField label="Property type" {...register('propertyType')}>
          {(Object.keys(PROPERTY_TYPE_LABELS) as PropertyType[]).map((t) => <option key={t} value={t}>{PROPERTY_TYPE_LABELS[t]}</option>)}
        </SelectField>
        <SelectField label="Stars" optional {...register('starRating')}>
          <option value="">Not rated</option>
          {[1, 2, 3, 4, 5].map((s) => <option key={s} value={s}>{s}</option>)}
        </SelectField>
        <TextField label="Street address" error={errors.addressLine?.message} {...register('addressLine')} />
        <TextField label="City" error={errors.city?.message} {...register('city')} />
        <SelectField label="Country" {...register('countryCode')}>
          {countries().map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </SelectField>
        {create.isError && ApiError.from(create.error).code !== 'VALIDATION_FAILED' && (
          <Alert tone="danger" className="sm:col-span-3">{ApiError.from(create.error).message}</Alert>
        )}
        <div className="flex gap-2 sm:col-span-3">
          <Button type="submit" variant="role" loading={create.isPending}>Create draft</Button>
          <Button variant="ghost" onClick={onDone}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}
