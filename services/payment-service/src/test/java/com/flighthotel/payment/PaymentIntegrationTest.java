package com.flighthotel.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.time.Instant;
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
import org.springframework.test.web.servlet.ResultActions;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.mysql.MySQLContainer;
import org.testcontainers.utility.DockerImageName;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.common.id.UuidV7;
import com.flighthotel.events.booking.BookingAwaitingPayment;
import com.flighthotel.payment.messaging.BookingEventsListener;
import com.jayway.jsonpath.JsonPath;

import io.confluent.kafka.serializers.KafkaAvroDeserializer;

/**
 * Base for payment-service integration tests: the real service against MySQL and Redis (Testcontainers, started
 * once). Kafka listeners are off; tests hand booking-service's events to the listener directly and read
 * payment-service's events back from the outbox, decoded like a consumer would.
 */
@SpringBootTest(properties = {
        "spring.kafka.listener.auto-startup=false",
        "travel.kafka.schema-registry-url=mock://payment-it",
        "payment.razorpay.key-id=rzp_test_key",
        "payment.razorpay.key-secret=razorpay-test-secret",
        "payment.razorpay.webhook-secret=razorpay-webhook-secret"
})
@AutoConfigureMockMvc
public abstract class PaymentIntegrationTest {

    static final MySQLContainer MYSQL = new MySQLContainer("mysql:8.4.13").withDatabaseName("payment_db");
    static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:8.4.8")).withExposedPorts(6379);
    private static final KafkaAvroDeserializer AVRO = new KafkaAvroDeserializer();

    static {
        MYSQL.start();
        REDIS.start();
        AVRO.configure(Map.of("schema.registry.url", "mock://payment-it", "specific.avro.reader", true), false);
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
    protected BookingEventsListener bookingEvents;

    // ------------------------------------------------------------------ users

    protected static JwtRequestPostProcessor customer(UUID userId) {
        return user(userId, Set.of("CUSTOMER"), Set.of());
    }

    protected static JwtRequestPostProcessor supportAgent() {
        return user(UUID.randomUUID(), Set.of("SUPPORT_AGENT"), Set.of("PAYMENT_READ_ANY"));
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

    // ------------------------------------------------------------------ booking-service's side

    /** booking-service says: the rooms are held, this is the price, payable for 15 more minutes. */
    protected UUID payable(UUID userId, String amount) {
        return payable(userId, amount, Instant.now().plus(15, ChronoUnit.MINUTES));
    }

    protected UUID payable(UUID userId, String amount, Instant deadline) {
        UUID bookingId = UUID.randomUUID();
        bookingEvents.handle(eventId(), BookingAwaitingPayment.newBuilder()
                .setBookingId(bookingId.toString())
                .setBookingReference("HT-" + bookingId.toString().substring(0, 8).toUpperCase())
                .setUserId(userId.toString())
                .setBookingType("HOTEL")
                .setAmount(EventMoney.of(new BigDecimal(amount), "INR"))
                .setDescription("Sea Breeze Resort · 2 nights · 1 room")
                .setContactEmail("asha@example.com")
                .setContactPhone("+91 98000 00000")
                .setPaymentDeadline(deadline)
                .setOccurredAt(Instant.now())
                .build());
        return bookingId;
    }

    protected static String eventId() {
        return UuidV7.generate().toString();
    }

    // ------------------------------------------------------------------ calls

    protected ResultActions createOrderCall(UUID userId, UUID bookingId, String key) throws Exception {
        return mockMvc.perform(post("/api/payments/create-order").with(customer(userId))
                .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON)
                .content("{\"bookingId\":\"" + bookingId + "\"}"));
    }

    /** Creates the order and returns the response body. */
    protected String createOrder(UUID userId, UUID bookingId) throws Exception {
        return createOrderCall(userId, bookingId, "key-" + UUID.randomUUID()).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    protected ResultActions verifyCall(UUID userId, String orderId, String paymentId, String signature)
            throws Exception {
        return mockMvc.perform(post("/api/payments/verify").with(customer(userId))
                .contentType(MediaType.APPLICATION_JSON).content("""
                        {"orderId":"%s","paymentId":"%s","signature":"%s"}""".formatted(orderId, paymentId, signature)));
    }

    protected String paymentStatus(UUID bookingId) {
        return jdbcClient.sql("SELECT status FROM payment_transactions WHERE booking_id = UUID_TO_BIN(:id) "
                        + "ORDER BY created_at DESC LIMIT 1")
                .param("id", bookingId.toString()).query(String.class).single();
    }

    protected static String json(String body, String path) {
        return JsonPath.read(body, path);
    }

    // ------------------------------------------------------------------ payment-service's events

    protected List<Object> events(UUID bookingId) {
        return jdbcClient.sql("""
                        SELECT payload FROM outbox_events WHERE aggregate_type = 'payment' AND aggregate_id = :id
                        ORDER BY created_at, id""")
                .param("id", bookingId.toString())
                .query((rs, i) -> AVRO.deserialize("payment.events", rs.getBytes("payload")))
                .list();
    }

    protected <T> List<T> eventsOf(UUID bookingId, Class<T> type) {
        return events(bookingId).stream().filter(type::isInstance).map(type::cast).toList();
    }

    protected <T> T single(UUID bookingId, Class<T> type) {
        List<T> matching = eventsOf(bookingId, type);
        assertThat(matching).as("%s events for booking %s", type.getSimpleName(), bookingId).hasSize(1);
        return matching.getFirst();
    }

    protected ResultActions getAs(UUID userId, String path) throws Exception {
        return mockMvc.perform(get(path).with(customer(userId)));
    }
}
