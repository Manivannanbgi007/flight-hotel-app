package com.flighthotel.common.dev;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.flighthotel.common.security.Roles;

/**
 * <b>Development only.</b> The one story every development seeder tells ({@code DEV_SEED_ENABLED}): who the people
 * are, which hotels and flights exist, and which bookings the two test customers have in every state.
 * <p>
 * Services never call each other to seed. Each one writes its own tables from this description, and every record
 * refers to the others by deterministic id ({@link DevIds}), so the pieces fit even though the services start in any
 * order. Dates are offsets from "today" (India), amounts follow the real rules: hotel GST per room and night (5 % up
 * to Rs 7,500 a night, else 18 %), flight fares with fuel charges and GST 5 %.
 */
public final class DevScenario {

    public static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    public static final String DOMAIN = "@flighthotel.local";

    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final DateTimeFormatter LOCAL = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm");
    private static final DateTimeFormatter DEADLINE = DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm", Locale.ENGLISH);

    /** A free cancellation window of 48 hours, then half of the stay price is charged (flexible hotel rate). */
    public static final int FLEX_FREE_HOURS = 48;
    public static final int FLEX_FEE_PERCENT = 50;
    /** Hotel check-in and check-out times of every seeded hotel. */
    public static final LocalTime CHECK_IN = LocalTime.of(14, 0);
    public static final LocalTime CHECK_OUT = LocalTime.of(11, 0);

    private DevScenario() {
    }

    // =================================================================== people

    public record Person(String key, String email, String firstName, String lastName, String phone, String role,
            LocalDate dateOfBirth) {

        public UUID id() {
            return DevIds.user(email);
        }

        public String fullName() {
            return firstName + " " + lastName;
        }
    }

    public static final Person ADMIN = new Person("admin", "dev.admin" + DOMAIN, "Dev", "Admin", "+919810000001",
            Roles.ADMIN, LocalDate.of(1985, 3, 14));
    public static final Person CUSTOMER1 = new Person("customer1", "dev.customer1" + DOMAIN, "Aarav", "Mehta",
            "+919810000002", Roles.CUSTOMER, LocalDate.of(1988, 4, 12));
    public static final Person CUSTOMER2 = new Person("customer2", "dev.customer2" + DOMAIN, "Priya", "Nair",
            "+919810000003", Roles.CUSTOMER, LocalDate.of(1992, 7, 18));
    public static final Person MANAGER1 = new Person("manager1", "dev.manager1" + DOMAIN, "Rohan", "Iyer",
            "+919810000004", Roles.HOTEL_MANAGER, LocalDate.of(1983, 11, 2));
    public static final Person MANAGER2 = new Person("manager2", "dev.manager2" + DOMAIN, "Sneha", "Kulkarni",
            "+919810000005", Roles.HOTEL_MANAGER, LocalDate.of(1990, 1, 27));
    public static final Person SUPPORT1 = new Person("support1", "dev.support1" + DOMAIN, "Vikram", "Singh",
            "+919810000006", Roles.SUPPORT_AGENT, LocalDate.of(1991, 6, 8));

    public static final List<Person> PEOPLE = List.of(ADMIN, CUSTOMER1, CUSTOMER2, MANAGER1, MANAGER2, SUPPORT1);

    public static Person person(String key) {
        return PEOPLE.stream().filter(p -> p.key().equals(key)).findFirst().orElseThrow();
    }

    // =================================================================== hotels

    /**
     * @param key     globally unique, for example {@code arabian-sands/garden-view}
     * @param flex    "Flexible with breakfast": free cancellation first, then a fee
     * @param saver   "Saver (non-refundable)"
     */
    public record RoomDef(String key, String name, String description, int maxAdults, int maxChildren, String beds,
            int sizeSqm, int totalRooms, int flexPrice, int saverPrice, Set<String> amenities) {

        public UUID id() {
            return DevIds.of("room", key);
        }

        public UUID planId(boolean flexible) {
            return DevIds.of("rateplan", key + ":" + (flexible ? "flex" : "saver"));
        }

        public String planName(boolean flexible) {
            return flexible ? "Flexible with breakfast" : "Saver (non-refundable)";
        }

        public int price(boolean flexible) {
            return flexible ? flexPrice : saverPrice;
        }
    }

