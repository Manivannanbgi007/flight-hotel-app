package com.flighthotel.search;

import java.io.IOException;
import java.io.InputStream;
import java.io.StringReader;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.events.booking.BookingConfirmed;
import com.flighthotel.events.booking.BookingRefundRequested;
import com.flighthotel.events.booking.BookingSnapshot;
import com.flighthotel.events.common.Money;
import com.flighthotel.events.hotel.HotelInventoryHeld;
import com.flighthotel.events.hotel.HotelReviewSnapshot;
import com.flighthotel.events.identity.UserSnapshot;
import com.flighthotel.events.payment.PaymentFailed;
import com.flighthotel.events.payment.PaymentSucceeded;
import com.flighthotel.events.support.SupportTicketSnapshot;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch._types.Refresh;

/**
 * Test data, built as the real Avro events the other services publish:
 * <ul>
 *   <li>two customers (Aarav, Priya), a hotel manager (Rohan, runs hotel H1), a support agent and an admin;</li>
 *   <li>four active hotels in hotel-service's index (two in Chennai, one in Bangalore, one in Mumbai);</li>
 *   <li>Aarav's hotel booking B1 at H1 (paid), Priya's cancelled booking B2 at H3 (payment failed, refund requested),
 *       Aarav's flight booking B3 Chennai → Mumbai; a support ticket of Aarav; reviews of H1 (Aarav) and H3 (Priya).</li>
 * </ul>
 */
final class SearchFixtures {

    static final UUID AARAV = UUID.fromString("00000000-0000-4000-8000-0000000000a1");
    static final UUID PRIYA = UUID.fromString("00000000-0000-4000-8000-0000000000a2");
    static final UUID ROHAN = UUID.fromString("00000000-0000-4000-8000-0000000000b1");
    static final UUID VIKRAM = UUID.fromString("00000000-0000-4000-8000-0000000000c1");
    static final UUID ADMIN = UUID.fromString("00000000-0000-4000-8000-0000000000d1");

    static final String H1 = "10000000-0000-4000-8000-000000000001";
    static final String H2 = "10000000-0000-4000-8000-000000000002";
    static final String H3 = "10000000-0000-4000-8000-000000000003";
    static final String H4 = "10000000-0000-4000-8000-000000000004";

    static final String B1 = "20000000-0000-4000-8000-000000000001";
    static final String B2 = "20000000-0000-4000-8000-000000000002";
    static final String B3 = "20000000-0000-4000-8000-000000000003";
    static final String R1 = "30000000-0000-4000-8000-000000000001";
    static final String R2 = "30000000-0000-4000-8000-000000000002";
    static final String P1 = "40000000-0000-4000-8000-000000000001";
    static final String P2 = "40000000-0000-4000-8000-000000000002";
    static final String RR2 = "50000000-0000-4000-8000-000000000002";
    static final String T1 = "60000000-0000-4000-8000-000000000001";
    static final String RV1 = "70000000-0000-4000-8000-000000000001";
    static final String RV3 = "70000000-0000-4000-8000-000000000003";

    static final String REF_B1 = "HT-AAAA1111";
    static final String REF_B2 = "HT-BBBB2222";
    static final String REF_B3 = "FL-CCCC3333";

    static final Instant T0 = Instant.parse("2026-11-01T10:00:00Z");

    private SearchFixtures() {
    }

    // ----- hotel-service's hotels index -----

