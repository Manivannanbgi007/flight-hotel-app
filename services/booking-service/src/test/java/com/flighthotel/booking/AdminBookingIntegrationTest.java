package com.flighthotel.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.web.servlet.ResultActions;

import com.flighthotel.booking.service.BookingSnapshotBackfill;
import com.flighthotel.events.booking.BookingCancelled;
import com.flighthotel.events.booking.BookingCompleted;
import com.flighthotel.events.booking.BookingRefundRequested;
import com.flighthotel.events.booking.BookingSnapshot;
import com.flighthotel.events.hotel.GuestCheckedIn;
import com.flighthotel.events.hotel.GuestCheckedOut;
import com.flighthotel.events.hotel.HotelReservationCancelled;
import com.flighthotel.events.hotel.HotelReservationConfirmed;
import com.flighthotel.events.payment.RefundCompleted;
import com.jayway.jsonpath.JsonPath;

/**
 * Phase 9 in booking-service: snapshots for reporting, the admin booking search, goodwill refunds, the hotel cancelling
 * on its own, check-out completing the stay, and coupon and offer management.
 */
class AdminBookingIntegrationTest extends BookingIntegrationTest {

    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");

    @Autowired
    BookingSnapshotBackfill backfill;

    // ------------------------------------------------------------------ snapshots for reporting

    @Test
    void everyTransactionPublishesOneSnapshotWithTheBookingsFinalState() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = confirmedStay(userId);

