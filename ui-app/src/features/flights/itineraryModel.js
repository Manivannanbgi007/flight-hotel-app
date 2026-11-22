export function itineraryOfTrip(slice) {
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
export function itineraryOfBooking(slice) {
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