    static void createHotelsIndex(ElasticsearchClient elasticsearch) throws IOException {
        if (elasticsearch.indices().exists(e -> e.index("hotels")).value()) {
            elasticsearch.indices().delete(d -> d.index("hotels"));
        }
        String definition;
        try (InputStream in = SearchFixtures.class.getResourceAsStream("/hotels-index.json")) {
            definition = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        elasticsearch.indices().create(c -> c.index("hotels").withJson(new StringReader(definition)));
        hotel(elasticsearch, H1, "chennai-grand-hotel", "Chennai Grand Hotel", "Chennai", "Tamil Nadu", 5, 4.6);
        hotel(elasticsearch, H2, "chennai-business-suites", "Chennai Business Suites", "Chennai", "Tamil Nadu", 4, 4.1);
        hotel(elasticsearch, H3, "bangalore-palace-inn", "Bangalore Palace Inn", "Bangalore", "Karnataka", 3, 3.9);
        hotel(elasticsearch, H4, "mumbai-sea-view-hotel", "Mumbai Sea View Hotel", "Mumbai", "Maharashtra", 4, 4.3);
    }

    static void hotel(ElasticsearchClient elasticsearch, String id, String slug, String name, String city, String state,
            int stars, double rating) throws IOException {
        Map<String, Object> document = Map.of("id", id, "slug", slug, "name", name, "city", city, "state", state,
                "countryCode", "IN", "starRating", stars, "guestRating", rating, "reviewCount", 12,
                "propertyType", "HOTEL");
        elasticsearch.index(i -> i.index("hotels").id(id).document(document).refresh(Refresh.True));
    }

    // ----- events -----

    static UserSnapshot user(UUID id, String email, String first, String last, String role) {
        return UserSnapshot.newBuilder().setUserId(id.toString()).setEmail(email).setFirstName(first)
                .setLastName(last).setRoles(List.of(role)).setStatus("ACTIVE").setEmailVerified(true)
                .setRegisteredAt(T0).setSnapshotAt(T0).build();
    }

    static BookingSnapshot booking(String id, String reference, UUID userId, String type, String status, String title,
            String destination, String hotelId, LocalDate start, LocalDate end, Instant changedAt) {
        return BookingSnapshot.newBuilder().setBookingId(id).setBookingReference(reference)
                .setUserId(userId.toString()).setBookingType(type).setStatus(status)
                .setPaymentStatus("CANCELLED".equals(status) ? "PAYMENT_FAILED" : "PAID").setTitle(title)
                .setDestination(destination).setHotelId(hotelId).setStartDate(start).setEndDate(end)
                .setTotalAmount(money("12400")).setDiscountAmount(money("0")).setRefundedAmount(money("0"))
                .setContactEmail(userId.equals(AARAV) ? "aarav@example.com" : "priya@example.com")
                .setCreatedAt(T0).setChangedAt(changedAt).build();
    }

    static HotelInventoryHeld held(String bookingId, String reservationId, String hotelId, String hotelName, String city) {
        return HotelInventoryHeld.newBuilder().setBookingId(bookingId).setReservationId(reservationId)
                .setHotelId(hotelId).setHotelSlug("slug").setHotelName(hotelName).setHotelCity(city)
                .setHotelAddress("1 Beach Road").setCountryCode("IN").setRoomTypeId(UUID.randomUUID().toString())
                .setRoomTypeName("Deluxe Sea View Room").setRatePlanName("Breakfast included")
                .setBreakfastIncluded(true).setCheckIn(LocalDate.now().plusDays(30))
                .setCheckOut(LocalDate.now().plusDays(32)).setCheckInTime("14:00").setCheckOutTime("11:00")
                .setNights(2).setRooms(1).setAdults(2).setChildren(0).setSubtotal(money("11000"))
                .setTaxes(money("1400")).setTaxLines(List.of()).setTotal(money("12400")).setRefundable(true)
                .setCancellationFeePercent(BigDecimal.ZERO).setCancellationPolicy("Free cancellation")
                .setDemo(false).setHoldExpiresAt(T0.plusSeconds(900)).setHeldAt(T0).build();
    }

    static BookingConfirmed confirmed(String bookingId, String reference, UUID userId, String customerName) {
        return BookingConfirmed.newBuilder().setBookingId(bookingId).setBookingReference(reference)
                .setUserId(userId.toString()).setBookingType("HOTEL").setContactEmail("aarav@example.com")
                .setCustomerName(customerName).setPaymentId(P1).setBaseAmount(money("11000"))
                .setTaxAmount(money("1400")).setDiscountAmount(money("0")).setTotalAmount(money("12400"))
                .setConfirmedAt(T0.plusSeconds(60)).build();
    }

    static PaymentSucceeded paid(String paymentId, String bookingId, UUID userId) {
        return PaymentSucceeded.newBuilder().setPaymentId(paymentId).setBookingId(bookingId)
                .setUserId(userId.toString()).setProvider("demo").setProviderPaymentId("pay_demo_" + paymentId.substring(0, 8))
                .setAmount(money("12400")).setMethod("UPI").setSucceededAt(T0.plusSeconds(30)).build();
    }

    static PaymentFailed failed(String paymentId, String bookingId, UUID userId) {
        return PaymentFailed.newBuilder().setPaymentId(paymentId).setBookingId(bookingId)
                .setUserId(userId.toString()).setProvider("demo").setFailureCode("CARD_DECLINED")
                .setFailureReason("The card was declined").setFailedAt(T0.plusSeconds(30)).build();
    }

    static BookingRefundRequested refundRequested(String refundRequestId, String bookingId, String reference, UUID userId) {
        return BookingRefundRequested.newBuilder().setRefundRequestId(refundRequestId).setBookingId(bookingId)
                .setBookingReference(reference).setUserId(userId.toString()).setPaymentId(P2)
                .setAmount(money("2000")).setReason("Cancelled by the guest").setContactEmail("priya@example.com")
                .setCustomerName("Priya Nair").setRequestedAt(T0.plusSeconds(120)).build();
    }

    static SupportTicketSnapshot ticket(String ticketId, String number, UUID userId, String subject, String status) {
        return SupportTicketSnapshot.newBuilder().setTicketId(ticketId).setTicketNumber(number)
                .setUserId(userId.toString()).setCustomerEmail("aarav@example.com").setBookingId(B1)
                .setBookingReference(REF_B1).setSubject(subject).setCategory("REFUND").setStatus(status)
                .setPriority("HIGH").setCreatedAt(T0).setChangedAt(T0.plusSeconds(10)).build();
    }

    static HotelReviewSnapshot review(String reviewId, String hotelId, String hotelName, String bookingId,
            String reference, UUID userId, String author, String title, String status) {
        return HotelReviewSnapshot.newBuilder().setReviewId(reviewId).setHotelId(hotelId).setHotelName(hotelName)
                .setHotelCity("Chennai").setReservationId(UUID.randomUUID().toString()).setBookingId(bookingId)
                .setBookingReference(reference).setUserId(userId.toString()).setAuthorName(author)
                .setStayedOn(LocalDate.of(2026, 10, 12)).setRating(5).setTitle(title)
                .setText("Wonderful stay, friendly staff and a great breakfast.").setStatus(status)
                .setCreatedAt(T0).setChangedAt(T0.plusSeconds(5)).build();
    }

    static Money money(String amount) {
        return EventMoney.of(new BigDecimal(amount), "INR");
    }
}