    public record HotelDef(String key, String name, String slug, String city, String state, String propertyType,
            int stars, String address, String postalCode, double latitude, double longitude, String description,
            Set<String> amenities, List<RoomDef> rooms, List<String> managerKeys) {

        public UUID id() {
            return DevIds.of("hotel", key);
        }

        public RoomDef room(String roomKey) {
            return rooms.stream().filter(r -> r.key().equals(roomKey)).findFirst().orElseThrow();
        }
    }

    private static final Set<String> COMFORT_ROOM = Set.of("AIR_CONDITIONING", "TV", "SAFE", "KETTLE", "WORK_DESK",
            "HAIR_DRYER");
    private static final Set<String> LUXURY_ROOM = Set.of("AIR_CONDITIONING", "TV", "SAFE", "MINIBAR", "KETTLE",
            "BATHTUB", "HAIR_DRYER", "WORK_DESK");

    public static final List<HotelDef> HOTELS = List.of(
            new HotelDef("arabian-sands", "Arabian Sands Beach Resort", "arabian-sands-beach-resort-goa", "Goa", "Goa",
                    "RESORT", 4, "Beach Road, Calangute", "403516", 15.5470, 73.7580,
                    "A relaxed beach resort a short walk from Calangute Beach, with a lagoon pool, a spa and a kids' "
                            + "club. Development test data: this hotel does not exist.",
                    Set.of("POOL", "SPA", "RESTAURANT", "BAR", "FREE_WIFI", "BEACH_ACCESS", "PARKING",
                            "AIRPORT_SHUTTLE", "KIDS_CLUB"),
                    List.of(new RoomDef("arabian-sands/garden-view", "Garden View Room",
                                    "Bright room facing the tropical garden, with a private balcony.", 2, 1, "1 King bed",
                                    28, 20, 6800, 5900, with(COMFORT_ROOM, "BALCONY")),
                            new RoomDef("arabian-sands/sea-view-suite", "Sea View Suite",
                                    "Separate living area and a balcony facing the sea.", 2, 2, "1 King bed + sofa bed",
                                    45, 8, 12900, 11200, with(LUXURY_ROOM, "BALCONY", "SEA_VIEW"))),
                    List.of("manager1")),
            new HotelDef("orchid-business", "Orchid Business Hotel", "orchid-business-hotel-bengaluru", "Bengaluru",
                    "Karnataka", "HOTEL", 4, "Residency Road", "560025", 12.9716, 77.5946,
                    "Modern business hotel near MG Road with fast Wi-Fi, meeting rooms and EV charging. Development "
                            + "test data: this hotel does not exist.",
                    Set.of("FREE_WIFI", "GYM", "RESTAURANT", "BUSINESS_CENTRE", "PARKING", "EV_CHARGING",
                            "FRONT_DESK_24H", "ROOM_SERVICE"),
                    List.of(new RoomDef("orchid-business/superior-queen", "Superior Queen Room",
                                    "Quiet room with a queen bed and a work desk.", 2, 0, "1 Queen bed", 24, 30, 5400,
                                    4700, with(COMFORT_ROOM, "CITY_VIEW")),
                            new RoomDef("orchid-business/executive-king", "Executive King Room",
                                    "Larger room on a high floor with a lounge corner.", 2, 1, "1 King bed", 34, 12,
                                    8200, 7300, with(LUXURY_ROOM, "CITY_VIEW"))),
                    List.of("manager1")),
            new HotelDef("rajputana-haveli", "Rajputana Heritage Haveli", "rajputana-heritage-haveli-jaipur", "Jaipur",
                    "Rajasthan", "HOTEL", 5, "Amer Road", "302002", 26.9330, 75.8150,
                    "A restored haveli with courtyards, a rooftop restaurant and a spa, ten minutes from the old "
                            + "city. Development test data: this hotel does not exist.",
                    Set.of("POOL", "SPA", "RESTAURANT", "FREE_WIFI", "PARKING", "ROOM_SERVICE", "FRONT_DESK_24H",
                            "WHEELCHAIR_ACCESSIBLE"),
                    List.of(new RoomDef("rajputana-haveli/heritage-deluxe", "Heritage Deluxe Room",
                                    "Hand-painted walls, a canopy bed and a courtyard view.", 2, 1, "1 King bed", 32, 14,
                                    9800, 8600, with(LUXURY_ROOM, "BALCONY")),
                            new RoomDef("rajputana-haveli/maharaja-suite", "Maharaja Suite",
                                    "Two-room suite with a private terrace and a dining area.", 3, 2,
                                    "1 King bed + 2 Single beds", 70, 4, 19500, 17200, with(LUXURY_ROOM, "BALCONY"))),
                    List.of("manager2")));

