import type { Airport, FlightFacets, FlightOption, FlightSearchResponse, TripOffer } from './types';

/** Test fixtures shared by the flight page tests. */

export const futureIso = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();

export const DEL: Airport = { iataCode: 'DEL', name: 'Indira Gandhi International', city: 'Delhi', countryCode: 'IN' };
export const BOM: Airport = { iataCode: 'BOM', name: 'Chhatrapati Shivaji Maharaj International', city: 'Mumbai', countryCode: 'IN' };
export const DXB: Airport = { iataCode: 'DXB', name: 'Dubai International', city: 'Dubai', countryCode: 'AE' };

export const optionFixture = (overrides: Partial<FlightOption> = {}): FlightOption => ({
  offerId: 'offer-1',
  provider: 'DEMO',
  demo: true,
  airline: { code: 'AI', name: 'Air India' },
  flightNumber: 'AI 504',
  origin: DEL,
  destination: BOM,
  departureLocal: '2099-03-10T06:45',
  arrivalLocal: '2099-03-10T08:55',
  durationMinutes: 130,
  stops: 0,
  viaAirport: null,
  segments: [{ flightNumber: 'AI 504', origin: 'DEL', destination: 'BOM', departureLocal: '2099-03-10T06:45', arrivalLocal: '2099-03-10T08:55', durationMinutes: 130 }],
  cabin: 'ECONOMY',
  fare: { name: 'Saver', type: 'NON_REFUNDABLE', refundable: false, checkedBaggageKg: 15, cabinBaggageKg: 7, cancellationFeePercent: 100, cancellationPolicy: 'Non-refundable: the full fare is charged if you cancel.' },
  seatsLeft: 4,
  pricePerAdult: 5200,
  totalPrice: 5200,
  currency: 'INR',
  expiresAt: futureIso(20),
  ...overrides,
});

export const facetsFixture = (overrides: Partial<FlightFacets> = {}): FlightFacets => ({
  minPrice: 4800,
  maxPrice: 9800,
  airlines: [{ code: 'AI', name: 'Air India', count: 2, minPrice: 5200 }, { code: '6E', name: 'IndiGo', count: 1, minPrice: 4800 }],
  stops: [{ stops: 0, count: 2 }, { stops: 1, count: 1 }],
  refundable: { yes: 1, no: 2 },
  ...overrides,
});

export const searchFixture = (overrides: Partial<FlightSearchResponse> = {}): FlightSearchResponse => ({
  tripType: 'ONE_WAY',
  cabin: 'ECONOMY',
  demo: true,
  passengers: { adults: 1, children: 0, infants: 0 },
  outbound: {
    origin: DEL, destination: BOM, date: '2099-03-10', totalOptions: 3,
    options: [
      optionFixture(),
      optionFixture({
        offerId: 'offer-2', airline: { code: '6E', name: 'IndiGo' }, flightNumber: '6E 211', departureLocal: '2099-03-10T09:10', arrivalLocal: '2099-03-10T11:15',
        durationMinutes: 125, totalPrice: 4800, pricePerAdult: 4800, seatsLeft: 9,
        fare: { name: 'Flex', type: 'REFUNDABLE', refundable: true, checkedBaggageKg: 20, cabinBaggageKg: 7, cancellationFeePercent: 25, cancellationPolicy: 'Refundable: a 25% fee applies up to departure.' },
      }),
      optionFixture({
        offerId: 'offer-3', flightNumber: 'AI 660', departureLocal: '2099-03-10T22:30', arrivalLocal: '2099-03-11T01:50', durationMinutes: 200,
        stops: 1, viaAirport: 'HYD', totalPrice: 9800, pricePerAdult: 9800,
      }),
    ],
  },
  inbound: null,
  facets: facetsFixture(),
  inboundFacets: null,
  ...overrides,
});

export const tripFixture = (overrides: Partial<TripOffer> = {}): TripOffer => ({
  tripOfferId: 'trip-1',
  expiresAt: futureIso(20),
  tripType: 'ONE_WAY',
  cabin: 'ECONOMY',
  provider: 'DEMO',
  demo: true,
  title: 'Delhi to Mumbai',
  international: false,
  passengers: { adults: 1, children: 0, infants: 0 },
  slices: [{
    origin: DEL, destination: BOM, airline: { code: 'AI', name: 'Air India' }, flightNumber: 'AI 504',
    departureLocal: '2099-03-10T06:45', arrivalLocal: '2099-03-10T08:55', durationMinutes: 130, stops: 0, viaAirport: null,
    segments: [{ flightNumber: 'AI 504', origin: 'DEL', destination: 'BOM', departureLocal: '2099-03-10T06:45', arrivalLocal: '2099-03-10T08:55', durationMinutes: 130 }],
    fare: { name: 'Saver', type: 'NON_REFUNDABLE', refundable: false, checkedBaggageKg: 15, cabinBaggageKg: 7, cancellationFeePercent: 100, cancellationPolicy: 'Non-refundable: the full fare is charged if you cancel.' },
  }],
  refundable: false,
  checkedBaggageKg: 15,
  cabinBaggageKg: 7,
  cancellationPolicy: 'Non-refundable: the full fare is charged if you cancel.',
  priceLines: [
    { label: 'Fare · 1 adult', amount: 4500 },
    { label: 'Airport and fuel charges', amount: 350 },
    { label: 'GST 5%', amount: 350 },
  ],
  subtotal: 4500,
  taxes: 700,
  total: 5200,
  currency: 'INR',
  priceChanged: false,
  previousTotal: null,
  ...overrides,
});
