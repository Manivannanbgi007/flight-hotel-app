package com.flighthotel.flight;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.LocalDate;
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

import com.flighthotel.common.id.UuidV7;
import com.flighthotel.events.booking.BookingExpired;
import com.flighthotel.events.booking.BookingFailed;
import com.flighthotel.events.booking.BookingInitiated;
import com.flighthotel.events.booking.BookingPaid;
import com.flighthotel.events.booking.FlightBookingRequest;
import com.flighthotel.events.booking.FlightPassengerInfo;
import com.flighthotel.flight.booking.BookingEventsListener;
import com.flighthotel.flight.booking.FlightJobs;
import com.jayway.jsonpath.JsonPath;

import io.confluent.kafka.serializers.KafkaAvroDeserializer;

/**
 * Base for flight-service integration tests: the real service with the DEMO timetable against MySQL and Redis
 * (Testcontainers, started once). Kafka listeners are off; tests hand booking-service's events to the listener
 * directly and read flight-service's events back from the outbox, decoded like a consumer would.
 */
@SpringBootTest(properties = {
        "spring.kafka.listener.auto-startup=false",
        "travel.kafka.schema-registry-url=mock://flight-it",
        "flight.demo.enabled=true",
        // Reconciliation: give up after 2 looks (the job still waits for notFoundAfter, which the tests age in SQL)
        "flight.reconcile.max-attempts=2",
        "flight.reconcile.not-found-after=5m"
})
@AutoConfigureMockMvc
public abstract class FlightIntegrationTest {

    static final MySQLContainer MYSQL = new MySQLContainer("mysql:8.4.13").withDatabaseName("flight_db");
    static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:8.4.8")).withExposedPorts(6379);
    private static final KafkaAvroDeserializer AVRO = new KafkaAvroDeserializer();