    private static Set<String> with(Set<String> base, String... extra) {
        java.util.Set<String> all = new java.util.HashSet<>(base);
        all.addAll(List.of(extra));
        return Set.copyOf(all);
    }

    public static HotelDef hotel(String key) {
        return HOTELS.stream().filter(h -> h.key().equals(key)).findFirst().orElseThrow();
    }

    // =================================================================== outcomes

    /** What became of a booking. The same word is used by every service for its own rows. */
    public enum Outcome {
        /** Held and waiting for payment, no attempt made yet. */
        AWAITING_PAYMENT,
        /** Held; the customer's payment attempt failed and may be repeated. */
        PAYMENT_FAILED,
        /** Paid and confirmed, still to come. */
        CONFIRMED,
        /** Hotel only: the guests are in the hotel right now. */
        IN_HOUSE,
        /** Paid, trip is over. */
        COMPLETED,
        /** Hotel only: the guests never arrived (no refund). */
        NO_SHOW,
        /** Cancelled by the customer in the free period: everything refunded. */
        CANCELLED_REFUNDED,
        /** Cancelled by the customer after the free period: a fee was kept. */
        CANCELLED_PARTIAL,
        /** Hotel only: cancelled by the hotel (overbooking), everything refunded. */
        CANCELLED_BY_HOTEL;

        public boolean paid() {
            return this != AWAITING_PAYMENT && this != PAYMENT_FAILED;
        }

        public boolean held() {
            return this == AWAITING_PAYMENT || this == PAYMENT_FAILED;
        }

        public boolean cancelled() {
            return this == CANCELLED_REFUNDED || this == CANCELLED_PARTIAL || this == CANCELLED_BY_HOTEL;
        }
    }

    // =================================================================== hotel stays

