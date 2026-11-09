package com.flighthotel.reporting;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.UUID;
import java.util.stream.Collectors;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.mysql.MySQLContainer;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.events.booking.BookingCancelled;
import com.flighthotel.events.booking.BookingRefundRequested;
import com.flighthotel.events.booking.BookingSnapshot;
import com.flighthotel.events.identity.UserRegistered;
import com.flighthotel.events.identity.UserSnapshot;
import com.flighthotel.events.payment.PaymentFailed;
import com.flighthotel.events.payment.PaymentSucceeded;
import com.flighthotel.events.payment.RefundCompleted;
import com.flighthotel.reporting.facts.DashboardUpdates;
import com.flighthotel.reporting.facts.FactsListener;
import com.flighthotel.reporting.report.ReportExporter;
import com.jayway.jsonpath.JsonPath;

/**
 * Phase 9 exit check "report totals match booking/payment data": a known month of bookings, payments, refunds and
 * cancellations (with redelivered, replayed and out-of-order events) goes through the listeners; every dashboard figure
 * and every report total must equal the same figure calculated here directly from that source data, and the reports
 * must agree with each other (revenue report = dashboard revenue, destinations = paid bookings, ...).
 */
@SpringBootTest(properties = {
        "spring.kafka.listener.auto-startup=false",
        "travel.kafka.schema-registry-url=mock://reporting-facts-it",
        "reporting.dashboard-update-interval=1h"
})
@AutoConfigureMockMvc
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ReportConsistencyIntegrationTest {

    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final LocalDate FROM = LocalDate.of(2026, 3, 1);
    private static final LocalDate TO = LocalDate.of(2026, 3, 31);
    private static final Instant START = FROM.atStartOfDay(INDIA).toInstant();
    private static final Instant END = TO.plusDays(1).atStartOfDay(INDIA).toInstant();
    private static final String RANGE = "range=CUSTOM&from=" + FROM + "&to=" + TO;
    /** The previous period of the same length (31 days): 29 January .. 28 February. */
    private static final Instant PREVIOUS_START = FROM.minusDays(31).atStartOfDay(INDIA).toInstant();
    private static final List<String> CITIES = List.of("Goa", "Jaipur", "Mumbai", "Delhi", "Kochi");

    @ServiceConnection
    static final MySQLContainer MYSQL = new MySQLContainer("mysql:8.4.13").withDatabaseName("reporting_db");

    static {
        MYSQL.start();   // before the context (the data is fed once, in @BeforeAll)
    }

    @Autowired
    MockMvc mockMvc;

    @Autowired
    FactsListener listener;

    @Autowired
    DashboardUpdates updates;

    @MockitoBean
    RealtimePublisher realtimePublisher;

    // ------------------------------------------------------------------ the source data (what the services know)

    record Booking(UUID id, String reference, UUID userId, String type, String city, UUID hotelId, Instant createdAt,
            BigDecimal total, String status, Instant confirmedAt, Instant cancelledAt, BigDecimal refunded) {
    }

    record Payment(UUID id, UUID bookingId, BigDecimal amount, boolean success, Instant at) {
    }

    record Refund(UUID id, UUID bookingId, UUID paymentId, BigDecimal amount, String reason, Instant requestedAt,
            Instant completedAt) {
    }

    record Cancellation(UUID id, UUID bookingId, String type, String initiatedBy, BigDecimal fee, BigDecimal refund,
            Instant at) {
    }

    private final List<Booking> bookings = new ArrayList<>();
    private final List<Payment> payments = new ArrayList<>();
    private final List<Refund> refunds = new ArrayList<>();
    private final List<Cancellation> cancellations = new ArrayList<>();
    private final List<UUID> customers = new ArrayList<>();
    private final List<Instant> registrations = new ArrayList<>();
    private final Random random = new Random(42);

    @BeforeAll
    void feedOneMonthOfEvents() {
        // Customers: six registered before March, two in March, one in April (after the range); one admin.
        for (int i = 0; i < 9; i++) {
            UUID id = UUID.randomUUID();
            Instant registered = i < 6 ? START.minus(Duration.ofDays(20 - i)) : i < 8
                    ? START.plus(Duration.ofDays(3L * i)) : END.plus(Duration.ofDays(2));
            UserRegistered event = UserRegistered.newBuilder().setUserId(id.toString())
                    .setEmail("customer" + i + "@example.com").setFirstName("Customer").setLastName("No" + i)
                    .setRoles(List.of("CUSTOMER")).setStatus("PENDING_VERIFICATION").setRegisteredAt(registered).build();
            listener.handle(event);
            registrations.add(registered);
            if (i % 2 == 0) {   // some also arrive as the identity backfill's snapshot
                listener.handle(UserSnapshot.newBuilder().setUserId(id.toString()).setEmail("customer" + i
                        + "@example.com").setFirstName("Customer").setLastName("No" + i).setRoles(List.of("CUSTOMER"))
                        .setStatus("ACTIVE").setEmailVerified(true).setRegisteredAt(registered)
                        .setSnapshotAt(Instant.now()).build());
            }
            if (i < 8) {
                customers.add(id);
            }
        }
        listener.handle(UserRegistered.newBuilder().setUserId(UUID.randomUUID().toString())
                .setEmail("admin@example.com").setFirstName("Ad").setLastName("Min").setRoles(List.of("ADMIN"))
                .setStatus("ACTIVE").setRegisteredAt(START.minus(Duration.ofDays(30))).build());

        for (int i = 0; i < 48; i++) {
            Instant created = START.plus(Duration.ofMinutes(random.nextInt(31 * 24 * 60)));
            booking(i, created);
        }
        // Just outside the range on both sides: must not count.
        booking(2, START.minus(Duration.ofMinutes(10)));
        booking(2, END.plus(Duration.ofMinutes(10)));
        booking(4, END.minus(Duration.ofMinutes(30)));   // cancelled and refunded after the range ends
    }

    /** One booking through one of six stories; records the source data and sends the events. */
    private void booking(int story, Instant created) {
        UUID id = UUID.randomUUID();
        UUID user = customers.get(random.nextInt(customers.size()));
        String type = story % 3 == 0 ? "FLIGHT" : "HOTEL";
        String city = CITIES.get(random.nextInt(CITIES.size()));
        UUID hotel = "HOTEL".equals(type) ? UUID.nameUUIDFromBytes(city.getBytes(StandardCharsets.UTF_8)) : null;
        BigDecimal total = BigDecimal.valueOf(1000 + random.nextInt(900_000), 2).add(BigDecimal.valueOf(2000));
        String reference = (type.equals("HOTEL") ? "HT-" : "FL-") + id.toString().substring(0, 8).toUpperCase();
        Instant paidAt = created.plus(Duration.ofMinutes(5));
        String status;
        Instant confirmedAt = null;
        Instant cancelledAt = null;
        BigDecimal refunded = BigDecimal.ZERO.setScale(2);

        // The first snapshot of every booking (created), sent again late to prove an old one never wins.
        BookingSnapshot first = snapshot(id, reference, user, type, city, hotel, created, total, "INITIATED", "UNPAID",
                null, null, BigDecimal.ZERO, created);
        listener.handle(first);

        switch (story % 6) {
            case 0 -> status = "PENDING_PAYMENT";
            case 1 -> {
                status = "EXPIRED";
                payment(id, user, null, false, paidAt);
            }
            case 2 -> {
                status = "CONFIRMED";
                confirmedAt = paid(id, user, total, paidAt);
            }
            case 3 -> {
                status = "COMPLETED";
                confirmedAt = paid(id, user, total, paidAt);
            }
            case 4 -> {
                confirmedAt = paid(id, user, total, paidAt);
                cancelledAt = created.plus(Duration.ofDays(2));
                BigDecimal fee = total.multiply(new BigDecimal("0.25")).setScale(2, RoundingMode.HALF_UP);
                UUID cancellation = UUID.randomUUID();
                // Mostly the customer; some on the customer's behalf or by the hotel (Phase 11 split by initiator).
                String initiatedBy = switch (cancellations.size() % 6) {
                    case 2 -> "SUPPORT_AGENT";
                    case 5 -> "HOTEL".equals(type) ? "HOTEL" : "ADMIN";
                    default -> "CUSTOMER";
                };
                cancellations.add(new Cancellation(cancellation, id, type, initiatedBy, fee, total.subtract(fee),
                        cancelledAt));
                BookingCancelled cancelled = BookingCancelled.newBuilder().setBookingId(id.toString())
                        .setBookingReference(reference).setBookingType(type).setUserId(user.toString())
                        .setCancellationId(cancellation.toString()).setTitle(city + " trip").setContactEmail("c@x.com")
                        .setCustomerName("C").setInitiatedBy(initiatedBy).setPaidAmount(EventMoney.of(total, "INR"))
                        .setCancellationFee(EventMoney.of(fee, "INR"))
                        .setRefundAmount(EventMoney.of(total.subtract(fee), "INR")).setCancelledAt(cancelledAt).build();
                listener.handle(cancelled);
                listener.handle(cancelled);   // redelivered
                refunded = refund(id, reference, user, payments.getLast().id(), total.subtract(fee), "CANCELLATION",
                        cancelledAt, cancelledAt.plus(Duration.ofHours(1)), random.nextBoolean());
                status = "REFUNDED";
                // A second payment (two tabs) for the same booking, refunded at once: money in, money out.
                Instant duplicateAt = paidAt.plus(Duration.ofMinutes(1));
                UUID duplicate = payment(id, user, total, true, duplicateAt);
                refund(id, reference, user, duplicate, total, "DUPLICATE_PAYMENT", duplicateAt,
                        duplicateAt.plus(Duration.ofMinutes(30)), false);
            }
            default -> {
                status = "CONFIRMED";
                payment(id, user, null, false, paidAt.minus(Duration.ofMinutes(2)));   // first try declined
                confirmedAt = paid(id, user, total, paidAt);
                refunded = refund(id, reference, user, payments.getLast().id(), new BigDecimal("500.00"), "GOODWILL",
                        paidAt.plus(Duration.ofDays(1)), paidAt.plus(Duration.ofDays(1)).plus(Duration.ofHours(2)),
                        false);
            }
        }
        String paymentStatus = switch (status) {
            case "PENDING_PAYMENT", "EXPIRED" -> "UNPAID";
            case "REFUNDED" -> "PARTIALLY_REFUNDED";
            default -> refunded.signum() > 0 ? "PARTIALLY_REFUNDED" : "PAID";
        };
        Instant changed = created.plus(Duration.ofDays(3));
        listener.handle(snapshot(id, reference, user, type, city, hotel, created, total, status, paymentStatus,
                confirmedAt, cancelledAt, refunded, changed));
        listener.handle(first);   // an old snapshot replayed: ignored
        bookings.add(new Booking(id, reference, user, type, city, hotel, created, total, status, confirmedAt,
                cancelledAt, refunded));
    }

    private Instant paid(UUID booking, UUID user, BigDecimal total, Instant at) {
        payment(booking, user, total, true, at);
        return at.plus(Duration.ofMinutes(1));
    }

    private UUID payment(UUID booking, UUID user, BigDecimal amount, boolean success, Instant at) {
        UUID id = UUID.randomUUID();
        payments.add(new Payment(id, booking, amount, success, at));
        if (success) {
            PaymentSucceeded event = PaymentSucceeded.newBuilder().setPaymentId(id.toString())
                    .setBookingId(booking.toString()).setUserId(user.toString()).setProvider("DEMO")
                    .setProviderPaymentId("pay_" + id).setAmount(EventMoney.of(amount, "INR")).setMethod("card")
                    .setSucceededAt(at).build();
            listener.handle(event);
            listener.handle(event);   // redelivered
        } else {
            listener.handle(PaymentFailed.newBuilder().setPaymentId(id.toString()).setBookingId(booking.toString())
                    .setUserId(user.toString()).setProvider("DEMO").setFailureCode("DECLINED")
                    .setFailureReason("Card declined").setFailedAt(at).build());
        }
        return id;
    }

    /** @return the refunded amount (the booking's own money; a duplicate payment's refund is not) */
    private BigDecimal refund(UUID booking, String reference, UUID user, UUID payment, BigDecimal amount, String reason,
            Instant requested, Instant completed, boolean answerFirst) {
        UUID id = UUID.randomUUID();
        refunds.add(new Refund(id, booking, payment, amount, reason, requested, completed));
        BookingRefundRequested request = BookingRefundRequested.newBuilder().setRefundRequestId(id.toString())
                .setBookingId(booking.toString()).setBookingReference(reference).setUserId(user.toString())
                .setPaymentId(payment.toString()).setAmount(EventMoney.of(amount, "INR")).setReason(reason)
                .setContactEmail("c@x.com").setCustomerName("C").setRequestedAt(requested).build();
        RefundCompleted done = RefundCompleted.newBuilder().setRefundId(UUID.randomUUID().toString())
                .setRefundRequestId(id.toString()).setPaymentId(payment.toString()).setBookingId(booking.toString())
                .setUserId(user.toString()).setAmount(EventMoney.of(amount, "INR")).setCompletedAt(completed).build();
        if (answerFirst) {   // payment.events was read before booking.events
            listener.handle(done);
            listener.handle(request);
        } else {
            listener.handle(request);
            listener.handle(done);
            listener.handle(done);   // payment-service repeats its answer
        }
        return "DUPLICATE_PAYMENT".equals(reason) ? BigDecimal.ZERO.setScale(2) : amount;
    }

    private static BookingSnapshot snapshot(UUID id, String reference, UUID user, String type, String city, UUID hotel,
            Instant created, BigDecimal total, String status, String paymentStatus, Instant confirmed,
            Instant cancelled, BigDecimal refunded, Instant changed) {
        return BookingSnapshot.newBuilder().setBookingId(id.toString()).setBookingReference(reference)
                .setUserId(user.toString()).setBookingType(type).setStatus(status).setPaymentStatus(paymentStatus)
                .setTitle(city + " trip").setDestination(city).setHotelId(hotel == null ? null : hotel.toString())
                .setRouteOrigin("FLIGHT".equals(type) ? "DEL" : null)
                .setRouteDestination("FLIGHT".equals(type) ? city.substring(0, 3).toUpperCase() : null)
                .setOriginCity("FLIGHT".equals(type) ? "Delhi" : null).setStartDate(LocalDate.of(2026, 5, 1))
                .setTotalAmount(EventMoney.of(total, "INR")).setDiscountAmount(EventMoney.of(BigDecimal.ZERO, "INR"))
                .setRefundedAmount(EventMoney.of(refunded, "INR")).setContactEmail(reference.toLowerCase() + "@x.com")
                .setCreatedAt(created).setConfirmedAt(confirmed).setCancelledAt(cancelled).setDemo(true)
                .setChangedAt(changed).build();
    }

    // ------------------------------------------------------------------ the checks

    @Test
    void dashboardFiguresMatchTheSourceData() throws Exception {
        List<Booking> inRange = bookings.stream().filter(b -> within(b.createdAt())).toList();
        List<Booking> paid = inRange.stream().filter(b -> b.confirmedAt() != null).toList();
        BigDecimal gross = sum(payments.stream().filter(p -> p.success() && within(p.at())).map(Payment::amount));
        BigDecimal refunded = sum(refunds.stream().filter(r -> within(r.completedAt())).map(Refund::amount));
        List<Booking> awaiting = inRange.stream().filter(b -> b.status().equals("PENDING_PAYMENT")).toList();

        String body = mockMvc.perform(get("/api/admin/dashboard?" + RANGE).with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.range.preset").value("CUSTOM"))
                .andExpect(jsonPath("$.range.from").value(FROM.toString()))
                .andExpect(jsonPath("$.customers.total").value(8))
                .andExpect(jsonPath("$.customers.newInRange").value(2))
                .andReturn().getResponse().getContentAsString();

        assertThat(count(body, "$.bookings.flight")).isEqualTo(paid.stream().filter(b -> b.type().equals("FLIGHT")).count());
        assertThat(count(body, "$.bookings.hotel")).isEqualTo(paid.stream().filter(b -> b.type().equals("HOTEL")).count());
        assertThat(count(body, "$.bookings.upcoming")).isEqualTo(paid.stream().filter(b -> b.status().equals("CONFIRMED")).count());
        assertThat(count(body, "$.bookings.completed")).isEqualTo(paid.stream().filter(b -> b.status().equals("COMPLETED")).count());
        assertThat(count(body, "$.bookings.cancelled")).isEqualTo(paid.stream().filter(b -> b.cancelledAt() != null).count());
        assertThat(count(body, "$.bookings.pending")).isEqualTo(awaiting.size());
        assertThat(count(body, "$.bookings.failed")).isEqualTo(inRange.stream().filter(b -> b.status().equals("EXPIRED")).count());
        assertThat(count(body, "$.payments.pendingCount")).isEqualTo(awaiting.size());
        assertThat(money(body, "$.payments.pendingAmount")).isEqualByComparingTo(sum(awaiting.stream().map(Booking::total)));
        assertThat(count(body, "$.payments.successfulCount"))
                .isEqualTo(payments.stream().filter(p -> p.success() && within(p.at())).count());
        assertThat(money(body, "$.payments.successfulAmount")).isEqualByComparingTo(gross);
        assertThat(money(body, "$.revenue.gross")).isEqualByComparingTo(gross);
        assertThat(money(body, "$.revenue.refunds")).isEqualByComparingTo(refunded);
        assertThat(money(body, "$.revenue.net")).isEqualByComparingTo(gross.subtract(refunded));

        // Trends: one entry per day; they add up to the totals.
        List<Object> trend = JsonPath.read(body, "$.revenueTrend");
        assertThat(trend).hasSize(31);
        assertThat(sum(((List<Object>) JsonPath.read(body, "$.revenueTrend[*].gross")).stream().map(ReportConsistencyIntegrationTest::decimal)))
                .isEqualByComparingTo(gross);
        assertThat(sum(((List<Object>) JsonPath.read(body, "$.revenueTrend[*].refunds")).stream().map(ReportConsistencyIntegrationTest::decimal)))
                .isEqualByComparingTo(refunded);
        List<Integer> flights = JsonPath.read(body, "$.bookingTrend[*].flight");
        assertThat(flights.stream().mapToLong(Integer::longValue).sum()).isEqualTo(count(body, "$.bookings.flight"));
        List<Integer> cancelledPerDay = JsonPath.read(body, "$.bookingTrend[*].cancelled");
        assertThat(cancelledPerDay.stream().mapToLong(Integer::longValue).sum())
                .isEqualTo(cancellations.stream().filter(c -> within(c.at())).count());

        // Popular destinations: paid bookings by city, top 5 (by bookings, then revenue).
        Map<String, List<Booking>> byCity = paid.stream().collect(Collectors.groupingBy(Booking::city));
        List<String> expectedCities = byCity.entrySet().stream()
                .sorted(Comparator.<Map.Entry<String, List<Booking>>>comparingInt(e -> e.getValue().size()).reversed()
                        .thenComparing(e -> net(e.getValue()), Comparator.reverseOrder()))
                .map(Map.Entry::getKey).limit(5).toList();
        assertThat((List<String>) JsonPath.read(body, "$.popularDestinations[*].city")).isEqualTo(expectedCities);
        assertThat(decimal(JsonPath.read(body, "$.popularDestinations[0].revenue")))
                .isEqualByComparingTo(net(byCity.get(expectedCities.getFirst())));
        assertThat((List<Object>) JsonPath.read(body, "$.recentBookings")).hasSize(10);
        assertThat((String) JsonPath.read(body, "$.recentBookings[0].id")).isEqualTo(inRange.stream()
                .max(Comparator.comparing(Booking::createdAt)).orElseThrow().id().toString());

        // Phase 12: active customers, the previous period of each destination and hotel, the richer recent bookings
        // and the activity feed.
        assertThat(count(body, "$.customers.active")).isEqualTo(paid.stream().map(Booking::userId).distinct().count());
        List<Booking> paidBefore = bookings.stream().filter(b -> b.confirmedAt() != null && b.createdAt() != null
                && !b.createdAt().isBefore(PREVIOUS_START) && b.createdAt().isBefore(START)).toList();
        List<String> cities = JsonPath.read(body, "$.popularDestinations[*].city");
        List<Integer> cityBefore = JsonPath.read(body, "$.popularDestinations[*].previousBookings");
        for (int i = 0; i < cities.size(); i++) {
            String city = cities.get(i);
            assertThat(cityBefore.get(i).longValue()).as("previous bookings of " + city)
                    .isEqualTo(paidBefore.stream().filter(b -> b.city().equals(city)).count());
        }
        List<String> hotelIds = JsonPath.read(body, "$.topHotels[*].hotelId");
        List<Integer> hotelBefore = JsonPath.read(body, "$.topHotels[*].previousBookings");
        for (int i = 0; i < hotelIds.size(); i++) {
            String hotelId = hotelIds.get(i);
            assertThat(hotelBefore.get(i).longValue()).as("previous bookings of hotel " + hotelId)
                    .isEqualTo(paidBefore.stream().filter(b -> b.type().equals("HOTEL")
                            && b.hotelId() != null && b.hotelId().toString().equals(hotelId)).count());
        }
        Booking newest = inRange.stream().max(Comparator.comparing(Booking::createdAt)).orElseThrow();
        assertThat((String) JsonPath.read(body, "$.recentBookings[0].customerEmail"))
                .isEqualTo(newest.reference().toLowerCase() + "@x.com");
        assertThat((String) JsonPath.read(body, "$.recentBookings[0].destination")).isEqualTo(newest.city());
        List<String> timelineTypes = JsonPath.read(body, "$.timeline[*].type");
        assertThat(timelineTypes).isNotEmpty().hasSizeLessThanOrEqualTo(12);
        assertThat(timelineTypes).allMatch(type -> List.of("CUSTOMER_REGISTERED", "BOOKING_CREATED", "BOOKING_CANCELLED",
                "PAYMENT_SUCCEEDED", "PAYMENT_FAILED", "SUPPORT_TICKET").contains(type) || type.startsWith("BOOKING_"));
        List<String> timelineOutcomes = JsonPath.read(body, "$.timeline[*].outcome");
        assertThat(timelineOutcomes).allMatch(o -> List.of("SUCCESS", "PENDING", "FAILED", "CANCELLED", "INFO").contains(o));
        List<String> at = JsonPath.read(body, "$.timeline[*].at");
        assertThat(at.stream().map(Instant::parse).toList()).isSortedAccordingTo(Comparator.reverseOrder());
    }

    /** Phase 11: hotel and flight apart and together, payment outcomes, cancellations, the series and the growth. */
    @Test
    void dashboardV2FiguresMatchTheSourceData() throws Exception {
        String body = mockMvc.perform(get("/api/admin/dashboard?" + RANGE + "&interval=WEEK").with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.interval").value("WEEK"))
                .andExpect(jsonPath("$.previousRange.preset").value("PREVIOUS_PERIOD"))
                .andExpect(jsonPath("$.previousRange.from").value("2026-01-29"))
                .andExpect(jsonPath("$.previousRange.to").value("2026-02-28"))
                .andReturn().getResponse().getContentAsString();
        Map<UUID, Booking> byId = bookings.stream().collect(Collectors.toMap(Booking::id, b -> b));
        Facts now = new Facts(START, END, byId);

        for (String type : List.of("HOTEL", "FLIGHT")) {
            String product = "$.products." + type.toLowerCase();
            assertThat(count(body, product + ".bookings")).isEqualTo(now.paid(type));
            assertThat(count(body, product + ".cancelled")).isEqualTo(now.cancelledPaid(type));
            assertThat(money(body, product + ".cancellationRate"))
                    .isEqualByComparingTo(percent(now.cancelledPaid(type), now.paid(type)));
            assertThat(money(body, product + ".gross")).isEqualByComparingTo(now.gross(type));
            assertThat(money(body, product + ".refunds")).isEqualByComparingTo(now.refunds(type));
            assertThat(money(body, product + ".net")).isEqualByComparingTo(now.gross(type).subtract(now.refunds(type)));
            assertThat(count(body, "$.cancellations." + type.toLowerCase())).isEqualTo(now.cancellations(type));
        }
        // Together: the sum of both, and the same as the Phase 9 figures.
        long paid = now.paid("HOTEL") + now.paid("FLIGHT");
        assertThat(count(body, "$.products.all.bookings")).isEqualTo(paid)
                .isEqualTo(count(body, "$.bookings.flight") + count(body, "$.bookings.hotel"));
        assertThat(count(body, "$.products.all.cancelled")).isEqualTo(count(body, "$.bookings.cancelled"));
        assertThat(money(body, "$.products.all.gross")).isEqualByComparingTo(money(body, "$.revenue.gross"))
                .isEqualByComparingTo(now.gross("HOTEL").add(now.gross("FLIGHT")));
        assertThat(money(body, "$.products.all.refunds")).isEqualByComparingTo(money(body, "$.revenue.refunds"))
                .isEqualByComparingTo(now.refunds("HOTEL").add(now.refunds("FLIGHT")));
        assertThat(money(body, "$.products.all.net")).isEqualByComparingTo(money(body, "$.revenue.net"));

        // Payments: successful and failed attempts (a failed attempt counts the booking's amount).
        assertThat(count(body, "$.payments.failedCount")).isEqualTo(now.failed()).isPositive();
        assertThat(money(body, "$.payments.failedAmount")).isEqualByComparingTo(now.failedAmount());
        assertThat(money(body, "$.payments.successRate"))
                .isEqualByComparingTo(percent(now.succeeded(), now.succeeded() + now.failed()));

        // Cancellations confirmed in the range, by who asked, with the money; the rate of the range's paid bookings.
        assertThat(count(body, "$.cancellations.count")).isEqualTo(now.cancellations(null));
        for (String who : List.of("CUSTOMER", "SUPPORT_AGENT", "ADMIN", "HOTEL")) {
            assertThat(count(body, "$.cancellations.byInitiator." + who)).as(who).isEqualTo(cancellations.stream()
                    .filter(c -> within(c.at()) && c.initiatedBy().equals(who)).count());
        }
        assertThat(count(body, "$.cancellations.byInitiator.CUSTOMER")).isLessThan(count(body, "$.cancellations.count"));
        assertThat(money(body, "$.cancellations.cancellationFees")).isEqualByComparingTo(sum(cancellations.stream()
                .filter(c -> within(c.at())).map(Cancellation::fee)));
        assertThat(money(body, "$.cancellations.refundAmount")).isEqualByComparingTo(sum(cancellations.stream()
                .filter(c -> within(c.at())).map(Cancellation::refund)));
        assertThat(money(body, "$.cancellations.rate"))
                .isEqualByComparingTo(percent(now.cancelledPaid("HOTEL") + now.cancelledPaid("FLIGHT"), paid));

        // The weekly series: ISO weeks cut to the range, adding up to the range's figures.
        List<String> starts = JsonPath.read(body, "$.series[*].start");
        List<String> ends = JsonPath.read(body, "$.series[*].end");
        assertThat(starts.getFirst()).isEqualTo(FROM.toString());
        assertThat(ends.getLast()).isEqualTo(TO.toString());
        assertThat(starts).hasSize(6);   // 1 March 2026 is a Sunday: W09 (one day) .. W14 (two days)
        assertThat((List<String>) JsonPath.read(body, "$.series[*].key")).startsWith("2026-W09", "2026-W10");
        assertThat(sumOf(body, "$.series[*].bookings")).isEqualByComparingTo(BigDecimal.valueOf(paid));
        assertThat(sumOf(body, "$.series[*].hotelBookings")).isEqualByComparingTo(BigDecimal.valueOf(now.paid("HOTEL")));
        assertThat(sumOf(body, "$.series[*].cancellations"))
                .isEqualByComparingTo(BigDecimal.valueOf(now.cancellations(null)));
        assertThat(sumOf(body, "$.series[*].gross")).isEqualByComparingTo(money(body, "$.revenue.gross"));
        assertThat(sumOf(body, "$.series[*].net")).isEqualByComparingTo(money(body, "$.revenue.net"));
        assertThat(sumOf(body, "$.series[*].hotelNet"))
                .isEqualByComparingTo(now.gross("HOTEL").subtract(now.refunds("HOTEL")));
        assertThat(sumOf(body, "$.series[*].flightGross")).isEqualByComparingTo(now.gross("FLIGHT"));
        assertThat(sumOf(body, "$.series[*].successfulPayments"))
                .isEqualByComparingTo(BigDecimal.valueOf(now.succeeded()));
        assertThat(sumOf(body, "$.series[*].failedPayments")).isEqualByComparingTo(BigDecimal.valueOf(now.failed()));
        assertThat(sumOf(body, "$.series[*].failedAmount")).isEqualByComparingTo(now.failedAmount());
        assertThat(sumOf(body, "$.series[*].newCustomers")).isEqualByComparingTo(BigDecimal.valueOf(2));
        // Each week on its own, against the source data.
        for (int i = 0; i < starts.size(); i++) {
            Instant weekStart = LocalDate.parse(starts.get(i)).atStartOfDay(INDIA).toInstant();
            Instant weekEnd = LocalDate.parse(ends.get(i)).plusDays(1).atStartOfDay(INDIA).toInstant();
            Facts week = new Facts(weekStart, weekEnd, byId);
            assertThat(count(body, "$.series[" + i + "].flightBookings")).isEqualTo(week.paid("FLIGHT"));
            assertThat(money(body, "$.series[" + i + "].hotelGross")).isEqualByComparingTo(week.gross("HOTEL"));
            assertThat(money(body, "$.series[" + i + "].refunds"))
                    .isEqualByComparingTo(week.refunds("HOTEL").add(week.refunds("FLIGHT")));
        }

        // Against the previous 31 days (29 Jan .. 28 Feb): a booking ten minutes before the range, six customers.
        Facts before = new Facts(PREVIOUS_START, START, byId);
        assertThat(before.paid("HOTEL") + before.paid("FLIGHT")).isPositive();
        assertChange(body, "bookings", paid, before.paid("HOTEL") + before.paid("FLIGHT"));
        assertChange(body, "hotelBookings", now.paid("HOTEL"), before.paid("HOTEL"));
        assertChange(body, "flightBookings", now.paid("FLIGHT"), before.paid("FLIGHT"));
        assertChange(body, "grossRevenue", now.gross("HOTEL").add(now.gross("FLIGHT")),
                before.gross("HOTEL").add(before.gross("FLIGHT")));
        assertChange(body, "hotelRevenue", now.gross("HOTEL").subtract(now.refunds("HOTEL")),
                before.gross("HOTEL").subtract(before.refunds("HOTEL")));
        assertChange(body, "successfulPayments", now.succeeded(), before.succeeded());
        assertChange(body, "failedPayments", now.failed(), before.failed());
        assertChange(body, "cancellations", now.cancellations(null), before.cancellations(null));
        long newBefore = registrations.stream().filter(at -> !at.isBefore(PREVIOUS_START) && at.isBefore(START))
                .count();
        assertThat(newBefore).isEqualTo(6);
        assertChange(body, "newCustomers", 2, newBefore);
        assertThat((String) JsonPath.read(body, "$.comparison.newCustomers.trend")).isEqualTo("DOWN");
        assertThat(money(body, "$.comparison.newCustomers.changePercent")).isEqualByComparingTo("-66.7");
    }

    /** Monthly and yearly series, the multi-year ranges and their limits. */
    @Test
    void longerIntervalsAndYearlyRanges() throws Exception {
        String month = mockMvc.perform(get("/api/admin/dashboard?" + RANGE + "&interval=MONTH").with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.series.length()").value(1))
                .andExpect(jsonPath("$.series[0].key").value("2026-03"))
                .andReturn().getResponse().getContentAsString();
        assertThat(money(month, "$.series[0].gross")).isEqualByComparingTo(money(month, "$.revenue.gross"));
        assertThat(count(month, "$.series[0].bookings")).isEqualTo(count(month, "$.products.all.bookings"));
        // A year cut to the range is one point holding the range.
        mockMvc.perform(get("/api/admin/dashboard?" + RANGE + "&interval=year").with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.series[0].key").value("2026"))
                .andExpect(jsonPath("$.series[0].start").value("2026-03-01"))
                .andExpect(jsonPath("$.series[0].end").value("2026-03-31"))
                .andExpect(jsonPath("$.series[0].bookings").value(count(month, "$.products.all.bookings")));

        // Two calendar years by month: 24 points; the March 2026 point equals the March range.
        String twoYears = mockMvc.perform(get("/api/admin/dashboard?range=CUSTOM&from=2025-01-01&to=2026-12-31")
                        .with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.interval").value("MONTH"))
                .andExpect(jsonPath("$.series.length()").value(24))
                .andExpect(jsonPath("$.bookingTrend.length()").value(730))
                .andReturn().getResponse().getContentAsString();
        assertThat(money(twoYears, "$.series[14].gross")).isEqualByComparingTo(money(month, "$.revenue.gross"));
        assertThat(count(twoYears, "$.series[14].hotelBookings")).isEqualTo(count(month, "$.products.hotel.bookings"));
        assertThat(sumOf(twoYears, "$.series[*].gross")).isEqualByComparingTo(money(twoYears, "$.revenue.gross"));

        // The yearly presets: five calendar years by year, the last one until today.
        String fiveYears = mockMvc.perform(get("/api/admin/dashboard?range=LAST_5_YEARS").with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.range.preset").value("LAST_5_YEARS"))
                .andExpect(jsonPath("$.interval").value("YEAR"))
                .andExpect(jsonPath("$.series.length()").value(5))
                .andReturn().getResponse().getContentAsString();
        assertThat(sumOf(fiveYears, "$.series[*].gross")).isEqualByComparingTo(money(fiveYears, "$.revenue.gross"));
        assertThat(sumOf(fiveYears, "$.series[*].bookings"))
                .isEqualByComparingTo(BigDecimal.valueOf(count(fiveYears, "$.products.all.bookings")));
        mockMvc.perform(get("/api/admin/dashboard?range=THIS_YEAR").with(admin()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.interval").value("MONTH"));
        mockMvc.perform(get("/api/admin/dashboard?range=LAST_12_MONTHS&interval=WEEK").with(admin()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.interval").value("WEEK"));

        // Limits: a daily series of five years, an unknown interval, more than five years, reports beyond 366 days.
        mockMvc.perform(get("/api/admin/dashboard?range=LAST_5_YEARS&interval=DAY").with(admin()))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_INTERVAL"));
        mockMvc.perform(get("/api/admin/dashboard?" + RANGE + "&interval=HOUR").with(admin()))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_INTERVAL"));
        mockMvc.perform(get("/api/admin/dashboard?range=CUSTOM&from=2020-01-01&to=2026-03-31").with(admin()))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_RANGE"));
        mockMvc.perform(get("/api/admin/reports/revenue?range=LAST_3_YEARS").with(admin()))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_RANGE"));
        mockMvc.perform(get("/api/admin/reports/revenue?range=THIS_YEAR").with(admin()))
                .andExpect(status().isOk());
    }

    @Test
    void reportTotalsMatchTheSourceDataAndEachOther() throws Exception {
        List<Booking> inRange = bookings.stream().filter(b -> within(b.createdAt())).toList();
        List<Booking> paid = inRange.stream().filter(b -> b.confirmedAt() != null).toList();
        List<Payment> captured = payments.stream().filter(p -> p.success() && within(p.at())).toList();

        String report = report("bookings", "");
        assertThat(count(report, "$.totals.count")).isEqualTo(inRange.size());
        assertThat(count(report, "$.totalElements")).isEqualTo(inRange.size());
        assertThat(money(report, "$.totals.totalAmount")).isEqualByComparingTo(sum(inRange.stream().map(Booking::total)));
        assertThat(money(report, "$.totals.refundedAmount"))
                .isEqualByComparingTo(sum(inRange.stream().map(Booking::refunded)));
        // The pages add up to the totals.
        BigDecimal paged = BigDecimal.ZERO;
        int pages = count(report("bookings", "&size=7"), "$.totalPages").intValue();
        for (int page = 0; page < pages; page++) {
            List<Object> amounts = JsonPath.read(report("bookings", "&size=7&sort=totalAmount,desc&page=" + page),
                    "$.content[*].totalAmount");
            paged = paged.add(sum(amounts.stream().map(ReportConsistencyIntegrationTest::decimal)));
        }
        assertThat(paged).isEqualByComparingTo(money(report, "$.totals.totalAmount"));
        String hotels = report("bookings", "&type=HOTEL&status=CONFIRMED");
        assertThat(count(hotels, "$.totals.count")).isEqualTo(inRange.stream()
                .filter(b -> b.type().equals("HOTEL") && b.status().equals("CONFIRMED")).count());

        String payments = report("payments", "&status=SUCCESS");
        assertThat(count(payments, "$.totals.count")).isEqualTo(captured.size());
        assertThat(money(payments, "$.totals.amount")).isEqualByComparingTo(sum(captured.stream().map(Payment::amount)));
        assertThat(money(payments, "$.totals.refundedAmount")).isEqualByComparingTo(sum(refunds.stream()
                .filter(r -> captured.stream().anyMatch(p -> p.id().equals(r.paymentId()))).map(Refund::amount)));
        assertThat(count(report("payments", "&status=FAILED"), "$.totals.count"))
                .isEqualTo(this.payments.stream().filter(p -> !p.success() && within(p.at())).count());

        String revenue = report("revenue", "&size=100");
        String dashboard = mockMvc.perform(get("/api/admin/dashboard?" + RANGE).with(admin()))
                .andReturn().getResponse().getContentAsString();
        assertThat(count(revenue, "$.totalElements")).isEqualTo(31);
        assertThat(money(revenue, "$.totals.gross")).isEqualByComparingTo(money(dashboard, "$.revenue.gross"));
        assertThat(money(revenue, "$.totals.refunds")).isEqualByComparingTo(money(dashboard, "$.revenue.refunds"));
        assertThat(money(revenue, "$.totals.net")).isEqualByComparingTo(money(dashboard, "$.revenue.net"));
        assertThat(count(revenue, "$.totals.payments")).isEqualTo(count(dashboard, "$.payments.successfulCount"));

        String refundsReport = report("refunds", "&status=COMPLETED");
        List<Refund> requested = refunds.stream().filter(r -> within(r.requestedAt())).toList();
        assertThat(count(refundsReport, "$.totals.count")).isEqualTo(requested.size());
        assertThat(money(refundsReport, "$.totals.amount")).isEqualByComparingTo(sum(requested.stream().map(Refund::amount)));

        String cancelled = report("cancellations", "");
        List<Cancellation> cancelledInRange = cancellations.stream().filter(c -> within(c.at())).toList();
        assertThat(count(cancelled, "$.totals.count")).isEqualTo(cancelledInRange.size());
        assertThat(money(cancelled, "$.totals.cancellationFee"))
                .isEqualByComparingTo(sum(cancelledInRange.stream().map(Cancellation::fee)));
        assertThat(money(cancelled, "$.totals.refundAmount"))
                .isEqualByComparingTo(sum(cancelledInRange.stream().map(Cancellation::refund)));

        String destinations = report("destinations", "");
        assertThat(count(destinations, "$.totals.bookings")).isEqualTo(paid.size())
                .isEqualTo(count(dashboard, "$.bookings.flight") + count(dashboard, "$.bookings.hotel"));
        assertThat(money(destinations, "$.totals.revenue")).isEqualByComparingTo(net(paid));

        String customersReport = report("customers", "&size=100");
        assertThat(count(customersReport, "$.totals.customers")).isEqualTo(8);
        assertThat(money(customersReport, "$.totals.spent")).isEqualByComparingTo(net(paid));
        assertThat(count(customersReport, "$.columns.length()")).isEqualTo(7);
    }

    @Test
    void exportsCarryEveryRowAndTheTotals() throws Exception {
        long rows = bookings.stream().filter(b -> within(b.createdAt())).count();
        byte[] csv = mockMvc.perform(get("/api/admin/reports/bookings/export?format=csv&" + RANGE).with(admin()))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "text/csv;charset=UTF-8"))
                .andExpect(header().string("Content-Disposition",
                        "attachment; filename=\"bookings-2026-03-01-2026-03-31.csv\""))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andReturn().getResponse().getContentAsByteArray();
        String text = new String(csv, StandardCharsets.UTF_8);
        assertThat(text).startsWith("﻿Reference,Type,Status");
        List<String> lines = text.lines().toList();
        assertThat(lines).hasSize((int) rows + 2);   // header + rows + total
        assertThat(lines.getLast()).startsWith("Total,");

        byte[] pdf = mockMvc.perform(get("/api/admin/reports/revenue/export?format=pdf&" + RANGE).with(admin()))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "application/pdf"))
                .andReturn().getResponse().getContentAsByteArray();
        try (PDDocument document = Loader.loadPDF(pdf)) {
            String content = new PDFTextStripper().getText(document);
            assertThat(content).contains("Revenue report").contains("1 Mar 2026 to 31 Mar 2026").contains("Total")
                    .contains("₹");
        }
        assertThat(ReportExporter.escape("=HYPERLINK(\"x\")")).startsWith("\"'=");
    }

    @Test
    void badRequestsAndPermissions() throws Exception {
        mockMvc.perform(get("/api/admin/reports/bookings?range=CUSTOM&from=2026-03-10").with(admin()))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_RANGE"));
        mockMvc.perform(get("/api/admin/reports/bookings?range=CUSTOM&from=2025-01-01&to=2026-03-01").with(admin()))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_RANGE"));
        mockMvc.perform(get("/api/admin/dashboard?range=YESTERDAY").with(admin()))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/admin/reports/everything?" + RANGE).with(admin()))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/admin/reports/bookings?sort=title&" + RANGE).with(admin()))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_SORT"));
        mockMvc.perform(get("/api/admin/reports/payments?status=MAYBE&" + RANGE).with(admin()))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_FILTER"));
        mockMvc.perform(get("/api/admin/reports/bookings/export?format=xlsx&" + RANGE).with(admin()))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/admin/dashboard").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_CUSTOMER"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/admin/dashboard")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/admin/dashboard").with(admin())).andExpect(status().isOk())
                .andExpect(jsonPath("$.range.preset").value("LAST_30_DAYS"));
    }

    @Test
    void publicFiguresNeedNoLoginAndOnlyCountRecentPaidBookings() throws Exception {
        // The test month is long ago for the 90-day window, so add two fresh paid flights on one route.
        for (int i = 0; i < 2; i++) {
            UUID id = UUID.randomUUID();
            Instant now = Instant.now().minus(Duration.ofHours(1));
            listener.handle(snapshot(id, "FL-" + id.toString().substring(0, 8).toUpperCase(), customers.getFirst(),
                    "FLIGHT", "Leh", null, now, new BigDecimal("8000.00"), "CONFIRMED", "PAID", now, null,
                    BigDecimal.ZERO, now));
        }
        mockMvc.perform(get("/api/public/popular-destinations?limit=3"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "max-age=300, public"))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].city").value("Leh"))
                .andExpect(jsonPath("$[0].bookings").value(2));
        mockMvc.perform(get("/api/public/popular-routes"))
                .andExpect(jsonPath("$[0].origin").value("DEL"))
                .andExpect(jsonPath("$[0].destination").value("LEH"))
                .andExpect(jsonPath("$[0].originCity").value("Delhi"))
                .andExpect(jsonPath("$[0].destinationCity").value("Leh"))
                .andExpect(jsonPath("$[0].bookings").value(2));
    }

    @Test
    void openDashboardsAreToldAtMostOncePerInterval() {
        clearInvocations(realtimePublisher);
        updates.publishIfChanged();   // whatever the set-up changed
        clearInvocations(realtimePublisher);
        for (int i = 0; i < 5; i++) {
            listener.handle(PaymentSucceeded.newBuilder().setPaymentId(UUID.randomUUID().toString())
                    .setBookingId(UUID.randomUUID().toString()).setUserId(UUID.randomUUID().toString())
                    .setProvider("DEMO").setProviderPaymentId("p").setAmount(EventMoney.of(BigDecimal.TEN, "INR"))
                    .setMethod("card").setSucceededAt(Instant.now().minus(Duration.ofDays(400))).build());
        }
        updates.publishIfChanged();
        updates.publishIfChanged();   // nothing new since
        verify(realtimePublisher, times(1)).publish(any(), any());
    }

    // ------------------------------------------------------------------ helpers

    /** The Phase 11 figures of [from, to) calculated directly from the source data. */
    private final class Facts {
        private final Instant from;
        private final Instant to;
        private final Map<UUID, Booking> byId;

        Facts(Instant from, Instant to, Map<UUID, Booking> byId) {
            this.from = from;
            this.to = to;
            this.byId = byId;
        }

        private boolean in(Instant at) {
            return at != null && !at.isBefore(from) && at.isBefore(to);
        }

        private boolean ofType(UUID booking, String type) {
            return type == null || byId.get(booking).type().equals(type);
        }

        long paid(String type) {
            return bookings.stream().filter(b -> in(b.createdAt()) && b.confirmedAt() != null && ofType(b.id(), type))
                    .count();
        }

        long cancelledPaid(String type) {
            return bookings.stream().filter(b -> in(b.createdAt()) && b.confirmedAt() != null
                    && b.cancelledAt() != null && ofType(b.id(), type)).count();
        }

        BigDecimal gross(String type) {
            return sum(payments.stream().filter(p -> p.success() && in(p.at()) && ofType(p.bookingId(), type))
                    .map(Payment::amount));
        }

        BigDecimal refunds(String type) {
            return sum(refunds.stream().filter(r -> in(r.completedAt()) && ofType(r.bookingId(), type))
                    .map(Refund::amount));
        }

        long succeeded() {
            return payments.stream().filter(p -> p.success() && in(p.at())).count();
        }

        long failed() {
            return payments.stream().filter(p -> !p.success() && in(p.at())).count();
        }

        BigDecimal failedAmount() {
            return sum(payments.stream().filter(p -> !p.success() && in(p.at()))
                    .map(p -> byId.get(p.bookingId()).total()));
        }

        long cancellations(String type) {
            return cancellations.stream().filter(c -> in(c.at()) && (type == null || c.type().equals(type))).count();
        }
    }

    private static void assertChange(String body, String figure, long current, long previous) {
        assertChange(body, figure, BigDecimal.valueOf(current), BigDecimal.valueOf(previous));
    }

    private static void assertChange(String body, String figure, BigDecimal current, BigDecimal previous) {
        String path = "$.comparison." + figure;
        assertThat(money(body, path + ".current")).as(figure).isEqualByComparingTo(current);
        assertThat(money(body, path + ".previous")).as(figure).isEqualByComparingTo(previous);
        assertThat(money(body, path + ".change")).as(figure).isEqualByComparingTo(current.subtract(previous));
        String trend = current.compareTo(previous) > 0 ? "UP" : current.compareTo(previous) < 0 ? "DOWN" : "FLAT";
        assertThat((String) JsonPath.read(body, path + ".trend")).as(figure).isEqualTo(trend);
        Object percent = JsonPath.read(body, path + ".changePercent");
        if (previous.signum() == 0) {
            assertThat(percent == null || decimal(percent).signum() == 0).as(figure).isTrue();
        } else {
            assertThat(decimal(percent)).as(figure).isEqualByComparingTo(current.subtract(previous)
                    .multiply(BigDecimal.valueOf(100)).divide(previous.abs(), 1, RoundingMode.HALF_UP));
        }
    }

    private static BigDecimal percent(long part, long whole) {
        return whole == 0 ? BigDecimal.ZERO : BigDecimal.valueOf(part * 100).divide(BigDecimal.valueOf(whole), 1,
                RoundingMode.HALF_UP);
    }

    private static BigDecimal sumOf(String json, String path) {
        List<Object> values = JsonPath.read(json, path);
        return values.stream().map(ReportConsistencyIntegrationTest::decimal).reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private String report(String name, String query) throws Exception {
        return mockMvc.perform(get("/api/admin/reports/" + name + "?" + RANGE + query).with(admin()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private static boolean within(Instant at) {
        return at != null && !at.isBefore(START) && at.isBefore(END);
    }

    private static BigDecimal net(List<Booking> list) {
        return sum(list.stream().map(b -> b.total().subtract(b.refunded())));
    }

    private static BigDecimal sum(java.util.stream.Stream<BigDecimal> amounts) {
        return amounts.reduce(BigDecimal.ZERO, BigDecimal::add).setScale(2, RoundingMode.HALF_UP);
    }

    private static Long count(String json, String path) {
        return ((Number) JsonPath.read(json, path)).longValue();
    }

    private static BigDecimal money(String json, String path) {
        return decimal(JsonPath.read(json, path));
    }

    private static BigDecimal decimal(Object value) {
        return new BigDecimal(value.toString()).setScale(2, RoundingMode.HALF_UP);
    }

    private static JwtRequestPostProcessor admin() {
        return jwt().jwt(token -> token.subject(UUID.randomUUID().toString()).claim("roles", List.of("ADMIN")))
                .authorities(new SimpleGrantedAuthority("ROLE_ADMIN"), new SimpleGrantedAuthority("REPORT_VIEW"));
    }
}
