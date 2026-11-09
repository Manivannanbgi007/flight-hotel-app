package com.flighthotel.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.function.Predicate;
import java.util.stream.Stream;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.jayway.jsonpath.JsonPath;

/**
 * Phase 11 customer dashboard ({@code GET /api/bookings/summary}): every figure against the bookings it comes from.
 * One customer's bookings cover every story (completed, cancelled and refunded, refund on its way, never paid, paid but
 * never confirmed, goodwill and duplicate payment refunds, waiting for payment, a cancellation request) on both sides
 * of India month and year boundaries, plus upcoming trips; another customer's bookings must never show.
 */
class CustomerSummaryIntegrationTest extends BookingIntegrationTest {

    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final String YEAR_2025 = "range=CUSTOM&from=2025-01-01&to=2025-12-31";

    /** A booking as the test wrote it into the database. */
    record Row(UUID id, String type, String status, boolean paid, Instant confirmedAt, Instant cancelledAt,
            BigDecimal total, BigDecimal refunded, Instant createdAt, LocalDate start, LocalDate end) {

        LocalDate day() {
            return createdAt.atZone(INDIA).toLocalDate();
        }

        boolean confirmed() {
            return confirmedAt != null;
        }

        boolean cancelled() {
            return cancelledAt != null;
        }
    }

    record Refund(UUID bookingId, BigDecimal amount, String reason, String status) {
    }

    private final List<Row> rows = new ArrayList<>();
    private final List<Refund> refunds = new ArrayList<>();
    private UUID customer;
    private LocalDate today;
    private UUID nextFlight;

    @BeforeEach
    void oneCustomersBookings() {
        customer = UUID.randomUUID();
        today = LocalDate.now(INDIA);
        Instant now = Instant.now();

        Row completedStay = add(customer, "HOTEL", "COMPLETED", true, true, null, "12000.00", "0", "2025-01-10T05:00:00Z");
        // 00:30 on 1 February in India (still 31 January in UTC): a February booking.
        add(customer, "FLIGHT", "COMPLETED", true, true, null, "8450.50", "0", "2025-01-31T19:00:00Z");
        Row refundedStay = add(customer, "HOTEL", "REFUNDED", true, true, Instant.parse("2025-03-20T10:00:00Z"),
                "10000.00", "7500.00", "2025-03-15T10:00:00Z");
        refund(refundedStay, "7500.00", "CANCELLATION", "COMPLETED");
        // 23:59 on 31 March in India: still March. The refund is on its way.
        Row refundPending = add(customer, "FLIGHT", "REFUND_PENDING", true, true,
                Instant.parse("2025-04-02T10:00:00Z"), "6000.00", "0", "2025-03-31T18:29:00Z");
        refund(refundPending, "4500.00", "CANCELLATION", "REQUESTED");
        add(customer, "HOTEL", "EXPIRED", false, false, null, "5000.00", "0", "2025-05-05T08:00:00Z");
        // Paid, but the airline could not confirm: refunded in full, never a trip.
        Row neverConfirmed = add(customer, "FLIGHT", "REFUNDED", true, false, null, "7000.00", "7000.00",
                "2025-06-06T08:00:00Z");
        refund(neverConfirmed, "7000.00", "BOOKING_FAILED", "COMPLETED");
        // Confirmed (its stay is over; the nightly job has not completed it yet), a goodwill refund, and a second
        // payment that was given back at once (never the booking's money, whether done or still on its way).
        Row goodwill = add(customer, "HOTEL", "CONFIRMED", true, true, null, "9000.00", "500.00",
                "2025-08-08T08:00:00Z");
        refund(goodwill, "500.00", "GOODWILL", "COMPLETED");
        refund(goodwill, "9000.00", "DUPLICATE_PAYMENT", "COMPLETED");
        refund(goodwill, "9000.00", "DUPLICATE_PAYMENT", "REQUESTED");
        add(customer, "HOTEL", "CANCELLATION_PENDING", true, true, null, "4000.00", "0", "2025-09-09T08:00:00Z");
        add(customer, "FLIGHT", "PENDING_PAYMENT", false, false, null, "2200.00", "0", "2025-11-11T08:00:00Z");
        // 00:00 on 1 January 2026 and 23:59 on 31 December 2024 in India: outside 2025.
        add(customer, "HOTEL", "COMPLETED", true, true, null, "3000.00", "0", "2025-12-31T18:30:00Z");
        add(customer, "FLIGHT", "COMPLETED", true, true, null, "2500.00", "0", "2024-12-31T18:29:00Z");

        // Trips of these days: a stay in ten days, a flight in three days (the next trip), a stay that is over.
        Row stay = add(customer, "HOTEL", "CONFIRMED", true, true, null, "15000.00", "0",
                now.minus(2, ChronoUnit.DAYS).toString(), today.plusDays(10), today.plusDays(12));
        hotelPart(stay.id(), today.plusDays(10), today.plusDays(12));
        Row flight = add(customer, "FLIGHT", "CONFIRMED", true, true, null, "5600.00", "0",
                now.minus(1, ChronoUnit.DAYS).toString(), today.plusDays(3), null);
        flightPart(flight.id(), today.plusDays(3));
        nextFlight = flight.id();
        add(customer, "HOTEL", "CONFIRMED", true, true, null, "3300.00", "0",
                now.minus(3, ChronoUnit.DAYS).toString(), today.minusDays(5), today.minusDays(2));

        // Someone else's: never counted, never the next trip.
        UUID other = UUID.randomUUID();
        insert(other, new Row(UUID.randomUUID(), "HOTEL", "CONFIRMED", true, now, null, new BigDecimal("99999.00"),
                BigDecimal.ZERO, now, today.plusDays(1), today.plusDays(2)));
        insert(other, new Row(UUID.randomUUID(), "FLIGHT", "COMPLETED", true, now, null, new BigDecimal("1111.00"),
                BigDecimal.ZERO, Instant.parse("2025-03-10T08:00:00Z"), LocalDate.of(2025, 4, 1), null));
    }

