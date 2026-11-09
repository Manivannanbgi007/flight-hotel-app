package com.flighthotel.flight.integration.demo;

import java.math.BigDecimal;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.TreeSet;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import com.flighthotel.common.id.UuidV7;

/**
 * Creates the labelled DEMO data when the tables are empty: about 40 airports, 12 airlines, fare families, the DEMO
 * provider row and schedules on popular routes (generated deterministically from the route, so every start gives the
 * same timetable). Never used in production ({@code flight.demo.enabled=false}).
 */
@Component
// Before DevFlightSeeder (order 20): the dev timetable must not make the "no schedules yet" check fail.
@Order(10)
@ConditionalOnProperty(name = "flight.demo.enabled", havingValue = "true", matchIfMissing = true)
public class DemoDataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoDataSeeder.class);

    record AirportSeed(String code, String name, String city, String country, double lat, double lon, String zone) {
    }

    private static final List<AirportSeed> AIRPORTS = List.of(
            new AirportSeed("DEL", "Indira Gandhi International", "Delhi", "IN", 28.5562, 77.1000, "Asia/Kolkata"),
            new AirportSeed("BOM", "Chhatrapati Shivaji Maharaj International", "Mumbai", "IN", 19.0896, 72.8656, "Asia/Kolkata"),
            new AirportSeed("BLR", "Kempegowda International", "Bengaluru", "IN", 13.1986, 77.7066, "Asia/Kolkata"),
            new AirportSeed("MAA", "Chennai International", "Chennai", "IN", 12.9900, 80.1693, "Asia/Kolkata"),
            new AirportSeed("HYD", "Rajiv Gandhi International", "Hyderabad", "IN", 17.2403, 78.4294, "Asia/Kolkata"),
            new AirportSeed("CCU", "Netaji Subhas Chandra Bose International", "Kolkata", "IN", 22.6547, 88.4467, "Asia/Kolkata"),
            new AirportSeed("GOI", "Dabolim", "Goa", "IN", 15.3808, 73.8314, "Asia/Kolkata"),
            new AirportSeed("AMD", "Sardar Vallabhbhai Patel International", "Ahmedabad", "IN", 23.0772, 72.6347, "Asia/Kolkata"),
            new AirportSeed("PNQ", "Pune", "Pune", "IN", 18.5821, 73.9197, "Asia/Kolkata"),
            new AirportSeed("COK", "Cochin International", "Kochi", "IN", 10.1520, 76.4019, "Asia/Kolkata"),
            new AirportSeed("JAI", "Jaipur International", "Jaipur", "IN", 26.8242, 75.8122, "Asia/Kolkata"),
            new AirportSeed("LKO", "Chaudhary Charan Singh International", "Lucknow", "IN", 26.7606, 80.8893, "Asia/Kolkata"),
            new AirportSeed("TRV", "Trivandrum International", "Thiruvananthapuram", "IN", 8.4821, 76.9201, "Asia/Kolkata"),
            new AirportSeed("IXC", "Chandigarh International", "Chandigarh", "IN", 30.6735, 76.7885, "Asia/Kolkata"),
            new AirportSeed("ATQ", "Sri Guru Ram Dass Jee International", "Amritsar", "IN", 31.7096, 74.7973, "Asia/Kolkata"),
            new AirportSeed("PAT", "Jay Prakash Narayan International", "Patna", "IN", 25.5913, 85.0880, "Asia/Kolkata"),
            new AirportSeed("BBI", "Biju Patnaik International", "Bhubaneswar", "IN", 20.2444, 85.8178, "Asia/Kolkata"),
            new AirportSeed("IDR", "Devi Ahilyabai Holkar", "Indore", "IN", 22.7218, 75.8011, "Asia/Kolkata"),
            new AirportSeed("NAG", "Dr. Babasaheb Ambedkar International", "Nagpur", "IN", 21.0922, 79.0472, "Asia/Kolkata"),
            new AirportSeed("VNS", "Lal Bahadur Shastri International", "Varanasi", "IN", 25.4524, 82.8593, "Asia/Kolkata"),
            new AirportSeed("SXR", "Sheikh ul-Alam International", "Srinagar", "IN", 33.9871, 74.7742, "Asia/Kolkata"),
            new AirportSeed("GAU", "Lokpriya Gopinath Bordoloi International", "Guwahati", "IN", 26.1061, 91.5859, "Asia/Kolkata"),
            new AirportSeed("DXB", "Dubai International", "Dubai", "AE", 25.2532, 55.3657, "Asia/Dubai"),
            new AirportSeed("AUH", "Zayed International", "Abu Dhabi", "AE", 24.4330, 54.6511, "Asia/Dubai"),
            new AirportSeed("DOH", "Hamad International", "Doha", "QA", 25.2731, 51.6081, "Asia/Qatar"),
            new AirportSeed("JED", "King Abdulaziz International", "Jeddah", "SA", 21.6796, 39.1565, "Asia/Riyadh"),
            new AirportSeed("SIN", "Changi", "Singapore", "SG", 1.3644, 103.9915, "Asia/Singapore"),
            new AirportSeed("BKK", "Suvarnabhumi", "Bangkok", "TH", 13.6900, 100.7501, "Asia/Bangkok"),
            new AirportSeed("KUL", "Kuala Lumpur International", "Kuala Lumpur", "MY", 2.7456, 101.7099, "Asia/Kuala_Lumpur"),
            new AirportSeed("HKG", "Hong Kong International", "Hong Kong", "HK", 22.3080, 113.9185, "Asia/Hong_Kong"),
            new AirportSeed("NRT", "Narita International", "Tokyo", "JP", 35.7720, 140.3929, "Asia/Tokyo"),
            new AirportSeed("SYD", "Kingsford Smith", "Sydney", "AU", -33.9399, 151.1753, "Australia/Sydney"),
            new AirportSeed("LHR", "Heathrow", "London", "GB", 51.4700, -0.4543, "Europe/London"),
            new AirportSeed("CDG", "Charles de Gaulle", "Paris", "FR", 49.0097, 2.5479, "Europe/Paris"),
            new AirportSeed("FRA", "Frankfurt am Main", "Frankfurt", "DE", 50.0379, 8.5622, "Europe/Berlin"),
            new AirportSeed("AMS", "Schiphol", "Amsterdam", "NL", 52.3105, 4.7683, "Europe/Amsterdam"),
            new AirportSeed("JFK", "John F. Kennedy International", "New York", "US", 40.6413, -73.7781, "America/New_York"),
            new AirportSeed("CMB", "Bandaranaike International", "Colombo", "LK", 7.1808, 79.8841, "Asia/Colombo"),
            new AirportSeed("KTM", "Tribhuvan International", "Kathmandu", "NP", 27.6966, 85.3591, "Asia/Kathmandu"),
            new AirportSeed("DAC", "Hazrat Shahjalal International", "Dhaka", "BD", 23.8433, 90.3978, "Asia/Dhaka"),
            new AirportSeed("MLE", "Velana International", "Male", "MV", 4.1918, 73.5291, "Indian/Maldives"));

    private static final Map<String, String[]> AIRLINES = Map.ofEntries(
            Map.entry("AI", new String[] { "Air India", "IN" }), Map.entry("6E", new String[] { "IndiGo", "IN" }),
            Map.entry("SG", new String[] { "SpiceJet", "IN" }), Map.entry("QP", new String[] { "Akasa Air", "IN" }),
            Map.entry("IX", new String[] { "Air India Express", "IN" }), Map.entry("EK", new String[] { "Emirates", "AE" }),
            Map.entry("QR", new String[] { "Qatar Airways", "QA" }), Map.entry("EY", new String[] { "Etihad Airways", "AE" }),
            Map.entry("SQ", new String[] { "Singapore Airlines", "SG" }), Map.entry("TG", new String[] { "Thai Airways", "TH" }),
            Map.entry("BA", new String[] { "British Airways", "GB" }), Map.entry("LH", new String[] { "Lufthansa", "DE" }));

    /** cabin, fare type, name, checked kg, cabin kg, cancel fee %, price multiplier */
    private static final List<Object[]> FARES = List.of(
            new Object[] { "ECONOMY", "NON_REFUNDABLE", "Economy Saver", 15, 7, 100, "1.00" },
            new Object[] { "ECONOMY", "REFUNDABLE", "Economy Flex", 20, 7, 25, "1.22" },
            new Object[] { "PREMIUM_ECONOMY", "NON_REFUNDABLE", "Premium Saver", 25, 7, 100, "1.55" },
            new Object[] { "PREMIUM_ECONOMY", "REFUNDABLE", "Premium Flex", 30, 10, 20, "1.80" },
            new Object[] { "BUSINESS", "NON_REFUNDABLE", "Business Saver", 35, 10, 100, "3.40" },
            new Object[] { "BUSINESS", "REFUNDABLE", "Business Flex", 40, 12, 15, "3.80" },
            new Object[] { "FIRST", "NON_REFUNDABLE", "First Saver", 45, 12, 100, "5.50" },
            new Object[] { "FIRST", "REFUNDABLE", "First Flex", 50, 15, 10, "6.10" });

    private static final Set<String> HUBS = new TreeSet<>(Set.of("DEL", "BOM", "BLR", "MAA", "HYD", "CCU", "GOI",
            "AMD", "PNQ", "COK", "JAI"));
    private static final Set<String> INTERNATIONAL_GATEWAYS = new TreeSet<>(Set.of("DEL", "BOM", "BLR", "MAA", "HYD",
            "CCU", "COK"));
    private static final List<String> DOMESTIC = List.of("AI", "6E", "SG", "QP", "IX");

    private final JdbcClient jdbc;
    private final TransactionTemplate transaction;
    private final ReferenceData reference;

    public DemoDataSeeder(JdbcClient jdbc, TransactionTemplate transaction, ReferenceData reference) {
        this.jdbc = jdbc;
        this.transaction = transaction;
        this.reference = reference;
    }

    @Override
    public void run(ApplicationArguments args) {
        transaction.executeWithoutResult(status -> seed());
        reference.refresh();
    }

    void seed() {
        if (jdbc.sql("SELECT COUNT(*) FROM airports").query(Integer.class).single() == 0) {
            for (AirportSeed a : AIRPORTS) {
                jdbc.sql("INSERT INTO airports (iata_code, name, city, country_code, latitude, longitude, timezone) "
                                + "VALUES (:c, :n, :city, :cc, :lat, :lon, :tz)")
                        .param("c", a.code()).param("n", a.name()).param("city", a.city()).param("cc", a.country())
                        .param("lat", a.lat()).param("lon", a.lon()).param("tz", a.zone()).update();
            }
            AIRLINES.forEach((code, v) -> jdbc.sql("INSERT INTO airlines (iata_code, name, country_code) "
                    + "VALUES (:c, :n, :cc)").param("c", code).param("n", v[0]).param("cc", v[1]).update());
            for (Object[] f : FARES) {
                jdbc.sql("INSERT INTO demo_fare_families (cabin, fare_type, name, checked_baggage_kg, "
                                + "cabin_baggage_kg, cancel_fee_percent, price_multiplier) "
                                + "VALUES (:a, :b, :c, :d, :e, :f, :g)")
                        .param("a", f[0]).param("b", f[1]).param("c", f[2]).param("d", f[3]).param("e", f[4])
                        .param("f", f[5]).param("g", new BigDecimal((String) f[6])).update();
            }
            log.info("Demo airports, airlines and fare families created");
        }
        if (jdbc.sql("SELECT COUNT(*) FROM flight_providers").query(Integer.class).single() == 0) {
            jdbc.sql("INSERT INTO flight_providers (id, code, name, enabled, is_demo, priority, timeout_ms, "
                            + "health_status, created_at, updated_at, created_by, updated_by) VALUES "
                            + "(UUID_TO_BIN(:id), 'DEMO', 'Demo airline system', TRUE, TRUE, 1, 10000, 'UNKNOWN', "
                            + "UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'SYSTEM', 'SYSTEM')")
                    .param("id", UuidV7.generate().toString()).update();
        }
        if (jdbc.sql("SELECT COUNT(*) FROM demo_flight_schedules").query(Integer.class).single() == 0) {
            int count = generateSchedules();
            log.info("Demo flight schedules created: {}", count);
        }
    }

    // ------------------------------------------------------------------ schedules

    private int generateSchedules() {
        int count = 0;
        for (AirportSeed from : AIRPORTS) {
            for (AirportSeed to : AIRPORTS) {
                if (from.code().equals(to.code()) || !connected(from, to)) {
                    continue;
                }
                count += routeSchedules(from, to);
            }
        }
        return count;
    }

    private static boolean indian(AirportSeed a) {
        return "IN".equals(a.country());
    }

    /** Domestic: hubs among themselves and every airport to the main four; international: gateways to abroad. */
    private static boolean connected(AirportSeed from, AirportSeed to) {
        if (indian(from) && indian(to)) {
            boolean mainFrom = Set.of("DEL", "BOM", "BLR", "MAA").contains(from.code());
            boolean mainTo = Set.of("DEL", "BOM", "BLR", "MAA").contains(to.code());
            return (HUBS.contains(from.code()) && HUBS.contains(to.code())) || mainFrom || mainTo;
        }
        if (indian(from) != indian(to)) {
            AirportSeed india = indian(from) ? from : to;
            return INTERNATIONAL_GATEWAYS.contains(india.code());
        }
        return false;
    }

    private int routeSchedules(AirportSeed from, AirportSeed to) {
        Random random = new Random((from.code() + ">" + to.code()).hashCode());
        boolean international = !indian(from) || !indian(to);
        int km = (int) Math.round(distance(from, to));
        List<String> airlines = airlinesFor(from, to, international);
        int flights = international ? 2 + random.nextInt(2) : 3 + random.nextInt(2);
        int created = 0;
        for (int i = 0; i < flights; i++) {
            String airline = airlines.get((i + random.nextInt(airlines.size())) % airlines.size());
            int hour = 5 + (i * 17 / flights) + random.nextInt(3);
            int minute = 5 * random.nextInt(12);
            String via = null;
            int layover = 0;
            if (international && km > 5500 && !Set.of("EK", "QR", "EY").contains(airline)) {
                via = random.nextBoolean() ? "DXB" : "DOH";
            } else if (international && Set.of("EK", "QR", "EY").contains(airline) && km > 4000) {
                via = airline.equals("QR") ? "DOH" : airline.equals("EK") ? "DXB" : "AUH";
            } else if (!international && km > 1500 && random.nextInt(100) < 15) {
                via = List.of("DEL", "BOM", "HYD", "BLR").stream()
                        .filter(h -> !h.equals(from.code()) && !h.equals(to.code())).findFirst().orElse(null);
            }
            if (via != null && (via.equals(from.code()) || via.equals(to.code()))) {
                via = null;
            }
            if (via != null) {
                layover = 60 + 15 * random.nextInt(6);
            }
            double speed = international ? 800 : 700;
            int flying = (int) Math.round(km / speed * 60 + (international ? 50 : 40));
            if (via != null) {
                flying = (int) Math.round(flying * 1.12);
            }
            int duration = flying + layover;
            String days = random.nextInt(100) < 85 ? "1234567" : "1357";
            String number = airline + " " + (100 + random.nextInt(890));
            jdbc.sql("INSERT IGNORE INTO demo_flight_schedules (id, airline_code, flight_number, origin, destination, "
                            + "departure_local, duration_minutes, days_of_week, stops, via_airport, layover_minutes, "
                            + "international, distance_km, cabins) VALUES (UUID_TO_BIN(:id), :al, :fn, :o, :d, :t, "
                            + ":dur, :days, :stops, :via, :lay, :intl, :km, :cabins)")
                    .param("id", UuidV7.generate().toString()).param("al", airline).param("fn", number)
                    .param("o", from.code()).param("d", to.code()).param("t", LocalTime.of(hour % 24, minute))
                    .param("dur", duration).param("days", days).param("stops", via == null ? 0 : 1)
                    .param("via", via).param("lay", layover).param("intl", international).param("km", km)
                    .param("cabins", cabins(airline, international)).update();
            created++;
        }
        return created;
    }

    private static List<String> airlinesFor(AirportSeed from, AirportSeed to, boolean international) {
        if (!international) {
            return DOMESTIC;
        }
        AirportSeed abroad = indian(from) ? to : from;
        return switch (abroad.code()) {
            case "DXB", "AUH", "DOH", "JED" -> List.of("EK", "QR", "EY", "AI", "IX", "6E");
            case "SIN", "BKK", "KUL", "HKG" -> List.of("SQ", "TG", "AI", "6E");
            case "LHR", "CDG", "FRA", "AMS", "JFK", "SYD", "NRT" -> List.of("BA", "LH", "AI", "EK", "QR");
            default -> List.of("AI", "6E", "IX");
        };
    }

    private static String cabins(String airline, boolean international) {
        if (!international) {
            return switch (airline) {
                case "AI" -> "ECONOMY,PREMIUM_ECONOMY,BUSINESS";
                case "6E" -> "ECONOMY,BUSINESS";
                default -> "ECONOMY";
            };
        }
        return switch (airline) {
            case "EK", "QR", "EY", "SQ", "BA", "LH" -> "ECONOMY,PREMIUM_ECONOMY,BUSINESS,FIRST";
            case "AI", "TG" -> "ECONOMY,PREMIUM_ECONOMY,BUSINESS";
            default -> "ECONOMY";
        };
    }

    private static double distance(AirportSeed a, AirportSeed b) {
        double r = 6371.0;
        double dLat = Math.toRadians(b.lat() - a.lat());
        double dLon = Math.toRadians(b.lon() - a.lon());
        double h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(Math.toRadians(a.lat()))
                * Math.cos(Math.toRadians(b.lat())) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * r * Math.asin(Math.sqrt(h));
    }

    List<AirportSeed> airports() {
        return new ArrayList<>(AIRPORTS);
    }
}
