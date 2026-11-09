package com.flighthotel.flight.controller;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.flight.dto.FlightDtos.AirlineView;
import com.flighthotel.flight.dto.FlightDtos.AirportView;
import com.flighthotel.flight.dto.FlightDtos.PopularRoute;
import com.flighthotel.flight.dto.FlightDtos.RevalidateRequest;
import com.flighthotel.flight.dto.FlightDtos.SearchResponse;
import com.flighthotel.flight.dto.FlightDtos.TripOffer;
import com.flighthotel.flight.integration.demo.ReferenceData;
import com.flighthotel.flight.service.FlightProviderService;
import com.flighthotel.flight.service.FlightProviderService.ProviderView;
import com.flighthotel.flight.service.FlightSearchService;
import com.flighthotel.flight.service.FlightSearchService.Filters;
import com.flighthotel.flight.service.FlightSearchService.Query;
import com.flighthotel.flight.service.TripService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

/** The controllers of flight-service: airports, search, revalidate (public) and provider management (admin). */
public final class FlightControllers {

    private FlightControllers() {
    }

    @RestController
    @RequestMapping("/api/airports")
    @Tag(name = "Airports", description = "Airport list and autocomplete")
    public static class AirportController {

        private final ReferenceData reference;

        public AirportController(ReferenceData reference) {
            this.reference = reference;
        }

        @GetMapping
        @Operation(summary = "All airports, by city and then code")
        public List<AirportView> all() {
            return reference.airports().stream().map(AirportView::of).toList();
        }

        @GetMapping("/search")
        @Operation(summary = "Airports by code, city or name, best match first")
        public List<AirportView> search(@RequestParam(defaultValue = "") String q,
                @RequestParam(defaultValue = "8") int limit) {
            return reference.searchAirports(q, Math.clamp(limit, 1, 20)).stream().map(AirportView::of).toList();
        }
    }

    @RestController
    @RequestMapping("/api/flights")
    @Tag(name = "Flights", description = "Search, compare and revalidate flights (DEMO inventory)")
    public static class FlightController {

        private final FlightSearchService search;
        private final TripService trips;
        private final ReferenceData reference;

        public FlightController(FlightSearchService search, TripService trips, ReferenceData reference) {
            this.search = search;
            this.trips = trips;
            this.reference = reference;
        }

        @GetMapping("/search")
        @Operation(summary = "Flights for a route and date (round trip with returnDate), filters and sorting")
        public SearchResponse search(@RequestParam String origin, @RequestParam String destination,
                @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate departureDate,
                @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate returnDate,
                @RequestParam(defaultValue = "1") int adults, @RequestParam(defaultValue = "0") int children,
                @RequestParam(defaultValue = "0") int infants, @RequestParam(defaultValue = "ECONOMY") String cabin,
                @RequestParam(required = false) String airlines, @RequestParam(required = false) Integer maxStops,
                @RequestParam(required = false) BigDecimal maxPrice,
                @RequestParam(required = false) Boolean refundable,
                @RequestParam(required = false) String departAfter, @RequestParam(required = false) String departBefore,
                @RequestParam(required = false) String arriveAfter, @RequestParam(required = false) String arriveBefore,
                @RequestParam(required = false) Integer maxDurationMinutes,
                @RequestParam(required = false) String sort) {
            Set<String> airlineCodes = airlines == null || airlines.isBlank() ? Set.of()
                    : java.util.Arrays.stream(airlines.split(",")).map(String::strip).map(String::toUpperCase)
                            .collect(Collectors.toSet());
            Filters filters = new Filters(airlineCodes, maxStops, maxPrice, refundable, time(departAfter),
                    time(departBefore), time(arriveAfter), time(arriveBefore), maxDurationMinutes);
            return search.search(new Query(origin.strip().toUpperCase(), destination.strip().toUpperCase(),
                    departureDate, returnDate, adults, children, infants, cabin.strip().toUpperCase(), filters, sort));
        }

        @GetMapping("/airlines")
        @Operation(summary = "Airlines of the demo timetable")
        public List<AirlineView> airlines() {
            return reference.airlines().stream().map(a -> new AirlineView(a.code(), a.name())).toList();
        }

        @GetMapping("/popular-routes")
        @Operation(summary = "Popular routes with their lowest fare (home page)")
        public List<PopularRoute> popularRoutes() {
            return search.popularRoutes();
        }

        @PostMapping("/revalidate")
        @Operation(summary = "Re-price the selected flight(s) and check the seats; nothing is reserved")
        public TripOffer revalidate(@Valid @RequestBody RevalidateRequest request) {
            return trips.revalidate(request.offerIds());
        }

        @GetMapping("/trips/{tripOfferId}")
        @Operation(summary = "A revalidated trip offer (20 minutes)")
        public TripOffer trip(@PathVariable String tripOfferId) {
            return trips.find(tripOfferId);
        }

        private static LocalTime time(String text) {
            if (text == null || text.isBlank()) {
                return null;
            }
            try {
                return LocalTime.parse(text.strip());
            } catch (java.time.format.DateTimeParseException ex) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_TIME", "Times look like 06:30.");
            }
        }
    }

    @RestController
    @RequestMapping("/api/admin/flight-providers")
    @Tag(name = "Flight providers", description = "Flight Provider Management (admin)")
    public static class AdminFlightProviderController {

        public record UpdateRequest(Boolean enabled, Integer priority) {
        }

        private final FlightProviderService providers;

        public AdminFlightProviderController(FlightProviderService providers) {
            this.providers = providers;
        }

        @GetMapping
        public List<ProviderView> list() {
            return providers.list();
        }

        @PatchMapping("/{code}")
        public ProviderView update(@PathVariable String code, @RequestBody UpdateRequest request) {
            return providers.update(code, request.enabled(), request.priority());
        }

        @PostMapping("/{code}/health-check")
        public ResponseEntity<ProviderView> healthCheck(@PathVariable String code) {
            return ResponseEntity.ok(providers.healthCheck(code));
        }
    }
}
