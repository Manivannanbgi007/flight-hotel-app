package com.flighthotel.notification;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;

import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.mysql.MySQLContainer;
import org.testcontainers.utility.DockerImageName;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.events.booking.BookingAwaitingPayment;
import com.flighthotel.events.booking.BookingConfirmed;
import com.flighthotel.events.booking.ConfirmedFlightPassenger;
import com.flighthotel.events.booking.ConfirmedFlightTrip;
import com.flighthotel.events.booking.ConfirmedHotelStay;
import com.flighthotel.events.common.FlightSegmentInfo;
import com.flighthotel.events.common.FlightSlice;
import com.flighthotel.notification.messaging.BookingNotificationListener;
import com.flighthotel.notification.messaging.DocumentEventsListener;
import com.jayway.jsonpath.JsonPath;

/**
 * Base of the Phase 8 tests: the real service against MySQL, Redis and a real SMTP server (Mailpit), started once for
 * all subclasses. Kafka listeners are off: tests hand events to the listeners directly. PDFs are written to a temporary
 * folder and read back with PDFBox, exactly as a customer would get them.
 */
@SpringBootTest(properties = {
        "spring.kafka.listener.auto-startup=false",
        "travel.kafka.schema-registry-url=mock://notification-phase8-it",
        "notification.email.app-public-url=https://app.example.test",
        "notification.newsletter.secret=test-newsletter-secret"
})
@AutoConfigureMockMvc
public abstract class NotificationIntegrationTest {

    static final MySQLContainer MYSQL = new MySQLContainer("mysql:8.4.13").withDatabaseName("notification_db");
    static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:8.4.8")).withExposedPorts(6379);
    static final GenericContainer<?> MAILPIT =
            new GenericContainer<>(DockerImageName.parse("axllent/mailpit:v1.33.0")).withExposedPorts(1025, 8025);
    static final Path STORAGE;

    static {
        MYSQL.start();
        REDIS.start();
        MAILPIT.start();
        try {
            STORAGE = Files.createTempDirectory("notification-documents-");
        } catch (IOException ex) {
            throw new IllegalStateException(ex);
        }
    }