    /**
     * @param customer       person key
     * @param room           {@link RoomDef#key()}
     * @param checkInOffset  days from today (negative: in the past)
     * @param bookedDaysAgo  when the booking was made
     */
    public record Stay(String key, String customer, String hotel, String room, boolean flex, int checkInOffset,
            int nights, int rooms, int adults, int children, Outcome outcome, int bookedDaysAgo, String requests) {

        public UUID bookingId() {
            return DevIds.of("booking", key);
        }

        public UUID reservationId() {
            return DevIds.of("reservation", key);
        }

        public UUID paymentId() {
            return DevIds.of("payment", key);
        }

        public UUID quoteId() {
            return DevIds.of("quote", key);
        }

        public String reference() {
            return DevIds.code("HT-DEV", key, 5);
        }

        public String confirmationNumber() {
            return DevIds.code("HDEV", key, 6);
        }

        public Person person() {
            return DevScenario.person(customer);
        }

        public HotelDef hotelDef() {
            return DevScenario.hotel(hotel);
        }

        public RoomDef roomDef() {
            return hotelDef().room(room);
        }

        public LocalDate checkIn(LocalDate today) {
            return today.plusDays(checkInOffset);
        }

        public LocalDate checkOut(LocalDate today) {
            return checkIn(today).plusDays(nights);
        }

        public Instant checkInAt(LocalDate today) {
            return checkIn(today).atTime(CHECK_IN).atZone(INDIA).toInstant();
        }

        public Instant bookedAt(Instant now) {
            return DevScenario.bookedAt(now, key, bookedDaysAgo);
        }

        /** The last moment to cancel for free (flexible rate), else null. */
        public Instant freeCancellationUntil(LocalDate today) {
            return flex ? checkInAt(today).minusSeconds(FLEX_FREE_HOURS * 3600L) : null;
        }

        public int feePercent() {
            return flex ? FLEX_FEE_PERCENT : 100;
        }

        /** The terms the customer accepted, as hotel-service words them. */
        public String cancellationPolicy(LocalDate today) {
            if (!flex) {
                return "Non-refundable: the full amount is charged if you cancel.";
            }
            ZonedDateTime until = freeCancellationUntil(today).atZone(INDIA);
            return "Free cancellation until " + DEADLINE.format(until) + " (hotel local time); after that "
                    + FLEX_FEE_PERCENT + "% of the total is charged.";
        }

        /** When a cancelled stay was cancelled. */
        public Instant cancelledAt(Instant now, LocalDate today) {
            return switch (outcome) {
                case CANCELLED_REFUNDED -> checkInAt(today).minusSeconds(5 * 86_400L);
                case CANCELLED_PARTIAL -> checkInAt(today).minusSeconds(30 * 3600L);
                case CANCELLED_BY_HOTEL -> now.minusSeconds(2 * 86_400L);
                default -> null;
            };
        }

        public StayPrice price() {
            return DevScenario.price(this);
        }

        /** Customer cancellations after the free period keep a share of the stay price (rooms + GST). */
        public BigDecimal cancellationFee() {
            if (outcome != Outcome.CANCELLED_PARTIAL) {
                return BigDecimal.ZERO.setScale(2);
            }
            StayPrice price = price();
            return price.subtotal().add(price.taxes()).multiply(BigDecimal.valueOf(feePercent()))
                    .divide(HUNDRED, 2, RoundingMode.HALF_UP);
        }

        /** What went back to the customer (0 for stays that are not cancelled). */
        public BigDecimal refund() {
            return outcome.cancelled() ? price().total().subtract(cancellationFee()) : BigDecimal.ZERO.setScale(2);
        }

        public List<String[]> guests() {
            List<String[]> names = new ArrayList<>();
            names.add(new String[] {person().firstName(), person().lastName()});
            if (rooms > 1) {
                names.add(customer.equals("customer1") ? new String[] {"Ananya", "Mehta"}
                        : new String[] {"Suresh", "Nair"});
            }
            return names;
        }
    }

    /**
     * @param taxByRate GST per percentage, in rate order (labels "GST 5%" and "GST 18%")
     */
    public record StayPrice(BigDecimal subtotal, BigDecimal taxes, BigDecimal total, Map<BigDecimal, BigDecimal> taxByRate) {
    }

    /** The real pricing rule (hotel-service PricingService with default settings): GST per room and night. */
    public static StayPrice price(Stay stay) {
        BigDecimal perNight = BigDecimal.valueOf(stay.roomDef().price(stay.flex())).setScale(2);
        BigDecimal rate = perNight.compareTo(BigDecimal.valueOf(7500)) <= 0 ? BigDecimal.valueOf(5)
                : BigDecimal.valueOf(18);
        BigDecimal taxPerRoom = perNight.multiply(rate).divide(HUNDRED, 2, RoundingMode.HALF_UP);
        BigDecimal roomNights = BigDecimal.valueOf((long) stay.nights() * stay.rooms());
        BigDecimal subtotal = perNight.multiply(roomNights).setScale(2);
        BigDecimal taxes = taxPerRoom.multiply(roomNights).setScale(2);
        Map<BigDecimal, BigDecimal> byRate = new LinkedHashMap<>();
        byRate.put(rate, taxes);
        return new StayPrice(subtotal, taxes, subtotal.add(taxes), byRate);
    }

