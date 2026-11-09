package com.flighthotel.notification.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;
import org.testcontainers.utility.DockerImageName;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.events.booking.BookingCancellationFailed;
import com.flighthotel.events.booking.BookingCancelled;
import com.flighthotel.events.booking.BookingConfirmed;
import com.flighthotel.events.booking.BookingRefundRequested;
import com.flighthotel.events.booking.ConfirmedHotelStay;
import com.flighthotel.events.payment.PaymentFailed;
import com.flighthotel.events.payment.PaymentSucceeded;
import com.flighthotel.events.payment.RefundCompleted;
import com.jayway.jsonpath.JsonPath;

/**
 * Booking and payment messages to the customer: email through a real SMTP server (Mailpit) and the in-app bell
 * through the REST API.
 */
@SpringBootTest(properties = {
        "spring.kafka.listener.auto-startup=false",
        "travel.kafka.schema-registry-url=mock://notification-booking-it",
        "notification.email.app-public-url=https://app.example.test"
})
@AutoConfigureMockMvc
@Testcontainers
class BookingNotificationIntegrationTest {

    @Container
    @ServiceConnection
    static MySQLContainer mysql = new MySQLContainer("mysql:8.4.13").withDatabaseName("notification_db");

    @Container
    @ServiceConnection(name = "redis")
    static GenericContainer<?> redis = new GenericContainer<>(DockerImageName.parse("redis:8.4.8")).withExposedPorts(6379);

    @Container
    static GenericContainer<?> mailpit = new GenericContainer<>(DockerImageName.parse("axllent/mailpit:v1.33.0"))
            .withExposedPorts(1025, 8025);

    @DynamicPropertySource
    static void mail(DynamicPropertyRegistry registry) {
        registry.add("spring.mail.host", mailpit::getHost);
        registry.add("spring.mail.port", () -> mailpit.getMappedPort(1025));
        registry.add("travel.storage.local-root", () -> System.getProperty("java.io.tmpdir") + "/notification-it-documents");
    }

    @Autowired
    BookingNotificationListener listener;

    @Autowired
    MockMvc mockMvc;

    @Autowired
    JdbcClient jdbcClient;

    private final HttpClient http = HttpClient.newHttpClient();

    @Test
    void aConfirmedBookingSendsTheConfirmationEmailAndOneNotification() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = UUID.randomUUID();
        String to = "asha-" + UUID.randomUUID() + "@example.com";
        String eventId = UUID.randomUUID().toString();

        listener.handleBookingEvent(eventId, confirmed(userId, bookingId, to));
        listener.handleBookingEvent(eventId, confirmed(userId, bookingId, to));   // re-delivered: handled once

        List<String> ids = messageIdsTo(to);
        assertThat(ids).hasSize(1);
        String message = mailpitGet("/api/v1/message/" + ids.get(0));
        assertThat((String) JsonPath.read(message, "$.Subject")).isEqualTo("Booking confirmed HT-7K3M9Q2X");
        assertThat((String) JsonPath.read(message, "$.HTML")).contains("Sea Breeze Resort, Goa").contains("SB123456")
                .contains("₹2,625.00").contains("https://app.example.test/my-trips/" + bookingId)
                .contains("&lt;b&gt;Asha&lt;/b&gt;").contains("demo booking");
        assertThat((String) JsonPath.read(message, "$.Text")).contains("Hotel confirmation no.: SB123456")
                .contains("Total paid: ₹2,625.00");

