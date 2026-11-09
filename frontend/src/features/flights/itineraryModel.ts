import type { FlightSliceInfo } from '@/features/bookings/types';
import type { TripSlice } from './types';

/** One direction of a trip in the shape every page can supply (trip offer, booking). */
export interface ItinerarySlice {
  originCode: string;
  originCity: string;
  destinationCode: string;
  destinationCity: string;
  departureLocal: string;
  arrivalLocal: string;
  durationMinutes: number;
  stops: number;
  viaAirport: string | null;
  segments: {
    flightNumber: string;
    airlineName: string;
    origin: string;
    destination: string;
    departureLocal: string;
    arrivalLocal: string;
    durationMinutes: number;
  }[];
}

export function itineraryOfTrip(slice: TripSlice): ItinerarySlice {
  return {
    originCode: slice.origin.iataCode,
    originCity: slice.origin.city,
    destinationCode: slice.destination.iataCode,
    destinationCity: slice.destination.city,
    departureLocal: slice.departureLocal,
    arrivalLocal: slice.arrivalLocal,
    durationMinutes: slice.durationMinutes,
    stops: slice.stops,
    viaAirport: slice.viaAirport,
    segments: slice.segments.map((segment) => ({ ...segment, airlineName: slice.airline.name })),
  };
}

/** The booking's slices in the same shape (a stop is a segment boundary). */
export function itineraryOfBooking(slice: FlightSliceInfo): ItinerarySlice {
  return {
    originCode: slice.origin,
    originCity: slice.originCity,
    destinationCode: slice.destination,
    destinationCity: slice.destinationCity,
    departureLocal: slice.departureLocal,
    arrivalLocal: slice.arrivalLocal,
    durationMinutes: slice.durationMinutes,
    stops: slice.stops,
    viaAirport: slice.segments.length > 1 ? (slice.segments[0]?.destination ?? null) : null,
    segments: slice.segments,
  };
}
