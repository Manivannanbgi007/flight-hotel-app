package com.flighthotel.flight.service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.flight.config.FlightProperties;
import com.flighthotel.flight.dto.FlightDtos.AirlineFacet;
import com.flighthotel.flight.dto.FlightDtos.Direction;
import com.flighthotel.flight.dto.FlightDtos.Facets;
import com.flighthotel.flight.dto.FlightDtos.PopularRoute;
import com.flighthotel.flight.dto.FlightDtos.RefundableFacet;
import com.flighthotel.flight.dto.FlightDtos.SearchResponse;
import com.flighthotel.flight.dto.FlightDtos.StopsFacet;
import com.flighthotel.flight.integration.FlightModel.Airport;
import com.flighthotel.flight.integration.FlightModel.FlightOption;
import com.flighthotel.flight.integration.FlightModel.Passengers;
import com.flighthotel.flight.integration.FlightModel.SearchCriteria;
import com.flighthotel.flight.integration.FlightModel.StoredOption;
import com.flighthotel.flight.integration.FlightProviders.FlightSearchProvider;
import com.flighthotel.flight.integration.demo.ReferenceData;

/** Flight search with every filter of the requirements, sorting and facets (API_DOCUMENTATION.md section 5a.1). */
@Service
public class FlightSearchService {

    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final Set<String> CABINS = Set.of("ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST");
    private static final int MAX_DAYS_AHEAD = 330;
    private static final List<String[]> POPULAR = List.of(new String[] { "DEL", "BOM" }, new String[] { "BLR", "DEL" },
            new String[] { "BOM", "GOI" }, new String[] { "DEL", "DXB" }, new String[] { "MAA", "BLR" },
            new String[] { "HYD", "DEL" });

    /** What the customer asked for. */
    public record Query(String origin, String destination, LocalDate departureDate, LocalDate returnDate, int adults,
            int children, int infants, String cabin, Filters filters, String sort) {
    }

    public record Filters(Set<String> airlines, Integer maxStops, BigDecimal maxPrice, Boolean refundable,
            LocalTime departAfter, LocalTime departBefore, LocalTime arriveAfter, LocalTime arriveBefore,
            Integer maxDurationMinutes) {

        public static Filters none() {
            return new Filters(Set.of(), null, null, null, null, null, null, null, null);
        }
    }

    private final ProviderRegistry providers;
    private final ReferenceData reference;
    private final OfferStore store;
    private final FlightProperties properties;
    private final Clock clock;

    public FlightSearchService(ProviderRegistry providers, ReferenceData reference, OfferStore store,
            FlightProperties properties, Clock clock) {
        this.providers = providers;
        this.reference = reference;
        this.store = store;
        this.properties = properties;
        this.clock = clock;
    }

    public SearchResponse search(Query query) {
        validate(query);
        Passengers passengers = new Passengers(query.adults(), query.children(), query.infants());
        FlightSearchProvider provider = providers.forSearch();
        Found outbound = direction(provider, query, query.origin(), query.destination(), query.departureDate(),
                passengers);
        Found inbound = query.returnDate() == null ? null
                : direction(provider, query, query.destination(), query.origin(), query.returnDate(), passengers);
        return new SearchResponse(query.returnDate() == null ? "ONE_WAY" : "ROUND_TRIP", query.cabin(), true,
                passengers, outbound.direction(), inbound == null ? null : inbound.direction(),
                facets(outbound.all()), inbound == null ? null : facets(inbound.all()));
    }

    private record Found(Direction direction, List<FlightOption> all) {
    }

    private Found direction(FlightSearchProvider provider, Query query, String origin, String destination,
            LocalDate date, Passengers passengers) {
        List<StoredOption> found = provider.search(new SearchCriteria(origin, destination, date, passengers,
                query.cabin()));
        Instant expires = clock.instant().plus(properties.offerTtl());
        List<StoredOption> stored = found.stream().map(s -> new StoredOption(withExpiry(s.option(), expires),
                s.ref(), s.passengers())).toList();
        stored.forEach(store::saveOption);
        List<FlightOption> all = stored.stream().map(StoredOption::option).toList();
        List<FlightOption> filtered = all.stream().filter(option -> matches(option, query.filters()))
                .sorted(comparator(query.sort())).limit(100).toList();
        return new Found(new Direction(reference.airport(origin), reference.airport(destination), date, all.size(),
                filtered), all);
    }

    /** Facets count the options before filtering, so the sidebar shows what changing a filter would give. */
    public Facets facets(List<FlightOption> options) {
        Map<String, List<FlightOption>> byAirline = options.stream()
                .collect(Collectors.groupingBy(o -> o.airline().code(), TreeMap::new, Collectors.toList()));
        List<AirlineFacet> airlines = byAirline.values().stream()
                .map(list -> new AirlineFacet(list.getFirst().airline().code(), list.getFirst().airline().name(),
                        list.size(), list.stream().map(FlightOption::totalPrice).min(Comparator.naturalOrder())
                                .orElse(BigDecimal.ZERO)))
                .sorted(Comparator.comparing(AirlineFacet::minPrice)).toList();
        Map<Integer, Long> stops = options.stream()
                .collect(Collectors.groupingBy(FlightOption::stops, TreeMap::new, Collectors.counting()));
        return new Facets(options.stream().map(FlightOption::totalPrice).min(Comparator.naturalOrder())
                .orElse(BigDecimal.ZERO),
                options.stream().map(FlightOption::totalPrice).max(Comparator.naturalOrder()).orElse(BigDecimal.ZERO),
                airlines, stops.entrySet().stream().map(e -> new StopsFacet(e.getKey(), e.getValue().intValue()))
                        .toList(),
                new RefundableFacet((int) options.stream().filter(o -> o.fare().refundable()).count(),
                        (int) options.stream().filter(o -> !o.fare().refundable()).count()));
    }