    public static final List<Stay> STAYS = List.of(
            // customer1
            new Stay("h01", "customer1", "arabian-sands", "arabian-sands/sea-view-suite", true, -40, 3, 1, 2, 1,
                    Outcome.COMPLETED, 60, "Late check-out if possible, we travel with a child."),
            new Stay("h02", "customer1", "orchid-business", "orchid-business/executive-king", true, -20, 2, 1, 1, 0,
                    Outcome.COMPLETED, 28, "Quiet room away from the lift, please."),
            new Stay("h03", "customer1", "arabian-sands", "arabian-sands/garden-view", true, 12, 4, 1, 2, 0,
                    Outcome.CONFIRMED, 5, "Early check-in around 11 am if the room is ready."),
            new Stay("h04", "customer1", "rajputana-haveli", "rajputana-haveli/heritage-deluxe", false, 30, 2, 1, 2, 0,
                    Outcome.AWAITING_PAYMENT, 0, null),
            new Stay("h09", "customer1", "orchid-business", "orchid-business/superior-queen", false, -10, 2, 1, 2, 0,
                    Outcome.NO_SHOW, 20, null),
            new Stay("h12", "customer1", "rajputana-haveli", "rajputana-haveli/heritage-deluxe", true, -90, 2, 1, 2, 0,
                    Outcome.COMPLETED, 100, null),
            new Stay("h14", "customer1", "orchid-business", "orchid-business/superior-queen", true, -75, 2, 1, 2, 0,
                    Outcome.COMPLETED, 85, null),
            new Stay("h16", "customer1", "arabian-sands", "arabian-sands/garden-view", true, -30, 2, 1, 2, 0,
                    Outcome.CANCELLED_PARTIAL, 45, null),
            // customer2
            new Stay("h05", "customer2", "orchid-business", "orchid-business/superior-queen", true, 5, 2, 1, 2, 0,
                    Outcome.CONFIRMED, 3, "Twin beds are not needed, a queen bed is fine."),
            new Stay("h06", "customer2", "rajputana-haveli", "rajputana-haveli/maharaja-suite", true, -1, 3, 1, 3, 1,
                    Outcome.IN_HOUSE, 14, "Birthday dinner on the terrace on the second evening."),
            new Stay("h07", "customer2", "arabian-sands", "arabian-sands/garden-view", true, -60, 2, 1, 2, 0,
                    Outcome.CANCELLED_REFUNDED, 75, null),
            new Stay("h08", "customer2", "rajputana-haveli", "rajputana-haveli/heritage-deluxe", true, 20, 2, 1, 2, 0,
                    Outcome.CANCELLED_BY_HOTEL, 25, null),
            new Stay("h10", "customer2", "arabian-sands", "arabian-sands/sea-view-suite", false, 45, 3, 2, 4, 2,
                    Outcome.PAYMENT_FAILED, 1, null),
            new Stay("h11", "customer2", "orchid-business", "orchid-business/executive-king", true, -35, 2, 1, 2, 0,
                    Outcome.COMPLETED, 40, null),
            new Stay("h13", "customer2", "arabian-sands", "arabian-sands/garden-view", true, -120, 2, 1, 2, 0,
                    Outcome.COMPLETED, 135, null),
            new Stay("h15", "customer2", "rajputana-haveli", "rajputana-haveli/heritage-deluxe", true, -50, 2, 1, 2, 0,
                    Outcome.COMPLETED, 60, null));

    public static Stay stay(String key) {
        return STAYS.stream().filter(s -> s.key().equals(key)).findFirst().orElseThrow();
    }

    // =================================================================== flights

    public record Airport(String code, String name, String city) {
    }

    private static final Map<String, Airport> AIRPORTS = Map.of(
            "DEL", new Airport("DEL", "Indira Gandhi International", "Delhi"),
            "BOM", new Airport("BOM", "Chhatrapati Shivaji Maharaj International", "Mumbai"),
            "BLR", new Airport("BLR", "Kempegowda International", "Bengaluru"),
            "GOI", new Airport("GOI", "Dabolim", "Goa"),
            "HYD", new Airport("HYD", "Rajiv Gandhi International", "Hyderabad"),
            "MAA", new Airport("MAA", "Chennai International", "Chennai"));

    public static Airport airport(String code) {
        return AIRPORTS.get(code);
    }

