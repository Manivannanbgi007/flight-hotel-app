package com.flighthotel.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import com.flighthotel.booking.messaging.FlightEventsListener;
import com.flighthotel.common.events.EventMoney;
import com.flighthotel.events.booking.BookingAwaitingPayment;
import com.flighthotel.events.booking.BookingConfirmed;
import com.flighthotel.events.booking.BookingInitiated;
import com.flighthotel.events.booking.BookingRefundRequested;
import com.flighthotel.events.common.FlightSegmentInfo;
import com.flighthotel.events.common.FlightSlice;
import com.flighthotel.events.flight.FlightBookingConfirmed;
import com.flighthotel.events.flight.FlightBookingFailed;
import com.flighthotel.events.flight.FlightBookingUncertain;
import com.flighthotel.events.flight.FlightOfferHeld;
import com.flighthotel.events.flight.FlightOfferHoldFailed;
import com.flighthotel.events.flight.FlightOfferReleased;
import com.flighthotel.events.flight.FlightPriceLine;
import com.flighthotel.events.flight.FlightTicketInfo;
import com.flighthotel.events.payment.RefundCompleted;
import com.jayway.jsonpath.JsonPath;

/** The flight booking saga from booking-service's side: every flight failure path of BOOKING_WORKFLOW.md section 3. */
class FlightBookingSagaIntegrationTest extends BookingIntegrationTest {

    @Autowired
    FlightEventsListener flightEvents;

    // ------------------------------------------------------------------ requests

    private static String adult(String first, String last) {
        return """
                {"passengerType":"ADULT","firstName":"%s","lastName":"%s","dateOfBirth":"1990-04-02","gender":"FEMALE",
                 "nationality":"in","passportNumber":"n1234567","passportExpiry":"%s","passportCountry":"in"}"""
                .formatted(first, last, LocalDate.now().plusYears(5));
    }

    private static String flightRequest(String passengers, String coupon) {
        return """
                {"tripOfferId":"%s","contact":{"email":"Asha@Example.com","phone":"+91 98000 00000"},
                 "passengers":[%s]%s}""".formatted(UUID.randomUUID(), passengers,
                coupon == null ? "" : ",\"couponCode\":\"" + coupon + "\"");
    }

    private UUID submitFlight(UUID userId, String coupon) throws Exception {
        String body = mockMvc.perform(post("/api/bookings/flight").with(customer(userId))
                        .header("Idempotency-Key", "key-" + UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON)
                        .content(flightRequest(adult("Asha", "Rao"), coupon)))
                .andExpect(status().isAccepted()).andReturn().getResponse().getContentAsString();
        return UUID.fromString(JsonPath.read(body, "$.id"));
    }

    // ------------------------------------------------------------------ flight-service's events

    private FlightOfferHeld held(UUID bookingId, boolean roundTrip) {
        Instant now = Instant.now();
        LocalDate out = LocalDate.now().plusDays(30);
        List<FlightSlice> slices = new java.util.ArrayList<>();
        slices.add(slice("DEL", "Delhi", "BOM", "Mumbai", out, "AI 504"));
        if (roundTrip) {
            slices.add(slice("BOM", "Mumbai", "DEL", "Delhi", out.plusDays(4), "AI 505"));
        }
        BigDecimal fares = new BigDecimal(roundTrip ? "9000.00" : "4500.00");
        BigDecimal taxes = new BigDecimal(roundTrip ? "1350.00" : "675.00");
        return FlightOfferHeld.newBuilder()
                .setBookingId(bookingId.toString())
                .setHoldId(UUID.randomUUID().toString())
                .setProvider("DEMO")
                .setDemo(true)
                .setTitle("Delhi to Mumbai")
                .setTripType(roundTrip ? "ROUND_TRIP" : "ONE_WAY")
                .setCabin("ECONOMY")
                .setFareName("Economy Flex")
                .setRefundable(true)
                .setCheckedBaggageKg(20)
                .setCabinBaggageKg(7)
                .setCancellationFeePercent(25)
                .setCancellationPolicy("Cancel up to 4 hours before departure for a fee of 25% of the fare.")
                .setSlices(slices)
                .setAdults(1).setChildren(0).setInfants(0)
                .setSubtotal(EventMoney.of(fares, "INR"))
                .setTaxes(EventMoney.of(taxes, "INR"))
                .setPriceLines(List.of(
                        line("Fare · 1 adult", fares), line("Fuel and airport charges", new BigDecimal("450.00")),
                        line("GST 5%", taxes.subtract(new BigDecimal("450.00")))))
                .setTotal(EventMoney.of(fares.add(taxes), "INR"))
                .setHoldExpiresAt(now.plus(20, ChronoUnit.MINUTES))
                .setHeldAt(now)
                .build();
    }

