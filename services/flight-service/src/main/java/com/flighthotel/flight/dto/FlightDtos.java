package com.flighthotel.flight.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import com.flighthotel.flight.integration.FlightModel.Airline;
import com.flighthotel.flight.integration.FlightModel.Airport;
import com.flighthotel.flight.integration.FlightModel.Fare;
import com.flighthotel.flight.integration.FlightModel.FlightOption;
import com.flighthotel.flight.integration.FlightModel.OptionRef;
import com.flighthotel.flight.integration.FlightModel.Passengers;
import com.flighthotel.flight.integration.FlightModel.PriceLine;
import com.flighthotel.flight.integration.FlightModel.Segment;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

/** Request and response bodies of the public flight API (API_DOCUMENTATION.md section 5a). */
public final class FlightDtos {

    private FlightDtos() {
    }

    public record AirportView(String iataCode, String name, String city, String countryCode, String label) {

        public static AirportView of(Airport airport) {
            return new AirportView(airport.iataCode(), airport.name(), airport.city(), airport.countryCode(),
                    airport.city() + " (" + airport.iataCode() + ") · " + airport.name());
        }
    }

    public record AirlineView(String code, String name) {
    }

    public record PopularRoute(Airport origin, Airport destination, BigDecimal fromPrice, String currency) {
    }

    public record Direction(Airport origin, Airport destination, LocalDate date, int totalOptions,
            List<FlightOption> options) {
    }

    public record AirlineFacet(String code, String name, int count, BigDecimal minPrice) {
    }

    public record StopsFacet(int stops, int count) {
    }

    public record RefundableFacet(int yes, int no) {
    }

    public record Facets(BigDecimal minPrice, BigDecimal maxPrice, List<AirlineFacet> airlines,
            List<StopsFacet> stops, RefundableFacet refundable) {
    }

    public record SearchResponse(String tripType, String cabin, boolean demo, Passengers passengers,
            Direction outbound, Direction inbound, Facets facets, Facets inboundFacets) {
    }

    public record RevalidateRequest(@NotEmpty @Size(min = 1, max = 2) List<String> offerIds) {
    }

    public record TripSlice(Airport origin, Airport destination, Airline airline, String flightNumber,
            String departureLocal, String arrivalLocal, int durationMinutes, int stops, String viaAirport,
            List<Segment> segments, Fare fare) {
    }

    public record TripOffer(String tripOfferId, Instant expiresAt, String tripType, String cabin, String provider,
            boolean demo, String title, boolean international, Passengers passengers, List<TripSlice> slices,
            boolean refundable, int checkedBaggageKg, int cabinBaggageKg, String cancellationPolicy,
            List<PriceLine> priceLines, BigDecimal subtotal, BigDecimal taxes, BigDecimal total, String currency,
            boolean priceChanged, BigDecimal previousTotal) {
    }

    /** What flight-service keeps for a trip offer: the public offer plus what it needs to hold the seats. */
    public record StoredTrip(TripOffer offer, List<OptionRef> refs) {
    }
}