    @DynamicPropertySource
    static void infrastructure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
        registry.add("spring.datasource.username", MYSQL::getUsername);
        registry.add("spring.datasource.password", MYSQL::getPassword);
        registry.add("spring.data.redis.host", REDIS::getHost);
        registry.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379));
        registry.add("spring.mail.host", MAILPIT::getHost);
        registry.add("spring.mail.port", () -> MAILPIT.getMappedPort(1025));
        registry.add("travel.storage.local-root", STORAGE::toString);
    }

    @Autowired
    protected MockMvc mockMvc;

    @Autowired
    protected JdbcClient jdbcClient;

    @Autowired
    protected BookingNotificationListener notificationsListener;

    @Autowired
    protected DocumentEventsListener documentsListener;

    private final HttpClient http = HttpClient.newHttpClient();

    // ------------------------------------------------------------------ users

    protected static JwtRequestPostProcessor customer(UUID userId) {
        return customer(userId, "customer-" + userId + "@example.com");
    }

    protected static JwtRequestPostProcessor customer(UUID userId, String email) {
        return user(userId, email, Set.of("CUSTOMER"), Set.of());
    }

    protected static JwtRequestPostProcessor supportAgent() {
        return user(UUID.randomUUID(), "agent@example.com", Set.of("SUPPORT_AGENT"),
                Set.of("BOOKING_READ_ANY", "BOOKING_MANAGE_ANY", "SUPPORT_TICKET_MANAGE"));
    }

    protected static JwtRequestPostProcessor user(UUID userId, String email, Set<String> roles,
            Set<String> permissions) {
        List<GrantedAuthority> authorities = new ArrayList<>();
        roles.forEach(role -> authorities.add(new SimpleGrantedAuthority("ROLE_" + role)));
        permissions.forEach(permission -> authorities.add(new SimpleGrantedAuthority(permission)));
        return jwt().jwt(token -> token.subject(userId.toString()).claim("email", email)
                        .claim("roles", List.copyOf(roles)).claim("permissions", List.copyOf(permissions)))
                .authorities(authorities);
    }

    protected static String eventId() {
        return UUID.randomUUID().toString();
    }

    // ------------------------------------------------------------------ events

    protected static BookingAwaitingPayment awaiting(UUID userId, UUID bookingId, String reference, String email) {
        return BookingAwaitingPayment.newBuilder().setBookingId(bookingId.toString()).setBookingReference(reference)
                .setUserId(userId.toString()).setBookingType("HOTEL")
                .setAmount(EventMoney.of(new BigDecimal("6300"), "INR"))
                .setDescription("Sea Breeze Resort · 2 nights · 1 room").setContactEmail(email)
                .setContactPhone("+91 98000 00000").setPaymentDeadline(Instant.now().plusSeconds(900))
                .setOccurredAt(Instant.now()).build();
    }

    protected static BookingConfirmed hotelConfirmed(UUID userId, UUID bookingId, String reference, String email,
            Instant startsAt) {
        LocalDate checkIn = LocalDate.now().plusDays(30);
        return BookingConfirmed.newBuilder()
                .setBookingId(bookingId.toString()).setBookingReference(reference).setUserId(userId.toString())
                .setBookingType("HOTEL").setContactEmail(email).setCustomerName("Asha Rao")
                .setPaymentId(UUID.randomUUID().toString())
                .setBaseAmount(EventMoney.of(new BigDecimal("6000"), "INR"))
                .setTaxAmount(EventMoney.of(new BigDecimal("300"), "INR"))
                .setDiscountAmount(EventMoney.of(BigDecimal.ZERO, "INR"))
                .setTotalAmount(EventMoney.of(new BigDecimal("6300"), "INR"))
                .setHotel(ConfirmedHotelStay.newBuilder().setHotelName("Sea Breeze Resort").setHotelCity("Goa")
                        .setHotelAddress("Calangute Beach Road, Goa").setRoomTypeName("Deluxe Sea View")
                        .setRatePlanName("Flexible with breakfast").setCheckIn(checkIn).setCheckOut(checkIn.plusDays(2))
                        .setCheckInTime("14:00").setCheckOutTime("11:00").setNights(2).setRooms(1).setAdults(2)
                        .setChildren(0).setConfirmationNumber("HK7M3Q9P2X")
                        .setCancellationPolicy("Free cancellation until 2 days before check-in.").setDemo(true).build())
                .setConfirmedAt(Instant.now())
                .setStartsAt(startsAt)
                .build();
    }

    protected static BookingConfirmed flightConfirmed(UUID userId, UUID bookingId, String reference, String email) {
        LocalDate day = LocalDate.now().plusDays(30);
        FlightSlice slice = FlightSlice.newBuilder().setOrigin("DEL").setDestination("BOM").setOriginCity("Delhi")
                .setDestinationCity("Mumbai").setDepartureLocal(day + "T06:45").setArrivalLocal(day + "T08:55")
                .setDurationMinutes(130).setStops(0)
                .setSegments(List.of(FlightSegmentInfo.newBuilder().setFlightNumber("AI 504").setAirlineCode("AI")
                        .setAirlineName("Air India").setOrigin("DEL").setDestination("BOM")
                        .setDepartureLocal(day + "T06:45").setArrivalLocal(day + "T08:55").setDurationMinutes(130)
                        .build()))
                .build();
        return BookingConfirmed.newBuilder()
                .setBookingId(bookingId.toString()).setBookingReference(reference).setUserId(userId.toString())
                .setBookingType("FLIGHT").setContactEmail(email).setCustomerName("Asha Rao")
                .setPaymentId(UUID.randomUUID().toString())
                .setBaseAmount(EventMoney.of(new BigDecimal("9000"), "INR"))
                .setTaxAmount(EventMoney.of(new BigDecimal("1350"), "INR"))
                .setDiscountAmount(EventMoney.of(new BigDecimal("500"), "INR"))
                .setTotalAmount(EventMoney.of(new BigDecimal("9850"), "INR"))
                .setFlight(ConfirmedFlightTrip.newBuilder().setTitle("Delhi to Mumbai").setTripType("ONE_WAY")
                        .setCabin("ECONOMY").setFareName("Economy Flex").setRefundable(true).setCheckedBaggageKg(20)
                        .setCabinBaggageKg(7)
                        .setCancellationPolicy("Cancel up to 4 hours before departure for a fee of 25% of the fare.")
                        .setSlices(List.of(slice)).setPnr("K7M2QX")
                        .setPassengers(List.of(
                                ConfirmedFlightPassenger.newBuilder().setIndex(1).setPassengerType("ADULT")
                                        .setFirstName("Asha").setLastName("Rao").setTicketNumber("0981234567891").build(),
                                ConfirmedFlightPassenger.newBuilder().setIndex(2).setPassengerType("CHILD")
                                        .setFirstName("Meera").setLastName("Rao").setTicketNumber("0981234567892")
                                        .build()))
                        .setDemo(false).build())
                .setConfirmedAt(Instant.now())
                .build();
    }

    // ------------------------------------------------------------------ PDFs and e-mail

    protected static String pdfText(byte[] pdf) throws IOException {
        try (PDDocument document = Loader.loadPDF(pdf)) {
            return new PDFTextStripper().getText(document);
        }
    }

    protected static int pdfPages(byte[] pdf) throws IOException {
        try (PDDocument document = Loader.loadPDF(pdf)) {
            return document.getNumberOfPages();
        }
    }

    protected List<String> messageIdsTo(String address) throws Exception {
        String body = mailpitGet("/api/v1/search?query=" + URLEncoder.encode("to:" + address, StandardCharsets.UTF_8));
        return JsonPath.read(body, "$.messages[*].ID");
    }

    protected String mailpitGet(String path) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://" + MAILPIT.getHost() + ":"
                + MAILPIT.getMappedPort(8025) + path)).GET().build();
        return http.send(request, HttpResponse.BodyHandlers.ofString()).body();
    }

    /** The newest e-mail to an address (JSON of Mailpit's message API). */
    protected String latestMailTo(String address) throws Exception {
        List<String> ids = messageIdsTo(address);
        return ids.isEmpty() ? null : mailpitGet("/api/v1/message/" + ids.getFirst());
    }
}
