import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm, useWatch, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Megaphone, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { ExportMenu } from '@/components/export/ExportMenu';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { tableStyles } from '@/components/ui/dataTableStyles';
import { DateField } from '@/components/ui/DateField';
import { Dialog } from '@/components/ui/Dialog';
import { CheckboxField, SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES, readPageSize } from '@/components/ui/paginationItems';
import { EmptyState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { applyServerErrors } from '@/lib/api/formErrors';
import { queryKeys } from '@/lib/api/queryKeys';
import { describeFilters, type ExportColumn } from '@/lib/export';
import {
  FilterCard, ListLoading, LoadError, PageHeader, ProblemAlert, RequirePermission, ResultCount, SearchBox, TableShell, tdClass,
} from '../shared/adminUi';
import { indiaDate, readEnum, readPage, useSearchState } from '../shared/searchState';
import { couponApi, offerApi, type ActiveStatus, type AdminOffer, type OfferFilters } from './couponApi';
import {
  APPLIES_TO_LABELS, discountLabel, fieldOfProblem, offerFormDefaults, offerSchema, THEME_LABELS, toOfferBody, validity, type OfferForm,
} from './couponSchemas';

const STATUSES = ['ACTIVE', 'INACTIVE'] as const;
const FORM_FIELDS: FieldPath<OfferForm>[] = [
  'title', 'description', 'couponId', 'appliesTo', 'destinationCity', 'validFrom', 'validTo', 'seasonal', 'theme', 'status',
];

const activeLabel = (status: ActiveStatus) => (status === 'ACTIVE' ? 'Active' : 'Inactive');

/** The columns of an export (CSV, Excel, PDF): what the table shows, one fact per column. Dates are India days. */
const EXPORT_COLUMNS: ExportColumn<AdminOffer>[] = [
  { header: 'Offer', value: (offer) => offer.title },
  { header: 'Applies to', value: (offer) => APPLIES_TO_LABELS[offer.appliesTo] ?? offer.appliesTo },
  { header: 'Destination', value: (offer) => offer.destinationCity },
  { header: 'Theme', value: (offer) => THEME_LABELS[offer.theme] ?? offer.theme },
  { header: 'Seasonal', value: (offer) => offer.seasonal },
  { header: 'Demo', value: (offer) => offer.demo },
  { header: 'Coupon', value: (offer) => offer.couponCode },
  { header: 'Discount', value: (offer) => offer.discountLabel },
  { header: 'Coupon status', value: (offer) => (offer.couponStatus ? activeLabel(offer.couponStatus) : null) },
  { header: 'Valid from', value: (offer) => indiaDate(offer.validFrom), type: 'date' },
  { header: 'Valid to', value: (offer) => indiaDate(offer.validTo), type: 'date' },
  { header: 'Status', value: (offer) => activeLabel(offer.status) },
  { header: 'On the site now', value: (offer) => offer.live },
];

/** /admin/offers — the deals on the public Offers page; each one points customers to a coupon. */
export function AdminOffersPage() {
  return (
    <RequirePermission permission="COUPON_MANAGE">
      <Offers />
    </RequirePermission>
  );
}

function Offers() {
  const { params, update } = useSearchState();
  const [editing, setEditing] = useState<AdminOffer | 'new' | null>(null);
  const filters: OfferFilters = { q: params.get('q')?.trim() ?? '', status: readEnum(params, 'status', STATUSES), page: readPage(params) };
  const size = readPageSize(params, PAGE_SIZES, 25);
  const offers = useQuery({
    queryKey: [...queryKeys.admin.offerList(filters), size],
    queryFn: () => offerApi.list(filters, size),
    placeholderData: keepPreviousData,
  });
  const data = offers.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon={<Megaphone className="size-5" />}
        title="Offers"
        description="Shown on the public Offers page while the offer is active, inside its dates and its coupon is active."
        actions={<Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden="true" /> New offer</Button>}
      />
      <FilterCard>
        <SearchBox key={filters.q} initial={filters.q} label="Search" placeholder="Title or coupon code" onSearch={(q) => update({ q })} />
        <div className="sm:w-56">
          <SelectField label="Status" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </SelectField>
        </div>
      </FilterCard>

      {offers.isPending && <ListLoading label="Loading offers…" />}
      {offers.isError && <LoadError error={offers.error} onRetry={() => void offers.refetch()} />}
      {data && data.content.length === 0 && <EmptyState title="No offers found" />}
      {data && data.content.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <ResultCount count={data.totalElements} noun={['offer', 'offers']} />
            <ExportMenu
              className="ml-auto"
              title="Offers"
              subtitle="Admin portal"
              fileName="offers"
              columns={EXPORT_COLUMNS}
              rows={data.content}
              total={data.totalElements}
              pageLabel={`Page ${data.page + 1} of ${Math.max(data.totalPages, 1)}`}
              fetchPage={(page, pageSize) => offerApi.list({ ...filters, page }, pageSize)}
              rowKey={(offer) => offer.id}
              filters={describeFilters([['Search', filters.q], ['Status', filters.status && activeLabel(filters.status)]])}
            />
          </div>
          <TableShell caption="Offers">
            <thead>
              <tr>
                <th scope="col" className={tableStyles.th}>Offer</th>
                <th scope="col" className={tableStyles.th}>Coupon</th>
                <th scope="col" className={tableStyles.th}>Valid</th>
                <th scope="col" className={tableStyles.th}>Status</th>
                <th scope="col" className={tableStyles.th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className={tableStyles.tbody}>
              {data.content.map((offer) => <OfferRow key={offer.id} offer={offer} onEdit={() => setEditing(offer)} />)}
            </tbody>
          </TableShell>
          <Pagination data={data} noun={['offer', 'offers']} pageSizes={PAGE_SIZES}
            onPageChange={(page) => update({ page: String(page) })} onPageSizeChange={(next) => update({ size: next === 25 ? null : String(next) })} />
        </>
      )}
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'New offer' : 'Change offer'} className="max-w-2xl">
        {editing !== null && <OfferEditor offer={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}

function OfferRow({ offer, onEdit }: { offer: AdminOffer; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (status: ActiveStatus) => offerApi.setStatus(offer.id, status),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.offers });
      void queryClient.invalidateQueries({ queryKey: queryKeys.publicContent.offers });
      toast.success(saved.status === 'ACTIVE' ? 'Offer activated.' : 'Offer switched off.');
    },
    onError: (error) => {
      const problem = ApiError.from(error);
      toast.error(problem.message, { description: problem.correlationId ? `Support reference: ${problem.correlationId}` : undefined });
    },
  });
  const active = offer.status === 'ACTIVE';
  return (
    <tr className={tableStyles.tr}>
      <td className={tdClass}>
        <span className="block font-medium text-slate-900">{offer.title}</span>
        <span className="block text-xs text-slate-500">
          {APPLIES_TO_LABELS[offer.appliesTo] ?? offer.appliesTo}{offer.destinationCity ? ` · ${offer.destinationCity}` : ''}
          {' · '}{THEME_LABELS[offer.theme] ?? offer.theme} theme{offer.seasonal ? ' · seasonal' : ''}
        </span>
        {offer.demo && <Badge className="mt-1">Demo</Badge>}
      </td>
      <td className={tdClass}>
        <span className="block font-mono font-semibold text-slate-900">{offer.couponCode ?? '—'}</span>
        {offer.discountLabel && <span className="block text-xs text-slate-500">{offer.discountLabel}</span>}
        {offer.couponStatus === 'INACTIVE' && <Badge tone="warning" className="mt-1">Coupon inactive</Badge>}
      </td>
      <td className={`${tdClass} whitespace-nowrap text-slate-700`}>{validity(offer.validFrom, offer.validTo)}</td>
      <td className={tdClass}>
        <span className="flex flex-col items-start gap-1">
          <Badge tone={active ? 'success' : 'neutral'}>{active ? 'Active' : 'Inactive'}</Badge>
          {offer.live ? <Badge tone="info">On the site now</Badge> : <span className="text-xs text-slate-500">Not shown now</span>}
        </span>
      </td>
      <td className={`${tdClass} whitespace-nowrap`}>
        <span className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onEdit} aria-label={`Change ${offer.title}`}>Change</Button>
          <Button size="sm" variant={active ? 'secondary' : 'primary'} loading={toggle.isPending} onClick={() => toggle.mutate(active ? 'INACTIVE' : 'ACTIVE')}
            aria-label={`${active ? 'Deactivate' : 'Activate'} ${offer.title}`}>
            {active ? 'Deactivate' : 'Activate'}
          </Button>
        </span>
      </td>
    </tr>
  );
}