    /**
     * A non-stop domestic flight of the development timetable (flight-service adds it as a schedule).
     * Fares are per adult, economy.
     */
    public record FlightDef(String key, String number, String airlineCode, String airlineName, String origin,
            String destination, LocalTime departure, int durationMinutes, int saverFare, int flexFare) {

        public UUID scheduleId() {
            return DevIds.of("schedule", key);
        }

        public String departureLocal(LocalDate date) {
            return date.atTime(departure).format(LOCAL);
        }

        public String arrivalLocal(LocalDate date) {
            return date.atTime(departure).plusMinutes(durationMinutes).format(LOCAL);
        }

        public Instant departureAt(LocalDate date) {
            return date.atTime(departure).atZone(INDIA).toInstant();
        }

        public int fare(boolean flexible) {
            return flexible ? flexFare : saverFare;
        }
    }

    public static final List<FlightDef> FLIGHTS = List.of(
            new FlightDef("del-bom", "6E 7101", "6E", "IndiGo", "DEL", "BOM", LocalTime.of(7, 15), 130, 4860, 5930),
            new FlightDef("bom-del", "6E 7102", "6E", "IndiGo", "BOM", "DEL", LocalTime.of(19, 40), 125, 4910, 5990),
            new FlightDef("blr-del", "AI 9205", "AI", "Air India", "BLR", "DEL", LocalTime.of(6, 30), 175, 6240, 7610),
            new FlightDef("del-blr", "AI 9206", "AI", "Air India", "DEL", "BLR", LocalTime.of(18, 5), 180, 6380, 7780),
            new FlightDef("bom-goi", "QP 1411", "QP", "Akasa Air", "BOM", "GOI", LocalTime.of(9, 20), 70, 3180, 3880),
            new FlightDef("hyd-maa", "6E 7233", "6E", "IndiGo", "HYD", "MAA", LocalTime.of(14, 10), 85, 3340, 4070),
            new FlightDef("maa-blr", "6E 7310", "6E", "IndiGo", "MAA", "BLR", LocalTime.of(11, 0), 65, 2960, 3610));

    public static FlightDef flight(String key) {
        return FLIGHTS.stream().filter(f -> f.key().equals(key)).findFirst().orElseThrow();
    }

    /** A saved or booked traveller. {@code type}: ADULT, CHILD or INFANT; {@code gender}: MALE, FEMALE or OTHER. */
    public record Traveller(String key, String owner, String firstName, String lastName, String type,
            LocalDate dateOfBirth, String gender, String passportNumber, LocalDate passportExpiry) {

        public UUID savedId() {
            return DevIds.of("passenger", key);
        }
    }

    public static final List<Traveller> TRAVELLERS = List.of(
            new Traveller("c1-self", "customer1", "Aarav", "Mehta", "ADULT", LocalDate.of(1988, 4, 12), "MALE",
                    "K1234567", LocalDate.of(2032, 8, 14)),
            new Traveller("c1-spouse", "customer1", "Ananya", "Mehta", "ADULT", LocalDate.of(1990, 9, 3), "FEMALE", null,
                    null),
            new Traveller("c1-child", "customer1", "Kabir", "Mehta", "CHILD", LocalDate.of(2017, 2, 20), "MALE", null,
                    null),
            new Traveller("c2-self", "customer2", "Priya", "Nair", "ADULT", LocalDate.of(1992, 7, 18), "FEMALE",
                    "P7654321", LocalDate.of(2031, 5, 2)),
            new Traveller("c2-father", "customer2", "Suresh", "Nair", "ADULT", LocalDate.of(1960, 1, 9), "MALE", null,
                    null),
            new Traveller("c2-niece", "customer2", "Meera", "Nair", "CHILD", LocalDate.of(2016, 11, 5), "FEMALE", null,
                    null));

    public static Traveller traveller(String key) {
        return TRAVELLERS.stream().filter(t -> t.key().equals(key)).findFirst().orElseThrow();
    }

    /** @param dayOffset departure date, days from today */
    public record Leg(String flight, int dayOffset) {

        public FlightDef def() {
            return DevScenario.flight(flight);
        }

        public LocalDate date(LocalDate today) {
            return today.plusDays(dayOffset);
        }
    }