    private static FlightPriceLine line(String label, BigDecimal amount) {
        return FlightPriceLine.newBuilder().setLabel(label).setAmount(EventMoney.of(amount, "INR")).build();
    }

    private static FlightSlice slice(String from, String fromCity, String to, String toCity, LocalDate day, String flight) {
        return FlightSlice.newBuilder().setOrigin(from).setDestination(to).setOriginCity(fromCity)
                .setDestinationCity(toCity).setDepartureLocal(day + "T06:45").setArrivalLocal(day + "T08:55")
                .setDurationMinutes(130).setStops(0)
                .setSegments(List.of(FlightSegmentInfo.newBuilder().setFlightNumber(flight).setAirlineCode("AI")
                        .setAirlineName("Air India").setOrigin(from).setDestination(to)
                        .setDepartureLocal(day + "T06:45").setArrivalLocal(day + "T08:55").setDurationMinutes(130)
                        .build()))
                .build();
    }

    private void heldBy(UUID bookingId, FlightOfferHeld held) {
        flightEvents.handle(eventId(), held);
    }

    private void confirmedByAirline(UUID bookingId, int passengers) {
        flightEvents.handle(eventId(), FlightBookingConfirmed.newBuilder().setBookingId(bookingId.toString())
                .setHoldId(UUID.randomUUID().toString()).setSupplierOrderId("DO1234567890").setPnr("K7M2QX")
                .setTickets(java.util.stream.IntStream.rangeClosed(1, passengers).mapToObj(i ->
                        FlightTicketInfo.newBuilder().setPassengerIndex(i).setTicketNumber("098123456789" + i).build())
                        .toList())
                .setConfirmedAt(Instant.now()).build());
    }

    private void failedAtAirline(UUID bookingId, String reason) {
        flightEvents.handle(eventId(), FlightBookingFailed.newBuilder().setBookingId(bookingId.toString())
                .setHoldId(UUID.randomUUID().toString()).setReason(reason).setMessage("The airline said no.")
                .setFailedAt(Instant.now()).build());
    }

    private String json(UUID userId, UUID bookingId) throws Exception {
        return details(userId, bookingId);
    }

    // ------------------------------------------------------------------ submitting