    @Test
    void theFiguresOfAYearMatchTheBookings() throws Exception {
        String body = summary(YEAR_2025);
        assertThat((String) JsonPath.read(body, "$.range.preset")).isEqualTo("CUSTOM");
        Predicate<Row> in2025 = row -> row.day().getYear() == 2025;
        assertFigures(body, in2025);

        // The same, written out once, so the calculation above is checked too.
        assertThat(count(body, "$.bookings.total")).isEqualTo(6);
        assertThat(count(body, "$.bookings.hotel")).isEqualTo(4);
        assertThat(count(body, "$.bookings.flight")).isEqualTo(2);
        assertThat(count(body, "$.bookings.upcoming")).isEqualTo(2);
        assertThat(count(body, "$.bookings.completed")).isEqualTo(2);
        assertThat(count(body, "$.bookings.cancelled")).isEqualTo(2);
        assertThat(money(body, "$.spending.paid")).isEqualByComparingTo("56450.50");
        assertThat(money(body, "$.spending.refunded")).isEqualByComparingTo("15000.00");
        assertThat(money(body, "$.spending.net")).isEqualByComparingTo("41450.50");
        assertThat(money(body, "$.spending.refundsInProgress")).isEqualByComparingTo("4500.00");
        assertThat(money(body, "$.spending.hotel.net")).isEqualByComparingTo("27000.00");
        assertThat(money(body, "$.spending.flight.paid")).isEqualByComparingTo("21450.50");
        assertThat((String) JsonPath.read(body, "$.spending.currency")).isEqualTo("INR");
        assertThat(((List<?>) JsonPath.read(body, "$.monthlyActivity"))).hasSize(12);
        assertThat((String) JsonPath.read(body, "$.monthlyActivity[1].month")).isEqualTo("2025-02");
        assertThat(count(body, "$.monthlyActivity[1].flightBookings")).isEqualTo(1);
        assertThat(count(body, "$.monthlyActivity[2].bookings")).isEqualTo(2);
        assertThat(money(body, "$.monthlyActivity[5].paid")).isEqualByComparingTo("7000.00");
        assertThat(money(body, "$.monthlyActivity[5].net")).isEqualByComparingTo("0.00");
    }