    public record Trip(String key, String customer, List<Leg> legs, boolean flex, List<String> travellers,
            Outcome outcome, int bookedDaysAgo) {

        public UUID bookingId() {
            return DevIds.of("booking", key);
        }

        public UUID paymentId() {
            return DevIds.of("payment", key);
        }

        public String reference() {
            return DevIds.code("FL-DEV", key, 5);
        }

        public String pnr() {
            return DevIds.code("", key + ":pnr", 6);
        }

        /** The ticket number of a passenger (1-based, adults first), the same in every service. */
        public String ticket(int passengerNo) {
            return "098" + DevIds.digits(key + ":ticket:" + passengerNo, 10);
        }

        public String supplierOrderId() {
            return "DO" + DevIds.digits(key + ":order", 10);
        }

        public String offerId() {
            return DevIds.of("offer", key).toString().replace("-", "").substring(0, 32);
        }

        public Person person() {
            return DevScenario.person(customer);
        }

        public List<Traveller> people() {
            return travellers.stream().map(DevScenario::traveller).toList();
        }

        public int count(String type) {
            return (int) people().stream().filter(t -> t.type().equals(type)).count();
        }

        public int seats() {
            return count("ADULT") + count("CHILD");
        }

        public boolean roundTrip() {
            return legs.size() == 2;
        }

        public String title() {
            FlightDef first = legs.getFirst().def();
            return airport(first.origin()).city() + " to " + airport(first.destination()).city();
        }

        public int feePercent() {
            return flex ? 25 : 100;
        }

        public Instant bookedAt(Instant now) {
            return DevScenario.bookedAt(now, key, bookedDaysAgo);
        }

        public Instant departureAt(LocalDate today) {
            return legs.getFirst().def().departureAt(legs.getFirst().date(today));
        }

        public Instant cancelledAt(LocalDate today) {
            return outcome.cancelled() ? departureAt(today).minusSeconds(3 * 86_400L) : null;
        }

        public String fareName() {
            return flex ? "Economy Flex" : "Economy Saver";
        }

        public String fareType() {
            return flex ? "REFUNDABLE" : "NON_REFUNDABLE";
        }

        public int checkedBaggageKg() {
            return flex ? 20 : 15;
        }

        /** The words flight-service gives the fare. */
        public String fareCancellationPolicy() {
            return flex ? "Cancel up to 4 hours before departure for a fee of 25% of the fare. Taxes and airline "
                    + "charges are refunded."
                    : "Non-refundable: the fare is not refunded if you cancel. Taxes and airline charges may be refunded.";
        }

        public String cancellationPolicy() {
            if (legs.size() == 1) {
                return fareCancellationPolicy();
            }
            return "Outbound: " + fareCancellationPolicy() + " Return: " + fareCancellationPolicy();
        }

        public TripPrice price() {
            return DevScenario.price(this);
        }

        public BigDecimal cancellationFee() {
            if (outcome != Outcome.CANCELLED_PARTIAL) {
                return BigDecimal.ZERO.setScale(2);
            }
            return price().subtotal().multiply(BigDecimal.valueOf(feePercent())).divide(HUNDRED, 2,
                    RoundingMode.HALF_UP);
        }

        public BigDecimal refund() {
            return outcome.cancelled() ? price().total().subtract(cancellationFee()) : BigDecimal.ZERO.setScale(2);
        }
    }

    public record PriceLine(String label, BigDecimal amount) {
    }

    public record TripPrice(List<PriceLine> lines, BigDecimal subtotal, BigDecimal taxes, BigDecimal total) {
    }

