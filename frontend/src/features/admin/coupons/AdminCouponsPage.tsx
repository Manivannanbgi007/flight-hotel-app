import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm, useWatch, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { BadgePercent, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { ExportMenu } from '@/components/export/ExportMenu';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { tableStyles } from '@/components/ui/dataTableStyles';
import { DateField } from '@/components/ui/DateField';
import { Dialog } from '@/components/ui/Dialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
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
import { couponApi, type ActiveStatus, type AdminCoupon, type CouponFilters } from './couponApi';
import {
  APPLIES_TO_LABELS, COUPON_DESCRIPTION_MAX, COUPON_TITLE_MAX, couponFormDefaults, couponSchema, discountLabel, fieldOfProblem,
  toCouponBody, validity, type CouponForm,
} from './couponSchemas';

const STATUSES = ['ACTIVE', 'INACTIVE'] as const;
const FORM_FIELDS: FieldPath<CouponForm>[] = [
  'code', 'title', 'description', 'discountType', 'discountValue', 'maxDiscount', 'minBookingAmount', 'appliesTo',
  'destinationCity', 'validFrom', 'validTo', 'usageLimit', 'perCustomerLimit', 'status',
];

const activeLabel = (status: ActiveStatus) => (status === 'ACTIVE' ? 'Active' : 'Inactive');

/** The columns of an export (CSV, Excel, PDF): what the table shows, one fact per column. Dates are India days. */
const EXPORT_COLUMNS: ExportColumn<AdminCoupon>[] = [
  { header: 'Code', value: (coupon) => coupon.code },
  { header: 'Title', value: (coupon) => coupon.title },
  { header: 'Demo', value: (coupon) => coupon.demo },
  { header: 'Discount', value: (coupon) => discountLabel(coupon) },
  { header: 'Applies to', value: (coupon) => APPLIES_TO_LABELS[coupon.appliesTo] ?? coupon.appliesTo },
  { header: 'Destination', value: (coupon) => coupon.destinationCity },
  { header: 'Valid from', value: (coupon) => indiaDate(coupon.validFrom), type: 'date' },
  { header: 'Valid to', value: (coupon) => indiaDate(coupon.validTo), type: 'date' },
  { header: 'Expired', value: (coupon) => coupon.expired },
  { header: 'Used', value: (coupon) => coupon.usedCount, type: 'integer' },
  { header: 'Usage limit', value: (coupon) => coupon.usageLimit, type: 'integer' },
  { header: 'Paid', value: (coupon) => coupon.consumedCount, type: 'integer' },
  { header: 'Reserved', value: (coupon) => coupon.reservedCount, type: 'integer' },
  { header: 'Per customer', value: (coupon) => coupon.perCustomerLimit, type: 'integer' },
  { header: 'Status', value: (coupon) => activeLabel(coupon.status) },
];

/** /admin/coupons — coupons with their usage; create, change, activate and deactivate them. */
export function AdminCouponsPage() {
  return (
    <RequirePermission permission="COUPON_MANAGE">
      <Coupons />
    </RequirePermission>
  );
}

function Coupons() {
  const { params, update } = useSearchState();
  const [editing, setEditing] = useState<AdminCoupon | 'new' | null>(null);
  const filters: CouponFilters = { q: params.get('q')?.trim() ?? '', status: readEnum(params, 'status', STATUSES), page: readPage(params) };
  const size = readPageSize(params, PAGE_SIZES, 25);
  const coupons = useQuery({
    queryKey: [...queryKeys.admin.couponList(filters), size],
    queryFn: () => couponApi.list(filters, size),
    placeholderData: keepPreviousData,
  });
  const data = coupons.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader icon={<BadgePercent className="size-5" />}
        title="Coupons"
        description="Discount codes customers enter when booking. Usage counts bookings waiting for payment (reserved) and paid ones."
        actions={<Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden="true" /> New coupon</Button>}
      />
      <FilterCard>
        <SearchBox key={filters.q} initial={filters.q} label="Search" placeholder="Code or title" onSearch={(q) => update({ q })} />
        <div className="sm:w-56">
          <SelectField label="Status" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </SelectField>
        </div>
      </FilterCard>

      {coupons.isPending && <ListLoading label="Loading coupons…" />}
      {coupons.isError && <LoadError error={coupons.error} onRetry={() => void coupons.refetch()} />}
      {data && data.content.length === 0 && <EmptyState title="No coupons found" />}
      {data && data.content.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <ResultCount count={data.totalElements} noun={['coupon', 'coupons']} />
            <ExportMenu
              className="ml-auto"
              title="Coupons"
              subtitle="Admin portal"
              fileName="coupons"
              columns={EXPORT_COLUMNS}
              rows={data.content}
              total={data.totalElements}
              pageLabel={`Page ${data.page + 1} of ${Math.max(data.totalPages, 1)}`}
              fetchPage={(page, pageSize) => couponApi.list({ ...filters, page }, pageSize)}
              rowKey={(coupon) => coupon.id}
              filters={describeFilters([['Search', filters.q], ['Status', filters.status && activeLabel(filters.status)]])}
            />
          </div>
          <TableShell caption="Coupons">
            <thead>
              <tr>
                <th scope="col" className={tableStyles.th}>Code</th>
                <th scope="col" className={tableStyles.th}>Discount</th>
                <th scope="col" className={tableStyles.th}>Valid</th>
                <th scope="col" className={tableStyles.th}>Usage</th>
                <th scope="col" className={tableStyles.th}>Status</th>
                <th scope="col" className={tableStyles.th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className={tableStyles.tbody}>
              {data.content.map((coupon) => <CouponRow key={coupon.id} coupon={coupon} onEdit={() => setEditing(coupon)} />)}
            </tbody>
          </TableShell>
          <Pagination data={data} noun={['coupon', 'coupons']} pageSizes={PAGE_SIZES}
            onPageChange={(page) => update({ page: String(page) })} onPageSizeChange={(next) => update({ size: next === 25 ? null : String(next) })} />
        </>
      )}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New coupon' : `Change ${editing?.code ?? ''}`}
        className="max-w-2xl"
      >
        {editing !== null && <CouponEditor coupon={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}

function CouponRow({ coupon, onEdit }: { coupon: AdminCoupon; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (status: ActiveStatus) => couponApi.setStatus(coupon.id, status),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.coupons });
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.offers });
      toast.success(saved.status === 'ACTIVE' ? `${saved.code} is active.` : `${saved.code} is switched off.`);
    },
    onError: (error) => {
      const problem = ApiError.from(error);
      toast.error(problem.message, { description: problem.correlationId ? `Support reference: ${problem.correlationId}` : undefined });
    },
  });
  const active = coupon.status === 'ACTIVE';
  return (
    <tr className={tableStyles.tr}>
      <td className={tdClass}>
        <span className="font-mono font-semibold text-slate-900">{coupon.code}</span>
        {coupon.demo && <Badge className="ml-1">Demo</Badge>}
        <span className="block text-slate-700">{coupon.title}</span>
      </td>
      <td className={tdClass}>
        <span className="block text-slate-900">{discountLabel(coupon)}</span>
        <span className="block text-xs text-slate-500">
          {APPLIES_TO_LABELS[coupon.appliesTo] ?? coupon.appliesTo}{coupon.destinationCity ? ` · ${coupon.destinationCity}` : ''}
        </span>
      </td>
      <td className={`${tdClass} whitespace-nowrap text-slate-700`}>
        {validity(coupon.validFrom, coupon.validTo)}
        {coupon.expired && <Badge tone="warning" className="ml-1">Expired</Badge>}
      </td>
      <td className={`${tdClass} whitespace-nowrap`}>
        <span className="block font-medium text-slate-900">{coupon.usedCount.toLocaleString('en-IN')}{coupon.usageLimit ? ` of ${coupon.usageLimit.toLocaleString('en-IN')}` : ''}</span>
        <span className="block text-xs text-slate-500">{coupon.consumedCount} paid · {coupon.reservedCount} reserved</span>
        {coupon.perCustomerLimit && <span className="block text-xs text-slate-500">{coupon.perCustomerLimit} per customer</span>}
      </td>
      <td className={tdClass}><Badge tone={active ? 'success' : 'neutral'}>{active ? 'Active' : 'Inactive'}</Badge></td>
      <td className={`${tdClass} whitespace-nowrap`}>
        <span className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onEdit} aria-label={`Change ${coupon.code}`}>Change</Button>
          <Button size="sm" variant={active ? 'secondary' : 'primary'} loading={toggle.isPending} onClick={() => toggle.mutate(active ? 'INACTIVE' : 'ACTIVE')}
            aria-label={`${active ? 'Deactivate' : 'Activate'} ${coupon.code}`}>
            {active ? 'Deactivate' : 'Activate'}
          </Button>
        </span>
      </td>
    </tr>
  );
}

