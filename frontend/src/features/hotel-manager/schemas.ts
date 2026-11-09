import { z } from 'zod';

import type { PropertyType } from '@/features/hotels/types';
import type {
  HotelProfile,
  PolicyType,
  RatePlanItem,
  RatePlanRequest,
  RoomTypeItem,
  RoomTypeRequest,
  SalesStatus,
  UpdateHotelProfileRequest,
} from './types';

/**
 * Manager forms keep numbers as text (an empty optional field is "not set", never NaN) and convert on submit.
 * The rules mirror hotel-service's ManagerDtos.
 */
const optionalNumber = (min: number, max: number, message: string) =>
  z.string().trim().refine((v) => v === '' || (Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max), { message });
const requiredNumber = (min: number, max: number, message: string) =>
  z.string().trim().min(1, 'Required').refine((v) => Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max, { message });
const integer = (v: string) => v === '' || Number.isInteger(Number(v));
const toNumber = (v: string) => (v.trim() === '' ? undefined : Number(v));
const money = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());

// ------------------------------------------------------------------ hotel profile

export const profileSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter the hotel name').max(150),
    description: z.string().max(5000, 'At most 5000 characters'),
    propertyType: z.enum(['HOTEL', 'RESORT', 'APARTMENT', 'VILLA', 'HOSTEL', 'GUEST_HOUSE']),
    starRating: z.string(),
    addressLine: z.string().trim().min(1, 'Enter the street address').max(255),
    city: z.string().trim().min(1, 'Enter the city').max(100),
    state: z.string().max(100),
    countryCode: z.string().regex(/^[A-Z]{2}$/, 'Choose a country'),
    postalCode: z.string().max(20),
    latitude: optionalNumber(-90, 90, 'Latitude is between -90 and 90'),
    longitude: optionalNumber(-180, 180, 'Longitude is between -180 and 180'),
    checkInTime: z.string().regex(/^\d{2}:\d{2}/, 'Choose a time'),
    checkOutTime: z.string().regex(/^\d{2}:\d{2}/, 'Choose a time'),
    contactEmail: z.string().trim().refine((v) => v === '' || z.email().safeParse(v).success, { message: 'Enter a valid email' }),
    contactPhone: z.string().trim().refine((v) => v === '' || /^\+?[0-9]{7,15}$/.test(v.replace(/[\s-]/g, '')), {
      message: 'Enter 7–15 digits, optionally starting with +',
    }),
    amenities: z.array(z.string()),
    policies: z.array(z.object({
      type: z.enum(['CHILDREN', 'PETS', 'SMOKING', 'ID_REQUIRED', 'PAYMENT', 'OTHER']),
      description: z.string().trim().min(1, 'Describe the rule').max(1000),
    })).max(20, 'At most 20 rules'),
  })
  .superRefine((form, ctx) => {
    if ((form.latitude.trim() === '') !== (form.longitude.trim() === '')) {
      ctx.addIssue({ code: 'custom', path: [form.latitude.trim() === '' ? 'latitude' : 'longitude'],
        message: 'Give both latitude and longitude, or neither' });
    }
  });
export type ProfileForm = z.infer<typeof profileSchema>;

export function profileToForm(profile: HotelProfile): ProfileForm {
  return {
    name: profile.name,
    description: profile.description ?? '',
    propertyType: profile.propertyType,
    starRating: profile.starRating ? String(profile.starRating) : '',
    addressLine: profile.addressLine,
    city: profile.city,
    state: profile.state ?? '',
    countryCode: profile.countryCode,
    postalCode: profile.postalCode ?? '',
    latitude: profile.latitude === null ? '' : String(profile.latitude),
    longitude: profile.longitude === null ? '' : String(profile.longitude),
    checkInTime: profile.checkInTime.slice(0, 5),
    checkOutTime: profile.checkOutTime.slice(0, 5),
    contactEmail: profile.contactEmail ?? '',
    contactPhone: profile.contactPhone ?? '',
    amenities: profile.amenities,
    policies: profile.policies,
  };
}

export function formToProfileRequest(form: ProfileForm, version: number): UpdateHotelProfileRequest {
  const blank = (v: string) => (v.trim() === '' ? undefined : v.trim());
  return {
    name: form.name.trim(),
    description: blank(form.description),
    propertyType: form.propertyType as PropertyType,
    starRating: toNumber(form.starRating),
    addressLine: form.addressLine.trim(),
    city: form.city.trim(),
    state: blank(form.state),
    countryCode: form.countryCode,
    postalCode: blank(form.postalCode),
    latitude: toNumber(form.latitude),
    longitude: toNumber(form.longitude),
    checkInTime: form.checkInTime.slice(0, 5),
    checkOutTime: form.checkOutTime.slice(0, 5),
    contactEmail: blank(form.contactEmail),
    contactPhone: blank(form.contactPhone)?.replace(/[\s-]/g, ''),
    amenities: form.amenities,
    policies: form.policies.map((p) => ({ type: p.type as PolicyType, description: p.description.trim() })),
    version,
  };
}

// ------------------------------------------------------------------ room types

export const roomTypeSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(100),
  description: z.string().max(2000),
  maxAdults: requiredNumber(1, 10, 'Between 1 and 10').refine(integer, 'Whole number'),
  maxChildren: requiredNumber(0, 10, 'Between 0 and 10').refine(integer, 'Whole number'),
  bedConfiguration: z.string().trim().min(1, 'Describe the beds, e.g. 1 King bed').max(100),
  sizeSqm: optionalNumber(1, 10000, 'Between 1 and 10000 m²').refine(integer, 'Whole number'),
  totalRooms: requiredNumber(0, 5000, 'Between 0 and 5000').refine(integer, 'Whole number'),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  amenities: z.array(z.string()),
});
export type RoomTypeForm = z.infer<typeof roomTypeSchema>;

