/** Public hotel API types (API_DOCUMENTATION.md §5, hotel-service PublicHotelDtos). Money values are numbers in INR. */

export type PropertyType = 'HOTEL' | 'RESORT' | 'APARTMENT' | 'VILLA' | 'HOSTEL' | 'GUEST_HOUSE';
export type SearchSort = 'RECOMMENDED' | 'PRICE_ASC' | 'PRICE_DESC' | 'RATING_DESC' | 'STARS_DESC' | 'DISTANCE_ASC';

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  HOTEL: 'Hotel',
  RESORT: 'Resort',
  APARTMENT: 'Apartment',
  VILLA: 'Villa',
  HOSTEL: 'Hostel',
  GUEST_HOUSE: 'Guest house',
};

export const SORT_LABELS: Record<SearchSort, string> = {
  RECOMMENDED: 'Recommended',
  PRICE_ASC: 'Price: low to high',
  PRICE_DESC: 'Price: high to low',
  RATING_DESC: 'Guest rating',
  STARS_DESC: 'Star rating',
  DISTANCE_ASC: 'Distance',
};

export interface HotelCard {
  id: string;
  slug: string;
  name: string;
  propertyType: PropertyType;
  starRating: number | null;
  guestRating: number | null;
  reviewCount: number;
  addressLine: string;
  city: string;
  countryCode: string;
  latitude: number | null;
  longitude: number | null;
  imageUrl: string | null;
  amenities: string[];
  available: boolean;
  availableRoomTypes: number;
  cheapestRoomType: string | null;
  /** Per room per night, before taxes. */
  pricePerNight: number | null;
  /** Whole stay, all rooms, taxes included. */
  totalPrice: number | null;
  currency: string;
  freeCancellation: boolean;
  breakfastIncluded: boolean;
  distanceKm: number | null;
  demo: boolean;
}

export interface SearchResponse {
  content: HotelCard[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  nights: number;
  destination: { query: string; city: string | null; distanceFrom: string | null; latitude: number | null; longitude: number | null };
  facets: { minPrice: number | null; maxPrice: number | null; stars: Record<string, number>; propertyTypes: Record<string, number> };
}

export interface DestinationSuggestion {
  city: string;
  countryCode: string;
  hotels: number;
}

export interface Amenity {
  code: string;
  name: string;
  category: 'HOTEL' | 'ROOM';
}

export interface HotelImage {
  id: string;
  url: string;
  thumbUrl: string;
  caption: string | null;
  roomTypeId: string | null;
  width: number;
  height: number;
}

export interface RoomTypeSummary {
  id: string;
  name: string;
  description: string | null;
  maxAdults: number;
  maxChildren: number;
  bedConfiguration: string;
  sizeSqm: number | null;
  amenities: Amenity[];
  images: HotelImage[];
}

export interface HotelDetails {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  propertyType: PropertyType;
  starRating: number | null;
  guestRating: number | null;
  reviewCount: number;
  addressLine: string;
  city: string;
  state: string | null;
  countryCode: string;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  checkInTime: string;
  checkOutTime: string;
  timeZone: string;
  amenities: Amenity[];
  policies: { type: string; description: string }[];
  images: HotelImage[];
  roomTypes: RoomTypeSummary[];
  nearby: { name: string; type: string; distanceKm: number }[];
  demo: boolean;
}

export interface NightlyPrice {
  date: string;
  price: number;
  season: string | null;
}

export interface RateOffer {
  ratePlanId: string;
  name: string;
  breakfastIncluded: boolean;
  refundable: boolean;
  freeCancellation: boolean;
  freeCancellationUntil: string | null;
  cancellationPolicy: string;
  pricePerNight: number;
  subtotal: number;
  taxes: number;
  total: number;
  currency: string;
  nights: NightlyPrice[];
}

export interface RoomOffer {
  roomType: RoomTypeSummary;
  fitsParty: boolean;
  freeRooms: number;
  available: boolean;
  rates: RateOffer[];
}

export interface RoomsResponse {
  hotelId: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  adults: number;
  children: number;
  roomTypes: RoomOffer[];
}

/** Who stays and when (shared by search, rooms and quotes). Dates are YYYY-MM-DD. */
export interface Stay {
  checkIn: string;
  checkOut: string;
  rooms: number;
  adults: number;
  children: number;
  childAges: number[];
}

export interface Quote {
  quoteId: string;
  createdAt: string;
  expiresAt: string;
  hotelId: string;
  hotelSlug: string;
  hotelName: string;
  hotelAddress: string;
  checkInTime: string;
  checkOutTime: string;
  roomTypeId: string;
  roomTypeName: string;
  ratePlanId: string;
  ratePlanName: string;
  breakfastIncluded: boolean;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  adults: number;
  children: number;
  childAges: number[];
  nightlyPrices: NightlyPrice[];
  subtotal: number;
  taxes: number;
  taxLines: { label: string; ratePercent: number; amount: number }[];
  total: number;
  currency: string;
  refundable: boolean;
  freeCancellation: boolean;
  freeCancellationUntil: string | null;
  cancellationFeePercent: number;
  cancellationPolicy: string;
  demo: boolean;
}
