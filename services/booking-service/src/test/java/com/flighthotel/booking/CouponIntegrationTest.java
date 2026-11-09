package com.flighthotel.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import com.flighthotel.events.booking.BookingAwaitingPayment;
import com.flighthotel.events.hotel.HotelInventoryReleased;
import com.flighthotel.events.hotel.HotelReservationConfirmed;
import com.jayway.jsonpath.JsonPath;

/**
 * Coupons (requirement §15) are always calculated on the backend from the price hotel-service held. Uses the demo
 * coupons: WELCOME10 (10 %, max ₹1,500, min ₹2,000, once per customer), STAY500 (₹500 off hotels from ₹4,000),
 * GOA15 (15 % off stays in Goa, max ₹3,000, min ₹3,000).
 */
class CouponIntegrationTest extends BookingIntegrationTest {

    @Test
    void aBadCodeIsRefusedWhenBooking() throws Exception {
        mockMvc.perform(post("/api/bookings/hotel").with(customer(UUID.randomUUID()))
                        .header("Idempotency-Key", "key-" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON).content(bookingRequest(UUID.randomUUID(), "NOPE99", 1)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("COUPON_NOT_FOUND"));
    }

    @Test
    void previewCalculatesTheDiscountOnTheServer() throws Exception {
        UUID me = UUID.randomUUID();
        check(me, "welcome10", "HOTEL", "6300", "Goa")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value("WELCOME10"))
                .andExpect(jsonPath("$.discount").value(630.00))
                .andExpect(jsonPath("$.totalAfterDiscount").value(5670.00));
        check(me, "WELCOME10", "HOTEL", "30000", "Goa")
                .andExpect(jsonPath("$.discount").value(1500.00));
        check(me, "WELCOME10", "HOTEL", "1500", "Goa")
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("COUPON_MIN_AMOUNT_NOT_MET"))
                .andExpect(jsonPath("$.detail").value("This coupon needs a booking of at least ₹2,000."));
        check(me, "GOA15", "HOTEL", "6000", "Jaipur")
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("COUPON_NOT_APPLICABLE"));
        check(me, "STAY500", "FLIGHT", "6000", null)
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("COUPON_NOT_APPLICABLE"));
        mockMvc.perform(post("/api/coupons/check").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"WELCOME10\",\"bookingType\":\"HOTEL\",\"amount\":6300}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void theDiscountIsTakenFromTheHeldPriceAndUsedOnce() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = submit(me, "welcome10");

        held(bookingId, "Goa", "20000.00");

        String booking = details(me, bookingId);
        // 20000 + 1000 GST = 21000; 10 % = 2100, capped at 1500 → 19500
        assertThat((Double) JsonPath.read(booking, "$.discountAmount")).isEqualTo(1500.0);
        assertThat((Double) JsonPath.read(booking, "$.totalAmount")).isEqualTo(19500.0);
        assertThat((List<String>) JsonPath.read(booking, "$.priceItems[*].label")).contains("Coupon WELCOME10");
        assertThat((List<Double>) JsonPath.read(booking, "$.priceItems[?(@.type=='DISCOUNT')].amount"))
                .containsExactly(-1500.0);
        assertThat(single(bookingId, BookingAwaitingPayment.class).getAmount().getAmount())
                .isEqualByComparingTo("19500.00");
        assertThat(usage(bookingId)).isEqualTo("RESERVED");

        paymentSucceeded(bookingId, UUID.randomUUID(), "19500.00");
        hotelEvents.handle(eventId(), HotelReservationConfirmed.newBuilder().setBookingId(bookingId.toString())
                .setReservationId(UUID.randomUUID().toString()).setConfirmationNumber("HCCCC44444")
                .setConfirmedAt(Instant.now()).build());
        assertThat(usage(bookingId)).isEqualTo("CONSUMED");

        // WELCOME10 is once per customer.
        mockMvc.perform(post("/api/bookings/hotel").with(customer(me)).header("Idempotency-Key", "key-" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON).content(bookingRequest(UUID.randomUUID(), "WELCOME10", 1)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("COUPON_ALREADY_USED"));
    }

    @Test
    void aCouponThatDoesNotFitTheHeldPriceIsSkippedWithANote() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = submit(me, "STAY500");

        held(bookingId, "Goa", "3000.00");

        String booking = details(me, bookingId);
        assertThat((String) JsonPath.read(booking, "$.status")).isEqualTo("PENDING_PAYMENT");
        assertThat((Double) JsonPath.read(booking, "$.discountAmount")).isEqualTo(0.0);
        assertThat((Double) JsonPath.read(booking, "$.totalAmount")).isEqualTo(3150.0);
        assertThat((String) JsonPath.read(booking, "$.couponNote"))
                .isEqualTo("Coupon STAY500 was not applied: This coupon needs a booking of at least ₹4,000.");
        assertThat(usage(bookingId)).isNull();
    }

    @Test
    void anExpiredBookingGivesTheCouponBack() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = submit(me, "GOA15");
        held(bookingId, "Goa", "10000.00");
        // 10000 + 500 GST = 10500; 15 % = 1575
        assertThat((Double) JsonPath.read(details(me, bookingId), "$.discountAmount")).isEqualTo(1575.0);
        int usedBefore = usedCount("GOA15");

        hotelEvents.handle(eventId(), HotelInventoryReleased.newBuilder().setBookingId(bookingId.toString())
                .setReservationId(UUID.randomUUID().toString()).setReason("EXPIRED").setReleasedAt(Instant.now()).build());

        assertThat(usage(bookingId)).isEqualTo("RELEASED");
        assertThat(usedCount("GOA15")).isEqualTo(usedBefore - 1);
    }

    private org.springframework.test.web.servlet.ResultActions check(UUID userId, String code, String type,
            String amount, String city) throws Exception {
        return mockMvc.perform(post("/api/coupons/check").with(customer(userId)).contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"code":"%s","bookingType":"%s","amount":%s%s}"""
                        .formatted(code, type, amount, city == null ? "" : ",\"destinationCity\":\"" + city + "\"")));
    }

    private String usage(UUID bookingId) {
        return jdbcClient.sql("SELECT status FROM coupon_usage WHERE booking_id = UUID_TO_BIN(:id)")
                .param("id", bookingId.toString()).query(String.class).optional().orElse(null);
    }

    private int usedCount(String code) {
        return jdbcClient.sql("SELECT used_count FROM coupons WHERE code = :code")
                .param("code", code).query(Integer.class).single();
    }
}
