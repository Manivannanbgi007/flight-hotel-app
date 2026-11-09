package com.flighthotel.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
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

import com.flighthotel.booking.messaging.HotelEventsListener;
import com.flighthotel.booking.messaging.PaymentEventsListener;
import com.flighthotel.common.events.EventMoney;
import com.flighthotel.common.id.UuidV7;
import com.flighthotel.events.hotel.HeldTaxLine;
import com.flighthotel.events.booking.BookingSnapshot;
import com.flighthotel.events.hotel.HotelInventoryHeld;
import com.flighthotel.events.payment.PaymentSucceeded;
import com.jayway.jsonpath.JsonPath;

import io.confluent.kafka.serializers.KafkaAvroDeserializer;

/**
 * Base for booking-service integration tests: the real service against MySQL and Redis (Testcontainers, started once).
 * Kafka listeners are off; tests hand hotel-service's and payment-service's events to the listeners directly and read
 * booking-service's events back from the outbox, decoded like a consumer would.
 */
@SpringBootTest(properties = {
        "spring.kafka.listener.auto-startup=false",
        "travel.kafka.schema-registry-url=mock://booking-it",
        "booking.demo-data.enabled=true",
        "travel.security.data-encryption-key=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
})
@AutoConfigureMockMvc
public abstract class BookingIntegrationTest {

    static final MySQLContainer MYSQL = new MySQLContainer("mysql:8.4.13").withDatabaseName("booking_db");
    static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:8.4.8")).withExposedPorts(6379);
    private static final KafkaAvroDeserializer AVRO = new KafkaAvroDeserializer();

    static {
        MYSQL.start();
        REDIS.start();
        AVRO.configure(Map.of("schema.registry.url", "mock://booking-it", "specific.avro.reader", true), false);
    }

