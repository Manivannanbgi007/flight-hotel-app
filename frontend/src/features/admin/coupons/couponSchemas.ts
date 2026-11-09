import { z } from 'zod';

import { formatDate, formatMoney } from '@/lib/format';
import { indiaDate, indiaEndOfDay, indiaStartOfDay, isIsoDate } from '../shared/searchState';
import type { AdminCoupon, AdminOffer, AppliesTo, CouponBody, OfferBody, OfferTheme } from './couponApi';

/**
 * Coupon and offer forms. The rules mirror booking-service (API_DOCUMENTATION.md §14.2); the server checks again.
 * Dates are India days on screen: valid from the start of the first day until the end of the last day.
 */

export const APPLIES_TO_LABELS: Record<AppliesTo, string> = { ALL: 'Flights and hotels', FLIGHT: 'Flights', HOTEL: 'Hotels' };
export const THEME_LABELS: Record<OfferTheme, string> = { OCEAN: 'Ocean', SUNSET: 'Sunset', FOREST: 'Forest', CITY: 'City' };

const money = /^\d+(\.\d{1,2})?$/;
const whole = /^\d+$/;
const optionalAmount = (label: string) =>
  z.string().trim().refine((value) => value === '' || money.test(value), `${label}: enter an amount in rupees`);
const optionalWhole = (label: string, max: number) =>
  z.string().trim().refine(
    (value) => value === '' || (whole.test(value) && Number(value) >= 1 && Number(value) <= max),
    `${label}: enter a whole number from 1 to ${max.toLocaleString('en-IN')}`,
  );
const date = (label: string) => z.string().refine(isIsoDate, `Choose the ${label}`);

export const COUPON_TITLE_MAX = 100;
export const COUPON_DESCRIPTION_MAX = 500;
export const USAGE_LIMIT_MAX = 1_000_000;
export const PER_CUSTOMER_MAX = 100;

/** `usedCount` of the coupon being changed: the usage limit cannot go below it (`422 USAGE_LIMIT_TOO_LOW`). */
export const couponSchema = (usedCount = 0) =>
  z
    .object({
      code: z.string().trim().min(3, 'Use 3 to 30 characters').max(30, 'Use 3 to 30 characters')
        .regex(/^[A-Za-z0-9-]+$/, 'Use letters, digits and - only'),
      title: z.string().trim().min(3, 'Use at least 3 characters').max(COUPON_TITLE_MAX, `Use at most ${COUPON_TITLE_MAX} characters`),
      description: z.string().trim().max(COUPON_DESCRIPTION_MAX, `Use at most ${COUPON_DESCRIPTION_MAX} characters`),
      discountType: z.enum(['PERCENT', 'FIXED']),
      discountValue: z.string().trim().min(1, 'Enter the discount').refine((value) => money.test(value) && Number(value) > 0, 'Enter a number above 0'),
      maxDiscount: optionalAmount('Maximum discount'),
      minBookingAmount: optionalAmount('Minimum booking amount'),
      appliesTo: z.enum(['ALL', 'FLIGHT', 'HOTEL']),
      destinationCity: z.string().trim().max(100, 'Use at most 100 characters'),
      validFrom: date('start date'),
      validTo: date('end date'),
      usageLimit: optionalWhole('Usage limit', USAGE_LIMIT_MAX),
      perCustomerLimit: optionalWhole('Uses per customer', PER_CUSTOMER_MAX),
      status: z.enum(['ACTIVE', 'INACTIVE']),
    })
    .superRefine((form, ctx) => {
      if (form.discountType === 'PERCENT' && money.test(form.discountValue) && Number(form.discountValue) > 100) {
        ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'A percentage can be at most 100' });
      }
      if (isIsoDate(form.validFrom) && isIsoDate(form.validTo) && form.validTo < form.validFrom) {
        ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'The end date cannot be before the start date' });
      }
      if (form.usageLimit !== '' && whole.test(form.usageLimit) && Number(form.usageLimit) < usedCount) {
        ctx.addIssue({ code: 'custom', path: ['usageLimit'], message: `Already used ${usedCount} times: the limit cannot be lower` });
      }
    });
export type CouponForm = z.infer<ReturnType<typeof couponSchema>>;

const orNull = (value: string) => (value.trim() === '' ? null : value.trim());
const numberOrNull = (value: string) => (value.trim() === '' ? null : Number(value));

export function couponFormDefaults(coupon?: AdminCoupon): CouponForm {
  return {
    code: coupon?.code ?? '',
    title: coupon?.title ?? '',
    description: coupon?.description ?? '',
    discountType: coupon?.discountType ?? 'PERCENT',
    discountValue: coupon ? String(coupon.discountValue) : '',
    maxDiscount: coupon?.maxDiscount != null ? String(coupon.maxDiscount) : '',
    minBookingAmount: coupon?.minBookingAmount ? String(coupon.minBookingAmount) : '',
    appliesTo: coupon?.appliesTo ?? 'ALL',
    destinationCity: coupon?.destinationCity ?? '',
    validFrom: indiaDate(coupon?.validFrom),
    validTo: indiaDate(coupon?.validTo),
    usageLimit: coupon?.usageLimit != null ? String(coupon.usageLimit) : '',
    perCustomerLimit: coupon?.perCustomerLimit != null ? String(coupon.perCustomerLimit) : '1',
    status: coupon?.status ?? 'ACTIVE',
  };
}

