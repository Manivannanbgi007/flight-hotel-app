import type { PropertyType } from '@/features/hotels/types';

/** Hotel manager / admin hotel API types (API_DOCUMENTATION.md §6–7, hotel-service ManagerDtos). */

export type HotelStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE';
export type SalesStatus = 'ACTIVE' | 'INACTIVE';
export type PolicyType = 'CHILDREN' | 'PETS' | 'SMOKING' | 'ID_REQUIRED' | 'PAYMENT' | 'OTHER';

export const POLICY_TYPE_LABELS: Record<PolicyType, string> = {
  CHILDREN: 'Children',
  PETS: 'Pets',
  SMOKING: 'Smoking',
  ID_REQUIRED: 'ID at check-in',
  PAYMENT: 'Payment',
  OTHER: 'Other',
};

export const HOTEL_STATUS_LABELS: Record<HotelStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Published',
  INACTIVE: 'Unpublished',
};

export interface HotelSummary {
  id: string;
  name: string;
  slug: string;
  city: string;
  countryCode: string;
  status: HotelStatus;
  dataSource: 'INTERNAL' | 'DEMO';
  starRating: number | null;
  imageUrl: string | null;
  roomTypes: number;
  /** Rooms the hotel can sell: the active room types' rooms added up. */
  totalRooms?: number;
  managers: number;
  updatedAt: string;
}

export interface ImageItem {
  id: string;
  url: string;
  thumbUrl: string;
  caption: string | null;
  cover: boolean;
  sortOrder: number;
  roomTypeId: string | null;
  width: number;
  height: number;
}

export interface HotelProfile {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  propertyType: PropertyType;
  starRating: number | null;
  addressLine: string;
  city: string;
  state: string | null;
  countryCode: string;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  timeZone: string;
  checkInTime: string;
  checkOutTime: string;
  contactEmail: string | null;
  contactPhone: string | null;
  amenities: string[];
  policies: { type: PolicyType; description: string }[];
  status: HotelStatus;
  dataSource: 'INTERNAL' | 'DEMO';
  images: ImageItem[];
  version: number;
}

export interface UpdateHotelProfileRequest {
  name: string;
  description?: string;
  propertyType: PropertyType;
  starRating?: number;
  addressLine: string;
  city: string;
  state?: string;
  countryCode: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  checkInTime: string;
  checkOutTime: string;
  contactEmail?: string;
  contactPhone?: string;
  amenities: string[];
  policies: { type: PolicyType; description: string }[];
  version: number;
}

export interface SeasonalRateItem {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  pricePerNight: number;
  priority: number;
}

export interface RatePlanItem {
  id: string;
  roomTypeId: string;
  name: string;
  basePricePerNight: number;
  currency: string;
  breakfastIncluded: boolean;
  refundable: boolean;
  freeCancellationHours: number | null;
  cancellationFeePercent: number;
  cancellationSummary: string;
  status: SalesStatus;
  seasonalRates: SeasonalRateItem[];
  version: number;
}

export interface RoomTypeItem {
  id: string;
  name: string;
  description: string | null;
  maxAdults: number;
  maxChildren: number;
  bedConfiguration: string;
  sizeSqm: number | null;
  totalRooms: number;
  status: SalesStatus;
  sortOrder: number;
  amenities: string[];
  ratePlans: RatePlanItem[];
  version: number;
}

export interface RoomTypeRequest {
  name: string;
  description?: string;
  maxAdults: number;
  maxChildren: number;
  bedConfiguration: string;
  sizeSqm?: number;
  totalRooms: number;
  status: SalesStatus;
  sortOrder: number;
  amenities: string[];
  version?: number;
}

export interface RatePlanRequest {
  name: string;
  basePricePerNight: number;
  breakfastIncluded: boolean;
  refundable: boolean;
  freeCancellationHours?: number;
  cancellationFeePercent?: number;
  status: SalesStatus;
  version?: number;
}

export interface SeasonalRateRequest {
  label: string;
  startDate: string;
  endDate: string;
  pricePerNight: number;
  priority: number;
}

export interface InventoryDay {
  date: string;
  totalRooms: number;
  bookedRooms: number;
  heldRooms: number;
  freeRooms: number;
  stopSell: boolean;
  price: number | null;
}

export interface InventoryCalendar {
  from: string;
  to: string;
  lastSellableNight: string;
  roomTypes: { roomTypeId: string; name: string; defaultTotalRooms: number; status: SalesStatus; days: InventoryDay[] }[];
}

export interface UpdateInventoryRequest {
  roomTypeId: string;
  from: string;
  to: string;
  totalRooms?: number;
  stopSell?: boolean;
}

export interface ManagerItem {
  userId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  assignedAt: string;
}
