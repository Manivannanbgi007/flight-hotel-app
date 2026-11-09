import { apiClient } from '@/lib/api/client';

export type OfferTheme = 'OCEAN' | 'SUNSET' | 'FOREST' | 'CITY';

/**
 * A current offer (`GET /api/offers`, public, API_DOCUMENTATION.md §14.2): only offers whose coupon can be used right
 * now, newest first.
 */
export interface Offer {
  id: string;
  title: string;
  description: string | null;
  couponCode: string;
  /** "10% off, up to ₹1,500" or "₹500 off". */
  discountLabel: string;
  /** 0 = no minimum. */
  minBookingAmount?: number | null;
  appliesTo: 'ALL' | 'FLIGHT' | 'HOTEL';
  destinationCity: string | null;
  /** Last moment the coupon works (ISO instant). */
  validTo: string;
  seasonal: boolean;
  theme: OfferTheme;
  demo?: boolean;
}

/** Offers change rarely: the list is kept for 5 minutes (offers page and home page). */
export const OFFERS_STALE_MS = 5 * 60_000;

export const offerApi = {
  async list(): Promise<Offer[]> {
    const { data } = await apiClient.get<Offer[]>('/offers');
    return Array.isArray(data) ? data : [];
  },
};
