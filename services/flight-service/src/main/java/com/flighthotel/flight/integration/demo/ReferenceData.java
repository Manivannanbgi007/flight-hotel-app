package com.flighthotel.flight.integration.demo;

import java.math.BigDecimal;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import com.flighthotel.flight.integration.FlightModel.Airline;
import com.flighthotel.flight.integration.FlightModel.Airport;

/**
 * Airports, airlines, fare families and schedules of the DEMO airline system, read from the database. The small
 * reference tables are cached; call {@link #refresh()} after seeding.
 */
@Component
public class ReferenceData {

    public record FareFamily(String cabin, String type, String name, int checkedBaggageKg, int cabinBaggageKg,
            int cancelFeePercent, BigDecimal multiplier) {
    }

    public record Schedule(String id, String airlineCode, String flightNumber, String origin, String destination,
            LocalTime departureLocal, int durationMinutes, String daysOfWeek, int stops, String viaAirport,
            int layoverMinutes, boolean international, int distanceKm, Set<String> cabins) {
    }

    private final JdbcClient jdbc;
    private volatile Map<String, Airport> airports;
    private volatile Map<String, Airline> airlines;
    private volatile Map<String, FareFamily> fares;
    private volatile Map<String, String> timezones;

    public ReferenceData(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public synchronized void refresh() {
        Map<String, Airport> loadedAirports = new LinkedHashMap<>();
        Map<String, String> zones = new LinkedHashMap<>();
        jdbc.sql("SELECT iata_code, name, city, country_code, timezone FROM airports ORDER BY iata_code")
                .query((rs, i) -> {
                    loadedAirports.put(rs.getString(1),
                            new Airport(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4)));
                    zones.put(rs.getString(1), rs.getString(5));
                    return null;
                }).list();
        Map<String, Airline> loadedAirlines = new LinkedHashMap<>();
        jdbc.sql("SELECT iata_code, name FROM airlines ORDER BY name").query((rs, i) -> {
            loadedAirlines.put(rs.getString(1), new Airline(rs.getString(1), rs.getString(2)));
            return null;
        }).list();
        Map<String, FareFamily> loadedFares = new LinkedHashMap<>();
        jdbc.sql("SELECT cabin, fare_type, name, checked_baggage_kg, cabin_baggage_kg, cancel_fee_percent, "
                + "price_multiplier FROM demo_fare_families").query((rs, i) -> {
                    FareFamily fare = new FareFamily(rs.getString(1), rs.getString(2), rs.getString(3), rs.getInt(4),
                            rs.getInt(5), rs.getInt(6), rs.getBigDecimal(7));
                    loadedFares.put(fare.cabin() + "|" + fare.type(), fare);
                    return null;
                }).list();
        this.airports = loadedAirports;
        this.airlines = loadedAirlines;
        this.fares = loadedFares;
        this.timezones = zones;
    }

    private void ensureLoaded() {
        if (airports == null || airports.isEmpty()) {
            refresh();
        }
    }

    public Airport airport(String code) {
        ensureLoaded();
        return airports.get(code);
    }

    public String timezone(String airportCode) {
        ensureLoaded();
        return timezones.get(airportCode);
    }

    public Airline airline(String code) {
        ensureLoaded();
        return airlines.getOrDefault(code, new Airline(code, code));
    }

    public List<Airline> airlines() {
        ensureLoaded();
        return List.copyOf(airlines.values());
    }

    public FareFamily fare(String cabin, String type) {
        ensureLoaded();
        return fares.get(cabin + "|" + type);
    }

    /** Every airport, by city and then code (the full list for pickers and the search index). */
    public List<Airport> airports() {
        ensureLoaded();
        return airports.values().stream()
                .sorted(Comparator.comparing(Airport::city).thenComparing(Airport::iataCode))
                .toList();
    }

    /** Best matches first: exact code, city starting with the text, then name or city containing it. */
    public List<Airport> searchAirports(String query, int limit) {
        ensureLoaded();
        String q = query == null ? "" : query.strip().toLowerCase(Locale.ROOT);
        if (q.isEmpty()) {
            return airports.values().stream().limit(limit).toList();
        }
        return airports.values().stream()
                .map(airport -> new Object[] { airport, rank(airport, q) })
                .filter(pair -> (int) pair[1] < 9)
                .sorted(Comparator.comparingInt((Object[] pair) -> (int) pair[1])
                        .thenComparing(pair -> ((Airport) pair[0]).city()))
                .limit(limit)
                .map(pair -> (Airport) pair[0])
                .toList();
    }

    private static int rank(Airport airport, String q) {
        String code = airport.iataCode().toLowerCase(Locale.ROOT);
        String city = airport.city().toLowerCase(Locale.ROOT);
        String name = airport.name().toLowerCase(Locale.ROOT);
        if (code.equals(q)) return 0;
        if (city.equals(q)) return 1;
        if (city.startsWith(q)) return 2;
        if (code.startsWith(q)) return 3;
        if (name.startsWith(q)) return 4;
        if (city.contains(q) || name.contains(q)) return 5;
        return 9;
    }

    public List<Schedule> schedules(String origin, String destination) {
        return jdbc.sql("SELECT BIN_TO_UUID(id), airline_code, flight_number, origin, destination, departure_local, "
                        + "duration_minutes, days_of_week, stops, via_airport, layover_minutes, international, "
                        + "distance_km, cabins FROM demo_flight_schedules WHERE origin = :o AND destination = :d "
                        + "ORDER BY departure_local")
                .param("o", origin).param("d", destination)
                .query((rs, i) -> schedule(rs)).list();
    }

    public Schedule schedule(String id) {
        return jdbc.sql("SELECT BIN_TO_UUID(id), airline_code, flight_number, origin, destination, departure_local, "
                        + "duration_minutes, days_of_week, stops, via_airport, layover_minutes, international, "
                        + "distance_km, cabins FROM demo_flight_schedules WHERE id = UUID_TO_BIN(:id)")
                .param("id", id).query((rs, i) -> schedule(rs)).optional().orElse(null);
    }

    private static Schedule schedule(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Schedule(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                rs.getTime(6).toLocalTime(), rs.getInt(7), rs.getString(8), rs.getInt(9), rs.getString(10),
                rs.getInt(11), rs.getBoolean(12), rs.getInt(13),
                Arrays.stream(rs.getString(14).split(",")).collect(Collectors.toUnmodifiableSet()));
    }
}