        List<BookingSnapshot> snapshots = snapshots(bookingId);
        // created, held, paid (two status moves, one transaction), confirmed
        assertThat(snapshots).extracting(BookingSnapshot::getStatus)
                .containsExactly("INITIATED", "PENDING_PAYMENT", "SUPPLIER_PENDING", "CONFIRMED");
        BookingSnapshot last = snapshots.getLast();
        assertThat(last.getPaymentStatus()).isEqualTo("PAID");
        assertThat(last.getBookingType()).isEqualTo("HOTEL");
        assertThat(last.getDestination()).isEqualTo("Goa");
        assertThat(last.getTitle()).isEqualTo("Sea Breeze Resort");
        assertThat(last.getHotelId()).isNotNull();
        assertThat(last.getTotalAmount().getAmount()).isEqualByComparingTo("6300.00");
        assertThat(last.getConfirmedAt()).isNotNull();
        assertThat(last.getUserId()).isEqualTo(userId.toString());
        assertThat(last.getDemo()).isTrue();
    }

    @Test
    void theBackfillPublishesEveryBookingOnceAndOnlyOnce() throws Exception {
        UUID bookingId = submit(UUID.randomUUID(), null);
        long bookings = jdbcClient.sql("SELECT COUNT(*) FROM bookings").query(Long.class).single();
        jdbcClient.sql("UPDATE data_backfills SET done_at = NULL WHERE name = 'booking-snapshots'").update();
        long before = snapshotRows();

        backfill.onStart();
        backfill.onStart();   // already done: nothing more

        assertThat(snapshotRows() - before).isEqualTo(bookings);
        assertThat(snapshots(bookingId)).hasSize(2);   // its own at creation + the backfill's
        assertThat(jdbcClient.sql("SELECT done_at IS NOT NULL FROM data_backfills WHERE name = 'booking-snapshots'")
                .query(Boolean.class).single()).isTrue();
    }

    // ------------------------------------------------------------------ admin search

    @Test
    void adminsSearchByCreationDayAndSortAndCustomersCannot() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID cheap = confirmedStay(userId);
        UUID dear = submit(userId, null);
        held(dear, "Jaipur", "9000.00");
        String today = LocalDate.now(INDIA).toString();
        String yesterday = LocalDate.now(INDIA).minusDays(1).toString();

        mockMvc.perform(get("/api/admin/bookings?q=asha@example.com&from=" + today + "&to=" + today
                        + "&sort=totalAmount,desc&size=100").with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.id == '" + dear + "')].totalAmount").value(Matchers.contains(9450.0)))
                .andExpect(jsonPath("$.content[?(@.id == '" + cheap + "')].userId")
                        .value(Matchers.contains(userId.toString())))
                .andExpect(jsonPath("$.content[?(@.id == '" + cheap + "')].refundedAmount").value(Matchers.contains(0.0)));
        String sorted = mockMvc.perform(get("/api/admin/bookings?q=asha@example.com&sort=totalAmount,desc&size=100")
                        .with(admin()))
                .andReturn().getResponse().getContentAsString();
        List<Double> totals = JsonPath.read(sorted, "$.content[*].totalAmount");
        assertThat(totals).isSortedAccordingTo((a, b) -> Double.compare(b, a));

        mockMvc.perform(get("/api/admin/bookings?q=asha@example.com&to=" + yesterday).with(admin()))
                .andExpect(jsonPath("$.content[?(@.id == '" + cheap + "')]").isEmpty());
        mockMvc.perform(get("/api/admin/bookings?sort=title").with(admin()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_SORT"));
        mockMvc.perform(get("/api/admin/bookings?from=" + today + "&to=" + yesterday).with(admin()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_RANGE"));
        mockMvc.perform(get("/api/admin/bookings").with(customer(userId)))
                .andExpect(status().isForbidden());
    }

    // ------------------------------------------------------------------ goodwill refunds

    @Test
    void aGoodwillRefundGivesMoneyBackWhileTheBookingStands() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = confirmedStay(userId);   // 6300 paid
        String key = "goodwill-" + UUID.randomUUID();

        goodwill(admin(), bookingId, key, "1000.00", "Pool closed during the stay")
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.reason").value("GOODWILL"))
                .andExpect(jsonPath("$.status").value("REQUESTED"))
                .andExpect(jsonPath("$.amount").value(1000.0));
        // The same request again: the same refund, nothing new.
        goodwill(admin(), bookingId, key, "1000.00", "Pool closed during the stay").andExpect(status().isAccepted());
        goodwill(admin(), bookingId, key, "999.00", "Pool closed during the stay")
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REUSED"));
        assertThat(eventsOf(bookingId, BookingRefundRequested.class)).hasSize(1);
        BookingRefundRequested request = eventsOf(bookingId, BookingRefundRequested.class).getFirst();
        assertThat(request.getReason()).isEqualTo("GOODWILL");

        String details = details(userId, bookingId);
        assertThat((String) JsonPath.read(details, "$.status")).isEqualTo("CONFIRMED");
        assertThat((String) JsonPath.read(details, "$.paymentStatus")).isEqualTo("PAID");

        // More than what is left (6300 - 1000 on its way) is refused; support agents may not refund at all.
        goodwill(admin(), bookingId, "goodwill-" + UUID.randomUUID(), "5300.01", "Too much")
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("REFUND_TOO_LARGE"))
                .andExpect(jsonPath("$.details.refundable").value(5300.0));
        goodwill(supportAgent(), bookingId, "goodwill-" + UUID.randomUUID(), "10.00", "Not allowed")
                .andExpect(status().isForbidden());

        paymentEvents.handle(eventId(), RefundCompleted.newBuilder().setRefundId(UUID.randomUUID().toString())
                .setRefundRequestId(request.getRefundRequestId()).setPaymentId(request.getPaymentId())
                .setBookingId(bookingId.toString()).setUserId(userId.toString()).setAmount(request.getAmount())
                .setCompletedAt(Instant.now()).build());
        details = details(userId, bookingId);
        assertThat((String) JsonPath.read(details, "$.status")).isEqualTo("CONFIRMED");
        assertThat((String) JsonPath.read(details, "$.paymentStatus")).isEqualTo("PARTIALLY_REFUNDED");
        assertThat(snapshots(bookingId).getLast().getRefundedAmount().getAmount()).isEqualByComparingTo("1000.00");

        // A later cancellation (free period) refunds only the rest.
        mockMvc.perform(get("/api/bookings/" + bookingId + "/cancellation-quote").with(customer(userId)))
                .andExpect(jsonPath("$.paidAmount").value(5300.0))
                .andExpect(jsonPath("$.refundAmount").value(5300.0));
        assertThat(jdbcClient.sql("SELECT note FROM booking_refund_requests WHERE booking_id = UUID_TO_BIN(:id)")
                .param("id", bookingId.toString()).query(String.class).single()).isEqualTo("Pool closed during the stay");
    }

    @Test
    void nothingPaidMeansNothingToRefund() throws Exception {
        UUID bookingId = submit(UUID.randomUUID(), null);
        held(bookingId, "Goa", "6000.00");
        goodwill(admin(), bookingId, "goodwill-" + UUID.randomUUID(), "100.00", "Customer complaint")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("NOT_REFUNDABLE"));
        goodwill(admin(), bookingId, "goodwill-" + UUID.randomUUID(), "100.00", "no")
                .andExpect(status().isBadRequest());
    }

    // ------------------------------------------------------------------ the hotel's front desk

    @Test
    void theHotelCancellingOnItsOwnRefundsEverythingOnce() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = confirmedStay(userId);
        String cancellationId = UUID.randomUUID().toString();
        HotelReservationCancelled cancelled = HotelReservationCancelled.newBuilder()
                .setBookingId(bookingId.toString()).setReservationId(UUID.randomUUID().toString())
                .setCancellationId(cancellationId).setCancellationReference("HXK7M3Q9P2").setCancelledAt(Instant.now())
                .setInitiatedBy("HOTEL").setReason("Overbooked: no rooms left for these dates").build();

        hotelEvents.handle(eventId(), cancelled);
        hotelEvents.handle(eventId(), cancelled);   // repeated by the hotel: nothing more

        String details = details(userId, bookingId);
        assertThat((String) JsonPath.read(details, "$.status")).isEqualTo("REFUND_PENDING");
        assertThat((String) JsonPath.read(details, "$.cancellation.initiatedBy")).isEqualTo("HOTEL");
        assertThat((Double) JsonPath.read(details, "$.cancellation.cancellationFee")).isZero();
        assertThat((Double) JsonPath.read(details, "$.cancellation.refundAmount")).isEqualTo(6300.0);
        BookingCancelled event = single(bookingId, BookingCancelled.class);
        assertThat(event.getInitiatedBy()).isEqualTo("HOTEL");
        assertThat(event.getFeeWaived()).isTrue();
        assertThat(single(bookingId, BookingRefundRequested.class).getAmount().getAmount())
                .isEqualByComparingTo("6300.00");
        assertThat(jdbcClient.sql("SELECT COUNT(*) FROM cancellations WHERE booking_id = UUID_TO_BIN(:id)")
                .param("id", bookingId.toString()).query(Long.class).single()).isEqualTo(1);
    }

    @Test
    @SuppressWarnings("unchecked")
    void checkOutCompletesTheStayAndCheckInIsOnTheTimeline() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = confirmedStay(userId);
        hotelEvents.handle(eventId(), GuestCheckedIn.newBuilder().setBookingId(bookingId.toString())
                .setReservationId(UUID.randomUUID().toString()).setHotelId(UUID.randomUUID().toString())
                .setAt(Instant.now()).build());
        GuestCheckedOut out = GuestCheckedOut.newBuilder().setBookingId(bookingId.toString())
                .setReservationId(UUID.randomUUID().toString()).setHotelId(UUID.randomUUID().toString())
                .setAt(Instant.now()).build();
        hotelEvents.handle(eventId(), out);
        hotelEvents.handle(eventId(), out);   // ignored: already completed

        String details = details(userId, bookingId);
        assertThat((String) JsonPath.read(details, "$.status")).isEqualTo("COMPLETED");
        String timeline = mockMvc.perform(get("/api/bookings/" + bookingId + "/timeline").with(customer(userId)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat((List<String>) JsonPath.read(timeline, "$[*].reason"))
                .contains("Checked in at the hotel", "Checked out: stay completed");
        assertThat(eventsOf(bookingId, BookingCompleted.class)).hasSize(1);
    }

    // ------------------------------------------------------------------ coupons and offers

    @Test
    void couponsAreManagedWithTheirRules() throws Exception {
        String code = "AUTUMN" + (System.nanoTime() % 100000);
        String created = mockMvc.perform(post("/api/admin/coupons").with(couponManager())
                        .contentType(MediaType.APPLICATION_JSON).content(coupon(code, "PERCENT", "12", null)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.code").value(code))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.usedCount").value(0))
                .andExpect(jsonPath("$.expired").value(false))
                .andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(created, "$.id");
        Integer version = JsonPath.read(created, "$.version");

        mockMvc.perform(post("/api/admin/coupons").with(couponManager()).contentType(MediaType.APPLICATION_JSON)
                        .content(coupon(code.toLowerCase(), "FIXED", "100", null)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("COUPON_CODE_TAKEN"));
        mockMvc.perform(post("/api/admin/coupons").with(couponManager()).contentType(MediaType.APPLICATION_JSON)
                        .content(coupon(code + "X", "PERCENT", "101", null)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_VALUE"));
        mockMvc.perform(post("/api/admin/coupons").with(couponManager()).contentType(MediaType.APPLICATION_JSON)
                        .content(coupon("A!", "PERCENT", "10", null)))
                .andExpect(status().isBadRequest());

        mockMvc.perform(put("/api/admin/coupons/" + id).with(couponManager()).contentType(MediaType.APPLICATION_JSON)
                        .content(coupon(code, "PERCENT", "15", version)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.discountValue").value(15.0));
        mockMvc.perform(put("/api/admin/coupons/" + id).with(couponManager()).contentType(MediaType.APPLICATION_JSON)
                        .content(coupon(code, "PERCENT", "20", version)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONCURRENT_MODIFICATION"));
        mockMvc.perform(put("/api/admin/coupons/" + id).with(couponManager()).contentType(MediaType.APPLICATION_JSON)
                        .content(coupon("OTHER1", "PERCENT", "20", null)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("COUPON_CODE_CANNOT_CHANGE"));

        // Used once by a booking: reserved count, and the limit cannot go below it.
        UUID bookingId = submit(UUID.randomUUID(), code);
        held(bookingId, "Goa", "6000.00");
        mockMvc.perform(get("/api/admin/coupons?q=" + code.toLowerCase()).with(couponManager()))
                .andExpect(jsonPath("$.content[0].usedCount").value(1))
                .andExpect(jsonPath("$.content[0].reservedCount").value(1))
                .andExpect(jsonPath("$.content[0].consumedCount").value(0));
        UUID second = submit(UUID.randomUUID(), code);
        held(second, "Goa", "6000.00");
        String limitOne = coupon(code, "PERCENT", "15", null).replace("\"usageLimit\":50", "\"usageLimit\":1");
        mockMvc.perform(put("/api/admin/coupons/" + id).with(couponManager()).contentType(MediaType.APPLICATION_JSON)
                        .content(limitOne))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("USAGE_LIMIT_TOO_LOW"));
        mockMvc.perform(patch("/api/admin/coupons/" + id + "/status").with(couponManager())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"INACTIVE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("INACTIVE"));
        mockMvc.perform(get("/api/admin/coupons").with(customer(UUID.randomUUID())))
                .andExpect(status().isForbidden());
    }

    @Test
    void offersAreShownOnlyWhileTheyAndTheirCouponCanBeUsed() throws Exception {
        String code = "SEASON" + (System.nanoTime() % 100000);
        String coupon = mockMvc.perform(post("/api/admin/coupons").with(couponManager())
                        .contentType(MediaType.APPLICATION_JSON).content(coupon(code, "PERCENT", "10", null)))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String couponId = JsonPath.read(coupon, "$.id");
        String title = "Monsoon escapes " + code;
        String offer = mockMvc.perform(post("/api/admin/offers").with(couponManager())
                        .contentType(MediaType.APPLICATION_JSON).content("""
                                {"title":"%s","description":"Hills and waterfalls","couponId":"%s","appliesTo":"HOTEL",
                                 "validFrom":"2026-01-01T00:00:00Z","validTo":"2030-01-01T00:00:00Z","seasonal":true,
                                 "theme":"FOREST"}""".formatted(title, couponId)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.couponCode").value(code))
                .andExpect(jsonPath("$.discountLabel").value("10% off, up to ₹1,500"))
                .andExpect(jsonPath("$.live").value(true))
                .andReturn().getResponse().getContentAsString();
        String offerId = JsonPath.read(offer, "$.id");

        mockMvc.perform(get("/api/offers"))   // public
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '" + offerId + "')].couponCode").value(Matchers.contains(code)))
                .andExpect(jsonPath("$[?(@.id == '" + offerId + "')].theme").value(Matchers.contains("FOREST")))
                .andExpect(jsonPath("$[?(@.id == '" + offerId + "')].seasonal").value(Matchers.contains(true)));

        // The coupon is switched off: the offer disappears from the public list.
        mockMvc.perform(patch("/api/admin/coupons/" + couponId + "/status").with(couponManager())
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"INACTIVE\"}"));
        mockMvc.perform(get("/api/offers"))
                .andExpect(jsonPath("$[?(@.id == '" + offerId + "')]").isEmpty());
        mockMvc.perform(get("/api/admin/offers?q=" + code.toLowerCase()).with(couponManager()))
                .andExpect(jsonPath("$.content[0].live").value(false));

        mockMvc.perform(post("/api/admin/offers").with(couponManager()).contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"Broken","couponId":"%s","validFrom":"2026-01-01T00:00:00Z",
                                 "validTo":"2025-01-01T00:00:00Z"}""".formatted(couponId)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.details.field").value("validTo"));
        mockMvc.perform(post("/api/admin/offers").with(customer(UUID.randomUUID()))
                        .contentType(MediaType.APPLICATION_JSON).content("""
                                {"title":"Not mine","couponId":"%s","validFrom":"2026-01-01T00:00:00Z",
                                 "validTo":"2030-01-01T00:00:00Z"}""".formatted(couponId)))
                .andExpect(status().isForbidden());
    }

    // ------------------------------------------------------------------ helpers

    private static JwtRequestPostProcessor admin() {
        return user(UUID.randomUUID(), Set.of("ADMIN"), Set.of("BOOKING_READ_ANY", "BOOKING_MANAGE_ANY",
                "PAYMENT_READ_ANY", "REFUND_MANAGE", "COUPON_MANAGE"));
    }

    private static JwtRequestPostProcessor couponManager() {
        return user(UUID.randomUUID(), Set.of("ADMIN"), Set.of("COUPON_MANAGE"));
    }

    private static String coupon(String code, String type, String value, Integer version) {
        return """
                {"code":"%s","title":"Autumn sale","description":"Admin test coupon","discountType":"%s",
                 "discountValue":%s,"maxDiscount":1500,"minBookingAmount":1000,"appliesTo":"ALL",
                 "validFrom":"2026-01-01T00:00:00Z","validTo":"2030-01-01T00:00:00Z","usageLimit":50,
                 "perCustomerLimit":2%s}""".formatted(code, type, value, version == null ? "" : ",\"version\":" + version);
    }

    /** Held (6000 + 5 % GST = 6300), paid and confirmed by the hotel. */
    private UUID confirmedStay(UUID userId) throws Exception {
        UUID bookingId = submit(userId, null);
        held(bookingId, "Goa", "6000.00");
        paymentSucceeded(bookingId, UUID.randomUUID(), "6300.00");
        hotelEvents.handle(eventId(), HotelReservationConfirmed.newBuilder().setBookingId(bookingId.toString())
                .setReservationId(UUID.randomUUID().toString()).setConfirmationNumber("HK7M3Q9P2X")
                .setConfirmedAt(Instant.now()).build());
        assertThat((String) JsonPath.read(details(userId, bookingId), "$.status")).isEqualTo("CONFIRMED");
        return bookingId;
    }

    private ResultActions goodwill(JwtRequestPostProcessor who, UUID bookingId, String key, String amount,
            String reason) throws Exception {
        return mockMvc.perform(post("/api/admin/bookings/" + bookingId + "/refunds").with(who)
                .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON)
                .content("{\"amount\":" + amount + ",\"reason\":\"" + reason + "\"}"));
    }

    private <T> List<T> eventsOf(UUID bookingId, Class<T> type) {
        return events(bookingId).stream().filter(type::isInstance).map(type::cast).toList();
    }

    private long snapshotRows() {
        return jdbcClient.sql("SELECT COUNT(*) FROM outbox_events WHERE event_type = :type")
                .param("type", BookingSnapshot.class.getName()).query(Long.class).single();
    }
}