    @Test
    void aFlightBookingStartsIdempotentlyAndKeepsPassportNumbersOutOfEvents() throws Exception {
        UUID userId = UUID.randomUUID();
        String key = "key-" + UUID.randomUUID();
        String body = flightRequest(adult("Asha", "Rao"), null);

        String first = mockMvc.perform(post("/api/bookings/flight").with(customer(userId)).header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isAccepted()).andExpect(jsonPath("$.status").value("INITIATED"))
                .andExpect(jsonPath("$.type").value("FLIGHT")).andExpect(jsonPath("$.reference").value(org.hamcrest.Matchers.startsWith("FL-")))
                .andReturn().getResponse().getContentAsString();
        UUID bookingId = UUID.fromString(JsonPath.read(first, "$.id"));
        String again = mockMvc.perform(post("/api/bookings/flight").with(customer(userId)).header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isAccepted()).andReturn().getResponse().getContentAsString();
        assertThat((String) JsonPath.read(again, "$.id")).isEqualTo(bookingId.toString());
        mockMvc.perform(post("/api/bookings/flight").with(customer(userId)).header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(body.replace("Asha", "Anna")))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REUSED"));

        // The seat request carries names and types, never the passport number.
        BookingInitiated initiated = single(bookingId, BookingInitiated.class);
        assertThat(initiated.getBookingType()).isEqualTo("FLIGHT");
        assertThat(initiated.getFlight().getPassengers()).hasSize(1);
        assertThat(initiated.getFlight().getPassengers().getFirst().getLastName()).isEqualTo("Rao");
        assertThat(initiated.getFlight().getPassengers().getFirst().getNationality()).isEqualTo("IN");
        assertThat(initiated.toString()).doesNotContain("N1234567");
        assertThat(initiated.getHotel()).isNull();

        // Encrypted at rest, shown as the last four characters only.
        String stored = jdbcClient.sql("SELECT passport_number_enc FROM booking_passengers WHERE booking_id = UUID_TO_BIN(:id)")
                .param("id", bookingId.toString()).query(String.class).single();
        assertThat(stored).startsWith("v1:").doesNotContain("N1234567");
        String shown = json(userId, bookingId);
        assertThat((String) JsonPath.read(shown, "$.flight.passengers[0].passportLast4")).isEqualTo("4567");
        assertThat(shown).doesNotContain("N1234567").doesNotContain("n1234567");
        assertThat((Object) JsonPath.read(shown, "$.flight.passengers[0].ticketNumber")).isNull();
        assertThat((Object) JsonPath.read(shown, "$.flight.pnr")).isNull();
    }