    @Test
    void tripsAndTheNextTripDoNotDependOnTheRange() throws Exception {
        for (String range : List.of(YEAR_2025, "range=LAST_30_DAYS", "range=ALL_TIME")) {
            String body = summary(range);
            assertThat(count(body, "$.trips.upcoming")).as(range).isEqualTo(5);
            assertThat(count(body, "$.trips.completed")).as(range).isEqualTo(4);
            assertThat(count(body, "$.trips.cancelled")).as(range).isEqualTo(2);
            assertThat(count(body, "$.trips.pending")).as(range).isEqualTo(1);
            assertThat((String) JsonPath.read(body, "$.nextTrip.bookingId")).isEqualTo(nextFlight.toString());
        }
        mockMvc.perform(get("/api/bookings/summary").with(customer(customer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nextTrip.type").value("FLIGHT"))
                .andExpect(jsonPath("$.nextTrip.status").value("CONFIRMED"))
                .andExpect(jsonPath("$.nextTrip.startDate").value(today.plusDays(3).toString()))
                .andExpect(jsonPath("$.nextTrip.daysUntil").value(3))
                .andExpect(jsonPath("$.nextTrip.inProgress").value(false))
                .andExpect(jsonPath("$.nextTrip.totalAmount").value(5600.00))
                .andExpect(jsonPath("$.nextTrip.hotel").doesNotExist())
                .andExpect(jsonPath("$.nextTrip.flight.origin").value("DEL"))
                .andExpect(jsonPath("$.nextTrip.flight.destination").value("GOI"))
                .andExpect(jsonPath("$.nextTrip.flight.destinationCity").value("Goa"))
                .andExpect(jsonPath("$.nextTrip.flight.airlineName").value("IndiGo"))
                .andExpect(jsonPath("$.nextTrip.flight.flightNumber").value("6E 201"))
                .andExpect(jsonPath("$.nextTrip.flight.passengers").value(2))
                .andExpect(jsonPath("$.nextTrip.flight.pnr").value("ABC123"));

        // Once the flight is cancelled, the stay in ten days is next, with its hotel details.
        jdbcClient.sql("UPDATE bookings SET status = 'CANCELLATION_PENDING' WHERE id = UUID_TO_BIN(:id)")
                .param("id", nextFlight.toString()).update();
        mockMvc.perform(get("/api/bookings/summary").with(customer(customer)))
                .andExpect(jsonPath("$.nextTrip.type").value("HOTEL"))
                .andExpect(jsonPath("$.nextTrip.daysUntil").value(10))
                .andExpect(jsonPath("$.nextTrip.hotel.hotelName").value("Sea Breeze Resort"))
                .andExpect(jsonPath("$.nextTrip.hotel.checkIn").value(today.plusDays(10).toString()))
                .andExpect(jsonPath("$.nextTrip.hotel.nights").value(2))
                .andExpect(jsonPath("$.nextTrip.hotel.guests").value(3))
                .andExpect(jsonPath("$.nextTrip.hotel.confirmationNumber").value("SBR-4411"))
                .andExpect(jsonPath("$.nextTrip.flight").doesNotExist());
    }

    @Test
    void theDefaultRangeAndAllTime() throws Exception {
        String body = summary("");
        assertThat((String) JsonPath.read(body, "$.range.preset")).isEqualTo("LAST_12_MONTHS");
        LocalDate from = today.withDayOfMonth(1).minusMonths(11);
        assertThat((String) JsonPath.read(body, "$.range.from")).isEqualTo(from.toString());
        assertThat(((List<?>) JsonPath.read(body, "$.monthlyActivity"))).hasSize(12);
        assertFigures(body, row -> !row.day().isBefore(from) && !row.day().isAfter(today));

        String all = summary("range=all_time");
        assertThat((String) JsonPath.read(all, "$.range.preset")).isEqualTo("ALL_TIME");
        assertThat((String) JsonPath.read(all, "$.range.from")).isEqualTo("2024-12-31");
        assertThat(((List<?>) JsonPath.read(all, "$.monthlyActivity")))
                .hasSize((int) ChronoUnit.MONTHS.between(YearMonth.of(2024, 12), YearMonth.from(today)) + 1);
        assertFigures(all, row -> true);
    }

    @Test
    void anAccountWithoutBookingsAndBadRanges() throws Exception {
        mockMvc.perform(get("/api/bookings/summary?range=ALL_TIME").with(supportAgent()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookings.total").value(0))
                .andExpect(jsonPath("$.trips.upcoming").value(0))
                .andExpect(jsonPath("$.spending.paid").value(0.0))
                .andExpect(jsonPath("$.monthlyActivity.length()").value(1))
                .andExpect(jsonPath("$.nextTrip").doesNotExist());
        mockMvc.perform(get("/api/bookings/summary?range=FOREVER").with(customer(customer)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_RANGE"));
        mockMvc.perform(get("/api/bookings/summary?range=CUSTOM&from=2019-01-01&to=2025-01-01")
                        .with(customer(customer)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_RANGE"));
        mockMvc.perform(get("/api/bookings/summary?range=CUSTOM&from=2025-01-01").with(customer(customer)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_RANGE"));
        mockMvc.perform(get("/api/bookings/summary")).andExpect(status().isUnauthorized());
    }

    // ------------------------------------------------------------------ expectations from the source rows

    private void assertFigures(String body, Predicate<Row> inRange) {
        List<Row> mine = rows.stream().filter(inRange).toList();
        List<Row> confirmed = mine.stream().filter(Row::confirmed).toList();
        assertThat(count(body, "$.bookings.total")).isEqualTo(confirmed.size());
        assertThat(count(body, "$.bookings.hotel")).isEqualTo(confirmed.stream().filter(r -> r.type().equals("HOTEL")).count());
        assertThat(count(body, "$.bookings.flight")).isEqualTo(confirmed.stream().filter(r -> r.type().equals("FLIGHT")).count());
        assertThat(count(body, "$.bookings.upcoming")).isEqualTo(confirmed.stream().filter(r -> !r.cancelled()
                && Set.of("CONFIRMED", "CANCELLATION_PENDING").contains(r.status())).count());
        assertThat(count(body, "$.bookings.completed")).isEqualTo(confirmed.stream()
                .filter(r -> r.status().equals("COMPLETED")).count());
        assertThat(count(body, "$.bookings.cancelled")).isEqualTo(confirmed.stream().filter(Row::cancelled).count());

        assertThat(money(body, "$.spending.paid")).isEqualByComparingTo(paid(mine.stream()));
        assertThat(money(body, "$.spending.refunded")).isEqualByComparingTo(refunded(mine.stream()));
        assertThat(money(body, "$.spending.net")).isEqualByComparingTo(paid(mine.stream()).subtract(refunded(mine.stream())));
        assertThat(money(body, "$.spending.refundsInProgress")).isEqualByComparingTo(sum(refunds.stream()
                .filter(r -> r.status().equals("REQUESTED") && !r.reason().equals("DUPLICATE_PAYMENT")
                        && mine.stream().anyMatch(row -> row.id().equals(r.bookingId())))
                .map(Refund::amount)));
        for (String type : List.of("HOTEL", "FLIGHT")) {
            String path = "$.spending." + type.toLowerCase();
            assertThat(money(body, path + ".paid")).isEqualByComparingTo(paid(mine.stream().filter(r -> r.type().equals(type))));
            assertThat(money(body, path + ".refunded"))
                    .isEqualByComparingTo(refunded(mine.stream().filter(r -> r.type().equals(type))));
        }

        // Month by month (India days), adding up to the range.
        List<String> months = JsonPath.read(body, "$.monthlyActivity[*].month");
        for (int i = 0; i < months.size(); i++) {
            YearMonth month = YearMonth.parse(months.get(i));
            List<Row> ofMonth = mine.stream().filter(r -> YearMonth.from(r.day()).equals(month)).toList();
            String path = "$.monthlyActivity[" + i + "]";
            assertThat(count(body, path + ".bookings")).as(month.toString())
                    .isEqualTo(ofMonth.stream().filter(Row::confirmed).count());
            assertThat(count(body, path + ".hotelBookings")).as(month.toString())
                    .isEqualTo(ofMonth.stream().filter(r -> r.confirmed() && r.type().equals("HOTEL")).count());
            assertThat(money(body, path + ".paid")).as(month.toString()).isEqualByComparingTo(paid(ofMonth.stream()));
            assertThat(money(body, path + ".refunded")).as(month.toString())
                    .isEqualByComparingTo(refunded(ofMonth.stream()));
        }
        assertThat(sumOf(body, "$.monthlyActivity[*].net")).isEqualByComparingTo(money(body, "$.spending.net"));
        assertThat(sumOf(body, "$.monthlyActivity[*].bookings"))
                .isEqualByComparingTo(BigDecimal.valueOf(count(body, "$.bookings.total")));
    }

    private static BigDecimal paid(Stream<Row> rows) {
        return sum(rows.filter(Row::paid).map(Row::total));
    }

    private static BigDecimal refunded(Stream<Row> rows) {
        return sum(rows.map(Row::refunded));
    }

    // ------------------------------------------------------------------ the bookings

    private Row add(UUID user, String type, String status, boolean paid, boolean confirmed, Instant cancelledAt,
            String total, String refunded, String createdAt) {
        Instant created = Instant.parse(createdAt);
        LocalDate start = created.atZone(INDIA).toLocalDate().plusDays(30);
        return add(user, type, status, paid, confirmed, cancelledAt, total, refunded, createdAt, start,
                start.plusDays(2));
    }

    private Row add(UUID user, String type, String status, boolean paid, boolean confirmed, Instant cancelledAt,
            String total, String refunded, String createdAt, LocalDate start, LocalDate end) {
        Instant created = Instant.parse(createdAt);
        Row row = new Row(UUID.randomUUID(), type, status, paid, confirmed ? created.plusSeconds(600) : null,
                cancelledAt, new BigDecimal(total), new BigDecimal(refunded).setScale(2), created, start, end);
        insert(user, row);
        rows.add(row);
        return row;
    }

    private void insert(UUID user, Row row) {
        String reference = (row.type().equals("HOTEL") ? "HT-" : "FL-") + row.id().toString().substring(0, 8);
        jdbcClient.sql("""
                        INSERT INTO bookings (id, booking_reference, user_id, booking_type, status, payment_status,
                            title, destination, start_date, end_date, currency, base_amount, total_amount,
                            refunded_amount, contact_email, contact_phone, paid_payment_id, idempotency_key,
                            request_hash, confirmed_at, cancelled_at, starts_at, created_at, updated_at, created_by,
                            updated_by)
                        VALUES (UUID_TO_BIN(:id), :reference, UUID_TO_BIN(:user), :type, :status, :paymentStatus,
                            :title, 'Goa', :start, :end, 'INR', :total, :total, :refunded, 'asha@example.com',
                            '+91 98000 00000', IF(:paid, UUID_TO_BIN(UUID()), NULL), :key, REPEAT('0', 64),
                            :confirmedAt, :cancelledAt, :startsAt, :createdAt, :createdAt, 'test', 'test')""")
                .param("id", row.id().toString())
                .param("reference", reference.toUpperCase())
                .param("user", user.toString())
                .param("type", row.type())
                .param("status", row.status())
                .param("paymentStatus", row.paid() ? "PAID" : "UNPAID")
                .param("title", row.type().equals("HOTEL") ? "Sea Breeze Resort" : "Delhi → Goa")
                .param("start", row.start())
                .param("end", row.end())
                .param("total", row.total())
                .param("refunded", row.refunded())
                .param("paid", row.paid())
                .param("key", "key-" + row.id())
                .param("confirmedAt", utc(row.confirmedAt()))
                .param("cancelledAt", utc(row.cancelledAt()))
                .param("startsAt", row.start() == null ? null
                        : utc(row.start().atTime(LocalTime.of(6, 10)).atZone(INDIA).toInstant()))
                .param("createdAt", utc(row.createdAt()))
                .update();
    }

    private void refund(Row booking, String amount, String reason, String status) {
        refunds.add(new Refund(booking.id(), new BigDecimal(amount), reason, status));
        jdbcClient.sql("""
                        INSERT INTO booking_refund_requests (id, booking_id, payment_id, amount, currency, reason,
                            status, requested_at, completed_at, last_sent_at)
                        VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(:booking), UUID_TO_BIN(UUID()), :amount, 'INR',
                            :reason, :status, :at, :completed, :at)""")
                .param("booking", booking.id().toString())
                .param("amount", new BigDecimal(amount))
                .param("reason", reason)
                .param("status", status)
                .param("at", utc(booking.createdAt().plus(3, ChronoUnit.DAYS)))
                .param("completed", "COMPLETED".equals(status) ? utc(booking.createdAt().plus(4, ChronoUnit.DAYS)) : null)
                .update();
    }

    private void hotelPart(UUID bookingId, LocalDate checkIn, LocalDate checkOut) {
        jdbcClient.sql("""
                        INSERT INTO hotel_bookings (booking_id, quote_id, hotel_name, hotel_city, hotel_address,
                            room_type_name, check_in, check_out, check_in_time, check_out_time, nights, rooms, adults,
                            children, confirmation_number)
                        VALUES (UUID_TO_BIN(:id), UUID_TO_BIN(UUID()), 'Sea Breeze Resort', 'Goa', 'Calangute Beach Road',
                            'Deluxe Sea View', :checkIn, :checkOut, '14:00', '11:00', 2, 1, 2, 1, 'SBR-4411')""")
                .param("id", bookingId.toString()).param("checkIn", checkIn).param("checkOut", checkOut).update();
    }

    private void flightPart(UUID bookingId, LocalDate departure) {
        String at = departure + "T06:10";
        String slices = """
                [{"origin":"DEL","destination":"GOI","originCity":"Delhi","destinationCity":"Goa",
                  "departureLocal":"%s","arrivalLocal":"%sT08:45","durationMinutes":155,"stops":0,
                  "segments":[{"flightNumber":"6E 201","airlineCode":"6E","airlineName":"IndiGo","origin":"DEL",
                  "destination":"GOI","departureLocal":"%s","arrivalLocal":"%sT08:45","durationMinutes":155}]}]"""
                .formatted(at, departure, at, departure);
        jdbcClient.sql("""
                        INSERT INTO flight_bookings (booking_id, offer_id, trip_type, cabin, adults, children, infants,
                            slices_json, pnr)
                        VALUES (UUID_TO_BIN(:id), 'offer-1', 'ONE_WAY', 'ECONOMY', 1, 1, 0, :slices, 'ABC123')""")
                .param("id", bookingId.toString()).param("slices", slices).update();
    }

    // ------------------------------------------------------------------ helpers

    private String summary(String query) throws Exception {
        return mockMvc.perform(get("/api/bookings/summary?" + query).with(customer(customer)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private static LocalDateTime utc(Instant instant) {
        return instant == null ? null : LocalDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    private static BigDecimal sum(Stream<BigDecimal> amounts) {
        return amounts.reduce(BigDecimal.ZERO, BigDecimal::add).setScale(2, RoundingMode.HALF_UP);
    }

    private static long count(String json, String path) {
        return ((Number) JsonPath.read(json, path)).longValue();
    }

    private static BigDecimal money(String json, String path) {
        return new BigDecimal(JsonPath.read(json, path).toString());
    }

    private static BigDecimal sumOf(String json, String path) {
        List<Object> values = JsonPath.read(json, path);
        return values.stream().map(value -> new BigDecimal(value.toString())).reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