function CouponEditor({ coupon, onDone }: { coupon?: AdminCoupon; onDone: () => void }) {
  const queryClient = useQueryClient();
  const creating = !coupon;
  const { register, handleSubmit, control, setError, formState: { errors } } = useForm<CouponForm>({
    resolver: zodResolver(couponSchema(coupon?.usedCount ?? 0)),
    defaultValues: couponFormDefaults(coupon),
  });
  const discountType = useWatch({ control, name: 'discountType' });
  const [validFrom, validTo] = useWatch({ control, name: ['validFrom', 'validTo'] });
  const save = useMutation({
    mutationFn: (form: CouponForm) => (coupon
      ? couponApi.update(coupon.id, toCouponBody(form, coupon.version))
      : couponApi.create(toCouponBody(form))),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.coupons });
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.offers });
      toast.success(creating ? `Coupon ${saved.code} created.` : `Coupon ${saved.code} saved.`);
      onDone();
    },
    onError: (error) => {
      const problem = ApiError.from(error);
      const field = fieldOfProblem(problem.code, problem.details);
      if (field && FORM_FIELDS.includes(field as FieldPath<CouponForm>)) {
        setError(field as FieldPath<CouponForm>, { type: 'server', message: problem.message }, { shouldFocus: true });
      } else {
        applyServerErrors(error, setError, FORM_FIELDS);
      }
    },
  });
  const problem = save.error ? ApiError.from(save.error) : null;
  const shownOnField = problem && (fieldOfProblem(problem.code, problem.details) !== null || problem.fieldErrors.length > 0);

  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit((form) => save.mutate(form))(event)}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Code" disabled={!creating} hint={creating ? 'Letters, digits and -; it cannot change later.' : 'The code cannot change.'}
          className="font-mono uppercase" error={errors.code?.message} {...register('code')} />
        <TextField label="Title" maxLength={COUPON_TITLE_MAX} error={errors.title?.message} {...register('title')} />
      </div>
      <TextAreaField label="Description" optional rows={2} maxLength={COUPON_DESCRIPTION_MAX} error={errors.description?.message} {...register('description')} />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField label="Discount type" error={errors.discountType?.message} {...register('discountType')}>
          <option value="PERCENT">Percentage</option>
          <option value="FIXED">Fixed amount (₹)</option>
        </SelectField>
        <TextField label={discountType === 'PERCENT' ? 'Discount (%)' : 'Discount (₹)'} inputMode="decimal" error={errors.discountValue?.message} {...register('discountValue')} />
        {discountType === 'PERCENT' && (
          <TextField label="Maximum discount (₹)" optional inputMode="decimal" error={errors.maxDiscount?.message} {...register('maxDiscount')} />
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Minimum booking (₹)" optional inputMode="decimal" error={errors.minBookingAmount?.message} {...register('minBookingAmount')} />
        <SelectField label="Applies to" error={errors.appliesTo?.message} {...register('appliesTo')}>
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
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Usage limit" optional inputMode="numeric" hint={coupon ? `Used ${coupon.usedCount} times so far.` : 'Empty = no limit.'}
          error={errors.usageLimit?.message} {...register('usageLimit')} />
        <TextField label="Uses per customer" inputMode="numeric" error={errors.perCustomerLimit?.message} {...register('perCustomerLimit')} />
        {creating && (
          <SelectField label="Status" {...register('status')}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </SelectField>
        )}
      </div>
      {problem && problem.code === 'CONCURRENT_MODIFICATION' && (
        <ProblemAlert error={save.error} title="Someone else changed this coupon. Close this window and open it again to see their change." />
      )}
      {problem && problem.code !== 'CONCURRENT_MODIFICATION' && !shownOnField && <ProblemAlert error={save.error} title="The coupon was not saved" />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={save.isPending}>{creating ? 'Create coupon' : 'Save changes'}</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
