/** Flight API shapes (API_DOCUMENTATION.md §5a). Amounts are rupee numbers; times are local `YYYY-MM-DDTHH:mm`. */

export type Cabin = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
export type TripType = 'ONE_WAY' | 'ROUND_TRIP';
export type FareType = 'REFUNDABLE' | 'NON_REFUNDABLE';
export type FlightSort = 'PRICE_ASC' | 'DURATION_ASC' | 'DEPARTURE_ASC' | 'ARRIVAL_ASC';

export const CABIN_LABELS: Record<Cabin, string> = {
  ECONOMY: 'Economy',
  PREMIUM_ECONOMY: 'Premium Economy',
  BUSINESS: 'Business',
  FIRST: 'First class',
};

export const SORT_LABELS: Record<FlightSort, string> = {
  PRICE_ASC: 'Lowest price',
  DURATION_ASC: 'Shortest journey',
  DEPARTURE_ASC: 'Earliest departure',
  ARRIVAL_ASC: 'Earliest arrival',
};

export interface Airport {
  iataCode: string;
  name: string;
  city: string;
  countryCode: string;
  /** Only in airport search answers: "Delhi (DEL) · Indira Gandhi International". */
  label?: string;
}

export interface Airline {
  code: string;
  name: string;
}

export interface PopularRoute {
  origin: Airport;
  destination: Airport;
  fromPrice: number;
  currency: string;
}

export interface FlightSegment {
  flightNumber: string;
  origin: string;
  destination: string;
  departureLocal: string;
  arrivalLocal: string;
  durationMinutes: number;
}

export interface Fare {
  name: string;
  type: FareType;
  refundable: boolean;
  checkedBaggageKg: number;
  cabinBaggageKg: number;
  cancellationFeePercent: number;
  cancellationPolicy: string;
}

export interface Passengers {
  adults: number;
  children: number;
  infants: number;
}

export interface FlightOption {
  offerId: string;
  provider: string;
  demo: boolean;
  airline: Airline;
  flightNumber: string;
  origin: Airport;
  destination: Airport;
  departureLocal: string;
  arrivalLocal: string;
  durationMinutes: number;
  stops: number;
  viaAirport: string | null;
  segments: FlightSegment[];
  cabin: Cabin;
  fare: Fare;
  seatsLeft: number;
  pricePerAdult: number;
  totalPrice: number;
  currency: string;
  expiresAt: string;
}

export interface Direction {
  origin: Airport;
  destination: Airport;
  date: string;
  totalOptions: number;
  options: FlightOption[];
}

export interface FlightFacets {
  minPrice: number;
  maxPrice: number;
  airlines: { code: string; name: string; count: number; minPrice: number }[];
  stops: { stops: number; count: number }[];
  refundable: { yes: number; no: number };
}

export interface FlightSearchResponse {
  tripType: TripType;
  cabin: Cabin;
  demo: boolean;
  passengers: Passengers;
  outbound: Direction;
  inbound: Direction | null;
  /** Unfiltered outbound options. */
  facets: FlightFacets;
  /** Same shape for the return direction; null for one-way trips. */
  inboundFacets: FlightFacets | null;
}

export interface TripSlice {
  origin: Airport;
  destination: Airport;
  airline: Airline;
  flightNumber: string;
  departureLocal: string;
  arrivalLocal: string;
  durationMinutes: number;
  stops: number;
  viaAirport: string | null;
  segments: FlightSegment[];
  fare: Fare;
}

export interface PriceLine {
  label: string;
  amount: number;
}

/** The revalidated trip (kept 20 minutes). `priceChanged`: today's price differs from the search result. */
export interface TripOffer {
  tripOfferId: string;
  expiresAt: string;
  tripType: TripType;
  cabin: Cabin;
  provider: string;
  demo: boolean;
  title: string;
  international: boolean;
  passengers: Passengers;
  slices: TripSlice[];
  refundable: boolean;
  checkedBaggageKg: number;
  cabinBaggageKg: number;
  cancellationPolicy: string;
  priceLines: PriceLine[];
  subtotal: number;
  taxes: number;
  total: number;
  currency: string;
  priceChanged: boolean;
  previousTotal: number | null;
}