        mockMvc.perform(get("/api/notifications").with(customer(userId))).andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("Booking confirmed"))
                .andExpect(jsonPath("$.content[0].link").value("/my-trips/" + bookingId))
                .andExpect(jsonPath("$.content[0].read").value(false));
    }

    @Test
    void paymentAndRefundEventsBecomeNotificationsThatCanBeReadOnlyByTheirOwner() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = UUID.randomUUID();

        listener.handlePaymentEvent(UUID.randomUUID().toString(), PaymentFailed.newBuilder()
                .setPaymentId(UUID.randomUUID().toString()).setBookingId(bookingId.toString())
                .setUserId(userId.toString()).setProvider("DEMO").setFailureCode("DEMO_DECLINED")
                .setFailedAt(Instant.now()).build());
        listener.handlePaymentEvent(UUID.randomUUID().toString(), PaymentSucceeded.newBuilder()
                .setPaymentId(UUID.randomUUID().toString()).setBookingId(bookingId.toString())
                .setUserId(userId.toString()).setProvider("DEMO").setProviderPaymentId("pay_demo_ok_1")
                .setAmount(EventMoney.of(new BigDecimal("2625"), "INR")).setSucceededAt(Instant.now()).build());
        listener.handlePaymentEvent(UUID.randomUUID().toString(), RefundCompleted.newBuilder()
                .setRefundId(UUID.randomUUID().toString()).setRefundRequestId(UUID.randomUUID().toString())
                .setPaymentId(UUID.randomUUID().toString()).setBookingId(bookingId.toString())
                .setUserId(userId.toString()).setAmount(EventMoney.of(new BigDecimal("1500.5"), "INR"))
                .setCompletedAt(Instant.now()).build());

        mockMvc.perform(get("/api/notifications/unread-count").with(customer(userId)))
                .andExpect(jsonPath("$.count").value(3));
        String list = mockMvc.perform(get("/api/notifications").with(customer(userId))).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat((List<String>) JsonPath.read(list, "$.content[*].title"))
                .containsExactlyInAnyOrder("Payment failed", "Payment received", "Refund completed");
        assertThat((List<String>) JsonPath.read(list, "$.content[*].message")).anyMatch(m -> m.contains("₹1,500.50"));

        String first = JsonPath.read(list, "$.content[0].id");
        mockMvc.perform(post("/api/notifications/" + first + "/read").with(customer(UUID.randomUUID())))
                .andExpect(status().isNotFound());
        mockMvc.perform(post("/api/notifications/" + first + "/read").with(customer(userId)))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/notifications/unread-count").with(customer(userId)))
                .andExpect(jsonPath("$.count").value(2));
        mockMvc.perform(get("/api/notifications").param("unreadOnly", "true").with(customer(userId)))
                .andExpect(jsonPath("$.totalElements").value(2));
        mockMvc.perform(post("/api/notifications/read-all").with(customer(userId)))
                .andExpect(jsonPath("$.updated").value(2));
        mockMvc.perform(get("/api/notifications/unread-count").with(customer(userId)))
                .andExpect(jsonPath("$.count").value(0));
        mockMvc.perform(get("/api/notifications")).andExpect(status().isUnauthorized());
    }

    @Test
    void aRefundStartedEmailExplainsTheReason() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = UUID.randomUUID();
        String to = "refund-" + UUID.randomUUID() + "@example.com";

        listener.handleBookingEvent(UUID.randomUUID().toString(), BookingRefundRequested.newBuilder()
                .setRefundRequestId(UUID.randomUUID().toString()).setBookingId(bookingId.toString())
                .setBookingReference("HT-7K3M9Q2X").setUserId(userId.toString())
                .setPaymentId(UUID.randomUUID().toString()).setAmount(EventMoney.of(new BigDecimal("2625"), "INR"))
                .setReason("LATE_PAYMENT").setContactEmail(to).setCustomerName("Asha Rao")
                .setRequestedAt(Instant.now()).build());

        List<String> ids = messageIdsTo(to);
        assertThat(ids).hasSize(1);
        String message = mailpitGet("/api/v1/message/" + ids.get(0));
        assertThat((String) JsonPath.read(message, "$.Text")).contains("Refund amount: ₹2,625.00")
                .contains("The payment arrived after the booking had expired");
    }

    @Test
    void aCancellationSendsOneEmailWithTheFeeAndTheRefundAndARefusalSaysTheBookingIsStillValid() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = UUID.randomUUID();
        String to = "cancel-" + UUID.randomUUID() + "@example.com";

        listener.handleBookingEvent(UUID.randomUUID().toString(), BookingCancellationFailed.newBuilder()
                .setBookingId(bookingId.toString()).setBookingReference("HT-7K3M9Q2X").setBookingType("HOTEL")
                .setUserId(userId.toString()).setCancellationId(UUID.randomUUID().toString())
                .setTitle("Sea Breeze Resort").setContactEmail(to).setCustomerName("Asha Rao").setReason("TOO_LATE")
                .setMessage("The check-in time has passed, so the hotel can no longer cancel this stay.")
                .setFailedAt(Instant.now()).build());
        listener.handleBookingEvent(UUID.randomUUID().toString(), BookingCancelled.newBuilder()
                .setBookingId(bookingId.toString()).setBookingReference("HT-7K3M9Q2X").setBookingType("HOTEL")
                .setUserId(userId.toString()).setCancellationId(UUID.randomUUID().toString())
                .setTitle("Sea Breeze Resort").setContactEmail(to).setCustomerName("Asha Rao")
                .setInitiatedBy("CUSTOMER").setPaidAmount(EventMoney.of(new BigDecimal("6300"), "INR"))
                .setCancellationFee(EventMoney.of(new BigDecimal("3150"), "INR"))
                .setRefundAmount(EventMoney.of(new BigDecimal("3150"), "INR")).setSupplierReference("HXK7M3Q9P2")
                .setCancelledAt(Instant.now()).build());
        // The refund of a cancellation: a bell notification, but no second e-mail.
        listener.handleBookingEvent(UUID.randomUUID().toString(), BookingRefundRequested.newBuilder()
                .setRefundRequestId(UUID.randomUUID().toString()).setBookingId(bookingId.toString())
                .setBookingReference("HT-7K3M9Q2X").setUserId(userId.toString())
                .setPaymentId(UUID.randomUUID().toString()).setAmount(EventMoney.of(new BigDecimal("3150"), "INR"))
                .setReason("CANCELLATION").setContactEmail(to).setCustomerName("Asha Rao")
                .setRequestedAt(Instant.now()).build());

        List<String> ids = messageIdsTo(to);
        assertThat(ids).hasSize(2);
        List<String> texts = new java.util.ArrayList<>();
        for (String id : ids) {
            texts.add(JsonPath.read(mailpitGet("/api/v1/message/" + id), "$.Text"));
        }
        assertThat(texts).anySatisfy(text -> assertThat(text).contains("Cancellation fee: ₹3,150.00")
                .contains("Refund: ₹3,150.00").contains("Cancellation number: HXK7M3Q9P2")
                .contains("has confirmed the cancellation"));
        assertThat(texts).anySatisfy(text -> assertThat(text).contains("your booking is still valid")
                .contains("check-in time has passed"));
        mockMvc.perform(get("/api/notifications").with(customer(userId)))
                .andExpect(jsonPath("$.totalElements").value(4))
                .andExpect(jsonPath("$.content[*].title").value(org.hamcrest.Matchers.containsInAnyOrder(
                        "Cancellation not possible", "We opened a support ticket", "Booking cancelled",
                        "Refund started")));
    }

    @Test
    void aConfirmedFlightEmailShowsThePnrTheFlightsAndTheTicketsOfEveryTraveller() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = UUID.randomUUID();
        String to = "flight-" + UUID.randomUUID() + "@example.com";
        LocalDate day = LocalDate.now().plusDays(30);
        com.flighthotel.events.common.FlightSlice slice = com.flighthotel.events.common.FlightSlice.newBuilder()
                .setOrigin("DEL").setDestination("BOM").setOriginCity("Delhi").setDestinationCity("Mumbai")
                .setDepartureLocal(day + "T06:45").setArrivalLocal(day + "T08:55").setDurationMinutes(130).setStops(0)
                .setSegments(List.of(com.flighthotel.events.common.FlightSegmentInfo.newBuilder()
                        .setFlightNumber("AI 504").setAirlineCode("AI").setAirlineName("Air India").setOrigin("DEL")
                        .setDestination("BOM").setDepartureLocal(day + "T06:45").setArrivalLocal(day + "T08:55")
                        .setDurationMinutes(130).build())).build();

        listener.handleBookingEvent(UUID.randomUUID().toString(), BookingConfirmed.newBuilder()
                .setBookingId(bookingId.toString()).setBookingReference("FL-7K3M9Q2X").setUserId(userId.toString())
                .setBookingType("FLIGHT").setContactEmail(to).setCustomerName("Asha Rao")
                .setPaymentId(UUID.randomUUID().toString())
                .setBaseAmount(EventMoney.of(new BigDecimal("4500"), "INR"))
                .setTaxAmount(EventMoney.of(new BigDecimal("675"), "INR"))
                .setDiscountAmount(EventMoney.of(BigDecimal.ZERO, "INR"))
                .setTotalAmount(EventMoney.of(new BigDecimal("5175"), "INR"))
                .setFlight(com.flighthotel.events.booking.ConfirmedFlightTrip.newBuilder().setTitle("Delhi to Mumbai")
                        .setTripType("ONE_WAY").setCabin("PREMIUM_ECONOMY").setFareName("Premium Flex").setRefundable(true)
                        .setCheckedBaggageKg(30).setCabinBaggageKg(10)
                        .setCancellationPolicy("Cancel up to 4 hours before departure for a fee of 20% of the fare.")
                        .setSlices(List.of(slice)).setPnr("K7M2QX")
                        .setPassengers(List.of(
                                com.flighthotel.events.booking.ConfirmedFlightPassenger.newBuilder().setIndex(1)
                                        .setPassengerType("ADULT").setFirstName("Asha").setLastName("Rao")
                                        .setTicketNumber("0981234567891").build(),
                                com.flighthotel.events.booking.ConfirmedFlightPassenger.newBuilder().setIndex(2)
                                        .setPassengerType("ADULT").setFirstName("Ravi").setLastName("Kumar")
                                        .setTicketNumber("0981234567892").build()))
                        .setDemo(true).build())
                .setConfirmedAt(Instant.now()).build());

        List<String> ids = messageIdsTo(to);
        assertThat(ids).hasSize(1);
        String message = mailpitGet("/api/v1/message/" + ids.get(0));
        assertThat((String) JsonPath.read(message, "$.Subject")).isEqualTo("Booking confirmed FL-7K3M9Q2X");
        assertThat((String) JsonPath.read(message, "$.Text")).contains("Booking reference (PNR): K7M2QX")
                .contains("Trip: Delhi to Mumbai").contains("AI 504").contains("DEL 06:45 to BOM 08:55")
                .contains("Cabin and fare: premium economy · Premium Flex").contains("Checked 30 kg, cabin 10 kg")
                .contains("Asha Rao · ticket 0981234567891").contains("Ravi Kumar · ticket 0981234567892")
                .contains("Total paid: ₹5,175.00").contains("not a real ticket");
        assertThat((String) JsonPath.read(message, "$.HTML")).contains("https://app.example.test/my-trips/" + bookingId);
    }

    // ------------------------------------------------------------------ helpers

    private static JwtRequestPostProcessor customer(UUID userId) {
        return jwt().jwt(token -> token.subject(userId.toString()).claim("roles", List.of("CUSTOMER"))
                        .claim("permissions", List.of()))
                .authorities(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_CUSTOMER"));
    }

    private static BookingConfirmed confirmed(UUID userId, UUID bookingId, String to) {
        return BookingConfirmed.newBuilder()
                .setBookingId(bookingId.toString())
                .setBookingReference("HT-7K3M9Q2X")
                .setUserId(userId.toString())
                .setBookingType("HOTEL")
                .setContactEmail(to)
                .setCustomerName("<b>Asha</b>")
                .setPaymentId(UUID.randomUUID().toString())
                .setBaseAmount(EventMoney.of(new BigDecimal("2500"), "INR"))
                .setTaxAmount(EventMoney.of(new BigDecimal("125"), "INR"))
                .setDiscountAmount(EventMoney.of(BigDecimal.ZERO, "INR"))
                .setTotalAmount(EventMoney.of(new BigDecimal("2625"), "INR"))
                .setHotel(ConfirmedHotelStay.newBuilder()
                        .setHotelName("Sea Breeze Resort").setHotelCity("Goa").setHotelAddress("Calangute Beach Road")
                        .setRoomTypeName("Deluxe Sea View").setRatePlanName("Flexible with breakfast")
                        .setCheckIn(LocalDate.now().plusDays(30)).setCheckOut(LocalDate.now().plusDays(32))
                        .setCheckInTime("14:00").setCheckOutTime("11:00").setNights(2).setRooms(1).setAdults(2)
                        .setChildren(0).setConfirmationNumber("SB123456")
                        .setCancellationPolicy("Free cancellation until 2 days before check-in.").setDemo(true).build())
                .setConfirmedAt(Instant.now())
                .build();
    }

    private List<String> messageIdsTo(String address) throws Exception {
        return JsonPath.read(mailpitGet("/api/v1/messages?limit=200"), "$.messages[?(@.To[0].Address == '" + address + "')].ID");
    }

    private String mailpitGet(String path) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(
                URI.create("http://" + mailpit.getHost() + ":" + mailpit.getMappedPort(8025) + path)).build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        return response.body();
    }
}