/** The coupon picker lists active coupons (and keeps the offer's current coupon even when it was switched off). */
function OfferEditor({ offer, onDone }: { offer?: AdminOffer; onDone: () => void }) {
  const queryClient = useQueryClient();
  const coupons = useQuery({
    queryKey: queryKeys.admin.couponList({ q: '', status: 'ACTIVE', page: 0, size: 100 }),
    queryFn: () => couponApi.list({ q: '', status: 'ACTIVE', page: 0 }, 100),
  });
  const { register, handleSubmit, control, setError, formState: { errors } } = useForm<OfferForm>({
    resolver: zodResolver(offerSchema),
    defaultValues: offerFormDefaults(offer),
  });
  const [validFrom, validTo] = useWatch({ control, name: ['validFrom', 'validTo'] });
  const save = useMutation({
    mutationFn: (form: OfferForm) => (offer ? offerApi.update(offer.id, toOfferBody(form, offer.version)) : offerApi.create(toOfferBody(form))),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.offers });
      void queryClient.invalidateQueries({ queryKey: queryKeys.publicContent.offers });
      toast.success(offer ? 'Offer saved.' : 'Offer created.');
      onDone();
    },
    onError: (error) => {
      const problem = ApiError.from(error);
      const field = fieldOfProblem(problem.code, problem.details);
      if (field && FORM_FIELDS.includes(field as FieldPath<OfferForm>)) {
        setError(field as FieldPath<OfferForm>, { type: 'server', message: problem.message }, { shouldFocus: true });
      } else {
        applyServerErrors(error, setError, FORM_FIELDS);
      }
    },
  });
  const problem = save.error ? ApiError.from(save.error) : null;
  const shownOnField = problem && (fieldOfProblem(problem.code, problem.details) !== null || problem.fieldErrors.length > 0);
  const options = coupons.data?.content ?? [];
  const keepCurrent = offer && !options.some((coupon) => coupon.id === offer.couponId);

  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit((form) => save.mutate(form))(event)}>
      <TextField label="Title" maxLength={80} error={errors.title?.message} {...register('title')} />
      <TextAreaField label="Description" optional rows={2} maxLength={300} error={errors.description?.message} {...register('description')} />
      <SelectField label="Coupon" error={errors.couponId?.message}
        hint={coupons.isPending ? 'Loading coupons…' : coupons.isError ? 'The coupons could not be loaded.' : 'Customers use this code to get the deal.'}
        {...register('couponId')}>
        <option value="">Choose a coupon</option>
        {keepCurrent && <option value={offer.couponId}>{offer.couponCode ?? 'Current coupon'} (inactive)</option>}
        {options.map((coupon) => <option key={coupon.id} value={coupon.id}>{coupon.code} · {discountLabel(coupon)}</option>)}
      </SelectField>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Applies to" {...register('appliesTo')}>
          {Object.entries(APPLIES_TO_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectField>
        <TextField label="Destination city" optional error={errors.destinationCity?.message} {...register('destinationCity')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller control={control} name="validFrom" render={({ field }) => (
          <DateField label="Valid from" hint="From the start of this day (India time)." error={errors.validFrom?.message} rangeEnd={validTo} {...field} />
        )} />
        <Controller control={control} name="validTo" render={({ field }) => (
          <DateField label="Valid until" hint="Until the end of this day (India time)." error={errors.validTo?.message} rangeStart={validFrom} {...field} />
        )} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Theme" {...register('theme')}>
          {Object.entries(THEME_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectField>
        <SelectField label="Status" {...register('status')}>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </SelectField>
      </div>
      <CheckboxField label="Seasonal offer (shown with a season label)" {...register('seasonal')} />
      {problem && problem.code === 'CONCURRENT_MODIFICATION' && (
        <ProblemAlert error={save.error} title="Someone else changed this offer. Close this window and open it again to see their change." />
      )}
      {problem && problem.code !== 'CONCURRENT_MODIFICATION' && !shownOnField && <ProblemAlert error={save.error} title="The offer was not saved" />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={save.isPending}>{offer ? 'Save changes' : 'Create offer'}</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