    @Test
    void passengersAreCheckedLikeTheAirlineWouldCheckThem() throws Exception {
        UUID userId = UUID.randomUUID();
        String infant = """
                {"passengerType":"INFANT","firstName":"Baby","lastName":"Rao","dateOfBirth":"%s"}""".formatted(LocalDate.now().minusMonths(8));
        String child = """
                {"passengerType":"CHILD","firstName":"Kid","lastName":"Rao","dateOfBirth":"%s"}""".formatted(LocalDate.now().minusYears(6));

        // A family: adult, child, infant is fine.
        mockMvc.perform(post("/api/bookings/flight").with(customer(userId)).header("Idempotency-Key", "key-" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(flightRequest(adult("Asha", "Rao") + "," + child + "," + infant, null)))
                .andExpect(status().isAccepted());

        String[][] bad = {
                { child + "," + adult("Asha", "Rao"), "adults first" },
                { adult("Asha", "Rao") + "," + infant + "," + infant, "one infant per adult" },
                { child, "1 to 9 travellers" },
                { adult("Asha", "Rao") + "," + child.replace(",\"dateOfBirth\":\"" + LocalDate.now().minusYears(6) + "\"", ""), "date of birth" },
                { adult("Asha", "Rao") + "," + child.replace(LocalDate.now().minusYears(6).toString(), LocalDate.now().minusYears(15).toString()), "2 to 11" },
                { adult("Asha", "Rao") + "," + infant.replace(LocalDate.now().minusMonths(8).toString(), LocalDate.now().minusYears(3).toString()), "under 2" },
                { adult("Asha", "Rao").replace("\"passportCountry\":\"in\"", "\"passportCountry\":\"\""), "passport" },
                { adult("Asha", "Rao").replace(LocalDate.now().plusYears(5).toString(), LocalDate.now().minusDays(1).toString()), "expired" },
        };
        for (String[] scenario : bad) {
            mockMvc.perform(post("/api/bookings/flight").with(customer(userId)).header("Idempotency-Key", "key-" + UUID.randomUUID())
                            .contentType(MediaType.APPLICATION_JSON).content(flightRequest(scenario[0], null)))
                    .andExpect(status().isUnprocessableContent())
                    .andExpect(jsonPath("$.code").value("INVALID_PASSENGERS"))
                    .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsStringIgnoringCase(scenario[1])));
        }
        mockMvc.perform(post("/api/bookings/flight").with(customer(userId)).contentType(MediaType.APPLICATION_JSON)
                        .content(flightRequest(adult("Asha", "Rao"), null))).andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/bookings/flight").with(customer(userId)).header("Idempotency-Key", "key-" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(flightRequest(adult("Asha", "R4o"), null))).andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/bookings/flight").header("Idempotency-Key", "key-" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON).content(flightRequest(adult("Asha", "Rao"), null)))
                .andExpect(status().isUnauthorized());
    }

    // ------------------------------------------------------------------ held, priced, paid, confirmed

    @Test
    void heldPaidConfirmedWithThePnrAppearingOnlyAtTheEnd() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = submitFlight(userId, "WELCOME10");

        heldBy(bookingId, held(bookingId, false));

        String pending = json(userId, bookingId);
        assertThat((String) JsonPath.read(pending, "$.status")).isEqualTo("PENDING_PAYMENT");
        assertThat((String) JsonPath.read(pending, "$.title")).isEqualTo("Delhi to Mumbai");
        assertThat((String) JsonPath.read(pending, "$.destination")).isEqualTo("Mumbai");
        assertThat((String) JsonPath.read(pending, "$.startDate")).isEqualTo(LocalDate.now().plusDays(30).toString());
        assertThat((Boolean) JsonPath.read(pending, "$.demo")).isTrue();
        assertThat((Boolean) JsonPath.read(pending, "$.canPay")).isTrue();
        // 5,175 total (4,500 fares + 675 taxes), 10 % coupon from the HELD price.
        assertThat(JsonPath.<Number>read(pending, "$.discountAmount").doubleValue()).isEqualTo(517.5);
        assertThat(JsonPath.<Number>read(pending, "$.totalAmount").doubleValue()).isEqualTo(4657.5);
        List<String> types = JsonPath.read(pending, "$.priceItems[*].type");
        assertThat(types).containsExactly("FARE", "FEE", "TAX", "DISCOUNT");
        assertThat((String) JsonPath.read(pending, "$.flight.cabin")).isEqualTo("ECONOMY");
        assertThat((String) JsonPath.read(pending, "$.flight.slices[0].segments[0].flightNumber")).isEqualTo("AI 504");
        assertThat((Object) JsonPath.read(pending, "$.flight.pnr")).isNull();
        BookingAwaitingPayment awaiting = single(bookingId, BookingAwaitingPayment.class);
        assertThat(awaiting.getDescription()).isEqualTo("Delhi to Mumbai · 1 traveller · Economy");
        assertThat(EventMoney.amount(awaiting.getAmount())).isEqualByComparingTo("4657.50");

        paymentSucceeded(bookingId, UUID.randomUUID(), "4657.50");
        String paid = json(userId, bookingId);
        assertThat((String) JsonPath.read(paid, "$.status")).isEqualTo("SUPPLIER_PENDING");
        assertThat((Object) JsonPath.read(paid, "$.flight.pnr")).isNull();   // payment success is not confirmation

        confirmedByAirline(bookingId, 1);

        String confirmed = json(userId, bookingId);
        assertThat((String) JsonPath.read(confirmed, "$.status")).isEqualTo("CONFIRMED");
        assertThat((String) JsonPath.read(confirmed, "$.flight.pnr")).isEqualTo("K7M2QX");
        assertThat((String) JsonPath.read(confirmed, "$.flight.passengers[0].ticketNumber")).isEqualTo("0981234567891");
        BookingConfirmed event = single(bookingId, BookingConfirmed.class);
        assertThat(event.getHotel()).isNull();
        assertThat(event.getFlight().getPnr()).isEqualTo("K7M2QX");
        assertThat(event.getFlight().getPassengers().getFirst().getTicketNumber()).isEqualTo("0981234567891");
        assertThat(event.getFlight().getSlices().getFirst().getSegments().getFirst().getAirlineName()).isEqualTo("Air India");
        assertThat(event.getCustomerName()).isEqualTo("Asha Rao");
        assertThat(eventTypes(bookingId)).containsExactly("BookingInitiated", "BookingAwaitingPayment", "BookingPaid",
                "BookingConfirmed");
        // Duplicate delivery: nothing happens twice.
        confirmedByAirline(bookingId, 1);
        assertThat(eventsOfType(bookingId, BookingConfirmed.class)).hasSize(1);
        mockMvc.perform(get("/api/bookings/" + bookingId).with(customer(UUID.randomUUID()))).andExpect(status().isNotFound());
    }

    @Test
    void aRoundTripEndsOnTheReturnDate() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = submitFlight(userId, null);

        heldBy(bookingId, held(bookingId, true));

        String details = json(userId, bookingId);
        assertThat((String) JsonPath.read(details, "$.startDate")).isEqualTo(LocalDate.now().plusDays(30).toString());
        assertThat((String) JsonPath.read(details, "$.endDate")).isEqualTo(LocalDate.now().plusDays(34).toString());
        assertThat((Integer) JsonPath.read(details, "$.flight.slices.length()")).isEqualTo(2);
        assertThat((String) JsonPath.read(details, "$.flight.tripType")).isEqualTo("ROUND_TRIP");
    }

    // ------------------------------------------------------------------ failures before payment

    @Test
    void holdFailuresEndTheFlightBookingWithAReason() throws Exception {
        for (String reason : List.of("OFFER_EXPIRED", "SOLD_OUT", "INVALID_PASSENGERS")) {
            UUID userId = UUID.randomUUID();
            UUID bookingId = submitFlight(userId, null);
            flightEvents.handle(eventId(), FlightOfferHoldFailed.newBuilder().setBookingId(bookingId.toString())
                    .setReason(reason).setMessage("Not available: " + reason).setFailedAt(Instant.now()).build());
            String details = json(userId, bookingId);
            assertThat((String) JsonPath.read(details, "$.status")).isEqualTo("FAILED");
            assertThat((String) JsonPath.read(details, "$.failureReason")).isEqualTo(reason);
            assertThat((Boolean) JsonPath.read(details, "$.canPay")).isFalse();
        }
        UUID userId = UUID.randomUUID();
        UUID bookingId = submitFlight(userId, null);
        flightEvents.handle(eventId(), FlightOfferHoldFailed.newBuilder().setBookingId(bookingId.toString())
                .setReason("PRICE_CHANGED").setMessage("The fare changed.")
                .setNewTotal(EventMoney.of(new BigDecimal("5400"), "INR")).setTitle("Delhi to Mumbai")
                .setFailedAt(Instant.now()).build());
        String details = json(userId, bookingId);
        assertThat((String) JsonPath.read(details, "$.failureMessage")).contains("Today's fare").contains("5,400");
        assertThat((String) JsonPath.read(details, "$.title")).isEqualTo("Delhi to Mumbai");
    }

    @Test
    void anUnpaidFlightBookingExpiresAndGivesTheCouponBack() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = submitFlight(userId, "WELCOME10");
        heldBy(bookingId, held(bookingId, false));

        flightEvents.handle(eventId(), FlightOfferReleased.newBuilder().setBookingId(bookingId.toString())
                .setHoldId(UUID.randomUUID().toString()).setReason("EXPIRED").setReleasedAt(Instant.now()).build());

        assertThat((String) JsonPath.read(json(userId, bookingId), "$.status")).isEqualTo("EXPIRED");
        // A late payment for an expired booking is refunded in full.
        UUID paymentId = UUID.randomUUID();
        paymentSucceeded(bookingId, paymentId, "4657.50");
        assertThat((String) JsonPath.read(json(userId, bookingId), "$.status")).isEqualTo("REFUND_PENDING");
        BookingRefundRequested refund = single(bookingId, BookingRefundRequested.class);
        assertThat(refund.getReason()).isEqualTo("LATE_PAYMENT");
        assertThat(refund.getCustomerName()).isEqualTo("Asha Rao");
    }

    // ------------------------------------------------------------------ failures after payment

    @Test
    void anAirlineThatCouldNotIssueTheTicketsMeansAFullRefund() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = submitFlight(userId, null);
        heldBy(bookingId, held(bookingId, false));
        UUID paymentId = UUID.randomUUID();
        paymentSucceeded(bookingId, paymentId, "5175.00");

        failedAtAirline(bookingId, "SUPPLIER_REJECTED");

        String details = json(userId, bookingId);
        assertThat((String) JsonPath.read(details, "$.status")).isEqualTo("REFUND_PENDING");
        assertThat((String) JsonPath.read(details, "$.failureMessage")).contains("refunded in full");
        assertThat((Object) JsonPath.read(details, "$.flight.pnr")).isNull();
        BookingRefundRequested refund = single(bookingId, BookingRefundRequested.class);
        assertThat(refund.getReason()).isEqualTo("BOOKING_FAILED");
        assertThat(EventMoney.amount(refund.getAmount())).isEqualByComparingTo("5175.00");
        assertThat(refund.getCustomerName()).isEqualTo("Asha Rao");

        paymentEvents.handle(eventId(), RefundCompleted.newBuilder().setRefundId(UUID.randomUUID().toString())
                .setRefundRequestId(refund.getRefundRequestId()).setPaymentId(paymentId.toString())
                .setBookingId(bookingId.toString()).setUserId(userId.toString())
                .setAmount(EventMoney.of(new BigDecimal("5175.00"), "INR")).setCompletedAt(Instant.now()).build());
        assertThat((String) JsonPath.read(json(userId, bookingId), "$.status")).isEqualTo("REFUNDED");
    }

    @Test
    void anAirlineThatDoesNotAnswerLeavesTheCustomerWaitingUntilItIsResolved() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = submitFlight(userId, null);
        heldBy(bookingId, held(bookingId, false));
        paymentSucceeded(bookingId, UUID.randomUUID(), "5175.00");

        flightEvents.handle(eventId(), FlightBookingUncertain.newBuilder().setBookingId(bookingId.toString())
                .setHoldId(UUID.randomUUID().toString()).setReason("SUPPLIER_TIMEOUT").setSince(Instant.now()).build());

        assertThat((String) JsonPath.read(json(userId, bookingId), "$.status")).isEqualTo("SUPPLIER_PENDING");
        String timeline = mockMvc.perform(get("/api/bookings/" + bookingId + "/timeline").with(customer(userId)))
                .andReturn().getResponse().getContentAsString();
        assertThat((List<String>) JsonPath.read(timeline, "$[*].reason")).anyMatch(r -> r != null && r.contains("not answered yet"));
        assertThat(eventsOfType(bookingId, BookingRefundRequested.class)).isEmpty();

        // Later flight-service found the order: confirmed, with the same PNR as the airline's.
        confirmedByAirline(bookingId, 1);
        assertThat((String) JsonPath.read(json(userId, bookingId), "$.status")).isEqualTo("CONFIRMED");
    }

    @Test
    void lateAndDuplicateFlightEventsAreIgnored() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = submitFlight(userId, null);

        // Before the seats were held and paid: nothing to confirm or refund.
        confirmedByAirline(bookingId, 1);
        failedAtAirline(bookingId, "SUPPLIER_REJECTED");
        assertThat((String) JsonPath.read(json(userId, bookingId), "$.status")).isEqualTo("INITIATED");

        FlightOfferHeld held = held(bookingId, false);
        heldBy(bookingId, held);
        heldBy(bookingId, held);   // a second, different delivery of the same answer
        assertThat(eventsOfType(bookingId, BookingAwaitingPayment.class)).hasSize(1);
        assertThat((String) JsonPath.read(json(userId, bookingId), "$.status")).isEqualTo("PENDING_PAYMENT");

        // The same event id twice is handled once (inbox).
        String id = eventId();
        FlightBookingUncertain uncertain = FlightBookingUncertain.newBuilder().setBookingId(bookingId.toString())
                .setHoldId("h").setReason("SUPPLIER_TIMEOUT").setSince(Instant.now()).build();
        flightEvents.handle(id, uncertain);
        flightEvents.handle(id, uncertain);
        assertThat(jdbcClient.sql("SELECT COUNT(*) FROM processed_events WHERE event_id = :id").param("id", id)
                .query(Long.class).single()).isEqualTo(1L);
    }

    private <T> List<T> eventsOfType(UUID bookingId, Class<T> type) {
        return events(bookingId).stream().filter(type::isInstance).map(type::cast).toList();
    }
}
