import { apiClient } from '@/lib/api/client';
import type { Page } from '@/lib/api/types';

/** `/api/admin/coupons` and `/api/admin/offers` (API_DOCUMENTATION.md §14.2, permission COUPON_MANAGE). */

export type DiscountType = 'PERCENT' | 'FIXED';
export type AppliesTo = 'ALL' | 'FLIGHT' | 'HOTEL';
export type ActiveStatus = 'ACTIVE' | 'INACTIVE';
export type OfferTheme = 'OCEAN' | 'SUNSET' | 'FOREST' | 'CITY';

export interface AdminCoupon {
  id: string;
  code: string;
  title: string;
  description: string | null;
  discountType: DiscountType;
  /** Percent (1–100) or rupees. */
  discountValue: number;
  maxDiscount: number | null;
  minBookingAmount: number | null;
  appliesTo: AppliesTo;
  destinationCity: string | null;
  /** ISO-8601 instants. */
  validFrom: string;
  validTo: string;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  /** reserved (bookings waiting for payment) + consumed (paid bookings). */
  usedCount: number;
  reservedCount: number;
  consumedCount: number;
  status: ActiveStatus;
  expired: boolean;
  demo: boolean;
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

/** POST / PUT body. `code` only when creating (`422 COUPON_CODE_CANNOT_CHANGE`); `version` only when changing. */
export interface CouponBody {
  code?: string;
  title: string;
  description: string | null;
  discountType: DiscountType;
  discountValue: number;
  /** Only used for PERCENT. */
  maxDiscount: number | null;
  /** Default 0. */
  minBookingAmount: number | null;
  appliesTo: AppliesTo;
  destinationCity: string | null;
  /** ISO-8601 instants (validTo after validFrom). */
  validFrom: string;
  validTo: string;
  /** 1 – 1,000,000; none = unlimited. */
  usageLimit: number | null;
  /** 1 – 100; default 1. */
  perCustomerLimit?: number;
  status?: ActiveStatus;
  /** `409 CONCURRENT_MODIFICATION` when someone else saved first. */
  version?: number;
}

export interface AdminOffer {
  id: string;
  title: string;
  description: string | null;
  couponId: string;
  couponCode: string | null;
  couponStatus: ActiveStatus | null;
  /** "10% off, up to ₹1,500" */
  discountLabel: string | null;
  appliesTo: AppliesTo;
  destinationCity: string | null;
  /** ISO-8601 instants. */
  validFrom: string;
  validTo: string;
  seasonal: boolean;
  theme: OfferTheme;
  status: ActiveStatus;
  /** Shown on the public Offers page right now (active offer, active and unexpired coupon, inside the dates). */
  live: boolean;
  demo: boolean;
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface OfferBody {
  title: string;
  description: string | null;
  couponId: string;
  appliesTo: AppliesTo;
  destinationCity: string | null;
  validFrom: string;
  validTo: string;
  seasonal: boolean;
  theme: OfferTheme;
  status: ActiveStatus;
  version?: number;
}

export type CouponFilters = { q: string; status: ActiveStatus | ''; page: number };
export type OfferFilters = { q: string; status: ActiveStatus | ''; page: number };

const couponPath = (id: string) => `/admin/coupons/${encodeURIComponent(id)}`;
const offerPath = (id: string) => `/admin/offers/${encodeURIComponent(id)}`;

export const couponApi = {
  async list(filters: CouponFilters, size = 20): Promise<Page<AdminCoupon>> {
    const { data } = await apiClient.get<Page<AdminCoupon>>('/admin/coupons', {
      params: { q: filters.q || undefined, status: filters.status || undefined, page: filters.page, size },
    });
    return data;
  },
  /** `409 COUPON_CODE_TAKEN`. */
  async create(body: CouponBody): Promise<AdminCoupon> {
    const { data } = await apiClient.post<AdminCoupon>('/admin/coupons', body);
    return data;
  },
  /** The code cannot change; the usage limit cannot go below what is already used (`422 USAGE_LIMIT_TOO_LOW`). */
  async update(id: string, body: CouponBody): Promise<AdminCoupon> {
    const { data } = await apiClient.put<AdminCoupon>(couponPath(id), body);
    return data;
  },
  async setStatus(id: string, status: ActiveStatus): Promise<AdminCoupon> {
    const { data } = await apiClient.patch<AdminCoupon>(`${couponPath(id)}/status`, { status });
    return data;
  },
};

export const offerApi = {
  async list(filters: OfferFilters, size = 20): Promise<Page<AdminOffer>> {
    const { data } = await apiClient.get<Page<AdminOffer>>('/admin/offers', {
      params: { q: filters.q || undefined, status: filters.status || undefined, page: filters.page, size },
    });
    return data;
  },
  async create(body: OfferBody): Promise<AdminOffer> {
    const { data } = await apiClient.post<AdminOffer>('/admin/offers', body);
    return data;
  },
  async update(id: string, body: OfferBody): Promise<AdminOffer> {
    const { data } = await apiClient.put<AdminOffer>(offerPath(id), body);
    return data;
  },
  async setStatus(id: string, status: ActiveStatus): Promise<AdminOffer> {
    const { data } = await apiClient.patch<AdminOffer>(`${offerPath(id)}/status`, { status });
    return data;
  },
};