    public List<PopularRoute> popularRoutes() {
        FlightSearchProvider provider = providers.forSearch();
        LocalDate date = LocalDate.now(clock.withZone(INDIA)).plusDays(30);
        List<PopularRoute> routes = new ArrayList<>();
        for (String[] pair : POPULAR) {
            List<StoredOption> options = provider.search(new SearchCriteria(pair[0], pair[1], date,
                    new Passengers(1, 0, 0), "ECONOMY"));
            options.stream().map(o -> o.option().totalPrice()).min(Comparator.naturalOrder())
                    .ifPresent(price -> routes.add(new PopularRoute(reference.airport(pair[0]),
                            reference.airport(pair[1]), price, "INR")));
        }
        return routes;
    }

    // ------------------------------------------------------------------ filters

    static boolean matches(FlightOption option, Filters filters) {
        if (!filters.airlines().isEmpty() && !filters.airlines().contains(option.airline().code())) {
            return false;
        }
        if (filters.maxStops() != null && option.stops() > filters.maxStops()) {
            return false;
        }
        if (filters.maxPrice() != null && option.totalPrice().compareTo(filters.maxPrice()) > 0) {
            return false;
        }
        if (filters.refundable() != null && option.fare().refundable() != filters.refundable()) {
            return false;
        }
        if (filters.maxDurationMinutes() != null && option.durationMinutes() > filters.maxDurationMinutes()) {
            return false;
        }
        LocalTime departure = LocalDateTime.parse(option.departureLocal()).toLocalTime();
        LocalTime arrival = LocalDateTime.parse(option.arrivalLocal()).toLocalTime();
        return (filters.departAfter() == null || !departure.isBefore(filters.departAfter()))
                && (filters.departBefore() == null || !departure.isAfter(filters.departBefore()))
                && (filters.arriveAfter() == null || !arrival.isBefore(filters.arriveAfter()))
                && (filters.arriveBefore() == null || !arrival.isAfter(filters.arriveBefore()));
    }

    static Comparator<FlightOption> comparator(String sort) {
        Comparator<FlightOption> byPrice = Comparator.comparing(FlightOption::totalPrice);
        return switch (sort == null ? "PRICE_ASC" : sort) {
            case "DURATION_ASC" -> Comparator.comparingInt(FlightOption::durationMinutes).thenComparing(byPrice);
            case "DEPARTURE_ASC" -> Comparator.comparing(FlightOption::departureLocal).thenComparing(byPrice);
            case "ARRIVAL_ASC" -> Comparator.comparing(FlightOption::arrivalLocal).thenComparing(byPrice);
            default -> byPrice.thenComparing(FlightOption::departureLocal);
        };
    }

    private static FlightOption withExpiry(FlightOption o, Instant expires) {
        return new FlightOption(o.offerId(), o.provider(), o.demo(), o.airline(), o.flightNumber(), o.origin(),
                o.destination(), o.departureLocal(), o.arrivalLocal(), o.durationMinutes(), o.stops(), o.viaAirport(),
                o.segments(), o.cabin(), o.fare(), o.seatsLeft(), o.pricePerAdult(), o.totalPrice(), o.currency(),
                expires);
    }

    // ------------------------------------------------------------------ validation

    private void validate(Query q) {
        Airport origin = reference.airport(q.origin());
        Airport destination = reference.airport(q.destination());
        if (origin == null || destination == null) {
            throw bad("UNKNOWN_AIRPORT", "Choose airports from the list.");
        }
        if (q.origin().equals(q.destination())) {
            throw bad("SAME_AIRPORT", "The departure and arrival airports must be different.");
        }
        LocalDate today = LocalDate.now(clock.withZone(INDIA));
        if (q.departureDate() == null || q.departureDate().isBefore(today)
                || ChronoUnit.DAYS.between(today, q.departureDate()) > MAX_DAYS_AHEAD) {
            throw bad("INVALID_DATE", "Choose a departure date from today up to " + MAX_DAYS_AHEAD + " days ahead.");
        }
        if (q.returnDate() != null && (q.returnDate().isBefore(q.departureDate())
                || ChronoUnit.DAYS.between(today, q.returnDate()) > MAX_DAYS_AHEAD)) {
            throw bad("INVALID_DATE", "The return date cannot be before the departure date.");
        }
        if (q.adults() < 1 || q.adults() > 9 || q.children() < 0 || q.children() > 8 || q.infants() < 0
                || q.infants() > q.adults() || q.adults() + q.children() > 9) {
            throw bad("INVALID_PASSENGERS", "Choose 1 to 9 travellers with a seat and at most one infant per adult.");
        }
        if (!CABINS.contains(q.cabin())) {
            throw bad("INVALID_CABIN", "Choose Economy, Premium Economy, Business or First.");
        }
    }

    private static ApiException bad(String code, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, code, message);
    }
}