    /** The development airline's pricing, per leg, merged by line label like the real trip price. */
    public static TripPrice price(Trip trip) {
        Map<String, BigDecimal> lines = new LinkedHashMap<>();
        BigDecimal subtotal = BigDecimal.ZERO;
        BigDecimal taxes = BigDecimal.ZERO;
        int adults = trip.count("ADULT");
        int children = trip.count("CHILD");
        int infants = trip.count("INFANT");
        for (Leg leg : trip.legs()) {
            BigDecimal adult = BigDecimal.valueOf(leg.def().fare(trip.flex())).setScale(2);
            BigDecimal child = rupees(adult.doubleValue() * 0.75);
            BigDecimal infant = rupees(adult.doubleValue() * 0.10);
            BigDecimal fares = BigDecimal.ZERO;
            fares = fare(lines, fares, "adult", adults, adult);
            fares = fare(lines, fares, "child", children, child);
            fares = fare(lines, fares, "infant", infants, infant);
            BigDecimal fees = BigDecimal.valueOf(450L * (adults + children)).setScale(2);
            BigDecimal gst = fares.multiply(BigDecimal.valueOf(5)).divide(HUNDRED, 2, RoundingMode.HALF_UP);
            lines.merge("Fuel and airport charges", fees, BigDecimal::add);
            lines.merge("GST 5%", gst, BigDecimal::add);
            subtotal = subtotal.add(fares);
            taxes = taxes.add(fees).add(gst);
        }
        List<PriceLine> result = new ArrayList<>();
        lines.forEach((label, amount) -> result.add(new PriceLine(label, amount)));
        return new TripPrice(result, subtotal, taxes, subtotal.add(taxes));
    }

    private static BigDecimal fare(Map<String, BigDecimal> lines, BigDecimal sum, String type, int count,
            BigDecimal each) {
        if (count == 0) {
            return sum;
        }
        BigDecimal amount = each.multiply(BigDecimal.valueOf(count));
        lines.merge("Fare · " + count + " " + type + (count == 1 ? "" : "s"), amount, BigDecimal::add);
        return sum.add(amount);
    }

    private static BigDecimal rupees(double amount) {
        return BigDecimal.valueOf(Math.round(amount / 10.0) * 10L).setScale(2);
    }

    public static final List<Trip> TRIPS = List.of(
            // customer1
            new Trip("f01", "customer1", List.of(new Leg("del-bom", -25)), false, List.of("c1-self"),
                    Outcome.COMPLETED, 35),
            new Trip("f02", "customer1", List.of(new Leg("blr-del", 15), new Leg("del-blr", 20)), true,
                    List.of("c1-self", "c1-spouse"), Outcome.CONFIRMED, 6),
            new Trip("f05", "customer1", List.of(new Leg("maa-blr", -50)), true, List.of("c1-self"),
                    Outcome.CANCELLED_PARTIAL, 60),
            new Trip("f07", "customer1", List.of(new Leg("bom-del", 10)), false, List.of("c1-self"),
                    Outcome.PAYMENT_FAILED, 1),
            // customer2
            new Trip("f03", "customer2", List.of(new Leg("bom-goi", 3)), false, List.of("c2-self", "c2-niece"),
                    Outcome.CONFIRMED, 4),
            new Trip("f04", "customer2", List.of(new Leg("hyd-maa", 45)), true, List.of("c2-self"),
                    Outcome.AWAITING_PAYMENT, 0),
            new Trip("f06", "customer2", List.of(new Leg("del-bom", -30)), false, List.of("c2-self"),
                    Outcome.COMPLETED, 40));

    public static Trip trip(String key) {
        return TRIPS.stream().filter(t -> t.key().equals(key)).findFirst().orElseThrow();
    }

    // =================================================================== time

    /** Today in India, the day every offset counts from. */
    public static LocalDate today(java.time.Clock clock) {
        return LocalDate.now(clock.withZone(INDIA));
    }

    /**
     * When a booking was made: {@code daysAgo} days before now plus a stable one to eight hours (so bookings made
     * "today" are a few hours old and different bookings do not share a timestamp).
     */
    static Instant bookedAt(Instant now, String key, int daysAgo) {
        long minutes = 60 + Math.floorMod(key.hashCode(), 420);
        return now.minusSeconds(daysAgo * 86_400L + minutes * 60L);
    }

    /** How long the unpaid holds of the seed stay open: long enough that they stay "pending" for a month. */
    public static final java.time.Duration PENDING_HOLD = java.time.Duration.ofDays(30);

    public static LocalDateTime localDateTime(Instant instant) {
        return LocalDateTime.ofInstant(instant, INDIA);
    }
}