export function roomTypeToForm(room?: RoomTypeItem): RoomTypeForm {
  return {
    name: room?.name ?? '',
    description: room?.description ?? '',
    maxAdults: String(room?.maxAdults ?? 2),
    maxChildren: String(room?.maxChildren ?? 1),
    bedConfiguration: room?.bedConfiguration ?? '',
    sizeSqm: room?.sizeSqm ? String(room.sizeSqm) : '',
    totalRooms: String(room?.totalRooms ?? 10),
    status: room?.status ?? 'ACTIVE',
    amenities: room?.amenities ?? [],
  };
}

export function formToRoomTypeRequest(form: RoomTypeForm, room?: RoomTypeItem): RoomTypeRequest {
  return {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    maxAdults: Number(form.maxAdults),
    maxChildren: Number(form.maxChildren),
    bedConfiguration: form.bedConfiguration.trim(),
    sizeSqm: toNumber(form.sizeSqm),
    totalRooms: Number(form.totalRooms),
    status: form.status as SalesStatus,
    sortOrder: room?.sortOrder ?? 0,
    amenities: form.amenities,
    version: room?.version,
  };
}

// ------------------------------------------------------------------ rate plans

export const ratePlanSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name, e.g. Room only').max(100),
    basePricePerNight: z.string().trim().refine((v) => money(v) && Number(v) >= 1, { message: 'Enter a price, e.g. 4500 or 4500.50' }),
    breakfastIncluded: z.boolean(),
    refundable: z.boolean(),
    freeCancellationHours: optionalNumber(0, 720, 'Between 0 and 720 hours').refine(integer, 'Whole hours'),
    cancellationFeePercent: optionalNumber(0, 100, 'Between 0 and 100 %'),
    status: z.enum(['ACTIVE', 'INACTIVE']),
  })
  .superRefine((form, ctx) => {
    if (form.refundable && form.freeCancellationHours.trim() === '' && form.cancellationFeePercent.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['freeCancellationHours'],
        message: 'Give a free-cancellation period or a cancellation fee' });
    }
  });
export type RatePlanForm = z.infer<typeof ratePlanSchema>;

export function ratePlanToForm(plan?: RatePlanItem): RatePlanForm {
  return {
    name: plan?.name ?? '',
    basePricePerNight: plan ? String(plan.basePricePerNight) : '',
    breakfastIncluded: plan?.breakfastIncluded ?? false,
    refundable: plan?.refundable ?? true,
    freeCancellationHours: plan?.freeCancellationHours != null ? String(plan.freeCancellationHours) : plan ? '' : '48',
    cancellationFeePercent: plan && plan.refundable ? String(plan.cancellationFeePercent) : '100',
    status: plan?.status ?? 'ACTIVE',
  };
}

export function formToRatePlanRequest(form: RatePlanForm, plan?: RatePlanItem): RatePlanRequest {
  return {
    name: form.name.trim(),
    basePricePerNight: Number(form.basePricePerNight),
    breakfastIncluded: form.breakfastIncluded,
    refundable: form.refundable,
    freeCancellationHours: form.refundable ? toNumber(form.freeCancellationHours) : undefined,
    cancellationFeePercent: form.refundable ? toNumber(form.cancellationFeePercent) : undefined,
    status: form.status as SalesStatus,
    version: plan?.version,
  };
}

// ------------------------------------------------------------------ seasonal prices and inventory

export const seasonalRateSchema = z
  .object({
    label: z.string().trim().min(1, 'Name the season, e.g. Diwali week').max(80),
    startDate: z.string().min(1, 'Choose the first night'),
    endDate: z.string().min(1, 'Choose the last night'),
    pricePerNight: z.string().trim().refine((v) => money(v) && Number(v) >= 1, { message: 'Enter a price' }),
    priority: requiredNumber(0, 100, 'Between 0 and 100').refine(integer, 'Whole number'),
  })
  .superRefine((form, ctx) => {
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'The last night must be on or after the first' });
    }
  });
export type SeasonalRateForm = z.infer<typeof seasonalRateSchema>;

export const inventoryUpdateSchema = z
  .object({
    roomTypeId: z.string().min(1, 'Choose a room type'),
    from: z.string().min(1, 'Choose the first night'),
    to: z.string().min(1, 'Choose the last night'),
    totalRooms: optionalNumber(0, 5000, 'Between 0 and 5000').refine(integer, 'Whole number'),
    stopSell: z.enum(['unchanged', 'on', 'off']),
  })
  .superRefine((form, ctx) => {
    if (form.from && form.to && form.to < form.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'The last night must be on or after the first' });
    }
    if (form.totalRooms.trim() === '' && form.stopSell === 'unchanged') {
      ctx.addIssue({ code: 'custom', path: ['totalRooms'], message: 'Change the number of rooms and/or stop-sell' });
    }
  });
export type InventoryUpdateForm = z.infer<typeof inventoryUpdateSchema>;

// ------------------------------------------------------------------ reservations (Phase 9)

export const HOTEL_CANCEL_REASON_MAX = 300;

/** The hotel cancels a confirmed stay: a reason of 5 to 300 characters (API_DOCUMENTATION.md §14.5). */
export const hotelCancelSchema = z.object({
  reason: z.string().trim().min(5, 'Write at least 5 characters').max(HOTEL_CANCEL_REASON_MAX, 'Use at most 300 characters'),
});
export type HotelCancelForm = z.infer<typeof hotelCancelSchema>;