/**
 * The request body. Creating sends the code and the status; changing sends `version` instead (the code cannot
 * change, and the status has its own Activate / Deactivate action).
 */
export function toCouponBody(form: CouponForm, version?: number): CouponBody {
  const creating = version === undefined;
  return {
    ...(creating ? { code: form.code.trim().toUpperCase(), status: form.status } : { version }),
    title: form.title.trim(),
    description: orNull(form.description),
    discountType: form.discountType,
    discountValue: Number(form.discountValue),
    maxDiscount: form.discountType === 'PERCENT' ? numberOrNull(form.maxDiscount) : null,
    minBookingAmount: numberOrNull(form.minBookingAmount) ?? 0,
    appliesTo: form.appliesTo,
    destinationCity: orNull(form.destinationCity),
    validFrom: indiaStartOfDay(form.validFrom),
    validTo: indiaEndOfDay(form.validTo),
    usageLimit: numberOrNull(form.usageLimit),
    ...(form.perCustomerLimit.trim() ? { perCustomerLimit: Number(form.perCustomerLimit) } : {}),
  };
}

/** "10% off, up to ₹1,500" / "₹500 off" (+ minimum booking). */
export function discountLabel(coupon: Pick<AdminCoupon, 'discountType' | 'discountValue' | 'maxDiscount' | 'minBookingAmount'>): string {
  const base = coupon.discountType === 'PERCENT'
    ? `${coupon.discountValue}% off${coupon.maxDiscount ? `, up to ${formatMoney(coupon.maxDiscount)}` : ''}`
    : `${formatMoney(coupon.discountValue)} off`;
  return coupon.minBookingAmount ? `${base} (bookings from ${formatMoney(coupon.minBookingAmount)})` : base;
}

export const offerSchema = z
  .object({
    title: z.string().trim().min(3, 'Use 3 to 80 characters').max(80, 'Use 3 to 80 characters'),
    description: z.string().trim().max(300, 'Use at most 300 characters'),
    couponId: z.string().min(1, 'Choose the coupon customers use'),
    appliesTo: z.enum(['ALL', 'FLIGHT', 'HOTEL']),
    destinationCity: z.string().trim().max(100, 'Use at most 100 characters'),
    validFrom: date('start date'),
    validTo: date('end date'),
    seasonal: z.boolean(),
    theme: z.enum(['OCEAN', 'SUNSET', 'FOREST', 'CITY']),
    status: z.enum(['ACTIVE', 'INACTIVE']),
  })
  .superRefine((form, ctx) => {
    if (isIsoDate(form.validFrom) && isIsoDate(form.validTo) && form.validTo < form.validFrom) {
      ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'The end date cannot be before the start date' });
    }
  });
export type OfferForm = z.infer<typeof offerSchema>;

export function offerFormDefaults(offer?: AdminOffer): OfferForm {
  return {
    title: offer?.title ?? '',
    description: offer?.description ?? '',
    couponId: offer?.couponId ?? '',
    appliesTo: offer?.appliesTo ?? 'ALL',
    destinationCity: offer?.destinationCity ?? '',
    validFrom: indiaDate(offer?.validFrom),
    validTo: indiaDate(offer?.validTo),
    seasonal: offer?.seasonal ?? false,
    theme: offer?.theme ?? 'OCEAN',
    status: offer?.status ?? 'ACTIVE',
  };
}

export function toOfferBody(form: OfferForm, version?: number): OfferBody {
  return {
    title: form.title.trim(),
    description: orNull(form.description),
    couponId: form.couponId,
    appliesTo: form.appliesTo,
    destinationCity: orNull(form.destinationCity),
    validFrom: indiaStartOfDay(form.validFrom),
    validTo: indiaEndOfDay(form.validTo),
    seasonal: form.seasonal,
    theme: form.theme,
    status: form.status,
    ...(version !== undefined ? { version } : {}),
  };
}

/** Server errors that belong to one field (`422 INVALID_VALUE` with `details.field`, duplicate code, limit too low). */
export function fieldOfProblem(code: string, details: Record<string, unknown>): string | null {
  if (code === 'COUPON_CODE_TAKEN' || code === 'COUPON_CODE_CANNOT_CHANGE') return 'code';
  if (code === 'USAGE_LIMIT_TOO_LOW') return 'usageLimit';
  if (code === 'INVALID_VALUE' && typeof details.field === 'string') return details.field;
  return null;
}

/** "1 Dec 2026 – 31 Jan 2027" in India days. */
export function validity(from: string, to: string): string {
  return `${formatDate(indiaDate(from))} – ${formatDate(indiaDate(to))}`;
}