    @DynamicPropertySource
    static void infrastructure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
        registry.add("spring.datasource.username", MYSQL::getUsername);
        registry.add("spring.datasource.password", MYSQL::getPassword);
        registry.add("spring.data.redis.host", REDIS::getHost);
        registry.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379));
    }

    @Autowired
    protected MockMvc mockMvc;

    @Autowired
    protected JdbcClient jdbcClient;

    @Autowired
    protected HotelEventsListener hotelEvents;

    @Autowired
    protected PaymentEventsListener paymentEvents;

    // ------------------------------------------------------------------ users

    protected static JwtRequestPostProcessor customer(UUID userId) {
        return user(userId, Set.of("CUSTOMER"), Set.of());
    }

    protected static JwtRequestPostProcessor supportAgent() {
        return user(UUID.randomUUID(), Set.of("SUPPORT_AGENT"), Set.of("BOOKING_READ_ANY", "BOOKING_MANAGE_ANY"));
    }

    protected static JwtRequestPostProcessor user(UUID userId, Set<String> roles, Set<String> permissions) {
        List<GrantedAuthority> authorities = new ArrayList<>();
        roles.forEach(role -> authorities.add(new SimpleGrantedAuthority("ROLE_" + role)));
        permissions.forEach(permission -> authorities.add(new SimpleGrantedAuthority(permission)));
        return jwt().jwt(token -> token.subject(userId.toString())
                        .claim("roles", List.copyOf(roles))
                        .claim("permissions", List.copyOf(permissions)))
                .authorities(authorities);
    }

    // ------------------------------------------------------------------ booking helpers

    protected static String bookingRequest(UUID quoteId, String coupon, int rooms) {
        StringBuilder guests = new StringBuilder();
        for (int room = 1; room <= rooms; room++) {
            guests.append(room > 1 ? "," : "").append("""
                    {"roomNo":%d,"firstName":"%s","lastName":"%s"}""".formatted(room, room == 1 ? "Asha" : "Ravi",
                    room == 1 ? "Rao" : "Kumar"));
        }
        return """
                {"quoteId":"%s","contact":{"email":"Asha@Example.com","phone":"+91 98000 00000"},
                 "guests":[%s],"specialRequests":"Late arrival"%s}"""
                .formatted(quoteId, guests, coupon == null ? "" : ",\"couponCode\":\"" + coupon + "\"");
    }

    /** Submits a hotel booking and returns its id. */
    protected UUID submit(UUID userId, String coupon) throws Exception {
        String body = mockMvc.perform(post("/api/bookings/hotel").with(customer(userId))
                        .header("Idempotency-Key", "key-" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingRequest(UUID.randomUUID(), coupon, 1)))
                .andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(JsonPath.read(body, "$.id"));
    }

    protected String details(UUID userId, UUID bookingId) throws Exception {
        return mockMvc.perform(get("/api/bookings/" + bookingId).with(customer(userId)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    /** hotel-service held the rooms: {@code subtotal} for 2 nights × 1 room plus 5 % GST. */
    protected void held(UUID bookingId, String city, String subtotal) {
        hotelEvents.handle(eventId(), heldEvent(bookingId, city, new BigDecimal(subtotal), LocalDate.now().plusDays(30)));
    }

    protected static HotelInventoryHeld heldEvent(UUID bookingId, String city, BigDecimal subtotal, LocalDate checkIn) {
        BigDecimal taxes = subtotal.multiply(new BigDecimal("0.05"));
        Instant now = Instant.now();
        return HotelInventoryHeld.newBuilder()
                .setBookingId(bookingId.toString())
                .setReservationId(UUID.randomUUID().toString())
                .setHotelId(UUID.randomUUID().toString())
                .setHotelSlug("sea-breeze-resort-goa")
                .setHotelName("Sea Breeze Resort")
                .setHotelCity(city)
                .setHotelAddress("Calangute Beach Road, " + city)
                .setCountryCode("IN")
                .setRoomTypeId(UUID.randomUUID().toString())
                .setRoomTypeName("Deluxe Sea View")
                .setRatePlanName("Flexible with breakfast")
                .setBreakfastIncluded(true)
                .setCheckIn(checkIn)
                .setCheckOut(checkIn.plusDays(2))
                .setCheckInTime("14:00")
                .setCheckOutTime("11:00")
                .setNights(2)
                .setRooms(1)
                .setAdults(2)
                .setChildren(0)
                .setSubtotal(EventMoney.of(subtotal, "INR"))
                .setTaxes(EventMoney.of(taxes, "INR"))
                .setTaxLines(List.of(HeldTaxLine.newBuilder().setLabel("GST 5%")
                        .setAmount(EventMoney.of(taxes, "INR")).build()))
                .setTotal(EventMoney.of(subtotal.add(taxes), "INR"))
                .setRefundable(true)
                .setFreeCancellationUntil(now.plus(28, ChronoUnit.DAYS))
                .setCancellationFeePercent(new BigDecimal("50.00"))
                .setCancellationPolicy("Free cancellation until 2 days before check-in; after that 50% is charged.")
                .setDemo(true)
                .setHoldExpiresAt(now.plus(20, ChronoUnit.MINUTES))
                .setHeldAt(now)
                .build();
    }

    protected void paymentSucceeded(UUID bookingId, UUID paymentId, String amount) {
        paymentEvents.handle(eventId(), PaymentSucceeded.newBuilder()
                .setPaymentId(paymentId.toString())
                .setBookingId(bookingId.toString())
                .setUserId(UUID.randomUUID().toString())
                .setProvider("DEMO")
                .setProviderPaymentId("demo_pay_" + paymentId)
                .setAmount(EventMoney.of(new BigDecimal(amount), "INR"))
                .setMethod("card")
                .setSucceededAt(Instant.now())
                .build());
    }

    protected static String eventId() {
        return UuidV7.generate().toString();
    }

    /**
     * booking-service's saga messages for one booking, decoded from the outbox like a Kafka consumer would (without the
     * {@code BookingSnapshot}s for read models: see {@link #snapshots}).
     */
    protected List<Object> events(UUID bookingId) {
        return allEvents(bookingId).stream().filter(event -> !(event instanceof BookingSnapshot)).toList();
    }

    /** The booking's snapshots for read models, oldest first. */
    protected List<BookingSnapshot> snapshots(UUID bookingId) {
        return allEvents(bookingId).stream().filter(BookingSnapshot.class::isInstance).map(BookingSnapshot.class::cast)
                .toList();
    }

    private List<Object> allEvents(UUID bookingId) {
        return jdbcClient.sql("""
                        SELECT payload FROM outbox_events WHERE aggregate_type = 'booking' AND aggregate_id = :id
                        ORDER BY created_at, id""")
                .param("id", bookingId.toString())
                .query((rs, i) -> AVRO.deserialize("booking.events", rs.getBytes("payload")))
                .list();
    }

    protected <T> T single(UUID bookingId, Class<T> type) {
        List<Object> matching = events(bookingId).stream().filter(type::isInstance).toList();
        assertThat(matching).as("%s events for booking %s", type.getSimpleName(), bookingId).hasSize(1);
        return type.cast(matching.getFirst());
    }

    protected List<String> eventTypes(UUID bookingId) {
        return events(bookingId).stream().map(event -> event.getClass().getSimpleName()).toList();
    }
}