    static {
        MYSQL.start();
        REDIS.start();
        AVRO.configure(Map.of("schema.registry.url", "mock://flight-it", "specific.avro.reader", true), false);
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

    @Autowired
    protected FlightJobs jobs;

    // ------------------------------------------------------------------ users

    protected static JwtRequestPostProcessor admin() {
        return user(Set.of("ADMIN"));
    }

    protected static JwtRequestPostProcessor customer() {
        return user(Set.of("CUSTOMER"));
    }

    private static JwtRequestPostProcessor user(Set<String> roles) {
        List<GrantedAuthority> authorities = new ArrayList<>();
        roles.forEach(role -> authorities.add(new SimpleGrantedAuthority("ROLE_" + role)));
        return jwt().jwt(token -> token.subject(UUID.randomUUID().toString()).claim("roles", List.copyOf(roles))
                .claim("permissions", List.of())).authorities(authorities);
    }

    // ------------------------------------------------------------------ searching and trips

    protected static LocalDate date(int daysAhead) {
        return LocalDate.now().plusDays(daysAhead);
    }

    protected String search(String query) throws Exception {
        return mockMvc.perform(get("/api/flights/search?" + query)).andExpect(status().isOk()).andReturn()
                .getResponse().getContentAsString();
    }

    protected String offerId(String searchResponse, String direction, int index) {
        return JsonPath.read(searchResponse, "$." + direction + ".options[" + index + "].offerId");
    }

    /** Revalidates and returns the trip offer JSON. */
    protected String revalidate(String... offerIds) throws Exception {
        String ids = String.join("\",\"", offerIds);
        return mockMvc.perform(post("/api/flights/revalidate").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"offerIds\":[\"" + ids + "\"]}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    }

    /** A one-way DEL to BOM trip for {@code adults} adults (cheapest economy option), revalidated. */
    protected String oneWayTrip(int daysAhead, int adults) throws Exception {
        String found = search("origin=DEL&destination=BOM&departureDate=" + date(daysAhead) + "&adults=" + adults);
        return revalidate(offerId(found, "outbound", 0));
    }

    // ------------------------------------------------------------------ booking-service's side

    protected static FlightPassengerInfo passenger(int index, String type, String first, String last) {
        return FlightPassengerInfo.newBuilder().setIndex(index).setPassengerType(type).setFirstName(first)
                .setLastName(last).build();
    }

    protected UUID initiate(String tripOfferId, FlightPassengerInfo... passengers) {
        UUID bookingId = UUID.randomUUID();
        bookingEvents.handle(eventId(), BookingInitiated.newBuilder()
                .setBookingId(bookingId.toString())
                .setBookingReference("FL-" + bookingId.toString().substring(0, 8).toUpperCase())
                .setUserId(UUID.randomUUID().toString())
                .setBookingType("FLIGHT")
                .setFlight(FlightBookingRequest.newBuilder().setOfferId(tripOfferId).setPassengers(List.of(passengers))
                        .setContactEmail("asha@example.com").setContactPhone("+91 98000 00000").build())
                .setInitiatedAt(Instant.now())
                .build());
        return bookingId;
    }

    protected void paid(UUID bookingId) {
        bookingEvents.handle(eventId(), BookingPaid.newBuilder().setBookingId(bookingId.toString())
                .setBookingType("FLIGHT").setPaymentId(UUID.randomUUID().toString()).setPaidAt(Instant.now()).build());
    }

    protected void bookingFailed(UUID bookingId) {
        bookingEvents.handle(eventId(), BookingFailed.newBuilder().setBookingId(bookingId.toString())
                .setBookingType("FLIGHT").setReason("TEST").setFailedAt(Instant.now()).build());
    }

    protected void bookingExpired(UUID bookingId) {
        bookingEvents.handle(eventId(), BookingExpired.newBuilder().setBookingId(bookingId.toString())
                .setBookingType("FLIGHT").setExpiredAt(Instant.now()).build());
    }

    protected static String eventId() {
        return UuidV7.generate().toString();
    }

    // ------------------------------------------------------------------ flight-service's events and tables

    protected List<Object> events(UUID bookingId) {
        return jdbcClient.sql("SELECT payload FROM outbox_events WHERE aggregate_type = 'flight' "
                        + "AND aggregate_id = :id ORDER BY created_at, id")
                .param("id", bookingId.toString())
                .query((rs, i) -> AVRO.deserialize("flight.events", rs.getBytes("payload"))).list();
    }

    protected <T> List<T> eventsOf(UUID bookingId, Class<T> type) {
        return events(bookingId).stream().filter(type::isInstance).map(type::cast).toList();
    }

    protected <T> T single(UUID bookingId, Class<T> type) {
        List<T> matching = eventsOf(bookingId, type);
        assertThat(matching).as("%s events for booking %s", type.getSimpleName(), bookingId).hasSize(1);
        return matching.getFirst();
    }

    protected String bookingStatus(UUID bookingId) {
        return jdbcClient.sql("SELECT status FROM flight_supplier_bookings WHERE booking_id = UUID_TO_BIN(:id)")
                .param("id", bookingId.toString()).query(String.class).single();
    }

    /** Seats held and sold of the schedule behind a trip offer's first flight (economy, that date). */
    protected int[] seatsOf(String tripOffer, int sliceIndex) {
        String flightNumber = JsonPath.read(tripOffer, "$.slices[" + sliceIndex + "].flightNumber");
        String origin = JsonPath.read(tripOffer, "$.slices[" + sliceIndex + "].origin.iataCode");
        String destination = JsonPath.read(tripOffer, "$.slices[" + sliceIndex + "].destination.iataCode");
        String when = JsonPath.read(tripOffer, "$.slices[" + sliceIndex + "].departureLocal");
        return jdbcClient.sql("SELECT i.seats_held, i.seats_sold FROM demo_seat_inventory i "
                        + "JOIN demo_flight_schedules s ON s.id = i.schedule_id WHERE s.flight_number = :f "
                        + "AND s.origin = :o AND s.destination = :d AND i.flight_date = :date AND i.cabin = 'ECONOMY'")
                .param("f", flightNumber).param("o", origin).param("d", destination)
                .param("date", java.sql.Date.valueOf(when.substring(0, 10)))
                .query((rs, i) -> new int[] { rs.getInt(1), rs.getInt(2) }).optional().orElse(new int[] { 0, 0 });
    }
}
